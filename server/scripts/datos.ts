/**
 * Copias de seguridad de la tienda (todas las tablas, fotos, modelos 3D y boletas).
 *
 *   npm run datos:exportar                       → copias/sole20-copia-AAAA-MM-DD-HHMM.jsonl.gz
 *   npm run datos:exportar -- mi-copia.jsonl.gz
 *   npm run datos:importar -- copia.jsonl.gz     (la base debe estar vacía)
 *   npm run datos:importar -- copia.jsonl.gz --reemplazar   (borra lo que haya y carga la copia)
 *
 * Sirve entre motores: una copia de Render (PostgreSQL) se importa en XAMPP (MySQL) y al revés.
 * La base es la de DATABASE_URL en server/.env.
 */
import fs from "node:fs";
import path from "node:path";
import { isMysql, prisma } from "../src/db";
import { exportBackup, importBackup } from "../src/services/backup";

// Rutas relativas a la carpeta desde la que se ejecutó npm (no a server/)
const fromCwd = (p: string) => path.resolve(process.env.INIT_CWD ?? process.cwd(), p);

async function main() {
  const [command, fileArg, ...flags] = process.argv.slice(2);
  const motor = isMysql ? "MySQL/MariaDB (XAMPP)" : "PostgreSQL";
  if (command === "exportar") {
    const stamp = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
    const file = fromCwd(fileArg ?? path.join("copias", `sole20-copia-${stamp}.jsonl.gz`));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    console.log(`Exportando desde ${motor}…`);
    const counts = await exportBackup(fs.createWriteStream(file));
    console.table(counts);
    console.log(`✔ Copia guardada en ${file} (${(fs.statSync(file).size / 1024 / 1024).toFixed(1)} MB)`);
  } else if (command === "importar" && fileArg) {
    const replace = flags.includes("--reemplazar");
    console.log(`Importando ${fileArg} en ${motor}${replace ? " (se reemplaza todo lo que haya)" : ""}…`);
    const result = await importBackup(fs.createReadStream(fromCwd(fileArg)), { replace });
    console.table(result.registros);
    console.log(`✔ Copia del ${result.creada} (${result.origen}) importada.`);
  } else {
    console.log("Uso:\n  npm run datos:exportar [-- archivo.jsonl.gz]\n  npm run datos:importar -- archivo.jsonl.gz [--reemplazar]");
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(`✖ ${(err as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
