import { Prisma, type OrderStatus } from "@prisma/client";
import { prisma } from "../db";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { finalPrice, shippingFor } from "../lib/pricing";
import { getPaymentProvider } from "../payments";
import { MAX_QTY_PER_LINE } from "./cart";
import * as inventory from "./inventory";

export interface ShippingInput {
  shippingName: string;
  shippingPhone: string;
  shippingAddress: string;
  shippingDistrict: string;
  shippingCity: string;
  shippingReference?: string | null;
  notes?: string | null;
}

export const orderInclude = {
  items: true,
  statusHistory: { orderBy: { createdAt: "asc" } },
  user: { select: { id: true, name: true, email: true, phone: true } },
} satisfies Prisma.OrderInclude;

/**
 * Crea un pedido a partir del carrito guardado en el servidor.
 * Todo ocurre en UNA transacción: si cualquier talla se agotó entre tanto,
 * no se crea nada y el cliente recibe un error claro.
 */
export async function createOrderFromCart(
  userId: string,
  shipping: ShippingInput,
  paymentMethod: "CASH_ON_DELIVERY",
  idempotencyKey?: string,
) {
  if (idempotencyKey) {
    const existing = await prisma.order.findUnique({ where: { idempotencyKey }, include: orderInclude });
    if (existing) {
      if (existing.userId !== userId) throw conflict("Clave de idempotencia ya utilizada");
      return existing;
    }
  }

  const provider = getPaymentProvider(paymentMethod);

  try {
    return await prisma.$transaction(async (tx) => {
      const cart = await tx.cart.findUnique({
        where: { userId },
        include: {
          items: {
            include: {
              variant: {
                include: {
                  size: true,
                  color: true,
                  product: { include: { brand: true, images: { where: { kind: "GALLERY" }, orderBy: { sortOrder: "asc" } } } },
                },
              },
            },
          },
        },
      });
      if (!cart || cart.items.length === 0) throw badRequest("Tu carrito está vacío");

      const items = cart.items.map((ci) => {
        const v = ci.variant;
        const p = v.product;
        if (p.status !== "PUBLISHED" || !v.active) {
          throw conflict(`"${p.name}" ya no está disponible`, { variantId: v.id });
        }
        if (ci.quantity < 1 || ci.quantity > MAX_QTY_PER_LINE) {
          throw badRequest(`Cantidad inválida para "${p.name}"`);
        }
        const unitPrice = finalPrice(p.priceCents, p.discountPercent);
        const image = p.images.find((img) => img.colorId === v.colorId) ?? p.images[0];
        return {
          variantId: v.id,
          quantity: ci.quantity,
          data: {
            productId: p.id,
            variantId: v.id,
            productName: p.name,
            brandName: p.brand?.name ?? null,
            sizeLabel: v.size.label,
            colorName: v.color.name,
            imageUrl: image?.url ?? null,
            unitListPriceCents: p.priceCents,
            discountPercent: p.discountPercent,
            unitPriceCents: unitPrice,
            quantity: ci.quantity,
            lineTotalCents: unitPrice * ci.quantity,
          },
        };
      });

      const subtotalCents = items.reduce((s, i) => s + i.data.unitListPriceCents * i.quantity, 0);
      const afterDiscount = items.reduce((s, i) => s + i.data.lineTotalCents, 0);
      const shippingCents = shippingFor(afterDiscount);

      const order = await tx.order.create({
        data: {
          userId,
          idempotencyKey,
          status: "PENDING",
          inventoryState: "RESERVED",
          subtotalCents,
          discountCents: subtotalCents - afterDiscount,
          shippingCents,
          totalCents: afterDiscount + shippingCents,
          paymentMethod,
          paymentStatus: "PENDING",
          paymentProvider: provider.id,
          ...shipping,
          items: { create: items.map((i) => i.data) },
          statusHistory: { create: { toStatus: "PENDING", changedById: userId, note: "Pedido registrado" } },
        },
      });

      for (const item of items) {
        const ok = await inventory.reserve(tx, item.variantId, item.quantity, { orderId: order.id, userId });
        if (!ok) {
          throw conflict(
            `No hay stock suficiente de "${item.data.productName}" talla ${item.data.sizeLabel}. Revisa tu carrito.`,
            { variantId: item.variantId },
          );
        }
      }

      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

      return tx.order.findUniqueOrThrow({ where: { id: order.id }, include: orderInclude });
    });
  } catch (err) {
    // Doble envío simultáneo con la misma clave: devolver el pedido ya creado.
    if (idempotencyKey && err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const existing = await prisma.order.findUnique({ where: { idempotencyKey }, include: orderInclude });
      if (existing && existing.userId === userId) return existing;
    }
    throw err;
  }
}

/** Transiciones de estado permitidas. */
export const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PREPARING", "CANCELLED"],
  PREPARING: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
};

export async function changeOrderStatus(
  orderId: string,
  to: OrderStatus,
  actor: { id: string; isAdmin: boolean },
  note?: string | null,
) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order) throw notFound("Pedido no encontrado");
    if (!actor.isAdmin) {
      // Un cliente solo puede cancelar SUS pedidos y solo mientras estén pendientes.
      if (order.userId !== actor.id) throw notFound("Pedido no encontrado");
      if (to !== "CANCELLED") throw forbidden();
      if (order.status !== "PENDING") throw conflict("Solo puedes cancelar pedidos pendientes");
    }
    if (!ALLOWED_TRANSITIONS[order.status].includes(to)) {
      throw conflict(`No se puede pasar un pedido de ${order.status} a ${to}`);
    }

    let inventoryState = order.inventoryState;
    let paymentStatus = order.paymentStatus;
    if (to === "CONFIRMED") {
      if (order.inventoryState !== "RESERVED") throw conflict("El inventario de este pedido ya fue procesado");
      inventoryState = "COMMITTED";
    } else if (to === "CANCELLED") {
      if (order.inventoryState === "RESERVED") inventoryState = "RELEASED";
      else if (order.inventoryState === "COMMITTED") inventoryState = "RESTOCKED";
      if (paymentStatus === "PAID") paymentStatus = "REFUNDED";
    } else if (to === "DELIVERED" && order.paymentMethod === "CASH_ON_DELIVERY") {
      paymentStatus = "PAID"; // el pago contra entrega se cobra al entregar
    }

    // Bloqueo optimista: solo actualiza si nadie cambió el pedido mientras tanto.
    const updated = await tx.order.updateMany({
      where: { id: order.id, status: order.status, inventoryState: order.inventoryState },
      data: { status: to, inventoryState, paymentStatus },
    });
    if (updated.count !== 1) throw conflict("El pedido fue modificado por otra operación. Recarga e inténtalo de nuevo.");

    const ctx = { orderId: order.id, userId: actor.id };
    for (const item of order.items) {
      if (!item.variantId) continue; // la variante fue eliminada del catálogo
      if (order.inventoryState === "RESERVED" && inventoryState === "COMMITTED") {
        await inventory.commit(tx, item.variantId, item.quantity, ctx);
      } else if (order.inventoryState === "RESERVED" && inventoryState === "RELEASED") {
        await inventory.release(tx, item.variantId, item.quantity, ctx);
      } else if (order.inventoryState === "COMMITTED" && inventoryState === "RESTOCKED") {
        await inventory.restock(tx, item.variantId, item.quantity, ctx);
      }
    }

    await tx.orderStatusHistory.create({
      data: { orderId: order.id, fromStatus: order.status, toStatus: to, note: note || null, changedById: actor.id },
    });

    return tx.order.findUniqueOrThrow({ where: { id: order.id }, include: orderInclude });
  });
}
