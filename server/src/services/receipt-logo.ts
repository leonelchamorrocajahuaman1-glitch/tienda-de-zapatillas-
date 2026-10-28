import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { prisma } from "../db";
import { dotsFor, type Raster } from "./escpos";

/**
 * Convierte el logo (PNG) en una imagen de 1 bit para la impresora térmica:
 * se reduce al ~55 % del ancho imprimible y cada punto queda negro o blanco.
 */

const DEFAULT_LOGO = path.resolve(__dirname, "../../assets/logo-boleta.png");
const cache = new Map<string, Raster>();

async function logoBytes(logoUrl: string | null): Promise<Buffer> {
  const id = logoUrl?.match(/^\/uploads\/([a-z0-9]+)/i)?.[1];
  if (id) {
    const file = await prisma.storedFile.findUnique({ where: { id }, select: { data: true } });
    if (file) return Buffer.from(file.data);
  }
  return fs.readFileSync(DEFAULT_LOGO);
}

export function pngToRaster(png: Buffer, maxWidth: number): Raster {
  const img = PNG.sync.read(png);
  const targetW = Math.max(8, Math.floor(Math.min(maxWidth, img.width) / 8) * 8);
  const scale = img.width / targetW;
  const targetH = Math.max(1, Math.round(img.height / scale));
  const bytesPerRow = targetW / 8;
  const data = Buffer.alloc(bytesPerRow * targetH);

  for (let y = 0; y < targetH; y++) {
    for (let x = 0; x < targetW; x++) {
      // Promedio de los píxeles de origen que caen en este punto (reducción suave)
      const x0 = Math.floor(x * scale);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * scale));
      const y0 = Math.floor(y * scale);
      const y1 = Math.max(y0 + 1, Math.floor((y + 1) * scale));
      let sum = 0;
      let n = 0;
      for (let sy = y0; sy < Math.min(y1, img.height); sy++) {
        for (let sx = x0; sx < Math.min(x1, img.width); sx++) {
          const i = (sy * img.width + sx) * 4;
          const a = img.data[i + 3] / 255;
          const lum = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
          sum += lum * a + 255 * (1 - a); // lo transparente cuenta como papel blanco
          n++;
        }
      }
      if (n && sum / n < 140) data[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { width: targetW, height: targetH, data };
}

export async function loadLogoRaster(logoUrl: string | null, paperWidth: number): Promise<Raster | null> {
  const key = `${logoUrl ?? "default"}:${paperWidth}`;
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const raster = pngToRaster(await logoBytes(logoUrl), Math.round(dotsFor(paperWidth) * 0.55));
    cache.set(key, raster);
    return raster;
  } catch {
    return null; // logo inválido: se imprime sin logo
  }
}

export function clearLogoCache() {
  cache.clear();
}

/** El logo tal como saldrá en el papel (blanco y negro), para la vista previa. */
export function rasterToPng(r: Raster): Buffer {
  const png = new PNG({ width: r.width, height: r.height });
  const bytesPerRow = r.width / 8;
  for (let y = 0; y < r.height; y++) {
    for (let x = 0; x < r.width; x++) {
      const black = (r.data[y * bytesPerRow + (x >> 3)] & (0x80 >> (x & 7))) !== 0;
      const i = (y * r.width + x) * 4;
      const v = black ? 17 : 255;
      png.data[i] = v;
      png.data[i + 1] = v;
      png.data[i + 2] = v;
      png.data[i + 3] = black ? 255 : 0;
    }
  }
  return PNG.sync.write(png);
}
