import crypto from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type { PrintAgent, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { unauthorized } from "../lib/errors";
import { parse } from "../lib/validate";
import { expireStalePrintJobs, getSettings, printEvents, printerLabel, renderJob } from "../services/receipts";

/**
 * API del agente de impresión (programa instalado en la PC de la tienda).
 * Se autentica con un token propio (Authorization: Bearer …) que solo permite
 * recibir trabajos de impresión: no da acceso al panel ni a datos de clientes.
 */
export const printAgentRouter = Router();

export const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      agent?: PrintAgent;
    }
  }
}

async function requireAgent(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw unauthorized("Falta el token del agente");
  const agent = await prisma.printAgent.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!agent || agent.revokedAt) throw unauthorized("Token de agente inválido o revocado");
  req.agent = await prisma.printAgent.update({ where: { id: agent.id }, data: { lastSeenAt: new Date() } });
  next();
}

printAgentRouter.use(rateLimit({ windowMs: 60 * 1000, limit: 240, standardHeaders: true, legacyHeaders: false }));
printAgentRouter.use(requireAgent);

const printerInfo = z.object({
  name: z.string().max(200),
  driver: z.string().max(200).optional().nullable(),
  port: z.string().max(200).optional().nullable(),
  isDefault: z.boolean().optional(),
  offline: z.boolean().optional(),
  status: z.string().max(60).optional().nullable(),
});

/** Latido: el agente informa que está vivo y qué impresoras ve en Windows. */
printAgentRouter.post("/heartbeat", async (req, res) => {
  const body = parse(
    z.object({
      version: z.string().max(40).optional(),
      hostname: z.string().max(120).optional(),
      platform: z.string().max(40).optional(),
      printers: z.array(printerInfo).max(50).optional(),
    }),
    req.body,
  );
  await prisma.printAgent.update({
    where: { id: req.agent!.id },
    data: {
      version: body.version,
      hostname: body.hostname,
      ...(body.printers ? { printers: body.printers as Prisma.InputJsonValue } : {}),
    },
  });
  const settings = await getSettings();
  res.json({ ok: true, agentName: req.agent!.name, printer: printerLabel(settings), paperWidth: settings.paperWidth });
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Pide el siguiente trabajo (long-polling: espera hasta ~20 s si no hay ninguno).
 * El trabajo se reclama de forma atómica: PENDIENTE → IMPRIMIENDO.
 */
printAgentRouter.post("/jobs/claim", async (req, res) => {
  const agent = req.agent!;
  // Si el agente corta la conexión mientras espera, se deja de buscar
  let closed = false;
  res.on("close", () => {
    if (!res.writableFinished) closed = true;
  });
  const waitMs = Math.max(0, Math.min(20_000, Number((req.body as { waitMs?: unknown })?.waitMs ?? 20_000) || 0));
  const deadline = Date.now() + waitMs;

  for (let first = true; !closed && (first || Date.now() < deadline); first = false) {
    await expireStalePrintJobs();
    const settings = await getSettings();
    if (settings.agentId && settings.agentId !== agent.id) {
      // Otro agente está asignado a la impresora: este solo mantiene el latido.
      await sleep(5000);
      continue;
    }
    const next = await prisma.printJob.findFirst({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" } });
    if (next) {
      const claimed = await prisma.printJob.updateMany({
        where: { id: next.id, status: "PENDING" },
        data: { status: "PRINTING", agentId: agent.id, claimedAt: new Date(), printerLabel: printerLabel(settings) },
      });
      if (claimed.count === 1) {
        try {
          const { payload, documentName } = await renderJob(next);
          res.json({
            job: {
              id: next.id,
              kind: next.kind,
              documentName,
              payloadBase64: payload.toString("base64"),
              target:
                settings.connection === "network"
                  ? { type: "network", host: settings.networkHost, port: settings.networkPort }
                  : { type: "windows", printerName: settings.printerName },
            },
          });
        } catch (err) {
          await prisma.printJob.update({
            where: { id: next.id },
            data: { status: "FAILED", finishedAt: new Date(), error: `No se pudo generar la boleta: ${(err as Error).message}` },
          });
          res.status(204).end();
        }
        return;
      }
      continue; // otro agente lo tomó primero
    }
    // Espera a que llegue un trabajo nuevo (o revisa de nuevo en 2 s)
    await new Promise<void>((resolve) => {
      const t = setTimeout(done, 2000);
      function done() {
        clearTimeout(t);
        printEvents.off("job", done);
        resolve();
      }
      printEvents.on("job", done);
    });
  }
  if (!closed) res.status(204).end();
});

/** Resultado de la impresión. Es idempotente: repetirlo no cambia nada. */
printAgentRouter.post("/jobs/:id/result", async (req, res) => {
  const body = parse(
    z.object({
      ok: z.boolean(),
      error: z.string().max(1000).optional().nullable(),
      printer: z.string().max(200).optional().nullable(),
    }),
    req.body,
  );
  const job = await prisma.printJob.findUnique({ where: { id: String(req.params.id) } });
  if (!job || job.agentId !== req.agent!.id) {
    res.json({ ok: true, ignored: true });
    return;
  }
  // Solo se actualiza un trabajo que este agente tenía "imprimiendo", o uno que el
  // servidor dio por perdido mientras el agente seguía trabajando (llega tarde).
  const lateReport = job.status === "FAILED" && job.error?.startsWith("El agente no confirmó");
  if (job.status === "PRINTING" || lateReport) {
    await prisma.printJob.update({
      where: { id: job.id },
      data: {
        status: body.ok ? "PRINTED" : "FAILED",
        error: body.ok ? null : body.error || "Error desconocido al imprimir",
        printerLabel: body.printer || job.printerLabel,
        finishedAt: new Date(),
      },
    });
  }
  res.json({ ok: true });
});
