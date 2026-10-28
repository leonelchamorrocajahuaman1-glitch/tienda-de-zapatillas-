import type { PrintJob, ReceiptSettings } from "@prisma/client";
import { prisma } from "../db";
import { plainText } from "./escpos";
import { expireStalePrintJobs, getSettings, jobContent, printEvents, storeNameOf } from "./receipts";

/**
 * Central de impresión externa
 * ────────────────────────────
 * Con la conexión "central", la tienda no usa su propio agente: cada boleta se
 * envía a la API de la central (POST /api/jobs) y el agente de Windows de la
 * central la imprime en su impresora.
 *
 * - Credenciales SOLO en variables de entorno (nunca en el código ni en la base):
 *     CENTRAL_PRINT_URL     https://…/api/jobs
 *     CENTRAL_SITE_TOKEN    → cabecera OAI-Sites-Authorization
 *     CENTRAL_SUBMIT_TOKEN  → cabecera Authorization
 * - La central no imprime dos veces el mismo (source, external_id). Por eso un
 *   reintento reutiliza la referencia del intento fallido: si el comprobante sí
 *   había llegado, la central no lo repite. Una reimpresión lleva una referencia nueva.
 * - La central solo acepta texto: la boleta va sin logo ni líneas gráficas.
 */

const TIMEOUT_MS = 20_000;
const MAX_CONTENT = 8000;
const BACKOFF_MS = [2000, 6000];

interface CentralConfig {
  url: string;
  siteToken: string;
  submitToken: string;
}

export function centralConfig(): CentralConfig | null {
  const url = process.env.CENTRAL_PRINT_URL?.trim();
  const siteToken = process.env.CENTRAL_SITE_TOKEN?.trim();
  const submitToken = process.env.CENTRAL_SUBMIT_TOKEN?.trim();
  if (!url || !siteToken || !submitToken) return null;
  try {
    const u = new URL(url);
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    // Los tokens solo viajan cifrados (http solo para pruebas en el mismo equipo)
    if (u.protocol !== "https:" && !(local && u.protocol === "http:")) return null;
  } catch {
    return null;
  }
  return { url, siteToken, submitToken };
}

/** Dominio de la central (para mostrarlo en el panel, sin tokens). */
export function centralHost(): string | null {
  const cfg = centralConfig();
  return cfg ? new URL(cfg.url).host : null;
}

/** Referencia del comprobante en la central. */
async function externalRefFor(job: PrintJob, code: string | null, copy: boolean): Promise<string> {
  if (job.reason === "RETRY") {
    // Reintento: misma referencia que el intento fallido que se reintentó
    const retried = await prisma.printJob.findFirst({
      where: {
        receiptId: job.receiptId,
        status: "FAILED",
        retriedAt: { not: null },
        createdAt: { lt: job.createdAt },
        externalRef: { not: null },
      },
      orderBy: { retriedAt: "desc" },
    });
    if (retried?.externalRef) return retried.externalRef;
  }
  const short = job.id.slice(-8).toUpperCase();
  if (!code) return `TEST-${short}`;
  return copy ? `${code}-COPIA-${short}` : code;
}

type SendResult = { ok: true; duplicate: boolean } | { ok: false; retry: boolean; error: string };

async function post(cfg: CentralConfig, body: unknown): Promise<SendResult> {
  let res: Response;
  try {
    res = await fetch(cfg.url, {
      method: "POST",
      redirect: "error", // una redirección podría llevar los tokens a otro sitio
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        "OAI-Sites-Authorization": `Bearer ${cfg.siteToken}`,
        Authorization: `Bearer ${cfg.submitToken}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const timeout = (err as Error).name === "TimeoutError";
    return { ok: false, retry: true, error: timeout ? "La central no respondió a tiempo" : "No se pudo conectar con la central" };
  }
  if (res.status === 200 || res.status === 201) {
    const data = (await res.json().catch(() => ({}))) as { duplicate?: boolean };
    return { ok: true, duplicate: res.status === 200 || data.duplicate === true };
  }
  const detail = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 160);
  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      retry: false,
      error: "La central rechazó las credenciales. Revisa CENTRAL_SITE_TOKEN y CENTRAL_SUBMIT_TOKEN en Render.",
    };
  }
  if (res.status === 429 || res.status >= 500) {
    return { ok: false, retry: true, error: `La central no está disponible (HTTP ${res.status})` };
  }
  return { ok: false, retry: false, error: `La central rechazó el comprobante (HTTP ${res.status})${detail ? `: ${detail}` : ""}` };
}

async function send(job: PrintJob, settings: ReceiptSettings, cfg: CentralConfig) {
  let externalRef: string | null = null;
  try {
    const content = await jobContent(job, settings, "text");
    externalRef = await externalRefFor(job, content.code, content.copy);
    await prisma.printJob.update({ where: { id: job.id }, data: { externalRef } });
    const text = plainText(content.blocks, content.cols).slice(0, MAX_CONTENT);
    const body = {
      source: process.env.CENTRAL_SOURCE?.trim() || storeNameOf(settings),
      external_id: externalRef,
      title: `${content.documentName}${content.copy ? " (COPIA)" : ""}`,
      content: text,
      copies: job.kind === "TEST" ? 1 : Math.min(3, Math.max(1, settings.copies)),
    };
    let result: SendResult = await post(cfg, body);
    // Errores de red o de la central: se reintenta con la MISMA referencia (no duplica)
    for (let i = 0; !result.ok && result.retry && i < BACKOFF_MS.length; i++) {
      await new Promise((r) => setTimeout(r, BACKOFF_MS[i]));
      result = await post(cfg, body);
    }
    if (result.ok) {
      await prisma.printJob.update({
        where: { id: job.id },
        data: {
          status: "PRINTED",
          finishedAt: new Date(),
          error: null,
          printerLabel: `Central de impresión · ${externalRef}${result.duplicate ? " (ya estaba en la central)" : ""}`,
        },
      });
    } else {
      await prisma.printJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          finishedAt: new Date(),
          error: result.retry
            ? `${result.error}. Reintentar es seguro: la central no imprime dos veces el mismo comprobante.`
            : result.error,
        },
      });
      console.warn(`[central] ${job.id}: ${result.error}`);
    }
  } catch (err) {
    await prisma.printJob.update({
      where: { id: job.id },
      data: { status: "FAILED", finishedAt: new Date(), error: `No se pudo preparar el comprobante: ${(err as Error).message}` },
    });
  }
}

let running = false;
let again = false;

/** Envía a la central los trabajos pendientes (de uno en uno). */
export async function dispatchCentral(): Promise<void> {
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    do {
      again = false;
      const settings = await getSettings();
      const cfg = centralConfig();
      if (settings.connection !== "central" || !cfg) return;
      await expireStalePrintJobs();
      for (;;) {
        const next = await prisma.printJob.findFirst({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" } });
        if (!next) break;
        // Toma atómica: nadie más envía o imprime este trabajo
        const claimed = await prisma.printJob.updateMany({
          where: { id: next.id, status: "PENDING" },
          data: { status: "PRINTING", claimedAt: new Date(), agentId: null, printerLabel: "Central de impresión" },
        });
        if (claimed.count === 1) await send(next, settings, cfg);
      }
    } while (again);
  } catch (err) {
    console.error("[central] error al enviar comprobantes:", (err as Error).message);
  } finally {
    running = false;
  }
}

// Cada trabajo nuevo se envía en cuanto se crea
printEvents.on("job", () => void dispatchCentral());

/** Revisión periódica (trabajos que quedaron pendientes, p. ej. tras un reinicio). */
export function startCentralDispatcher(everyMs = 30_000) {
  void dispatchCentral();
  return setInterval(() => void dispatchCentral(), everyMs).unref();
}
