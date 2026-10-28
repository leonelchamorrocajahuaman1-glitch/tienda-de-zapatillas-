import type { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db";
import { notFound } from "../../lib/errors";
import { parse } from "../../lib/validate";
import { ALLOWED_TRANSITIONS, changeOrderStatus, orderInclude } from "../../services/orders";

export const adminOrdersRouter = Router();

const statusEnum = z.enum(["PENDING", "CONFIRMED", "PREPARING", "SHIPPED", "DELIVERED", "CANCELLED"]);

adminOrdersRouter.get("/", async (req, res) => {
  const q = parse(
    z.object({
      status: statusEnum.optional(),
      q: z.string().trim().max(80).optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(25),
    }),
    req.query,
  );
  const num = q.q ? Number.parseInt(q.q.replace(/\D/g, ""), 10) : NaN;
  const where: Prisma.OrderWhereInput = {
    ...(q.status ? { status: q.status } : {}),
    ...(q.q
      ? {
          OR: [
            ...(Number.isFinite(num) ? [{ number: num }] : []),
            { user: { email: { contains: q.q, mode: "insensitive" } } },
            { user: { name: { contains: q.q, mode: "insensitive" } } },
            { shippingName: { contains: q.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [items, total, counts] = await Promise.all([
    prisma.order.findMany({
      where,
      include: { user: { select: { name: true, email: true } }, _count: { select: { items: true } } },
      orderBy: { createdAt: "desc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.order.count({ where }),
    prisma.order.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  res.json({
    items,
    total,
    page: q.page,
    pageSize: q.pageSize,
    countsByStatus: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
  });
});

adminOrdersRouter.get("/:id", async (req, res) => {
  const order = await prisma.order.findUnique({
    where: { id: req.params.id },
    include: {
      ...orderInclude,
      statusHistory: { orderBy: { createdAt: "asc" }, include: { changedBy: { select: { name: true, role: true } } } },
      receipt: { include: { printJobs: { orderBy: { createdAt: "desc" }, take: 5 } } },
    },
  });
  if (!order) throw notFound("Pedido no encontrado");
  res.json({ ...order, allowedTransitions: ALLOWED_TRANSITIONS[order.status] });
});

adminOrdersRouter.patch("/:id/status", async (req, res) => {
  const body = parse(z.object({ status: statusEnum, note: z.string().trim().max(500).optional() }), req.body);
  await changeOrderStatus(req.params.id, body.status, { id: req.user!.id, isAdmin: true }, body.note);
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: req.params.id },
    include: {
      ...orderInclude,
      statusHistory: { orderBy: { createdAt: "asc" }, include: { changedBy: { select: { name: true, role: true } } } },
      receipt: { include: { printJobs: { orderBy: { createdAt: "desc" }, take: 5 } } },
    },
  });
  res.json({ ...order, allowedTransitions: ALLOWED_TRANSITIONS[order.status] });
});
