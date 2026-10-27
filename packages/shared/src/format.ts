import type { OrderStatus } from "./types";

const money = new Intl.NumberFormat("es-PE", { style: "currency", currency: "PEN", minimumFractionDigits: 2 });

/** 19990 → "S/ 199.90" */
export const formatMoney = (cents: number) => money.format(cents / 100);

export const formatDate = (iso: string | Date, withTime = false) =>
  new Intl.DateTimeFormat("es-PE", {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" } : {}),
    timeZone: "America/Lima",
  }).format(new Date(iso));

export const orderCode = (n: number) => `PED-${String(n).padStart(6, "0")}`;

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: "Pendiente",
  CONFIRMED: "Confirmado",
  PREPARING: "Preparando",
  SHIPPED: "Enviado",
  DELIVERED: "Entregado",
  CANCELLED: "Cancelado",
};

/** Recorrido normal de un pedido (para la línea de seguimiento). */
export const ORDER_FLOW: OrderStatus[] = ["PENDING", "CONFIRMED", "PREPARING", "SHIPPED", "DELIVERED"];

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  CASH_ON_DELIVERY: "Pago contra entrega",
};

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  PENDING: "Por cobrar",
  PAID: "Pagado",
  REFUNDED: "Reembolsado",
  FAILED: "Fallido",
};
