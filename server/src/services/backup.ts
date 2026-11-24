import readline from "node:readline";
import type { Readable, Writable } from "node:stream";
import zlib from "node:zlib";
import { Prisma } from "@prisma/client";
import { isMysql, prisma } from "../db";
import { CHUNK_SIZE } from "../storage/uploads";

/**
 * Copia de seguridad completa de la tienda (todas las tablas, también fotos,
 * modelos 3D y boletas) en un archivo .jsonl.gz.
 *
 * Es independiente del motor: una copia hecha en PostgreSQL (Render) se puede
 * importar en MySQL/MariaDB (XAMPP) y al revés. Los id se conservan, así que las
 * fotos, pedidos y boletas siguen enlazados igual.
 *
 * Formato: una línea JSON por registro, tras una cabecera.
 *   {"formato":"sole20-copia","version":1,…}
 *   {"m":"User","r":{…}}        fechas → {"$d":"…"}, binarios → {"$b":"base64"}
 */

const FORMAT = "sole20-copia";
const VERSION = 1;

type Field = Prisma.DMMF.Field;
type Model = Prisma.DMMF.Model;
type Delegate = {
  findMany(args: object): Promise<Record<string, unknown>[]>;
  createMany(args: object): Promise<unknown>;
  create(args: object): Promise<unknown>;
  update(args: object): Promise<unknown>;
  deleteMany(args?: object): Promise<unknown>;
  count(): Promise<number>;
};

const delegate = (name: string) =>
  (prisma as unknown as Record<string, Delegate>)[name.charAt(0).toLowerCase() + name.slice(1)];

/** Modelos en orden de dependencias: cada tabla después de las tablas a las que apunta. */
export function modelsInOrder(): Model[] {
  const models = Prisma.dmmf.datamodel.models as Model[];
  const deps = new Map(
    models.map((m) => [
      m.name,
      new Set(
        m.fields
          .filter((f) => f.kind === "object" && (f.relationFromFields?.length ?? 0) > 0 && f.type !== m.name)
          .map((f) => f.type),
      ),
    ]),
  );
  const ordered: Model[] = [];
  const done = new Set<string>();
  while (ordered.length < models.length) {
    const next = models.find((m) => !done.has(m.name) && [...deps.get(m.name)!].every((d) => done.has(d)));
    if (!next) throw new Error("Hay dependencias circulares entre tablas");
    ordered.push(next);
    done.add(next.name);
  }
  return ordered;
}

const scalarFields = (m: Model) => m.fields.filter((f) => f.kind !== "object");
const idFields = (m: Model) => m.primaryKey?.fields ?? m.fields.filter((f) => f.isId).map((f) => f.name);

function encode(value: unknown): unknown {
  if (value instanceof Date) return { $d: value.toISOString() };
  if (value instanceof Uint8Array) return { $b: Buffer.from(value).toString("base64") };
  return value;
}

function decode(field: Field, value: unknown): unknown {
  if (value && typeof value === "object" && "$d" in value) return new Date((value as { $d: string }).$d);
  if (value && typeof value === "object" && "$b" in value) return Buffer.from((value as { $b: string }).$b, "base64");
  if (field.type === "Json" && value === null) return field.isRequired ? Prisma.JsonNull : Prisma.DbNull;
  return value;
}

async function writeLine(out: Writable, line: string) {
  if (!out.write(`${line}\n`)) await new Promise((resolve) => out.once("drain", resolve));
}

/** Escribe la copia comprimida en `destination` (archivo o respuesta HTTP). */
export async function exportBackup(destination: Writable): Promise<Record<string, number>> {
  const gzip = zlib.createGzip();
  gzip.pipe(destination);
  const models = modelsInOrder();
  const counts: Record<string, number> = {};
  for (const m of models) counts[m.name] = await delegate(m.name).count();
  await writeLine(
    gzip,
    JSON.stringify({ formato: FORMAT, version: VERSION, creada: new Date().toISOString(), motor: isMysql ? "mysql" : "postgresql", registros: counts }),
  );
  for (const m of models) {
    const ids = idFields(m);
    // Los archivos se leen de pocos en pocos para no llenar la memoria
    const page = m.name === "StoredFile" || m.name === "StoredFileChunk" ? 4 : 500;
    for (let skip = 0; ; skip += page) {
      const rows = await delegate(m.name).findMany({ orderBy: ids.map((f) => ({ [f]: "asc" })), skip, take: page });
      for (const r of rows) {
        const record: Record<string, unknown> = {};
        for (const f of scalarFields(m)) record[f.name] = encode(r[f.name]);
        await writeLine(gzip, JSON.stringify({ m: m.name, r: record }));
      }
      if (rows.length < page) break;
    }
  }
  gzip.end();
  await new Promise<void>((resolve, reject) => {
    destination.once("finish", resolve);
    destination.once("close", resolve);
    destination.once("error", reject);
  });
  return counts;
}

export interface ImportResult {
  registros: Record<string, number>;
  origen: string;
  creada: string;
}

/**
 * Importa una copia. La base debe estar vacía, salvo con `replace`, que borra
 * antes TODO su contenido (la copia pasa a ser la única fuente de datos).
 */
export async function importBackup(source: Readable, { replace = false } = {}): Promise<ImportResult> {
  const lines = readline.createInterface({ input: source.pipe(zlib.createGunzip()), crlfDelay: Infinity });
  const models = modelsInOrder();
  const byName = new Map(models.map((m) => [m.name, m]));
  const counts: Record<string, number> = {};
  let header: { formato?: string; version?: number; motor?: string; creada?: string } | null = null;

  let batchModel: Model | null = null;
  let batch: Record<string, unknown>[] = [];
  const flush = async () => {
    if (batchModel && batch.length) await delegate(batchModel.name).createMany({ data: batch });
    batch = [];
  };

  // Archivos: se vuelven a trocear al tamaño de esta base (MySQL usa trozos más pequeños)
  const open: { file: { id: string; buffer: Buffer; index: number } | null } = { file: null };
  const writeChunks = async (final: boolean) => {
    const file = open.file;
    if (!file) return;
    while (file.buffer.length >= CHUNK_SIZE || (final && file.buffer.length > 0)) {
      const part = file.buffer.subarray(0, CHUNK_SIZE);
      file.buffer = file.buffer.subarray(part.length);
      await prisma.storedFileChunk.create({ data: { fileId: file.id, index: file.index++, data: part } });
    }
    if (final) {
      await prisma.storedFile.update({ where: { id: file.id }, data: { chunks: file.index } });
      open.file = null;
    }
  };

  for await (const raw of lines) {
    if (!raw.trim()) continue;
    const line = JSON.parse(raw);
    if (!header) {
      if (line.formato !== FORMAT || line.version !== VERSION) throw new Error("El archivo no es una copia de seguridad de SOLE 20");
      header = line;
      const existing = (await Promise.all(models.map((m) => delegate(m.name).count()))).reduce((a, b) => a + b, 0);
      if (existing > 0 && !replace) {
        throw new Error("La base de datos ya tiene datos. Usa la opción de reemplazar para borrarlos e importar la copia.");
      }
      if (existing > 0) for (const m of [...models].reverse()) await delegate(m.name).deleteMany();
      continue;
    }
    const model = byName.get(line.m);
    if (!model) throw new Error(`Tabla desconocida en la copia: ${line.m}`);
    if (model !== batchModel) {
      await flush();
      batchModel = model;
    }
    const data: Record<string, unknown> = {};
    for (const f of scalarFields(model)) if (f.name in line.r) data[f.name] = decode(f, line.r[f.name]);
    counts[model.name] = (counts[model.name] ?? 0) + 1;

    if (model.name === "StoredFile") {
      await writeChunks(true);
      const content = data.data as Buffer;
      const inline = Number(data.chunks) === 0 && content.length <= CHUNK_SIZE;
      await prisma.storedFile.create({ data: { ...(data as Prisma.StoredFileCreateManyInput), data: inline ? content : Buffer.alloc(0), chunks: 0 } });
      if (!inline && Number(data.chunks) === 0) {
        open.file = { id: String(data.id), buffer: content, index: 0 };
        await writeChunks(true);
      }
    } else if (model.name === "StoredFileChunk") {
      if (open.file?.id !== data.fileId) {
        await writeChunks(true);
        open.file = { id: String(data.fileId), buffer: Buffer.alloc(0), index: 0 };
      }
      open.file!.buffer = Buffer.concat([open.file!.buffer, data.data as Buffer]);
      await writeChunks(false);
    } else {
      await writeChunks(true);
      batch.push(data);
      if (batch.length >= 200) await flush();
    }
  }
  if (!header) throw new Error("El archivo está vacío");
  await flush();
  await writeChunks(true);

  // PostgreSQL: el contador de números de pedido continúa tras el último importado
  if (!isMysql) {
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('"Order"', 'number'), COALESCE((SELECT MAX("number") FROM "Order"), 0) + 1, false)`,
    );
  }
  return { registros: counts, origen: header.motor ?? "?", creada: header.creada ?? "?" };
}
