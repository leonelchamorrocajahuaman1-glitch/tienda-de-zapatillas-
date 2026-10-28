/**
 * Boletas para impresoras térmicas ESC/POS (58 mm y 80 mm).
 *
 * El diseño se describe una sola vez como una lista de bloques y de ahí salen:
 *   - los bytes ESC/POS que el agente envía a la impresora, y
 *   - la vista previa del panel (las mismas líneas, carácter por carácter).
 */

export type Align = "left" | "center" | "right";
export type TextSize = "normal" | "tall" | "double"; // tall = doble alto; double = doble alto y ancho

export type Block =
  | { type: "logo" }
  | { type: "text"; text: string; align?: Align; bold?: boolean; size?: TextSize }
  | { type: "rule" }
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

// ───────────────────────── Contenido ─────────────────────────

export function buildReceiptBlocks(s: ReceiptSnapshot, o: ReceiptRenderOptions): Block[] {
  const c = o.cols;
  const b: Block[] = [];
  if (o.printLogo) b.push({ type: "logo" });
  // El logo por defecto ya lleva el nombre: no se repite
  if (!o.logoHasName) b.push({ type: "text", text: s.storeName, align: "center", bold: true, size: o.printLogo ? "normal" : "double" });
  for (const line of s.headerLines) b.push({ type: "text", text: line, align: "center" });
  b.push({ type: "rule" });
  if (o.voided) b.push({ type: "text", text: "*** ANULADA ***", align: "center", bold: true, size: "tall" });
  if (o.copy) b.push({ type: "text", text: "*** COPIA - REIMPRESION ***", align: "center", bold: true });
  b.push({ type: "text", text: s.title, align: "center", bold: true });
  b.push({ type: "text", text: s.code, align: "center", bold: true, size: "tall" });
  b.push({ type: "feed", lines: 1 });
  b.push({ type: "text", text: row("Fecha:", formatLimaDate(s.issuedAt), c) });
  b.push({ type: "text", text: row("Pedido:", `PED-${String(s.orderNumber).padStart(6, "0")}`, c) });
  if (s.customerName) b.push({ type: "text", text: `Cliente: ${s.customerName}` });
  b.push({ type: "rule" });

  for (const it of s.items) {
    const name =
      it.brand && !it.name.toLowerCase().includes(it.brand.toLowerCase()) ? `${it.brand} ${it.name}` : it.name;
    b.push({ type: "text", text: name, bold: true });
    b.push({ type: "text", text: `  Talla ${it.size} · ${it.color}` });
    b.push({ type: "text", text: row(`  ${it.quantity} x ${money(it.unitPriceCents)}`, money(it.lineTotalCents), c) });
    if (it.discountPercent > 0) {
      b.push({ type: "text", text: `  Antes ${money(it.unitListPriceCents)} (-${it.discountPercent}%)` });
    }
  }
  b.push({ type: "rule" });
  b.push({ type: "text", text: row("Subtotal", money(s.subtotalCents), c) });
  if (s.discountCents > 0) b.push({ type: "text", text: row("Descuentos", money(-s.discountCents), c) });
  b.push({ type: "text", text: row("Envío", s.shippingCents === 0 ? "Gratis" : money(s.shippingCents), c) });
  b.push({ type: "text", text: row("TOTAL", money(s.totalCents), c), bold: true, size: "tall" });
  b.push({ type: "rule" });
  b.push({ type: "text", text: row("Pago:", s.paymentMethod, c) });
  b.push({ type: "text", text: row("Estado del pago:", o.paymentStatusLabel, c), bold: true });
  b.push({ type: "rule" });
  b.push({ type: "feed", lines: 1 });
  for (const line of s.footerMessage.split("\n").filter(Boolean)) {
    b.push({ type: "text", text: line, align: "center", bold: true });
  }
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
  b.push({ type: "rule" });
  b.push({ type: "text", text: "IMPRESIÓN DE PRUEBA", align: "center", bold: true, size: "tall" });
  b.push({ type: "feed", lines: 1 });
  b.push({ type: "text", text: row("Fecha:", formatLimaDate(new Date().toISOString()), c) });
  b.push({ type: "text", text: row("Papel:", `${info.paperWidth} mm (${c} columnas)`, c) });
  b.push({ type: "text", text: `Impresora: ${info.printerLabel}` });
  b.push({ type: "text", text: row("Caracteres:", info.charset.toUpperCase(), c) });
  b.push({ type: "rule" });
  b.push({ type: "text", text: "Acentos: áéíóú ÁÉÍÓÚ ñÑ ü ¿? ¡!" });
  b.push({ type: "text", text: "1234567890".repeat(Math.ceil(c / 10)).slice(0, c) });
  b.push({ type: "text", text: "Texto normal" });
  b.push({ type: "text", text: "Texto en negrita", bold: true });
  b.push({ type: "text", text: "Doble alto", size: "tall" });
  b.push({ type: "text", text: "Doble", size: "double" });
  b.push({ type: "text", text: "Centrado", align: "center" });
  b.push({ type: "text", text: "Derecha", align: "right" });
  b.push({ type: "rule" });
  b.push({ type: "text", text: "Si lees esto, la impresora está lista.", align: "center" });
  b.push({ type: "feed", lines: 1 });
  return b;
}

// ───────────────────────── Vista previa ─────────────────────────

export type PreviewLine =
  | { type: "logo" }
  | { type: "text"; text: string; align: Align; bold: boolean; size: TextSize }
  | { type: "blank" };

/** Las líneas exactas que saldrán en el papel (para la vista previa del panel). */
export function previewLines(blocks: Block[], cols: number): PreviewLine[] {
  const out: PreviewLine[] = [];
  for (const blk of blocks) {
    if (blk.type === "logo") out.push({ type: "logo" });
    else if (blk.type === "rule") out.push({ type: "text", text: "-".repeat(cols), align: "left", bold: false, size: "normal" });
    else if (blk.type === "feed") for (let i = 0; i < blk.lines; i++) out.push({ type: "blank" });
    else {
      const width = blk.size === "double" ? Math.floor(cols / 2) : cols;
      for (const line of wrap(blk.text, width)) {
        out.push({ type: "text", text: line, align: blk.align ?? "left", bold: Boolean(blk.bold), size: blk.size ?? "normal" });
      }
    }
  }
  return out;
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
  charset: Charset;
  logo: Raster | null;
  cut: boolean;
  copies: number;
}

export function encodeEscPos(blocks: Block[], o: EncodeOptions): Buffer {
  const parts: Buffer[] = [];
  const push = (...bytes: number[]) => parts.push(Buffer.from(bytes));
  const align = (a: Align) => push(ESC, 0x61, a === "center" ? 1 : a === "right" ? 2 : 0);

  push(ESC, 0x40); // inicializar
  if (o.charset !== "ascii") push(ESC, 0x74, CODEPAGE[o.charset]);

  for (const blk of blocks) {
    if (blk.type === "logo") {
      if (!o.logo) continue;
      align("center");
      // GS v 0: imagen en bloques de hasta 128 filas (compatible con más modelos)
      const bytesPerRow = o.logo.width / 8;
      for (let y = 0; y < o.logo.height; y += 128) {
        const rows = Math.min(128, o.logo.height - y);
        push(GS, 0x76, 0x30, 0x00, bytesPerRow & 0xff, bytesPerRow >> 8, rows & 0xff, rows >> 8);
        parts.push(o.logo.data.subarray(y * bytesPerRow, (y + rows) * bytesPerRow));
      }
      push(0x0a);
      align("left");
    } else if (blk.type === "rule") {
      parts.push(Buffer.from(`${"-".repeat(o.cols)}\n`, "ascii"));
    } else if (blk.type === "feed") {
      push(ESC, 0x64, blk.lines);
    } else {
      const size = blk.size ?? "normal";
      const width = size === "double" ? Math.floor(o.cols / 2) : o.cols;
      align(blk.align ?? "left");
      if (blk.bold) push(ESC, 0x45, 1);
      if (size !== "normal") push(GS, 0x21, size === "double" ? 0x11 : 0x01);
      for (const line of wrap(blk.text, width)) {
        parts.push(encodeText(line, o.charset));
        push(0x0a);
      }
      if (size !== "normal") push(GS, 0x21, 0x00);
      if (blk.bold) push(ESC, 0x45, 0);
      align("left");
    }
  }

  push(ESC, 0x64, 3); // avanzar el papel para que salga la boleta
  if (o.cut) push(GS, 0x56, 0x42, 0x02); // corte parcial (si la impresora tiene cortador)
  const one = Buffer.concat(parts);
  return Buffer.concat(Array.from({ length: Math.max(1, Math.min(5, o.copies)) }, () => one));
}
