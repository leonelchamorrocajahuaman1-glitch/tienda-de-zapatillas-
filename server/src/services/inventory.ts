import type { MovementType } from "@prisma/client";
import type { Tx } from "../db";
import { conflict } from "../lib/errors";

/**
 * Reglas de inventario
 * ────────────────────
 *  stock    = unidades físicas en almacén
 *  reserved = unidades apartadas por pedidos PENDIENTES
 *  disponible = stock - reserved
 *
 *  Pedido creado (PENDIENTE)           → reserved += q                (RESERVE)
 *  PENDIENTE → CONFIRMADO              → stock -= q, reserved -= q    (COMMIT)
 *  PENDIENTE → CANCELADO               → reserved -= q                (RELEASE)
 *  CONFIRMADO/PREPARANDO → CANCELADO   → stock += q                   (RESTOCK)
 *  PREPARANDO / ENVIADO / ENTREGADO    → sin cambios de inventario
 *
 * Cada operación es un UPDATE atómico con condición en la cláusula WHERE: si
 * otra transacción se adelantó (p. ej. dos clientes compran la última unidad),
 * el UPDATE afecta 0 filas y la transacción completa se revierte.
 * El campo Order.inventoryState garantiza que cada pedido reserve, descuente o
 * devuelva sus unidades una sola vez.
 */

interface MovementCtx {
  orderId?: string;
  userId?: string;
  note?: string;
}

async function logMovement(
  tx: Tx,
  variantId: string,
  type: MovementType,
  stockDelta: number,
  reservedDelta: number,
  ctx: MovementCtx,
) {
  await tx.inventoryMovement.create({
    data: { variantId, type, stockDelta, reservedDelta, orderId: ctx.orderId, userId: ctx.userId, note: ctx.note },
  });
}

export async function reserve(tx: Tx, variantId: string, qty: number, ctx: MovementCtx): Promise<boolean> {
  const rows = await tx.$executeRaw`
    UPDATE "ProductVariant"
       SET "reserved" = "reserved" + ${qty}, "updatedAt" = NOW()
     WHERE "id" = ${variantId} AND "active" = true AND "stock" - "reserved" >= ${qty}`;
  if (rows === 1) await logMovement(tx, variantId, "RESERVE", 0, qty, ctx);
  return rows === 1;
}

export async function release(tx: Tx, variantId: string, qty: number, ctx: MovementCtx) {
  const rows = await tx.$executeRaw`
    UPDATE "ProductVariant"
       SET "reserved" = "reserved" - ${qty}, "updatedAt" = NOW()
     WHERE "id" = ${variantId} AND "reserved" >= ${qty}`;
  if (rows !== 1) throw conflict("Inconsistencia de inventario al liberar la reserva");
  await logMovement(tx, variantId, "RELEASE", 0, -qty, ctx);
}

export async function commit(tx: Tx, variantId: string, qty: number, ctx: MovementCtx) {
  const rows = await tx.$executeRaw`
    UPDATE "ProductVariant"
       SET "stock" = "stock" - ${qty}, "reserved" = "reserved" - ${qty}, "updatedAt" = NOW()
     WHERE "id" = ${variantId} AND "reserved" >= ${qty} AND "stock" >= ${qty}`;
  if (rows !== 1) throw conflict("No hay stock suficiente para confirmar el pedido");
  await logMovement(tx, variantId, "COMMIT", -qty, -qty, ctx);
}

export async function restock(tx: Tx, variantId: string, qty: number, ctx: MovementCtx) {
  const rows = await tx.$executeRaw`
    UPDATE "ProductVariant" SET "stock" = "stock" + ${qty}, "updatedAt" = NOW() WHERE "id" = ${variantId}`;
  if (rows === 1) await logMovement(tx, variantId, "RESTOCK", qty, 0, ctx);
}

/**
 * Ajuste manual desde el panel: fija el stock físico.
 * No se permite dejar el stock por debajo de lo reservado por pedidos pendientes.
 */
export async function setStock(tx: Tx, variantId: string, newStock: number, ctx: MovementCtx) {
  const current = await tx.productVariant.findUnique({ where: { id: variantId }, select: { stock: true } });
  if (!current) throw conflict("Variante no encontrada");
  if (current.stock === newStock) return;
  const rows = await tx.$executeRaw`
    UPDATE "ProductVariant" SET "stock" = ${newStock}, "updatedAt" = NOW()
     WHERE "id" = ${variantId} AND "reserved" <= ${newStock}`;
  if (rows !== 1) {
    throw conflict("El stock no puede ser menor que las unidades reservadas por pedidos pendientes");
  }
  await logMovement(tx, variantId, "ADJUSTMENT", newStock - current.stock, 0, ctx);
}
