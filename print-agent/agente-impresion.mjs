#!/usr/bin/env node
/**
 * Agente de impresión de boletas
 * ──────────────────────────────
 * Se ejecuta en la PC de la tienda (Windows) y:
 *   1. Se conecta a tu tienda (local o en Internet) con su token.
 *   2. Recibe las boletas pendientes y las envía a la impresora térmica
 *      (ESC/POS) sin abrir ninguna ventana de impresión.
 *   3. Informa si se imprimió o falló. Nunca reimprime por su cuenta.
 *
 * Requisitos: Node.js 18 o superior. No necesita instalar paquetes.
 *
 *   node agente-impresion.mjs                       inicia el agente
 *   node agente-impresion.mjs --listar              muestra las impresoras de Windows
 *   node agente-impresion.mjs --probar "Nombre"     imprime una prueba local en esa impresora
 *   node agente-impresion.mjs --probar-red 192.168.1.50:9100
 */
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "1.0.0";
const DIR = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = path.join(DIR, "config.json");
const JOURNAL_FILE = path.join(DIR, "registro-trabajos.json");
const LOG_FILE = path.join(DIR, "agente.log");
const PS_SCRIPT = path.join(DIR, "imprimir-raw.ps1");
const IS_WINDOWS = process.platform === "win32";

// ───────────────────────── Registro ─────────────────────────

function log(level, message) {
  const line = `[${new Date().toLocaleString("es-PE")}] ${level.padEnd(5)} ${message}`;
  (level === "ERROR" ? console.error : console.log)(line);
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 1_000_000) {
      fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
    }
    fs.appendFileSync(LOG_FILE, `${line}\n`);
  } catch {
    /* el registro en archivo es opcional */
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ───────────────────────── Configuración ─────────────────────────

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    throw new Error(
      "No se encontró config.json. Descarga el agente desde el panel (Boletas e impresión → Agente) " +
        "para obtener el archivo con tu token.",
    );
  }
  const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  if (!cfg.serverUrl || !cfg.token) throw new Error("config.json debe tener serverUrl y token");
  cfg.serverUrl = String(cfg.serverUrl).replace(/\/+$/, "");
  return cfg;
}

// ───────────────────────── Registro de trabajos ─────────────────────────
// Guarda qué trabajos ya se imprimieron. Si se corta Internet justo después de
// imprimir, el agente vuelve a INFORMAR el resultado, pero nunca vuelve a imprimir.

function readJournal() {
  try {
    return JSON.parse(fs.readFileSync(JOURNAL_FILE, "utf8"));
  } catch {
    return [];
  }
}

function writeJournal(entries) {
  const tmp = `${JOURNAL_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(entries.slice(-300), null, 2));
  fs.renameSync(tmp, JOURNAL_FILE);
}

// ───────────────────────── Comunicación con la tienda ─────────────────────────

async function api(cfg, pathname, body, timeoutMs = 15_000) {
  const res = await fetch(`${cfg.serverUrl}/api/print-agent${pathname}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 204) return null;
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* respuesta no JSON */
  }
  if (res.status === 401) {
    const err = new Error(data?.error || "Token rechazado. Descarga de nuevo el agente desde el panel.");
    err.fatal = true;
    throw err;
  }
  if (!res.ok) throw new Error(data?.error || `La tienda respondió ${res.status}`);
  return data;
}

// ───────────────────────── Impresoras de Windows ─────────────────────────

function run(cmd, args, { timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("La operación tardó demasiado"));
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

const PS_ARGS = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass"];

async function listPrinters() {
  if (!IS_WINDOWS) return [];
  const command =
    "[Console]::OutputEncoding=[Text.Encoding]::UTF8; " +
    "Get-CimInstance Win32_Printer | Select-Object Name,DriverName,PortName,Default,WorkOffline,PrinterStatus | ConvertTo-Json -Compress";
  const { code, stdout, stderr } = await run("powershell.exe", [...PS_ARGS, "-Command", command], { timeoutMs: 30_000 });
  if (code !== 0) throw new Error(stderr || "No se pudo obtener la lista de impresoras");
  if (!stdout) return [];
  const parsed = JSON.parse(stdout);
  const list = Array.isArray(parsed) ? parsed : [parsed];
  return list.map((p) => ({
    name: p.Name,
    driver: p.DriverName ?? null,
    port: p.PortName ?? null,
    isDefault: Boolean(p.Default),
    offline: Boolean(p.WorkOffline),
    status: p.PrinterStatus != null ? String(p.PrinterStatus) : null,
  }));
}

/**
 * Envía bytes "RAW" (ESC/POS) a una impresora instalada en Windows usando la API
 * del administrador de impresión (winspool). Luego vigila la cola: si la
 * impresora da error o no responde, CANCELA el trabajo para que no se imprima
 * más tarde por sorpresa (evita boletas duplicadas al reintentar).
 */
const RAW_PRINT_PS1 = String.raw`param(
  [Parameter(Mandatory=$true)][string]$Printer,
  [Parameter(Mandatory=$true)][string]$Path,
  [string]$DocName = "Boleta",
  [int]$TimeoutSec = 25
)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try {
  Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class RawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }

  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern int StartDocPrinter(IntPtr hPrinter, int level, [In] DOCINFO di);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int dwWritten);

  public static int Send(string printer, byte[] data, string docName) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) {
      throw new Win32Exception(Marshal.GetLastWin32Error(), "No se pudo abrir la impresora '" + printer + "'");
    }
    try {
      DOCINFO di = new DOCINFO();
      di.pDocName = docName;
      di.pDataType = "RAW";
      int jobId = StartDocPrinter(h, 1, di);
      if (jobId == 0) {
        throw new Win32Exception(Marshal.GetLastWin32Error(), "La impresora rechazó el documento");
      }
      try {
        if (!StartPagePrinter(h)) {
          throw new Win32Exception(Marshal.GetLastWin32Error(), "No se pudo iniciar la página");
        }
        int written;
        bool ok = WritePrinter(h, data, data.Length, out written);
        EndPagePrinter(h);
        if (!ok || written != data.Length) {
          throw new Win32Exception(Marshal.GetLastWin32Error(), "No se pudieron enviar los datos a la impresora");
        }
      } finally {
        EndDocPrinter(h);
      }
      return jobId;
    } finally {
      ClosePrinter(h);
    }
  }
}
"@

  $bytes = [System.IO.File]::ReadAllBytes($Path)
  $jobId = [RawPrinter]::Send($Printer, $bytes, $DocName)

  # Vigilar la cola de Windows hasta que el trabajo salga
  $canWatch = $null -ne (Get-Command Get-PrintJob -ErrorAction SilentlyContinue)
  if (-not $canWatch) { Write-Output "OK $jobId"; exit 0 }
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $job = Get-PrintJob -PrinterName $Printer -ID $jobId -ErrorAction SilentlyContinue
    if ($null -eq $job) { Write-Output "OK $jobId"; exit 0 }
    $st = [string]$job.JobStatus
    if ($st -match "Error|Offline|PaperOut|UserIntervention|Blocked|Paused") {
      Remove-PrintJob -PrinterName $Printer -ID $jobId -ErrorAction SilentlyContinue
      [Console]::Error.WriteLine("La impresora reportó un problema ($st). El trabajo se canceló.")
      exit 2
    }
    Start-Sleep -Milliseconds 500
  }
  Remove-PrintJob -PrinterName $Printer -ID $jobId -ErrorAction SilentlyContinue
  [Console]::Error.WriteLine("La impresora no respondió en $TimeoutSec s (¿apagada, sin papel o desconectada?). El trabajo se canceló.")
  exit 3
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
`;

async function printWindows(printerName, data, documentName) {
  if (!IS_WINDOWS) {
    throw new Error("Imprimir por nombre de impresora solo funciona en Windows. Usa una impresora de red (IP).");
  }
  let printer = printerName;
  if (!printer) {
    const def = (await listPrinters()).find((p) => p.isDefault);
    if (!def) throw new Error("No hay impresora predeterminada en Windows. Elige una en el panel.");
    printer = def.name;
  }
  fs.writeFileSync(PS_SCRIPT, `﻿${RAW_PRINT_PS1}`); // BOM: PowerShell 5 lee bien los acentos
  const tmp = path.join(os.tmpdir(), `boleta-${crypto.randomBytes(6).toString("hex")}.bin`);
  fs.writeFileSync(tmp, data);
  try {
    const { code, stdout, stderr } = await run(
      "powershell.exe",
      [...PS_ARGS, "-File", PS_SCRIPT, "-Printer", printer, "-Path", tmp, "-DocName", documentName],
      { timeoutMs: 60_000 },
    );
    if (code !== 0) throw new Error(stderr || stdout || `Error ${code} al imprimir`);
    return printer;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** Impresora de red (puerto 9100). Si responde al estado ESC/POS, se comprueba el papel. */
function printNetwork(host, port, data) {
  return new Promise((resolve, reject) => {
    if (!host) {
      reject(new Error("Falta la IP de la impresora de red (configúrala en el panel)"));
      return;
    }
    const socket = net.connect({ host, port: port || 9100 });
    let phase = "connect";
    const fail = (msg) => {
      socket.destroy();
      reject(new Error(msg));
    };
    socket.setTimeout(8000, () => fail(`La impresora ${host}:${port} no responde`));
    socket.on("error", (e) => fail(`No se pudo conectar con ${host}:${port} (${e.code || e.message})`));
    socket.on("connect", () => {
      phase = "status";
      socket.write(Buffer.from([0x10, 0x04, 0x04])); // DLE EOT 4: estado del papel
      const timer = setTimeout(send, 1200); // muchas impresoras no responden: se continúa
      socket.once("data", (buf) => {
        clearTimeout(timer);
        if (phase !== "status") return;
        if ((buf[0] & 0x60) === 0x60) fail("La impresora no tiene papel");
        else send();
      });
    });
    function send() {
      if (phase !== "status") return;
      phase = "send";
      socket.end(data, () => {
        phase = "done";
        resolve(`Red ${host}:${port}`);
      });
    }
  });
}

async function printBytes(target, data, documentName) {
  if (target?.type === "network") return printNetwork(target.host, target.port, data);
  return printWindows(target?.printerName || null, data, documentName);
}

// ───────────────────────── Bucle principal ─────────────────────────

async function report(cfg, entry) {
  await api(cfg, `/jobs/${encodeURIComponent(entry.id)}/result`, entry.result);
  entry.reported = true;
}

async function flushReports(cfg) {
  const journal = readJournal();
  const pending = journal.filter((e) => !e.reported);
  for (const entry of pending) {
    await report(cfg, entry);
    log("INFO", `Resultado del trabajo ${entry.id} informado a la tienda`);
  }
  if (pending.length) writeJournal(journal);
}

async function handleJob(cfg, job) {
  const journal = readJournal();
  const known = journal.find((e) => e.id === job.id);
  if (known) {
    // Ya se procesó: solo se vuelve a informar, jamás se imprime dos veces
    log("WARN", `El trabajo ${job.id} ya se había procesado; se informa sin reimprimir`);
    known.reported = false;
    writeJournal(journal);
    return;
  }
  log("INFO", `Imprimiendo ${job.documentName}…`);
  let result;
  try {
    const printer = await printBytes(job.target, Buffer.from(job.payloadBase64, "base64"), job.documentName);
    result = { ok: true, printer };
    log("OK", `${job.documentName} impresa en ${printer}`);
  } catch (err) {
    result = { ok: false, error: err.message };
    log("ERROR", `${job.documentName}: ${err.message}`);
  }
  const entry = { id: job.id, document: job.documentName, at: new Date().toISOString(), result, reported: false };
  journal.push(entry);
  writeJournal(journal); // se guarda ANTES de informar
  try {
    await report(cfg, entry);
    writeJournal(journal);
  } catch (err) {
    log("WARN", `No se pudo informar el resultado (${err.message}); se reintentará el aviso`);
  }
}

async function main() {
  const cfg = loadConfig();
  log("INFO", `Agente de impresión v${VERSION} — tienda: ${cfg.serverUrl}`);
  if (!IS_WINDOWS) log("WARN", "No es Windows: solo se puede imprimir en impresoras de red (IP)");

  let printers = [];
  let printersAt = 0;
  let heartbeatAt = 0;
  let backoff = 2000;
  let connected = false;

  for (;;) {
    try {
      if (Date.now() - printersAt > 60_000) {
        try {
          printers = await listPrinters();
        } catch (err) {
          log("WARN", `No se pudieron listar las impresoras: ${err.message}`);
        }
        printersAt = Date.now();
      }
      if (Date.now() - heartbeatAt > 15_000) {
        const hb = await api(cfg, "/heartbeat", {
          version: VERSION,
          hostname: os.hostname(),
          platform: process.platform,
          printers,
        });
        heartbeatAt = Date.now();
        if (!connected) {
          log("OK", `Conectado como "${hb.agentName}". Impresora configurada: ${hb.printer} (${hb.paperWidth} mm)`);
          connected = true;
        }
      }
      await flushReports(cfg);
      const res = await api(cfg, "/jobs/claim", {}, 35_000);
      if (res?.job) await handleJob(cfg, res.job);
      backoff = 2000;
    } catch (err) {
      if (err.fatal) {
        log("ERROR", err.message);
        process.exit(2);
      }
      if (connected) log("WARN", `Sin conexión con la tienda: ${err.message}`);
      else log("WARN", `No se pudo conectar con la tienda (${err.message}). Reintentando…`);
      connected = false;
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 60_000);
    }
  }
}

// ───────────────────────── Comandos de ayuda ─────────────────────────

function localTestTicket() {
  const enc = (s) => Buffer.from(s.normalize("NFD").replace(/[̀-ͯ]/g, ""), "ascii");
  return Buffer.concat([
    Buffer.from([0x1b, 0x40, 0x1b, 0x61, 1, 0x1d, 0x21, 0x11]),
    enc("PRUEBA\n"),
    Buffer.from([0x1d, 0x21, 0x00]),
    enc(`Agente de impresion v${VERSION}\n${new Date().toLocaleString("es-PE")}\n`),
    enc("Conexion con la impresora: OK\n"),
    Buffer.from([0x1b, 0x64, 4, 0x1d, 0x56, 0x42, 0x02]),
  ]);
}

const args = process.argv.slice(2);
if (args[0] === "--listar") {
  const list = await listPrinters();
  if (!list.length) console.log(IS_WINDOWS ? "No se encontraron impresoras." : "Solo disponible en Windows.");
  for (const p of list) {
    console.log(`${p.isDefault ? "★" : " "} ${p.name}  (${p.driver ?? "?"} · ${p.port ?? "?"})${p.offline ? "  [SIN CONEXIÓN]" : ""}`);
  }
} else if (args[0] === "--probar") {
  const printer = await printWindows(args[1] || null, localTestTicket(), "Prueba del agente");
  console.log(`Prueba enviada a ${printer}`);
} else if (args[0] === "--probar-red") {
  const [host, port] = String(args[1] || "").split(":");
  console.log(`Prueba enviada a ${await printNetwork(host, Number(port) || 9100, localTestTicket())}`);
} else if (args[0] === "--version") {
  console.log(VERSION);
} else {
  main().catch((err) => {
    log("ERROR", err.message);
    process.exit(1);
  });
}
