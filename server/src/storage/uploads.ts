import path from "node:path";
import type { Request, Response } from "express";
import multer from "multer";
import { prisma } from "../db";
import { badRequest } from "../lib/errors";

/**
 * Almacenamiento de imágenes y modelos 3D en PostgreSQL (tabla StoredFile).
 * Se publican en /uploads/<id>.<ext> con caché permanente: un archivo nunca
 * cambia; si se reemplaza, se crea otro con otro id.
 */

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif"]);
const MODEL_EXT = new Set([".glb", ".gltf"]);

export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!IMAGE_EXT.has(ext) || !file.mimetype.startsWith("image/")) {
      cb(badRequest("Solo se permiten imágenes JPG, PNG, WEBP o AVIF"));
      return;
    }
    cb(null, true);
  },
});

/** Fotogramas de la vista 360°: se suben por tandas para no saturar la memoria. */
export const spinUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024, files: 12 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!IMAGE_EXT.has(ext) || !file.mimetype.startsWith("image/")) {
      cb(badRequest("La vista 360° solo admite fotos JPG, PNG, WEBP o AVIF"));
      return;
    }
    cb(null, true);
  },
});

export const modelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 60 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!MODEL_EXT.has(ext)) {
      cb(badRequest("Solo se permiten modelos 3D en formato .glb o .gltf"));
      return;
    }
    cb(null, true);
  },
});

/** Comprueba el contenido real (no solo la extensión) y devuelve su tipo MIME. */
export function imageMime(buf: Buffer): string {
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (isJpeg) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  if (buf.subarray(4, 8).toString("ascii") === "ftyp" && ["avif", "avis"].includes(buf.subarray(8, 12).toString("ascii"))) {
    return "image/avif";
  }
  throw badRequest("El archivo no es una imagen válida");
}

/**
 * Comprueba que el modelo sea un glTF 2.0 válido.
 * Un .gltf debe llevar sus buffers y texturas incrustados (data URI), porque
 * se sube un único archivo; si no, conviene exportarlo como .glb.
 */
export function modelMime(buf: Buffer, originalName: string): string {
  const ext = path.extname(originalName).toLowerCase();
  if (ext === ".glb") {
    if (buf.subarray(0, 4).toString("ascii") !== "glTF" || buf.readUInt32LE(4) !== 2) {
      throw badRequest("El archivo .glb no es un modelo glTF 2.0 válido");
    }
    return "model/gltf-binary";
  }
  let json: { asset?: { version?: string }; buffers?: { uri?: string }[]; images?: { uri?: string }[] };
  try {
    json = JSON.parse(buf.toString("utf8"));
  } catch {
    throw badRequest("El archivo .gltf no contiene JSON válido");
  }
  if (!json.asset?.version?.startsWith("2")) throw badRequest("El archivo .gltf no es glTF 2.0");
  const external = [...(json.buffers ?? []), ...(json.images ?? [])].some((r) => r.uri && !r.uri.startsWith("data:"));
  if (external) {
    throw badRequest(
      "Este .gltf depende de archivos externos (.bin o texturas). Expórtalo como .glb (un solo archivo) y vuelve a subirlo.",
    );
  }
  return "model/gltf+json";
}

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/avif": ".avif",
  "model/gltf-binary": ".glb",
  "model/gltf+json": ".gltf",
};

/** Guarda un archivo y devuelve su URL pública (/uploads/<id>.<ext>). */
export async function saveFile(kind: "image" | "model", data: Buffer, mimeType: string, fileName: string) {
  const stored = await prisma.storedFile.create({
    data: { kind, mimeType, fileName: fileName.slice(0, 200), size: data.length, data },
    select: { id: true },
  });
  return `/uploads/${stored.id}${EXT_BY_MIME[mimeType] ?? ""}`;
}

const idFromUrl = (url: string | null | undefined) => {
  const match = url?.match(/^\/uploads\/([a-z0-9]+)(\.[a-z0-9]+)?$/i);
  return match?.[1] ?? null;
};

/** Elimina un archivo a partir de su URL pública. Nunca lanza errores. */
export async function removeByUrl(url: string | null | undefined) {
  const id = idFromUrl(url);
  if (!id) return;
  await prisma.storedFile.deleteMany({ where: { id } }).catch(() => undefined);
}

/** GET /uploads/:file — sirve el archivo desde la base de datos. */
export async function serveUpload(req: Request, res: Response) {
  const id = idFromUrl(`/uploads/${req.params.file}`);
  if (!id) {
    res.status(404).end();
    return;
  }
  if (req.headers["if-none-match"] === `"${id}"`) {
    res.status(304).end();
    return;
  }
  const file = await prisma.storedFile.findUnique({ where: { id }, select: { mimeType: true, data: true } });
  if (!file) {
    res.status(404).end();
    return;
  }
  res.setHeader("Content-Type", file.mimeType);
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("ETag", `"${id}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(Buffer.from(file.data));
}
