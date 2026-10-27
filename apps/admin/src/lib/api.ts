import { createApi } from "@tienda/shared";

export const api = createApi();
export const STORE_NAME = (import.meta.env.VITE_STORE_NAME as string | undefined) || "SOLE 20";

/** URL pública de la tienda (en desarrollo, otro puerto). */
export const STORE_URL = import.meta.env.DEV ? "http://localhost:5173" : "";

export const soles = (cents: number) => (cents / 100).toFixed(2);
