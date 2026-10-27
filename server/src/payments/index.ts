import type { PaymentMethod } from "@prisma/client";
import { badRequest } from "../lib/errors";

/**
 * Punto de extensión para pasarelas de pago.
 *
 * Hoy solo existe "pago contra entrega": no se cobra nada en línea y el pedido
 * queda con paymentStatus = PENDING hasta que se entrega (pasa a PAID).
 *
 * Para integrar una pasarela (Culqi, Mercado Pago, Niubiz, Stripe…):
 *  1. Añade el método al enum PaymentMethod de prisma/schema.prisma y migra.
 *  2. Implementa un PaymentProvider con createPayment() que devuelva la URL o
 *     el token de pago, y guarda paymentReference en el pedido.
 *  3. Crea una ruta de webhook que verifique la firma de la pasarela y, al
 *     recibir la confirmación, marque paymentStatus = PAID y llame a
 *     changeOrderStatus(orderId, "CONFIRMED", ...) para descontar el stock.
 * Nunca marques un pedido como pagado por lo que diga el navegador.
 */
export interface PaymentProvider {
  id: string;
  label: string;
  /** true si el cobro ocurre fuera de línea (no requiere redirección). */
  offline: boolean;
}

const cashOnDelivery: PaymentProvider = {
  id: "cash_on_delivery",
  label: "Pago contra entrega",
  offline: true,
};

export function getPaymentProvider(method: PaymentMethod): PaymentProvider {
  switch (method) {
    case "CASH_ON_DELIVERY":
      return cashOnDelivery;
    default:
      throw badRequest("Método de pago no soportado");
  }
}

export const availablePaymentMethods = [{ id: "CASH_ON_DELIVERY" as const, label: cashOnDelivery.label }];
