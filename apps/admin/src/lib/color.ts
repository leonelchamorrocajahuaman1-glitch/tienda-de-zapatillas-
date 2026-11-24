/**
 * Color de la escena 3D a partir de la foto de la zapatilla: el tono vivo que
 * más se repite (se ignoran el fondo blanco, el negro y los grises), aclarado
 * para que brille sobre el fondo oscuro de la tienda.
 */

/** Para zapatillas blancas, negras o grises: un gris azulado suave. */
export const NEUTRAL_SCENE_COLOR = "#cfd6de";

const hex = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");

function hslToHex(h: number, s: number, l: number) {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

export async function dominantColor(url: string): Promise<string> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const size = 72;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return NEUTRAL_SCENE_COLOR;
  ctx.drawImage(img, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);

  // 24 grupos de tono (15° cada uno), pesando más los píxeles saturados y luminosos
  const buckets = Array.from({ length: 24 }, () => ({ w: 0, h: 0, s: 0 }));
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max ? (max - min) / max : 0;
    total++;
    if (sat < 0.3 || max < 0.18) continue; // fondo, negro, blanco o gris
    const d = max - min;
    let hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hue = (hue * 60 + 360) % 360;
    const w = sat * sat * max;
    const k = Math.floor(hue / 15) % 24;
    buckets[k].w += w;
    buckets[k].h += hue * w;
    buckets[k].s += sat * w;
  }

  // Grupo con más peso (sumando un poco de sus vecinos)
  let best = -1;
  let bestScore = 0;
  buckets.forEach((bk, k) => {
    const score = bk.w + 0.5 * (buckets[(k + 23) % 24].w + buckets[(k + 1) % 24].w);
    if (score > bestScore) {
      bestScore = score;
      best = k;
    }
  });
  // Casi sin color (zapatilla blanca, negra o gris)
  if (best < 0 || buckets[best].w < total * 0.01) return NEUTRAL_SCENE_COLOR;

  const bk = buckets[best];
  const hue = bk.h / bk.w;
  const sat = Math.max(0.6, Math.min(0.95, bk.s / bk.w));
  return hslToHex(hue, sat, 0.58);
}
