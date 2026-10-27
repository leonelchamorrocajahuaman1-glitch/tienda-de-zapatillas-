import { prisma } from "../db";
import { finalPrice, shippingFor } from "../lib/pricing";

export const MAX_QTY_PER_LINE = 10;

export interface LineInput {
  variantId: string;
  quantity: number;
}

export interface PricedLine {
  variantId: string;
  quantity: number;
  productId: string;
  productName: string;
  productSlug: string;
  brandName: string | null;
  sizeLabel: string;
  colorName: string;
  colorHex: string;
  imageUrl: string | null;
  unitListPriceCents: number;
  discountPercent: number;
  unitPriceCents: number;
  lineTotalCents: number;
  available: number;
  /** null si la línea se puede comprar; si no, explica el problema */
  issue: string | null;
}

export interface CartSummary {
  lines: PricedLine[];
  itemCount: number;
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  totalCents: number;
  canCheckout: boolean;
}

/**
 * Calcula precios y disponibilidad con los datos ACTUALES de la base de datos.
 * Los precios que envía el navegador nunca se usan.
 */
export async function priceLines(inputs: LineInput[]): Promise<CartSummary> {
  const ids = [...new Set(inputs.map((i) => i.variantId))];
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: ids } },
    include: {
      size: true,
      color: true,
      product: {
        include: { brand: true, images: { where: { kind: "GALLERY" }, orderBy: { sortOrder: "asc" } } },
      },
    },
  });
  const byId = new Map(variants.map((v) => [v.id, v]));

  const lines: PricedLine[] = [];
  for (const input of inputs) {
    const v = byId.get(input.variantId);
    if (!v) continue; // variante eliminada: se descarta del carrito
    const p = v.product;
    const available = Math.max(0, v.stock - v.reserved);
    const unitPrice = finalPrice(p.priceCents, p.discountPercent);
    let issue: string | null = null;
    if (p.status !== "PUBLISHED" || !v.active) issue = "Este producto ya no está disponible";
    else if (available === 0) issue = "Agotado en esta talla";
    else if (input.quantity > available) issue = `Solo quedan ${available} unidades`;
    const image = p.images.find((img) => img.colorId === v.colorId) ?? p.images[0];
    lines.push({
      variantId: v.id,
      quantity: input.quantity,
      productId: p.id,
      productName: p.name,
      productSlug: p.slug,
      brandName: p.brand?.name ?? null,
      sizeLabel: v.size.label,
      colorName: v.color.name,
      colorHex: v.color.hex,
      imageUrl: image?.url ?? null,
      unitListPriceCents: p.priceCents,
      discountPercent: p.discountPercent,
      unitPriceCents: unitPrice,
      lineTotalCents: unitPrice * input.quantity,
      available,
      issue,
    });
  }

  const subtotalCents = lines.reduce((s, l) => s + l.unitListPriceCents * l.quantity, 0);
  const totalAfterDiscount = lines.reduce((s, l) => s + l.lineTotalCents, 0);
  const shippingCents = shippingFor(totalAfterDiscount);
  return {
    lines,
    itemCount: lines.reduce((s, l) => s + l.quantity, 0),
    subtotalCents,
    discountCents: subtotalCents - totalAfterDiscount,
    shippingCents,
    totalCents: totalAfterDiscount + shippingCents,
    canCheckout: lines.length > 0 && lines.every((l) => l.issue === null),
  };
}
