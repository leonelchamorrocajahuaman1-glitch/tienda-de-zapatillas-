#!/usr/bin/env node
/**
 * Genera prisma/mysql/schema.prisma (XAMPP: MySQL / MariaDB) a partir de
 * prisma/schema.prisma (PostgreSQL), que es el único que se edita a mano.
 *
 * Diferencias necesarias en MySQL:
 *  - provider = "mysql"
 *  - los textos que no son claves ni índices pasan a TEXT (en MySQL un String
 *    es VARCHAR(191) y una dirección o una nota podrían no caber)
 *
 * Uso:  node scripts/schema-mysql.mjs          (escribe el archivo)
 *       node scripts/schema-mysql.mjs --check  (falla si está desactualizado)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "prisma");
const source = path.join(dir, "schema.prisma");
const target = path.join(dir, "mysql", "schema.prisma");

export function toMysql(schema) {
  let out = schema.replace(/provider\s*=\s*"postgresql"/, 'provider = "mysql"');
  out = out.replace(/model (\w+) \{([\s\S]*?)\n\}/g, (block, name, body) => {
    const lines = body.split("\n");
    // Campos que forman parte de claves, índices o relaciones: siguen siendo VARCHAR
    const keyed = new Set();
    for (const l of lines) {
      for (const m of l.matchAll(/@@(?:id|unique|index)\(\[([^\]]*)\]/g)) m[1].split(",").forEach((f) => keyed.add(f.trim()));
      for (const m of l.matchAll(/@relation\([^)]*fields:\s*\[([^\]]*)\]/g)) m[1].split(",").forEach((f) => keyed.add(f.trim()));
    }
    const fixed = lines.map((l) => {
      const m = l.match(/^(\s+)(\w+)(\s+)String(\??)(\s.*)?$/);
      if (!m) return l;
      const [, indent, field, gap, optional, rest = ""] = m;
      const [attrs, comment = ""] = rest.split(/(?=\/\/)/);
      if (keyed.has(field) || /@id\b|@unique\b|@db\./.test(attrs)) return l;
      return `${indent}${field}${gap}String${optional}${attrs.trimEnd()} @db.Text${comment ? ` ${comment.trim()}` : ""}`.replace(
        /String(\??) +@db\.Text/,
        "String$1 @db.Text",
      );
    });
    return `model ${name} {${fixed.join("\n")}\n}`;
  });
  return `// ⚠ ARCHIVO GENERADO desde ../schema.prisma por scripts/schema-mysql.mjs: no lo edites.\n// Base de datos MySQL / MariaDB (XAMPP).\n\n${out}`;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const generated = toMysql(fs.readFileSync(source, "utf8"));
  if (process.argv.includes("--check")) {
    const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
    if (current !== generated) {
      console.error("prisma/mysql/schema.prisma está desactualizado: ejecuta  node scripts/schema-mysql.mjs");
      process.exit(1);
    }
    console.log("✔ prisma/mysql/schema.prisma al día");
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, generated);
    console.log("✔ prisma/mysql/schema.prisma generado");
  }
}
