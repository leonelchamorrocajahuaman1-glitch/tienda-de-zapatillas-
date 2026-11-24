import path from "node:path";
import dotenv from "dotenv";
import { Prisma, PrismaClient } from "@prisma/client";

// Se lee aquí también: los scripts (importador, copias) usan la base sin pasar por config.ts
dotenv.config({ path: path.resolve(__dirname, "../.env") });

export const prisma = new PrismaClient();

export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Motor de base de datos según DATABASE_URL: PostgreSQL (Render) o
 * MySQL/MariaDB (XAMPP). El resto del código es el mismo para los dos.
 */
export const isMysql = /^mysql:/i.test(process.env.DATABASE_URL ?? "");

/**
 * SQL escrito con "comillas dobles" en los nombres (PostgreSQL); en MySQL se
 * cambian por `acentos graves`. Los valores siempre van como parámetros.
 */
export function portableSql(strings: TemplateStringsArray, ...values: unknown[]) {
  return Prisma.sql(isMysql ? strings.map((s) => s.replaceAll('"', "`")) : [...strings], ...values);
}

/**
 * Búsqueda de texto sin distinguir mayúsculas. En MySQL ya es así por defecto
 * (colación _ci), y la opción `mode` solo existe en PostgreSQL.
 */
export function textContains(value: string): { contains: string } {
  return (isMysql ? { contains: value } : { contains: value, mode: "insensitive" }) as { contains: string };
}

/** Igualdad de texto sin distinguir mayúsculas (ver textContains). */
export function textEquals(value: string): { equals: string } {
  return (isMysql ? { equals: value } : { equals: value, mode: "insensitive" }) as { equals: string };
}

/** Bloqueo mutuo entre dos transacciones (habitual en MySQL con compras simultáneas). */
function isDeadlock(err: unknown) {
  const e = err as { code?: string; meta?: { code?: string } } | null;
  return e?.code === "P2034" || (e?.code === "P2010" && ["1213", "1205", "40001", "40P01"].includes(String(e.meta?.code)));
}

/**
 * Repite una transacción que la base canceló por un bloqueo mutuo. Es seguro:
 * la transacción cancelada no dejó ningún cambio, y al repetirla ve el estado
 * nuevo (p. ej. que la última unidad ya se vendió → "sin stock").
 */
export async function withDeadlockRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts || !isDeadlock(err)) throw err;
      await new Promise((r) => setTimeout(r, 20 * i + Math.random() * 30));
    }
  }
}
