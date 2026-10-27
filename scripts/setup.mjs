#!/usr/bin/env node
/**
 * Configuración inicial (Windows, macOS y Linux):
 *   1. Crea server/.env con secretos aleatorios (pregunta los datos clave)
 *   2. Instala dependencias
 *   3. Crea la base de datos y aplica las migraciones
 *   4. Carga los datos iniciales (administrador, tallas, colores, categorías)
 *
 * Uso:  npm run setup
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, "server", ".env");
const examplePath = path.join(root, "server", ".env.example");
const isWin = process.platform === "win32";

const c = (code) => (s) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const red = c(31), green = c(32), bold = c(1), dim = c(2);

function run(cmd, args, opts = {}) {
  console.log(dim(`\n> ${cmd} ${args.join(" ")}`));
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: isWin, ...opts });
  if (r.status !== 0) {
    console.error(red(`\n✖ Falló: ${cmd} ${args.join(" ")}`));
    process.exit(r.status ?? 1);
  }
}

const major = Number(process.versions.node.split(".")[0]);
if (major < 20) {
  console.error(red(`Necesitas Node.js 20 o superior (tienes ${process.versions.node}). Descárgalo de https://nodejs.org`));
  process.exit(1);
}

console.log(bold("\n=== Tienda de zapatillas 3D · configuración inicial ===\n"));

if (!fs.existsSync(envPath)) {
  // Cola de líneas: funciona tanto escribiendo en la consola como con entrada redirigida.
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  const lines = [];
  const waiters = [];
  rl.on("line", (l) => (waiters.length ? waiters.shift()(l) : lines.push(l)));
  rl.on("close", () => waiters.splice(0).forEach((w) => w("")));
  const nextLine = () => (lines.length ? Promise.resolve(lines.shift()) : new Promise((r) => waiters.push(r)));
  const prompt = async (q) => {
    process.stdout.write(q);
    const l = await nextLine();
    if (!process.stdin.isTTY) process.stdout.write("\n");
    return l;
  };
  const ask = async (q, def) => (await prompt(`${q} ${dim(`[${def}]`)}: `)).trim() || def;
  console.log("Responde o pulsa Enter para usar el valor sugerido.\n");
  const dbUser = await ask("Usuario de PostgreSQL", "postgres");
  const dbPass = await ask("Contraseña de PostgreSQL", "postgres");
  const dbHost = await ask("Host de PostgreSQL", "localhost");
  const dbPort = await ask("Puerto de PostgreSQL", "5432");
  const dbName = await ask("Nombre de la base de datos", "tienda_zapatillas");
  const adminEmail = await ask("Email del administrador", "admin@tienda.local");
  let adminPass = "";
  while (adminPass.length < 10) {
    adminPass = (await prompt("Contraseña del administrador (mín. 10 caracteres): ")).trim();
    if (adminPass.length < 10) {
      console.log(red("  Debe tener al menos 10 caracteres."));
      if (!process.stdin.readable && lines.length === 0) process.exit(1);
    }
  }
  rl.close();

  const secret = () => crypto.randomBytes(48).toString("hex");
  const q = (v) => `"${v.replace(/"/g, '\\"')}"`;
  let env = fs.readFileSync(examplePath, "utf8");
  const set = (key, value) => {
    env = env.replace(new RegExp(`^${key}=.*$`, "m"), `${key}=${value}`);
  };
  set(
    "DATABASE_URL",
    q(`postgresql://${encodeURIComponent(dbUser)}:${encodeURIComponent(dbPass)}@${dbHost}:${dbPort}/${dbName}?schema=public`),
  );
  set("JWT_SECRET_STORE", q(secret()));
  set("JWT_SECRET_ADMIN", q(secret()));
  set("ADMIN_EMAIL", q(adminEmail));
  set("ADMIN_PASSWORD", q(adminPass));
  fs.writeFileSync(envPath, env);
  console.log(green("\n✔ server/.env creado (con secretos aleatorios)"));
} else {
  console.log(green("✔ server/.env ya existe, se reutiliza"));
}

run("npm", ["install"]);
console.log(bold("\nCreando la base de datos y aplicando migraciones…"));
run("npx", ["prisma", "migrate", "deploy"], { cwd: path.join(root, "server") });
console.log(bold("\nCargando datos iniciales…"));
run("npx", ["prisma", "db", "seed"], { cwd: path.join(root, "server") });
console.log(bold("\nImportando el catálogo (server/catalog/productos.json)…"));
run("npx", ["tsx", "scripts/importar-catalogo.ts"], { cwd: path.join(root, "server") });

console.log(green(bold("\n✔ Todo listo.\n")));
console.log(`Inicia el sistema con:  ${bold("npm run dev")}   (o doble clic en iniciar.bat)\n`);
console.log(`  Tienda:  http://localhost:5173`);
console.log(`  Panel:   http://localhost:5174/admin`);
console.log(`  API:     http://localhost:4000/api/health\n`);
