import { useQuery } from "@tanstack/react-query";
import { createApi } from "@tienda/shared";

export const api = createApi();
export const STORE_NAME = (import.meta.env.VITE_STORE_NAME as string | undefined) || "SOLE 20";

export const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export interface StoreSettings {
  shippingFlatCents: number;
  freeShippingMinCents: number;
  paymentMethods: { id: string; label: string }[];
}

export const useStoreSettings = () =>
  useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<StoreSettings>("/api/catalog/settings"),
    staleTime: 10 * 60 * 1000,
  });

/** UUID v4 (crypto.randomUUID solo existe en contextos seguros: https o localhost). */
export function uuid(): string {
  const c = globalThis.crypto as Crypto & { randomUUID?: () => string };
  if (typeof c.randomUUID === "function") return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
