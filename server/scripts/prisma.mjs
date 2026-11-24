#!/usr/bin/env node
/**
 * Ejecuta la CLI de Prisma con el esquema que corresponde a la base de datos:
 *   DATABASE_URL = postgresql://…  → prisma/schema.prisma        (Render, PostgreSQL)
 *   DATABASE_URL = mysql://…       → prisma/mysql/schema.prisma  (XAMPP, MySQL/MariaDB)
 *
 * Uso:  node scripts/prisma.mjs migrate deploy   (igual que "prisma migrate deploy")
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(serverDir, ".env") });

const mysql = /^mysql:/i.test(process.env.DATABASE_URL ?? "");
const args = process.argv.slice(2);
if (mysql) {
  // El esquema MySQL se genera desde el de PostgreSQL (un solo origen)
  spawnSync(process.execPath, [path.join(serverDir, "scripts", "schema-mysql.mjs")], { stdio: "inherit" });
}
const schema = path.join(serverDir, "prisma", ...(mysql ? ["mysql", "schema.prisma"] : ["schema.prisma"]));
const needsSchema = !["db"].includes(args[0]) || args[1] !== "seed";
const prismaBin = path.join(serverDir, "..", "node_modules", "prisma", "build", "index.js");
const bin = fs.existsSync(prismaBin) ? prismaBin : path.join(serverDir, "node_modules", "prisma", "build", "index.js");
// Como en "npm run": los programas del proyecto (tsx para los datos iniciales) en el PATH
const binDirs = [path.join(serverDir, "node_modules", ".bin"), path.join(serverDir, "..", "node_modules", ".bin")];
const r = spawnSync(process.execPath, [bin, ...args, ...(needsSchema ? ["--schema", schema] : [])], {
  cwd: serverDir,
  stdio: "inherit",
  env: { ...process.env, PATH: [...binDirs, process.env.PATH ?? ""].join(path.delimiter) },
});
process.exit(r.status ?? 1);
