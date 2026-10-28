import { useEffect } from "react";

export type PreviewLine =
  | { type: "logo" }
  | { type: "blank" }
  | { type: "rule"; style: "solid" | "dashed" | "double" | "thick" }
  | {
      type: "text";
      text: string;
      align: "left" | "center" | "right";
      bold: boolean;
      size: "normal" | "tall" | "double";
      /** blanco sobre negro */
      inverse?: boolean;
    };

export interface Preview {
  cols: number;
  paperWidth: number;
  lines: PreviewLine[];
  cut: boolean;
  code?: string;
}

const logoUrl = (paperWidth: number) => `/api/admin/printing/logo-preview.png?paperWidth=${paperWidth}&t=${Date.now()}`;

/**
 * Vista previa de la boleta en papel térmico: las mismas líneas, carácter por
 * carácter, que el servidor envía a la impresora.
 */
export function ReceiptPaper({ preview }: { preview: Preview }) {
  return (
    <div className="paper-wrap">
      <div className="paper" style={{ "--cols": preview.cols } as React.CSSProperties}>
        {preview.lines.map((l, i) => {
          if (l.type === "logo") return <img key={i} className="paper__logo" src={logoUrl(preview.paperWidth)} alt="Logo" />;
          if (l.type === "blank") return <div key={i} className="paper__line">&nbsp;</div>;
          if (l.type === "rule") return <div key={i} className={`paper__rule paper__rule--${l.style}`} aria-hidden />;
          return (
            <div
              key={i}
              className={`paper__line paper__line--${l.size} ${l.bold ? "is-bold" : ""}`}
              style={{ textAlign: l.align }}
            >
              {l.inverse ? <span className="paper__ink">{l.text}</span> : l.text || " "}
            </div>
          );
        })}
        <div className="paper__cut">{preview.cut ? "✂ corte" : "— fin —"}</div>
      </div>
      <div className="muted" style={{ fontSize: 12, textAlign: "center" }}>
        Papel de {preview.paperWidth} mm · {preview.cols} caracteres por línea
      </div>
    </div>
  );
}

/** Impresión desde el navegador (ventana de impresión), útil sin agente o como respaldo. */
export function printInBrowser(preview: Preview, title: string) {
  const w = window.open("", "_blank", "width=480,height=720");
  if (!w) {
    alert("El navegador bloqueó la ventana. Permite las ventanas emergentes para este sitio.");
    return;
  }
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // Ancho que imprime de verdad una térmica (48 mm en papel de 58, 72 mm en papel de 80) y
  // letra calculada para que quepan todas las columnas (monoespaciada ≈ 0,6 em por carácter)
  const printable = preview.paperWidth === 58 ? 48 : 72;
  const charMm = +(printable / (preview.cols * 0.6)).toFixed(2);
  const body = preview.lines
    .map((l) => {
      if (l.type === "logo") return `<img class="logo" src="${location.origin}${logoUrl(preview.paperWidth)}" alt="">`;
      if (l.type === "blank") return `<div class="l">&nbsp;</div>`;
      if (l.type === "rule") return `<div class="rule ${l.style}"></div>`;
      const text = l.inverse ? `<span class="inv">${esc(l.text)}</span>` : esc(l.text) || "&nbsp;";
      return `<div class="l ${l.size} ${l.bold ? "b" : ""}" style="text-align:${l.align}">${text}</div>`;
    })
    .join("");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
@page { size: ${preview.paperWidth}mm auto; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0 auto; padding: 2mm 0; width: ${printable}mm; font-family: "Consolas", "Courier New", monospace; color: #000; }
.l { white-space: pre; font-size: ${charMm}mm; line-height: 1.35; overflow: hidden; }
.b { font-weight: 700; }
.tall { transform: scaleY(2); transform-origin: top; margin-bottom: 1.35em; }
.double { font-size: ${charMm * 2}mm; }
.logo { display: block; margin: 0 auto 2mm; max-width: 55%; image-rendering: pixelated; }
.inv, .rule { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.inv { background: #000; color: #fff; }
.rule { height: 0.25mm; margin: 0.9mm 0; background: #000; }
.rule.thick { height: 0.5mm; }
.rule.dashed { background: repeating-linear-gradient(90deg, #000 0 1.25mm, transparent 1.25mm 2mm); }
.rule.double { height: 0.75mm; background: linear-gradient(#000 0 0.25mm, transparent 0.25mm 0.5mm, #000 0.5mm); }
</style></head><body>${body}</body></html>`);
  w.document.close();
  const doPrint = () => {
    w.focus();
    w.print();
  };
  const img = w.document.querySelector("img");
  if (img && !img.complete) img.onload = img.onerror = doPrint;
  else setTimeout(doPrint, 250);
}

/** Ventana modal sencilla. */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal__backdrop" onClick={onClose} />
      <div className="modal__panel card">
        <div className="card__head">
          <h2>{title}</h2>
          <button className="btn btn--sm btn--ghost" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </div>
        <div className="card__body">{children}</div>
      </div>
    </div>
  );
}
