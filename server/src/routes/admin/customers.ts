import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db";
import { notFound } from "../../lib/errors";
import { parse } from "../../lib/validate";

export const adminCustomersRouter = Router();

adminCustomersRouter.get("/", async (req, res) => {
  const q = parse(z.object({ q: z.string().trim().max(80).optional() }), req.query);
  const customers = await prisma.user.findMany({
    where: {
      role: "CUSTOMER",
      ...(q.q
        ? {
            OR: [
              { name: { contains: q.q, mode: "insensitive" } },
              { email: { contains: q.q, mode: "insensitive" } },
              { phone: { contains: q.q } },
            ],
          }
        : {}),
    },
    select: { id: true, name: true, email: true, phone: true, isActive: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const stats = await prisma.order.groupBy({
    by: ["userId"],
    where: { userId: { in: customers.map((c) => c.id) }, status: { not: "CANCELLED" } },
    _count: { _all: true },
    _sum: { totalCents: true },
    _max: { createdAt: true },
  });
  const byUser = new Map(stats.map((s) => [s.userId, s]));
  res.json(
    customers.map((c) => ({
      ...c,
      orderCount: byUser.get(c.id)?._count._all ?? 0,
      totalSpentCents: byUser.get(c.id)?._sum.totalCents ?? 0,
      lastOrderAt: byUser.get(c.id)?._max.createdAt ?? null,
    })),
  );
});

adminCustomersRouter.get("/:id", async (req, res) => {
  const customer = await prisma.user.findFirst({
    where: { id: req.params.id, role: "CUSTOMER" },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      isActive: true,
      createdAt: true,
      orders: { orderBy: { createdAt: "desc" }, include: { _count: { select: { items: true } } } },
    },
  });
  if (!customer) throw notFound("Cliente no encontrado");
  res.json(customer);
});

adminCustomersRouter.patch("/:id", async (req, res) => {
  const body = parse(z.object({ isActive: z.boolean() }), req.body);
  const result = await prisma.user.updateMany({ where: { id: req.params.id, role: "CUSTOMER" }, data: body });
  if (result.count === 0) throw notFound("Cliente no encontrado");
  res.json({ ok: true });
});
