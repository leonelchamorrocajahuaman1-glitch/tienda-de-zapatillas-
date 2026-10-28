import { EventEmitter } from "node:events";
import type { Order, PaymentStatus, PrintJob, Prisma, ReceiptSettings } from "@prisma/client";
import { prisma, type Tx } from "../db";
import { conflict, notFound } from "../lib/errors";
import { getPaymentProvider } from "../payments";
import {
  buildReceiptBlocks,
  buildTestBlocks,
  columnsFor,
  encodeEscPos,
  type Block,
  type Charset,
  type ReceiptSnapshot,
} from "./escpos";
import { loadLogoRaster } from "./receipt-logo";

/**
 * Boletas de venta
 * ────────────────
 * - Se emiten UNA vez por pedido (Receipt.orderId es único), dentro de la misma
 *   transacción que confirma el pedido: si la confirmación falla, no hay boleta.
 * - Momento de emisión (configurable):
 *     ON_CONFIRMED → al confirmar el pedido. Con pago contra entrega el pago
 *                    aún no está verificado y la boleta lo indica: "POR COBRAR".
 *     ON_PAID      → solo cuando el pago está verificado (contra entrega: al
 *                    marcar el pedido como Entregado).
 * - Numeración correlativa por serie (B001-00000001…), sin huecos ni repetidos.
 *
 * Impresión
 * ─────────
 * - Cada impresión es un PrintJob: PENDIENTE → IMPRIMIENDO → IMPRESA | FALLIDA.
 * - El agente de la PC "reclama" el trabajo de forma atómica: dos agentes nunca
 *   imprimen el mismo trabajo.
 * - Un trabajo fallido o sin confirmación NUNCA se reintenta solo (evita boletas
 *   duplicadas); se reintenta desde el panel.
 */

export const STALE_PRINTING_MS = 2 * 60 * 1000;

/** Avisa a los agentes que esperan (long-polling) de que hay trabajo nuevo. */
export const printEvents = new EventEmitter();
printEvents.setMaxListeners(50);

const DEFAULT_STORE_NAME = () => process.env.VITE_STORE_NAME || "SOLE 20";

export async function getSettings(db: Tx | typeof prisma = prisma): Promise<ReceiptSettings> {
  return db.receiptSettings.upsert({
    where: { id: 1 },
    create: { id: 1, storeName: DEFAULT_STORE_NAME() },
    update: {},
  });
}

export const storeNameOf = (s: ReceiptSettings) => s.storeName?.trim() || DEFAULT_STORE_NAME();

export function paymentStatusLabel(order: Pick<Order, "paymentStatus" | "paymentMethod">): string {
  const labels: Record<PaymentStatus, string> = {
    PENDING: order.paymentMethod === "CASH_ON_DELIVERY" ? "POR COBRAR" : "PENDIENTE",
    PAID: "PAGADO",
    REFUNDED: "REEMBOLSADO",
    FAILED: "FALLIDO",
  };
  return labels[order.paymentStatus];
}

/** Emite la boleta de un pedido (o devuelve la existente: nunca hay dos). */
export async function issueReceipt(tx: Tx, orderId: string) {
  const existing = await tx.receipt.findUnique({ where: { orderId } });
  if (existing) return { receipt: existing, created: false };

  const settings = await getSettings(tx);
  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: { items: true, user: { select: { name: true } } },
  });
  if (!order) throw notFound("Pedido no encontrado");

  const series = settings.series.trim().toUpperCase() || "B001";
  // Incremento atómico del correlativo (la fila queda bloqueada hasta el commit)
  const counter = await tx.receiptSeries.upsert({
    where: { series },
    create: { series, last: 1 },
    update: { last: { increment: 1 } },
  });
  const code = `${series}-${String(counter.last).padStart(8, "0")}`;

  const snapshot: ReceiptSnapshot = {
    storeName: storeNameOf(settings),
    title: settings.title.trim() || "BOLETA DE VENTA",
    headerLines: settings.headerLines
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean),
    footerMessage: settings.footerMessage,
    legalNote: settings.legalNote,
    code,
    issuedAt: new Date().toISOString(),
    orderNumber: order.number,
    customerName: order.shippingName || order.user.name || null,
    items: order.items.map((i) => ({
      name: i.productName,
      brand: i.brandName,
      size: i.sizeLabel,
      color: i.colorName,
      quantity: i.quantity,
      unitListPriceCents: i.unitListPriceCents,
      discountPercent: i.discountPercent,
      unitPriceCents: i.unitPriceCents,
      lineTotalCents: i.lineTotalCents,
    })),
    subtotalCents: order.subtotalCents,
    discountCents: order.discountCents,
    shippingCents: order.shippingCents,
    totalCents: order.totalCents,
    paymentMethod: getPaymentProvider(order.paymentMethod).label,
  };

  const receipt = await tx.receipt.create({
    data: {
      code,
      series,
      number: counter.last,
      orderId,
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
    },
  });
  return { receipt, created: true };
}

/** Pone una boleta en la cola de impresión (si no hay ya una impresión en curso). */
export async function queuePrint(
  tx: Tx,
  receiptId: string,
  reason: "AUTO" | "MANUAL" | "REPRINT" | "RETRY",
  requestedById: string | null,
) {
  const active = await tx.printJob.count({ where: { receiptId, status: { in: ["PENDING", "PRINTING"] } } });
  if (active > 0) throw conflict("Esta boleta ya tiene una impresión en curso. Espera a que termine.");
  const job = await tx.printJob.create({ data: { receiptId, kind: "RECEIPT", reason, requestedById } });
  setImmediate(() => printEvents.emit("job"));
  return job;
}

/**
 * Se llama dentro de la transacción que cambia el estado de un pedido.
 * Emite la boleta (y la manda a imprimir) cuando corresponde, o la anula.
 */
export async function onOrderStatusChanged(
  tx: Tx,
  orderId: string,
  to: Order["status"],
  paymentStatus: PaymentStatus,
  actorId: string,
) {
  if (to === "CANCELLED") {
    const receipt = await tx.receipt.findUnique({ where: { orderId } });
    if (receipt && !receipt.voidedAt) {
      await tx.receipt.update({
        where: { id: receipt.id },
        data: { voidedAt: new Date(), voidReason: "Pedido cancelado" },
      });
      await tx.printJob.updateMany({
        where: { receiptId: receipt.id, status: "PENDING" },
        data: { status: "CANCELLED", finishedAt: new Date(), error: "Pedido cancelado antes de imprimir" },
      });
    }
    return;
  }

  const settings = await getSettings(tx);
  if (!settings.enabled) return;
  const due =
    (settings.trigger === "ON_CONFIRMED" && to === "CONFIRMED") ||
    (settings.trigger === "ON_PAID" && paymentStatus === "PAID");
  if (!due) return;

  const { receipt, created } = await issueReceipt(tx, orderId);
  if (created && settings.autoPrint) await queuePrint(tx, receipt.id, "AUTO", actorId);
}

/** Trabajos "imprimiendo" sin respuesta del agente → FALLIDA (no se reintentan solos). */
export async function expireStalePrintJobs() {
  await prisma.printJob.updateMany({
    where: { status: "PRINTING", claimedAt: { lt: new Date(Date.now() - STALE_PRINTING_MS) } },
    data: {
      status: "FAILED",
      finishedAt: new Date(),
      error:
        "El agente no confirmó la impresión (¿se apagó la PC o se cortó la conexión?). " +
        "Revisa si salió la boleta antes de reintentar.",
    },
  });
}

export function printerLabel(s: ReceiptSettings) {
  if (s.connection === "network") return `Red ${s.networkHost ?? "?"}:${s.networkPort}`;
  return s.printerName || "Impresora predeterminada de Windows";
}

export interface RenderedJob {
  payload: Buffer;
  documentName: string;
}

/** Genera los bytes ESC/POS de un trabajo con la configuración actual. */
export async function renderJob(job: PrintJob): Promise<RenderedJob> {
  const settings = await getSettings();
  const cols = columnsFor(settings.paperWidth);
  const logo = settings.printLogo ? await loadLogoRaster(settings.logoUrl, settings.paperWidth) : null;
  let blocks: Block[];
  let documentName = "Prueba de impresión";

  if (job.kind === "TEST") {
    blocks = buildTestBlocks({
      storeName: storeNameOf(settings),
      paperWidth: settings.paperWidth,
      printerLabel: printerLabel(settings),
      charset: settings.charset,
      printLogo: Boolean(logo),
      logoHasName: Boolean(logo) && !settings.logoUrl,
    });
  } else {
    const receipt = await prisma.receipt.findUnique({
      where: { id: job.receiptId ?? "" },
      include: { order: { select: { paymentStatus: true, paymentMethod: true } } },
    });
    if (!receipt) throw notFound("Boleta no encontrada");
    // Cualquier impresión posterior a una que ya salió bien es una COPIA
    const alreadyPrinted = await prisma.printJob.count({
      where: { receiptId: receipt.id, status: "PRINTED", id: { not: job.id } },
    });
    blocks = buildReceiptBlocks(receipt.snapshot as unknown as ReceiptSnapshot, {
      cols,
      printLogo: Boolean(logo),
      logoHasName: Boolean(logo) && !settings.logoUrl,
      copy: job.reason === "REPRINT" || alreadyPrinted > 0,
      paymentStatusLabel: paymentStatusLabel(receipt.order),
      voided: Boolean(receipt.voidedAt),
    });
    documentName = `Boleta ${receipt.code}`;
  }

  const payload = encodeEscPos(blocks, {
    cols,
    charset: settings.charset as Charset,
    logo,
    cut: settings.cutPaper,
    copies: job.kind === "TEST" ? 1 : settings.copies,
  });
  return { payload, documentName };
}
