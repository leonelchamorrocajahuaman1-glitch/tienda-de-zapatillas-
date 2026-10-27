import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db";
import { badRequest, conflict, notFound } from "../../lib/errors";
import { parse } from "../../lib/validate";
import { requireCustomer } from "../../middleware/auth";
import { MAX_QTY_PER_LINE, priceLines } from "../../services/cart";

export const cartRouter = Router();

const line = z.object({
  variantId: z.string().min(1).max(40),
  quantity: z.coerce.number().int().min(1).max(MAX_QTY_PER_LINE),
});

/**
 * Cotización para el carrito de invitados (guardado en el navegador).
 * Devuelve precios y disponibilidad actuales del servidor.
 */
cartRouter.post("/quote", async (req, res) => {
  const body = parse(z.object({ items: z.array(line).max(50) }), req.body);
  res.json(await priceLines(body.items));
});

async function getCart(userId: string) {
  const include = { items: { orderBy: { createdAt: "asc" as const } } };
  try {
    return await prisma.cart.upsert({ where: { userId }, create: { userId }, update: {}, include });
  } catch (err) {
    // Dos peticiones simultáneas pueden intentar crear el carrito a la vez:
    // la segunda falla por la restricción única y simplemente lee el existente.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return prisma.cart.findUniqueOrThrow({ where: { userId }, include });
    }
    throw err;
  }
}

async function summary(userId: string) {
  const cart = await getCart(userId);
  return priceLines(cart.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })));
}

async function assertPurchasable(variantId: string, quantity: number) {
  const v = await prisma.productVariant.findUnique({ where: { id: variantId }, include: { product: true } });
  if (!v || !v.active || v.product.status !== "PUBLISHED") throw notFound("Producto no disponible");
  const available = v.stock - v.reserved;
  if (available <= 0) throw conflict("Esta talla está agotada");
  if (quantity > available) throw conflict(`Solo quedan ${available} unidades de esta talla`);
}

cartRouter.get("/", requireCustomer, async (req, res) => {
  res.json(await summary(req.user!.id));
});

/** Fija la cantidad de una variante en el carrito. */
cartRouter.put("/items", requireCustomer, async (req, res) => {
  const body = parse(line, req.body);
  await assertPurchasable(body.variantId, body.quantity);
  const cart = await getCart(req.user!.id);
  await prisma.cartItem.upsert({
    where: { cartId_variantId: { cartId: cart.id, variantId: body.variantId } },
    create: { cartId: cart.id, variantId: body.variantId, quantity: body.quantity },
    update: { quantity: body.quantity },
  });
  res.json(await summary(req.user!.id));
});

/** Suma unidades a una variante (botón "Añadir al carrito"). */
cartRouter.post("/items", requireCustomer, async (req, res) => {
  const body = parse(line, req.body);
  const cart = await getCart(req.user!.id);
  const existing = cart.items.find((i) => i.variantId === body.variantId);
  const quantity = (existing?.quantity ?? 0) + body.quantity;
  if (quantity > MAX_QTY_PER_LINE) throw badRequest(`Máximo ${MAX_QTY_PER_LINE} unidades por talla`);
  await assertPurchasable(body.variantId, quantity);
  await prisma.cartItem.upsert({
    where: { cartId_variantId: { cartId: cart.id, variantId: body.variantId } },
    create: { cartId: cart.id, variantId: body.variantId, quantity },
    update: { quantity },
  });
  res.json(await summary(req.user!.id));
});

cartRouter.delete("/items/:variantId", requireCustomer, async (req, res) => {
  const cart = await getCart(req.user!.id);
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id, variantId: String(req.params.variantId) } });
  res.json(await summary(req.user!.id));
});

/** Al iniciar sesión, fusiona el carrito de invitado con el guardado. */
cartRouter.post("/merge", requireCustomer, async (req, res) => {
  const body = parse(z.object({ items: z.array(line).max(50) }), req.body);
  const cart = await getCart(req.user!.id);
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: body.items.map((i) => i.variantId) } },
    select: { id: true },
  });
  const valid = new Set(variants.map((v) => v.id));
  for (const item of body.items) {
    if (!valid.has(item.variantId)) continue;
    const existing = cart.items.find((i) => i.variantId === item.variantId);
    const quantity = Math.min(MAX_QTY_PER_LINE, (existing?.quantity ?? 0) + item.quantity);
    await prisma.cartItem.upsert({
      where: { cartId_variantId: { cartId: cart.id, variantId: item.variantId } },
      create: { cartId: cart.id, variantId: item.variantId, quantity },
      update: { quantity },
    });
  }
  res.json(await summary(req.user!.id));
});
