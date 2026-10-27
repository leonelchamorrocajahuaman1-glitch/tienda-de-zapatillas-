import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db";
import { notFound } from "../../lib/errors";
import { parse } from "../../lib/validate";
import { requireCustomer } from "../../middleware/auth";
import { availablePaymentMethods } from "../../payments";
import { changeOrderStatus, createOrderFromCart, orderInclude } from "../../services/orders";

export const ordersRouter = Router();
ordersRouter.use(requireCustomer);

const text = (max: number, msg: string) => z.string().trim().min(2, msg).max(max);

const checkoutSchema = z.object({
  shippingName: text(120, "Ingresa el nombre de quien recibe"),
  shippingPhone: z.string().trim().regex(/^[0-9+\s-]{6,20}$/, "Teléfono inválido"),
  shippingAddress: text(200, "Ingresa la dirección"),
  shippingDistrict: text(80, "Ingresa el distrito"),
  shippingCity: text(80, "Ingresa la ciudad"),
  shippingReference: z.string().trim().max(200).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  paymentMethod: z.literal("CASH_ON_DELIVERY").default("CASH_ON_DELIVERY"),
  idempotencyKey: z.string().uuid().optional(),
  // Cualquier precio o total enviado por el navegador se ignora.
});

function serialize(order: Awaited<ReturnType<typeof createOrderFromCart>>) {
  const { user: _user, idempotencyKey: _key, ...rest } = order;
  return rest;
}

ordersRouter.get("/payment-methods", (_req, res) => {
  res.json(availablePaymentMethods);
});

ordersRouter.post("/", async (req, res) => {
  const { paymentMethod, idempotencyKey, ...shipping } = parse(checkoutSchema, req.body);
  const order = await createOrderFromCart(req.user!.id, shipping, paymentMethod, idempotencyKey);
  res.status(201).json(serialize(order));
});

ordersRouter.get("/", async (req, res) => {
  const orders = await prisma.order.findMany({
    where: { userId: req.user!.id },
    include: orderInclude,
    orderBy: { createdAt: "desc" },
  });
  res.json(orders.map(serialize));
});

// Se busca SIEMPRE por número + dueño: un cliente no puede ver pedidos ajenos.
async function findOwn(userId: string, numberParam: string) {
  const number = Number.parseInt(numberParam, 10);
  if (!Number.isFinite(number)) throw notFound("Pedido no encontrado");
  const order = await prisma.order.findFirst({ where: { number, userId }, include: orderInclude });
  if (!order) throw notFound("Pedido no encontrado");
  return order;
}

ordersRouter.get("/:number", async (req, res) => {
  res.json(serialize(await findOwn(req.user!.id, req.params.number)));
});

ordersRouter.post("/:number/cancel", async (req, res) => {
  const order = await findOwn(req.user!.id, req.params.number);
  const updated = await changeOrderStatus(order.id, "CANCELLED", { id: req.user!.id, isAdmin: false }, "Cancelado por el cliente");
  res.json(serialize(updated));
});
