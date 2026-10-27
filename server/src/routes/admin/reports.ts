import type { OrderStatus } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db";
import { parse } from "../../lib/validate";

export const adminReportsRouter = Router();

/** Pedidos que cuentan como venta: confirmados en adelante (stock ya descontado). */
const SOLD: OrderStatus[] = ["CONFIRMED", "PREPARING", "SHIPPED", "DELIVERED"];
const TZ = "America/Lima";
const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d); // YYYY-MM-DD

adminReportsRouter.get("/dashboard", async (_req, res) => {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [soldAll, soldRecent, byStatus, productsByStatus, variants, topItems, recentOrders, customers] = await Promise.all([
    prisma.order.aggregate({ where: { status: { in: SOLD } }, _sum: { totalCents: true }, _count: { _all: true } }),
    prisma.order.findMany({
      where: { status: { in: SOLD }, createdAt: { gte: since } },
      select: { createdAt: true, totalCents: true },
    }),
    prisma.order.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.product.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.productVariant.findMany({
      where: { active: true, product: { status: { not: "ARCHIVED" } } },
      include: { size: true, color: true, product: { select: { id: true, name: true, status: true } } },
    }),
    prisma.orderItem.groupBy({
      by: ["productId", "productName"],
      where: { order: { status: { in: SOLD } } },
      _sum: { quantity: true, lineTotalCents: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 5,
    }),
    prisma.order.findMany({
      orderBy: { createdAt: "desc" },
      take: 6,
      include: { user: { select: { name: true } } },
    }),
    prisma.user.count({ where: { role: "CUSTOMER" } }),
  ]);

  // Serie diaria de los últimos 30 días (incluye días sin ventas).
  const series = new Map<string, { date: string; totalCents: number; orders: number }>();
  for (let i = 29; i >= 0; i--) {
    const key = dayKey(new Date(Date.now() - i * 24 * 60 * 60 * 1000));
    series.set(key, { date: key, totalCents: 0, orders: 0 });
  }
  for (const o of soldRecent) {
    const entry = series.get(dayKey(o.createdAt));
    if (entry) {
      entry.totalCents += o.totalCents;
      entry.orders += 1;
    }
  }

  const lowStock = variants
    .map((v) => ({
      variantId: v.id,
      productId: v.product.id,
      productName: v.product.name,
      productStatus: v.product.status,
      size: v.size.label,
      color: v.color.name,
      stock: v.stock,
      reserved: v.reserved,
      available: v.stock - v.reserved,
    }))
    .filter((v) => v.available <= 3)
    .sort((a, b) => a.available - b.available)
    .slice(0, 12);

  const soldCount = soldAll._count._all;
  res.json({
    revenueCents: soldAll._sum.totalCents ?? 0,
    revenue30dCents: soldRecent.reduce((s, o) => s + o.totalCents, 0),
    soldOrders: soldCount,
    averageTicketCents: soldCount ? Math.round((soldAll._sum.totalCents ?? 0) / soldCount) : 0,
    ordersByStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
    productsByStatus: Object.fromEntries(productsByStatus.map((s) => [s.status, s._count._all])),
    stock: {
      units: variants.reduce((s, v) => s + v.stock, 0),
      reserved: variants.reduce((s, v) => s + v.reserved, 0),
      variants: variants.length,
      outOfStock: variants.filter((v) => v.stock - v.reserved <= 0).length,
    },
    customers,
    lowStock,
    salesByDay: [...series.values()],
    topProducts: topItems.map((t) => ({
      productId: t.productId,
      name: t.productName,
      units: t._sum.quantity ?? 0,
      revenueCents: t._sum.lineTotalCents ?? 0,
    })),
    recentOrders: recentOrders.map((o) => ({
      id: o.id,
      number: o.number,
      customer: o.user.name,
      status: o.status,
      totalCents: o.totalCents,
      createdAt: o.createdAt,
    })),
  });
});

/** Historial de ventas: líneas vendidas con el precio histórico cobrado. */
adminReportsRouter.get("/sales", async (req, res) => {
  const q = parse(
    z.object({
      from: z.string().date().optional(),
      to: z.string().date().optional(),
      format: z.enum(["json", "csv"]).default("json"),
    }),
    req.query,
  );
  const createdAt: { gte?: Date; lt?: Date } = {};
  if (q.from) createdAt.gte = new Date(`${q.from}T00:00:00-05:00`);
  if (q.to) createdAt.lt = new Date(new Date(`${q.to}T00:00:00-05:00`).getTime() + 24 * 60 * 60 * 1000);

  const items = await prisma.orderItem.findMany({
    where: { order: { status: { in: SOLD }, ...(q.from || q.to ? { createdAt } : {}) } },
    include: { order: { select: { id: true, number: true, createdAt: true, status: true, user: { select: { name: true, email: true } } } } },
    orderBy: { order: { createdAt: "desc" } },
    take: 2000,
  });

  const rows = items.map((i) => ({
    orderId: i.order.id,
    orderNumber: i.order.number,
    date: i.order.createdAt,
    status: i.order.status,
    customer: i.order.user.name,
    email: i.order.user.email,
    product: i.productName,
    brand: i.brandName,
    size: i.sizeLabel,
    color: i.colorName,
    quantity: i.quantity,
    unitListPriceCents: i.unitListPriceCents,
    discountPercent: i.discountPercent,
    unitPriceCents: i.unitPriceCents,
    lineTotalCents: i.lineTotalCents,
  }));

  if (q.format === "csv") {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const money = (c: number) => (c / 100).toFixed(2);
    const header = ["Pedido", "Fecha", "Estado", "Cliente", "Email", "Producto", "Marca", "Talla", "Color", "Cantidad", "Precio lista", "Descuento %", "Precio unitario", "Total línea"];
    const lines = rows.map((r) =>
      [
        r.orderNumber, dayKey(r.date), r.status, r.customer, r.email, r.product, r.brand, r.size, r.color, r.quantity,
        money(r.unitListPriceCents), r.discountPercent, money(r.unitPriceCents), money(r.lineTotalCents),
      ].map(esc).join(","),
    );
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="ventas.csv"`);
    res.send("﻿" + [header.map(esc).join(","), ...lines].join("\n"));
    return;
  }

  res.json({
    rows,
    totals: {
      units: rows.reduce((s, r) => s + r.quantity, 0),
      revenueCents: rows.reduce((s, r) => s + r.lineTotalCents, 0),
      orders: new Set(rows.map((r) => r.orderId)).size,
    },
  });
});

/** Movimientos de inventario (auditoría). */
adminReportsRouter.get("/inventory-movements", async (req, res) => {
  const q = parse(z.object({ productId: z.string().max(40).optional() }), req.query);
  const movements = await prisma.inventoryMovement.findMany({
    where: q.productId ? { variant: { productId: q.productId } } : {},
    include: {
      variant: { include: { size: true, color: true, product: { select: { name: true } } } },
      order: { select: { number: true } },
      user: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json(
    movements.map((m) => ({
      id: m.id,
      type: m.type,
      stockDelta: m.stockDelta,
      reservedDelta: m.reservedDelta,
      product: m.variant.product.name,
      size: m.variant.size.label,
      color: m.variant.color.name,
      orderNumber: m.order?.number ?? null,
      user: m.user?.name ?? null,
      note: m.note,
      createdAt: m.createdAt,
    })),
  );
});
