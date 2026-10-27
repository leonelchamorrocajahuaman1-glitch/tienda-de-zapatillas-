import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { config } from "../config";
import { badRequest } from "../lib/errors";

/**
 * Almacenamiento local de archivos en server/uploads.
 * Se publican en /uploads/... Para producción puedes sustituir este módulo por
 * un almacenamiento en la nube (S3, Cloudflare R2, Cloudinary) manteniendo las
 * mismas funciones: el resto del código solo guarda la URL resultante.
 */

const IMAGE_DIR = path.join(config.uploadsDir, "images");
const MODEL_DIR = path.join(config.uploadsDir, "models");
fs.mkdirSync(IMAGE_DIR, { recursive: true });
fs.mkdirSync(MODEL_DIR, { recursive: true });

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif"]);
const MODEL_EXT = new Set([".glb", ".gltf"]);

function storageFor(dir: string) {
  return multer.diskStorage({
    destination: dir,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`);
    },
  });
}

export const imageUpload = multer({
  storage: storageFor(IMAGE_DIR),
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

export const modelUpload = multer({
  storage: storageFor(MODEL_DIR),
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

function readHead(filePath: string, bytes: number): Buffer {
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(bytes);
    fs.readSync(fd, buf, 0, bytes, 0);
    return buf;
  } finally {
    fs.closeSync(fd);
  }
}

/** Comprueba el contenido real (no solo la extensión) de una imagen subida. */
export function assertValidImage(filePath: string) {
  const h = readHead(filePath, 12);
  const isJpeg = h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff;
  const isPng = h.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp = h.subarray(0, 4).toString("ascii") === "RIFF" && h.subarray(8, 12).toString("ascii") === "WEBP";
  const isAvif =
    h.subarray(4, 8).toString("ascii") === "ftyp" && ["avif", "avis"].includes(h.subarray(8, 12).toString("ascii"));
  if (!(isJpeg || isPng || isWebp || isAvif)) {
    removeFile(filePath);
    throw badRequest("El archivo no es una imagen válida");
  }
}

/**
 * Comprueba que el modelo sea un glTF 2.0 válido.
 * Un .gltf debe llevar sus buffers y texturas incrustados (data URI), porque
 * se sube un único archivo; si no, conviene exportarlo como .glb.
 */
export function assertValidModel(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".glb") {
    const h = readHead(filePath, 8);
    if (h.subarray(0, 4).toString("ascii") !== "glTF" || h.readUInt32LE(4) !== 2) {
      removeFile(filePath);
      throw badRequest("El archivo .glb no es un modelo glTF 2.0 válido");
    }
    return;
  }
  let json: { asset?: { version?: string }; buffers?: { uri?: string }[]; images?: { uri?: string }[] };
  try {
    json = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    removeFile(filePath);
    throw badRequest("El archivo .gltf no contiene JSON válido");
  }
  if (!json.asset?.version?.startsWith("2")) {
    removeFile(filePath);
    throw badRequest("El archivo .gltf no es glTF 2.0");
  }
  const external = [...(json.buffers ?? []), ...(json.images ?? [])].some((r) => r.uri && !r.uri.startsWith("data:"));
  if (external) {
    removeFile(filePath);
    throw badRequest(
      "Este .gltf depende de archivos externos (.bin o texturas). Expórtalo como .glb (un solo archivo) y vuelve a subirlo.",
    );
  }
}

export const publicUrl = (kind: "images" | "models", fileName: string) => `/uploads/${kind}/${fileName}`;

/** Elimina un archivo subido a partir de su URL pública (/uploads/...). */
export function removeByUrl(url: string | null | undefined) {
  if (!url || !url.startsWith("/uploads/")) return;
  const rel = url.replace(/^\/uploads\//, "");
  const full = path.resolve(config.uploadsDir, rel);
  if (!full.startsWith(config.uploadsDir + path.sep)) return; // evita salir de la carpeta
  removeFile(full);
}

function removeFile(full: string) {
  fs.rm(full, { force: true }, () => undefined);
}
