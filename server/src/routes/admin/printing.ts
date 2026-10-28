import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Prisma, PrintJobStatus } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { config } from "../../config";
import { prisma } from "../../db";
import { badRequest, conflict, notFound } from "../../lib/errors";
import { parse } from "../../lib/validate";
import { createZip } from "../../lib/zip";
import { hashToken } from "../print-agent";
import {
  buildReceiptBlocks,
  buildTestBlocks,
  columnsFor,
  previewLines,
  type ReceiptSnapshot,
} from "../../services/escpos";
import { clearLogoCache, loadLogoRaster, pngToRaster, rasterToPng } from "../../services/receipt-logo";
import {
  expireStalePrintJobs,
  getSettings,
  issueReceipt,
  paymentStatusLabel,
  printEvents,
  printerLabel,
  queuePrint,
  storeNameOf,
} from "../../services/receipts";
import { imageMime, imageUpload, removeByUrl, saveFile } from "../../storage/uploads";

/** Boletas e impresión (panel administrativo). */
export const adminPrintingRouter = Router();

const ONLINE_MS = 45_000;

// ───────────────────────── Configuración ─────────────────────────

adminPrintingRouter.get("/settings", async (_req, res) => {
  const s = await getSettings();
  res.json({ ...s, effectiveStoreName: storeNameOf(s), printerLabel: printerLabel(s) });
});

const settingsBody = z.object({
  enabled: z.boolean(),
  autoPrint: z.boolean(),
  trigger: z.enum(["ON_CONFIRMED", "ON_PAID"]),
  paperWidth: z.union([z.literal(58), z.literal(80)]),
  connection: z.enum(["windows", "network"]),
  printerName: z.string().trim().max(200).nullable(),
  networkHost: z
    .string()
    .trim()
    .max(120)
    .regex(/^[a-zA-Z0-9.\-]*$/, "IP o nombre de equipo inválido")
    .nullable(),
  networkPort: z.number().int().min(1).max(65535),
  agentId: z.string().max(40).nullable(),
  charset: z.enum(["cp850", "cp1252", "ascii"]),
  cutPaper: z.boolean(),
  printLogo: z.boolean(),
  copies: z.number().int().min(1).max(3),
  storeName: z.string().trim().max(40).nullable(),
  title: z.string().trim().min(1).max(40),
  series: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{1,6}$/, "La serie debe tener de 1 a 6 letras o números (p. ej. B001)"),
  headerLines: z.string().max(400),
  footerMessage: z.string().max(400),
  legalNote: z.string().max(400),
});

adminPrintingRouter.put("/settings", async (req, res) => {
  const body = parse(settingsBody, req.body);
  if (body.connection === "network" && !body.networkHost) throw badRequest("Indica la IP de la impresora de red");
  await getSettings();
  const s = await prisma.receiptSettings.update({
    where: { id: 1 },
    data: { ...body, printerName: body.printerName || null, networkHost: body.networkHost || null, storeName: body.storeName || null },
  });
  clearLogoCache();
  res.json({ ...s, effectiveStoreName: storeNameOf(s), printerLabel: printerLabel(s) });
});

/** Logo propio para la boleta (PNG; mejor en blanco y negro con fondo transparente o blanco). */
adminPrintingRouter.post("/settings/logo", imageUpload.single("logo"), async (req, res) => {
  const file = req.file;
  if (!file) throw badRequest("Selecciona un archivo PNG");
  if (imageMime(file.buffer) !== "image/png") throw badRequest("El logo de la boleta debe ser PNG");
  try {
    pngToRaster(file.buffer, 320);
  } catch {
    throw badRequest("No se pudo leer el PNG");
  }
  const current = await getSettings();
  const url = await saveFile("image", file.buffer, "image/png", file.originalname);
  const s = await prisma.receiptSettings.update({ where: { id: 1 }, data: { logoUrl: url } });
  await removeByUrl(current.logoUrl);
  clearLogoCache();
  res.status(201).json({ ...s, effectiveStoreName: storeNameOf(s), printerLabel: printerLabel(s) });
});

adminPrintingRouter.delete("/settings/logo", async (_req, res) => {
  const current = await getSettings();
  const s = await prisma.receiptSettings.update({ where: { id: 1 }, data: { logoUrl: null } });
  await removeByUrl(current.logoUrl);
  clearLogoCache();
  res.json({ ...s, effectiveStoreName: storeNameOf(s), printerLabel: printerLabel(s) });
});

/** El logo exactamente como saldrá en el papel térmico (blanco y negro). */
adminPrintingRouter.get("/logo-preview.png", async (req, res) => {
  const q = parse(z.object({ paperWidth: z.coerce.number().int().default(80) }), req.query);
  const s = await getSettings();
  const raster = await loadLogoRaster(s.logoUrl, q.paperWidth === 58 ? 58 : 80);
  if (!raster) throw notFound("Logo no disponible");
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "no-store");
  res.end(rasterToPng(raster));
});

// ───────────────────────── Estado ─────────────────────────

adminPrintingRouter.get("/status", async (_req, res) => {
  await expireStalePrintJobs();
  const [settings, agents, counts, failures] = await Promise.all([
    getSettings(),
    prisma.printAgent.findMany({ where: { revokedAt: null }, orderBy: { createdAt: "desc" } }),
    prisma.printJob.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.printJob.findMany({
      where: { status: "FAILED", retriedAt: null },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { receipt: { select: { id: true, code: true } } },
    }),
  ]);
  const now = Date.now();
  res.json({
    printer: printerLabel(settings),
    paperWidth: settings.paperWidth,
    autoPrint: settings.enabled && settings.autoPrint,
    agents: agents.map((a) => ({
      id: a.id,
      name: a.name,
      hostname: a.hostname,
      version: a.version,
      lastSeenAt: a.lastSeenAt,
      online: Boolean(a.lastSeenAt && now - a.lastSeenAt.getTime() < ONLINE_MS),
      printers: a.printers ?? [],
    })),
    queue: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
    failures,
  });
});

/** Impresión de prueba. */
adminPrintingRouter.post("/test", async (req, res) => {
  const active = await prisma.printJob.count({ where: { kind: "TEST", status: { in: ["PENDING", "PRINTING"] } } });
  if (active) throw conflict("Ya hay una impresión de prueba en curso");
  const job = await prisma.printJob.create({ data: { kind: "TEST", reason: "TEST", requestedById: req.user!.id } });
  printEvents.emit("job");
  res.status(201).json(job);
});

adminPrintingRouter.get("/test-preview", async (req, res) => {
  const q = parse(z.object({ paperWidth: z.coerce.number().int().optional() }), req.query);
  const s = await getSettings();
  const paperWidth = q.paperWidth === 58 || q.paperWidth === 80 ? q.paperWidth : s.paperWidth;
  const cols = columnsFor(paperWidth);
  const blocks = buildTestBlocks({
    storeName: storeNameOf(s),
    paperWidth,
    printerLabel: printerLabel(s),
    charset: s.charset,
    printLogo: s.printLogo,
    logoHasName: s.printLogo && !s.logoUrl,
  });
  res.json({ cols, paperWidth, lines: previewLines(blocks, cols), cut: s.cutPaper });
});

// ───────────────────────── Boletas ─────────────────────────

const lastJobInclude = {
  printJobs: { orderBy: { createdAt: "desc" }, take: 1 },
  order: { select: { id: true, number: true, status: true, paymentStatus: true } },
} satisfies Prisma.ReceiptInclude;

adminPrintingRouter.get("/receipts", async (req, res) => {
  await expireStalePrintJobs();
  const q = parse(
    z.object({
      q: z.string().trim().max(60).optional(),
      status: z.enum(["PENDING", "PRINTING", "PRINTED", "FAILED", "CANCELLED", "NONE", "VOIDED"]).optional(),
    }),
    req.query,
  );
  const num = q.q ? Number.parseInt(q.q.replace(/\D/g, ""), 10) : NaN;
  const receipts = await prisma.receipt.findMany({
    where: q.q
      ? {
          OR: [
            { code: { contains: q.q.toUpperCase() } },
            ...(Number.isFinite(num) ? [{ order: { number: num } }, { number: num }] : []),
          ],
        }
      : {},
    include: lastJobInclude,
    orderBy: { issuedAt: "desc" },
    take: 500,
  });
  const rows = receipts
    .map((r) => {
      const snap = r.snapshot as unknown as ReceiptSnapshot;
      const last = r.printJobs[0] ?? null;
      return {
        id: r.id,
        code: r.code,
        issuedAt: r.issuedAt,
        voidedAt: r.voidedAt,
        order: r.order,
        customerName: snap.customerName,
        totalCents: snap.totalCents,
        printStatus: (last?.status ?? "NONE") as PrintJobStatus | "NONE",
        lastJob: last,
      };
    })
    .filter((r) => {
      if (!q.status) return true;
      if (q.status === "VOIDED") return Boolean(r.voidedAt);
      return r.printStatus === q.status;
    });
  res.json(rows.slice(0, 200));
});

adminPrintingRouter.get("/receipts/:id", async (req, res) => {
  await expireStalePrintJobs();
  const receipt = await prisma.receipt.findUnique({
    where: { id: String(req.params.id) },
    include: {
      order: { select: { id: true, number: true, status: true, paymentStatus: true, paymentMethod: true } },
      printJobs: {
        orderBy: { createdAt: "desc" },
        include: { requestedBy: { select: { name: true } }, agent: { select: { name: true } } },
      },
    },
  });
  if (!receipt) throw notFound("Boleta no encontrada");
  res.json(receipt);
});

adminPrintingRouter.get("/receipts/:id/preview", async (req, res) => {
  const q = parse(
    z.object({ paperWidth: z.coerce.number().int().optional(), copy: z.enum(["0", "1"]).optional() }),
    req.query,
  );
  const receipt = await prisma.receipt.findUnique({
    where: { id: String(req.params.id) },
    include: { order: { select: { paymentStatus: true, paymentMethod: true } } },
  });
  if (!receipt) throw notFound("Boleta no encontrada");
  const s = await getSettings();
  const paperWidth = q.paperWidth === 58 || q.paperWidth === 80 ? q.paperWidth : s.paperWidth;
  const cols = columnsFor(paperWidth);
  const blocks = buildReceiptBlocks(receipt.snapshot as unknown as ReceiptSnapshot, {
    cols,
    printLogo: s.printLogo,
    logoHasName: s.printLogo && !s.logoUrl,
    copy: q.copy === "1",
    paymentStatusLabel: paymentStatusLabel(receipt.order),
    voided: Boolean(receipt.voidedAt),
  });
  res.json({ cols, paperWidth, lines: previewLines(blocks, cols), cut: s.cutPaper, code: receipt.code });
});

adminPrintingRouter.post("/receipts/:id/reprint", async (req, res) => {
  const receipt = await prisma.receipt.findUnique({ where: { id: String(req.params.id) } });
  if (!receipt) throw notFound("Boleta no encontrada");
  const job = await prisma.$transaction((tx) => queuePrint(tx, receipt.id, "REPRINT", req.user!.id));
  res.status(201).json(job);
});

/** Emisión manual (pedidos anteriores o con la emisión automática desactivada). */
adminPrintingRouter.post("/orders/:orderId/receipt", async (req, res) => {
  const body = parse(z.object({ print: z.boolean().default(true) }), req.body ?? {});
  const order = await prisma.order.findUnique({ where: { id: String(req.params.orderId) } });
  if (!order) throw notFound("Pedido no encontrado");
  if (order.status === "PENDING") throw conflict("Confirma el pedido antes de emitir su boleta");
  if (order.status === "CANCELLED") throw conflict("El pedido está cancelado");
  const settings = await getSettings();
  if (settings.trigger === "ON_PAID" && order.paymentStatus !== "PAID") {
    throw conflict("El pago de este pedido aún no está verificado");
  }
  const result = await prisma.$transaction(async (tx) => {
    const { receipt, created } = await issueReceipt(tx, order.id);
    const job = body.print && created ? await queuePrint(tx, receipt.id, "MANUAL", req.user!.id) : null;
    return { receipt, created, job };
  });
  res.status(result.created ? 201 : 200).json(result);
});

// ───────────────────────── Trabajos ─────────────────────────

adminPrintingRouter.get("/jobs", async (req, res) => {
  await expireStalePrintJobs();
  const q = parse(z.object({ status: z.enum(["PENDING", "PRINTING", "PRINTED", "FAILED", "CANCELLED"]).optional() }), req.query);
  const jobs = await prisma.printJob.findMany({
    where: q.status ? { status: q.status } : {},
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      receipt: { select: { id: true, code: true } },
      requestedBy: { select: { name: true } },
      agent: { select: { name: true } },
    },
  });
  res.json(jobs);
});

/** Reintento manual de una impresión fallida (una sola vez por fallo). */
adminPrintingRouter.post("/jobs/:id/retry", async (req, res) => {
  const job = await prisma.printJob.findUnique({ where: { id: String(req.params.id) } });
  if (!job) throw notFound("Trabajo no encontrado");
  if (job.status !== "FAILED") throw conflict("Solo se pueden reintentar impresiones fallidas");
  const created = await prisma.$transaction(async (tx) => {
    const marked = await tx.printJob.updateMany({
      where: { id: job.id, status: "FAILED", retriedAt: null },
      data: { retriedAt: new Date() },
    });
    if (marked.count !== 1) throw conflict("Esta impresión ya se reintentó");
    if (job.kind === "TEST") {
      return tx.printJob.create({ data: { kind: "TEST", reason: "TEST", requestedById: req.user!.id } });
    }
    return queuePrint(tx, job.receiptId!, "RETRY", req.user!.id);
  });
  printEvents.emit("job");
  res.status(201).json(created);
});

// ───────────────────────── Agentes ─────────────────────────

adminPrintingRouter.get("/agents", async (_req, res) => {
  const agents = await prisma.printAgent.findMany({ orderBy: { createdAt: "desc" } });
  const now = Date.now();
  res.json(
    agents.map(({ tokenHash: _t, ...a }) => ({
      ...a,
      online: Boolean(!a.revokedAt && a.lastSeenAt && now - a.lastSeenAt.getTime() < ONLINE_MS),
    })),
  );
});

const AGENT_FILES = [
  "agente-impresion.mjs",
  "iniciar-agente.bat",
  "listar-impresoras.bat",
  "probar-impresora.bat",
  "instalar-inicio-automatico.bat",
  "quitar-inicio-automatico.bat",
  "LEEME.txt",
];

/** Crea un agente nuevo y descarga el ZIP listo para usar (con su token). */
adminPrintingRouter.post("/agents/package", async (req, res) => {
  const body = parse(
    z.object({
      name: z.string().trim().min(1).max(60).default("PC de la tienda"),
      serverUrl: z.string().trim().url("Dirección de la tienda inválida").max(200),
    }),
    req.body,
  );
  const files = AGENT_FILES.map((name) => ({ name, data: fs.readFileSync(path.join(config.printAgentDir, name)) }));
  const token = crypto.randomBytes(32).toString("base64url");
  const agent = await prisma.printAgent.create({ data: { name: body.name, tokenHash: hashToken(token) } });
  const cfg = { serverUrl: body.serverUrl.replace(/\/+$/, ""), token, agentName: agent.name };
  const zip = createZip([
    ...files.map((f) => ({ name: `agente-impresion/${f.name}`, data: f.data })),
    { name: "agente-impresion/config.json", data: Buffer.from(`${JSON.stringify(cfg, null, 2)}\n`) },
  ]);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", 'attachment; filename="agente-impresion.zip"');
  res.setHeader("Cache-Control", "no-store");
  res.end(zip);
});

adminPrintingRouter.delete("/agents/:id", async (req, res) => {
  const id = String(req.params.id);
  await prisma.printAgent.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
  await prisma.receiptSettings.updateMany({ where: { agentId: id }, data: { agentId: null } });
  // Lo que ese agente tenía a medias queda como fallido (se reintenta a mano)
  await prisma.printJob.updateMany({
    where: { agentId: id, status: "PRINTING" },
    data: { status: "FAILED", finishedAt: new Date(), error: "Agente revocado durante la impresión" },
  });
  res.json({ ok: true });
});
