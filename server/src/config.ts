import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno ${name}. Revisa server/.env (puedes copiar server/.env.example).`);
  }
  return value;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) throw new Error(`La variable ${name} debe ser un número entero`);
  return n;
}

const isProduction = process.env.NODE_ENV === "production";

const jwtStore = required("JWT_SECRET_STORE");
const jwtAdmin = required("JWT_SECRET_ADMIN");
if (jwtStore === jwtAdmin) {
  throw new Error("JWT_SECRET_STORE y JWT_SECRET_ADMIN deben ser distintos");
}
if (isProduction && (jwtStore.length < 32 || jwtAdmin.length < 32)) {
  throw new Error("En producción los secretos JWT deben tener al menos 32 caracteres");
}

export const config = {
  isProduction,
  // Cookies "Secure" (solo HTTPS). Por defecto activas en producción.
  cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === "true" : isProduction,
  port: int("PORT", 4000),
  databaseUrl: required("DATABASE_URL"),
  jwtSecretStore: jwtStore,
  jwtSecretAdmin: jwtAdmin,
  corsOrigins: (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  shippingFlatCents: int("SHIPPING_FLAT_CENTS", 1000),
  freeShippingMinCents: int("FREE_SHIPPING_MIN_CENTS", 30000),
  uploadsDir: process.env.UPLOADS_DIR ? path.resolve(process.env.UPLOADS_DIR) : path.resolve(__dirname, "../uploads"),
  // Carpetas de las apps compiladas (se sirven en producción desde la misma API)
  storeDist: path.resolve(__dirname, "../../apps/store/dist"),
  adminDist: path.resolve(__dirname, "../../apps/admin/dist"),
};
