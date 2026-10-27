import { config } from "../config";

/** Precio final por unidad, calculado SIEMPRE en el servidor. */
export function finalPrice(priceCents: number, discountPercent: number): number {
  return Math.round((priceCents * (100 - discountPercent)) / 100);
}

export function shippingFor(subtotalAfterDiscountCents: number): number {
  if (subtotalAfterDiscountCents <= 0) return 0;
  return subtotalAfterDiscountCents >= config.freeShippingMinCents ? 0 : config.shippingFlatCents;
}
