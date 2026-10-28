/**
 * Boletas para impresoras térmicas ESC/POS (58 mm y 80 mm).
 *
 * El diseño se describe una sola vez como una lista de bloques y de ahí salen:
 *   - los bytes ESC/POS que el agente envía a la impresora, y
 *   - la vista previa del panel (las mismas líneas, carácter por carácter).
 */

export type Align = "left" | "center" | "right";
export type TextSize = "normal" | "tall" | "double"; // tall = doble alto; double = doble alto y ancho
/** Separadores: se imprimen como imagen (líneas continuas, iguales en cualquier impresora). */
export type RuleStyle = "solid" | "dashed" | "double" | "thick";

export type Block =
  | { type: "logo" }
  /** inverse = blanco sobre negro (si la impresora no lo soporta, sale texto normal) */
  | { type: "text"; text: string; align?: Align; bold?: boolean; size?: TextSize; inverse?: boolean }
  | { type: "rule"; style?: RuleStyle }
  | { type: "feed"; lines: number };

export interface ReceiptItemSnapshot {
  name: string;
  brand: string | null;
  size: string;
  color: string;
  quantity: number;
  unitListPriceCents: number;
  discountPercent: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

/** Copia inmutable de la venta guardada al emitir la boleta. */
export interface ReceiptSnapshot {
  storeName: string;
  title: string;
  headerLines: string[];
  footerMessage: string;
  legalNote: string;
  code: string;
  issuedAt: string;
  orderNumber: number;
  customerName: string | null;
  items: ReceiptItemSnapshot[];
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  totalCents: number;
  paymentMethod: string;
}

export interface ReceiptRenderOptions {
  cols: number;
  printLogo: boolean;
  /** reimpresión: se marca como COPIA */
  copy: boolean;
  /** estado del pago en el momento de imprimir */
  paymentStatusLabel: string;
  voided: boolean;
  /** el logo impreso ya incluye el nombre de la tienda */
  logoHasName?: boolean;
}

/** Columnas de texto (fuente A) según el ancho del papel. */
export const columnsFor = (paperWidth: number) => (paperWidth === 58 ? 32 : 48);
/** Puntos imprimibles por línea (203 dpi). */
export const dotsFor = (paperWidth: number) => (paperWidth === 58 ? 384 : 576);

// ───────────────────────── Formato ─────────────────────────

const money = (cents: number) => {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const soles = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}S/ ${soles}.${String(abs % 100).padStart(2, "0")}`;
};

export const formatLimaDate = (iso: string) => {
  const parts = new Intl.DateTimeFormat("es-PE", {
    timeZone: "America/Lima",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}`;
};

/** Parte un texto en líneas de como máximo `width` caracteres, respetando palabras. */
export function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    // Si cabe, se respeta tal cual (columnas alineadas con espacios, sangrías)
    if (paragraph.length <= width) {
      out.push(paragraph);
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (word.length > width) {
        if (line) out.push(line);
        for (let i = 0; i < word.length; i += width) out.push(word.slice(i, i + width));
        line = out.pop() ?? "";
        continue;
      }
      if (!line) line = word;
      else if (line.length + 1 + word.length <= width) line += ` ${word}`;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

/** "Etiqueta ........ valor" ocupando exactamente `cols` caracteres. */
export function row(left: string, right: string, cols: number): string {
  const space = cols - right.length - 1;
  const l = left.length > space ? left.slice(0, Math.max(0, space)) : left;
  return l + " ".repeat(Math.max(1, cols - l.length - right.length)) + right;
}

/** Texto centrado y rellenado con espacios hasta `width` (franja invertida de ancho completo). */
export function bar(text: string, width: number): string {
  const t = text.slice(0, width);
  const left = Math.floor((width - t.length) / 2);
  return " ".repeat(left) + t + " ".repeat(width - t.length - left);
}

/** Etiqueta y valor en una línea; si no caben juntos, el valor pasa a la línea siguiente. */
function pair(label: string, value: string, cols: number): Block[] {
  if (label.length + 1 + value.length <= cols) return [{ type: "text", text: row(label, value, cols) }];
  return [
    { type: "text", text: label },
    { type: "text", text: value, align: "right" },
  ];
}

/** Franja invertida con el texto centrado; si el texto es muy largo, texto en negrita normal. */
function band(text: string, cols: number, size: TextSize = "normal"): Block {
  const width = size === "double" ? Math.floor(cols / 2) : cols;
  return text.length <= width - 2
    ? { type: "text", text: bar(text, width), bold: true, size, inverse: true }
    : { type: "text", text, align: "center", bold: true, size };
}

/** Sello invertido centrado (solo el texto, con un espacio de margen). */
const stamp = (text: string, size: TextSize = "normal"): Block => ({
  type: "text",
  text: ` ${text} `,
  align: "center",
  bold: true,
  size,
  inverse: true,
});

// ───────────────────────── Contenido ─────────────────────────

export function buildReceiptBlocks(s: ReceiptSnapshot, o: ReceiptRenderOptions): Block[] {
  const c = o.cols;
  const b: Block[] = [];

  // Cabecera: logo, nombre y datos de la tienda
  if (o.printLogo) b.push({ type: "logo" });
  // El logo por defecto ya lleva el nombre: no se repite
  if (!o.logoHasName) b.push({ type: "text", text: s.storeName, align: "center", bold: true, size: o.printLogo ? "normal" : "double" });
  for (const line of s.headerLines) b.push({ type: "text", text: line, align: "center" });
  b.push({ type: "feed", lines: 1 });

  // Tipo de comprobante y número
  b.push(band(s.title, c));
  b.push({ type: "text", text: s.code, align: "center", bold: true, size: "double" });
  if (o.voided) b.push(band("ANULADA", c, "tall"));
  if (o.copy) b.push(stamp("COPIA · REIMPRESIÓN"));
  b.push({ type: "feed", lines: 1 });

  // Datos de la venta
  b.push(...pair("FECHA", formatLimaDate(s.issuedAt), c));
  b.push(...pair("PEDIDO", `PED-${String(s.orderNumber).padStart(6, "0")}`, c));
  if (s.customerName) b.push(...pair("CLIENTE", s.customerName, c));
  b.push({ type: "rule", style: "solid" });

  // Productos
  s.items.forEach((it, i) => {
    if (i > 0) b.push({ type: "feed", lines: 1 });
    const showBrand = it.brand && !it.name.toLowerCase().includes(it.brand.toLowerCase());
    b.push({ type: "text", text: it.name, bold: true });
    b.push({ type: "text", text: [showBrand ? it.brand : null, `Talla ${it.size}`, it.color].filter(Boolean).join(" · ") });
    b.push({ type: "text", text: row(`${it.quantity} x ${money(it.unitPriceCents)}`, money(it.lineTotalCents), c) });
    if (it.discountPercent > 0) {
      b.push({ type: "text", text: `Precio regular ${money(it.unitListPriceCents)} · -${it.discountPercent}%` });
    }
  });
  b.push({ type: "rule", style: "dashed" });

  // Totales
  const units = s.items.reduce((n, it) => n + it.quantity, 0);
  const subtotalLabel = `Subtotal (${units} ${units === 1 ? "artículo" : "artículos"})`;
  const subtotal = money(s.subtotalCents);
  b.push(...pair(subtotalLabel.length + 1 + subtotal.length <= c ? subtotalLabel : "Subtotal", subtotal, c));
  if (s.discountCents > 0) b.push(...pair("Descuentos", money(-s.discountCents), c));
  b.push(...pair("Envío", s.shippingCents === 0 ? "Gratis" : money(s.shippingCents), c));
  b.push({ type: "rule", style: "double" });
  b.push({ type: "text", text: ` ${row("TOTAL", money(s.totalCents), c - 2)} `, bold: true, size: "tall", inverse: true });
  b.push({ type: "feed", lines: 1 });

  // Pago: método y, debajo, el estado como sello (POR COBRAR / PAGADO…)
  b.push({ type: "text", text: s.paymentMethod, align: "center" });
  b.push(stamp(o.paymentStatusLabel));
  b.push({ type: "rule", style: "solid" });

  // Despedida
  s.footerMessage
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((line, i) => b.push({ type: "text", text: line, align: "center", bold: true, size: i === 0 ? "tall" : "normal" }));
  if (s.legalNote.trim()) {
    b.push({ type: "feed", lines: 1 });
    b.push({ type: "text", text: s.legalNote, align: "center" });
  }
  b.push({ type: "feed", lines: 1 });
  return b;
}

export function buildTestBlocks(info: {
  storeName: string;
  paperWidth: number;
  printerLabel: string;
  charset: string;
  printLogo: boolean;
  logoHasName?: boolean;
}): Block[] {
  const c = columnsFor(info.paperWidth);
  const b: Block[] = [];
  if (info.printLogo) b.push({ type: "logo" });
  if (!info.logoHasName) b.push({ type: "text", text: info.storeName, align: "center", bold: true, size: "double" });
  b.push({ type: "feed", lines: 1 });
  b.push(band("IMPRESIÓN DE PRUEBA", c));
  b.push({ type: "feed", lines: 1 });
  b.push(...pair("FECHA", formatLimaDate(new Date().toISOString()), c));
  b.push(...pair("PAPEL", `${info.paperWidth} mm (${c} columnas)`, c));
  b.push(...pair("IMPRESORA", info.printerLabel, c));
  b.push(...pair("CARACTERES", info.charset.toUpperCase(), c));
  b.push({ type: "rule", style: "solid" });
  b.push({ type: "text", text: "Acentos: áéíóú ÁÉÍÓÚ ñÑ ü ¿? ¡!" });
  b.push({ type: "text", text: "1234567890".repeat(Math.ceil(c / 10)).slice(0, c) });
  b.push({ type: "text", text: "Texto normal" });
  b.push({ type: "text", text: "Texto en negrita", bold: true });
  b.push({ type: "text", text: "Doble alto", size: "tall" });
  b.push({ type: "text", text: "Doble", size: "double" });
  b.push({ type: "text", text: "Centrado", align: "center" });
  b.push({ type: "text", text: "Derecha", align: "right" });
  b.push(stamp("TEXTO INVERTIDO"));
  b.push({ type: "text", text: "Separadores:" });
  b.push({ type: "rule", style: "solid" });
  b.push({ type: "rule", style: "dashed" });
  b.push({ type: "rule", style: "double" });
  b.push({ type: "rule", style: "thick" });
  b.push({ type: "text", text: "Si ves el texto invertido y las cuatro líneas, las boletas saldrán con su diseño completo.", align: "center" });
  b.push({ type: "feed", lines: 1 });
  b.push({ type: "text", text: "La impresora está lista.", align: "center", bold: true });
  b.push({ type: "feed", lines: 1 });
  return b;
}

// ───────────────────────── Vista previa ─────────────────────────

export type PreviewLine =
  | { type: "logo" }
  | { type: "text"; text: string; align: Align; bold: boolean; size: TextSize; inverse: boolean }
  | { type: "rule"; style: RuleStyle }
  | { type: "blank" };

/** Las líneas exactas que saldrán en el papel (para la vista previa del panel). */
export function previewLines(blocks: Block[], cols: number): PreviewLine[] {
  const out: PreviewLine[] = [];
  for (const blk of blocks) {
    if (blk.type === "logo") out.push({ type: "logo" });
    else if (blk.type === "rule") out.push({ type: "rule", style: blk.style ?? "solid" });
    else if (blk.type === "feed") for (let i = 0; i < blk.lines; i++) out.push({ type: "blank" });
    else {
      const width = blk.size === "double" ? Math.floor(cols / 2) : cols;
      for (const line of wrap(blk.text, width)) {
        out.push({
          type: "text",
          text: line,
          align: blk.align ?? "left",
          bold: Boolean(blk.bold),
          size: blk.size ?? "normal",
          inverse: Boolean(blk.inverse),
        });
      }
    }
  }
  return out;
}

/** Separador como imagen de 1 bit a todo el ancho del papel. */
export function ruleRaster(style: RuleStyle, dots: number): Raster {
  const pad = 7; // aire arriba y abajo de la línea
  const strokes: number[][] =
    style === "double" ? [[0, 2], [4, 6]] : style === "thick" ? [[0, 4]] : [[0, 2]];
  const inkHeight = strokes[strokes.length - 1][1];
  const height = pad * 2 + inkHeight;
  const bytesPerRow = dots / 8;
  const data = Buffer.alloc(bytesPerRow * height);
  for (const [from, to] of strokes) {
    for (let y = pad + from; y < pad + to; y++) {
      for (let x = 0; x < dots; x++) {
        if (style === "dashed" && x % 16 >= 10) continue; // trazos de 10 puntos, huecos de 6
        data[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }
  return { width: dots, height, data };
}

// ───────────────────────── Codificación ESC/POS ─────────────────────────

export type Charset = "cp850" | "cp1252" | "ascii";

/** Número de tabla de caracteres (ESC t n) en impresoras compatibles con Epson. */
const CODEPAGE: Record<Exclude<Charset, "ascii">, number> = { cp850: 2, cp1252: 16 };

const MAP: Record<Exclude<Charset, "ascii">, Record<string, number>> = {
  cp850: {
    á: 0xa0, é: 0x82, í: 0xa1, ó: 0xa2, ú: 0xa3, ñ: 0xa4, Ñ: 0xa5, ü: 0x81, Ü: 0x9a,
    Á: 0xb5, É: 0x90, Í: 0xd6, Ó: 0xe0, Ú: 0xe9, "¿": 0xa8, "¡": 0xad, "°": 0xf8, "º": 0xa7, "ª": 0xa6, "·": 0xfa,
  },
  cp1252: {
    á: 0xe1, é: 0xe9, í: 0xed, ó: 0xf3, ú: 0xfa, ñ: 0xf1, Ñ: 0xd1, ü: 0xfc, Ü: 0xdc,
    Á: 0xc1, É: 0xc9, Í: 0xcd, Ó: 0xd3, Ú: 0xda, "¿": 0xbf, "¡": 0xa1, "°": 0xb0, "º": 0xba, "ª": 0xaa, "·": 0xb7,
  },
};

const REPLACE: Record<string, string> = {
  " ": " ", " ": " ", "—": "-", "–": "-", "“": '"', "”": '"', "‘": "'", "’": "'", "…": "...", "€": "EUR",
};

export function encodeText(text: string, charset: Charset): Buffer {
  const bytes: number[] = [];
  for (const raw of text) {
    const ch = REPLACE[raw] ?? raw;
    if (ch.length > 1) {
      bytes.push(...Buffer.from(ch, "ascii"));
      continue;
    }
    const code = ch.charCodeAt(0);
    if (code >= 0x20 && code < 0x7f) {
      bytes.push(code);
      continue;
    }
    const mapped = charset === "ascii" ? undefined : MAP[charset][ch];
    if (mapped !== undefined) {
      bytes.push(mapped);
      continue;
    }
    if (ch === "·") {
      bytes.push(0x2d); // "-" en modo ASCII
      continue;
    }
    // Sin equivalente: se quita el acento (á → a) o se usa "?"
    const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
    const b = base.charCodeAt(0);
    bytes.push(base.length && b >= 0x20 && b < 0x7f ? b : 0x3f);
  }
  return Buffer.from(bytes);
}

/** Imagen monocroma: 1 bit por punto, filas de `width / 8` bytes (bit 7 = izquierda). */
export interface Raster {
  width: number; // múltiplo de 8
  height: number;
  data: Buffer;
}

const ESC = 0x1b;
const GS = 0x1d;

export interface EncodeOptions {
  cols: number;
  /** puntos por línea (por defecto 12 por columna: 576 en 80 mm, 384 en 58 mm) */
  dots?: number;
  charset: Charset;
  logo: Raster | null;
  cut: boolean;
  copies: number;
}

export function encodeEscPos(blocks: Block[], o: EncodeOptions): Buffer {
  const parts: Buffer[] = [];
  const push = (...bytes: number[]) => parts.push(Buffer.from(bytes));
  const align = (a: Align) => push(ESC, 0x61, a === "center" ? 1 : a === "right" ? 2 : 0);
  const dots = o.dots ?? o.cols * 12;
  // GS v 0: imagen en bloques de hasta 128 filas (compatible con más modelos)
  const raster = (img: Raster) => {
    const bytesPerRow = img.width / 8;
    for (let y = 0; y < img.height; y += 128) {
      const rows = Math.min(128, img.height - y);
      push(GS, 0x76, 0x30, 0x00, bytesPerRow & 0xff, bytesPerRow >> 8, rows & 0xff, rows >> 8);
      parts.push(img.data.subarray(y * bytesPerRow, (y + rows) * bytesPerRow));
    }
  };

  push(ESC, 0x40); // inicializar
  if (o.charset !== "ascii") push(ESC, 0x74, CODEPAGE[o.charset]);

  for (const blk of blocks) {
    if (blk.type === "logo") {
      if (!o.logo) continue;
      align("center");
      raster(o.logo);
      push(0x0a);
      align("left");
    } else if (blk.type === "rule") {
      raster(ruleRaster(blk.style ?? "solid", dots));
    } else if (blk.type === "feed") {
      push(ESC, 0x64, blk.lines);
    } else {
      const size = blk.size ?? "normal";
      const width = size === "double" ? Math.floor(o.cols / 2) : o.cols;
      align(blk.align ?? "left");
      if (blk.bold) push(ESC, 0x45, 1);
      if (blk.inverse) push(GS, 0x42, 1);
      if (size !== "normal") push(GS, 0x21, size === "double" ? 0x11 : 0x01);
      for (const line of wrap(blk.text, width)) {
        parts.push(encodeText(line, o.charset));
        push(0x0a);
      }
      if (size !== "normal") push(GS, 0x21, 0x00);
      if (blk.inverse) push(GS, 0x42, 0);
      if (blk.bold) push(ESC, 0x45, 0);
      align("left");
    }
  }

  push(ESC, 0x64, 3); // avanzar el papel para que salga la boleta
  if (o.cut) push(GS, 0x56, 0x42, 0x02); // corte parcial (si la impresora tiene cortador)
  const one = Buffer.concat(parts);
  return Buffer.concat(Array.from({ length: Math.max(1, Math.min(5, o.copies)) }, () => one));
}
