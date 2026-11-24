import { execSync } from "node:child_process";
import path from "node:path";

/**
 * Prepara la base de pruebas (PostgreSQL o MySQL/MariaDB según la URL):
 * aplica las migraciones y la vacía. Solo acepta bases cuyo nombre termine en _test.
 */
export async function resetTestDb(url: string) {
  if (!/_test(\?|$)/.test(new URL(url).pathname)) {
    throw new Error("Por seguridad, TEST_DATABASE_URL debe apuntar a una base cuyo nombre termine en _test");
  }
  process.env.DATABASE_URL = url;
  execSync("node scripts/prisma.mjs migrate deploy", {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: url },
    stdio: "ignore",
  });
  const { prisma, isMysql } = await import("../src/db");
  if (isMysql) {
    const tables = await prisma.$queryRaw<{ t: string }[]>`
      SELECT TABLE_NAME AS t FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME <> '_prisma_migrations'`;
    // En una sola conexión: las claves foráneas se desactivan solo mientras se vacía
    await prisma.$transaction([
      prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 0"),
      ...tables.map((x) => prisma.$executeRawUnsafe(`TRUNCATE TABLE \`${x.t}\``)),
      prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 1"),
    ]);
  } else {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  }
  return prisma;
}
