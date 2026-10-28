import { useEffect } from "react";

export type PreviewLine =
  | { type: "logo" }
  | { type: "blank" }
  | { type: "text"; text: string; align: "left" | "center" | "right"; bold: boolean; size: "normal" | "tall" | "double" };

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
          return (
            <div
              key={i}
              className={`paper__line paper__line--${l.size} ${l.bold ? "is-bold" : ""}`}
              style={{ textAlign: l.align }}
            >
              {l.text || " "}
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
  const body = preview.lines
    .map((l) => {
      if (l.type === "logo") return `<img class="logo" src="${location.origin}${logoUrl(preview.paperWidth)}" alt="">`;
      if (l.type === "blank") return `<div class="l">&nbsp;</div>`;
      return `<div class="l ${l.size} ${l.bold ? "b" : ""}" style="text-align:${l.align}">${esc(l.text) || "&nbsp;"}</div>`;
    })
    .join("");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
@page { size: ${preview.paperWidth}mm auto; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; padding: 3mm; width: ${preview.paperWidth}mm; font-family: "Consolas", "Courier New", monospace; color: #000; }
.l { white-space: pre; font-size: ${preview.paperWidth === 58 ? 2.9 : 3.0}mm; line-height: 1.35; overflow: hidden; }
.b { font-weight: 700; }
.tall { transform: scaleY(2); transform-origin: top; margin-bottom: 1.35em; }
.double { font-size: ${preview.paperWidth === 58 ? 5.8 : 6.0}mm; }
.logo { display: block; margin: 0 auto 2mm; max-width: 55%; image-rendering: pixelated; }
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
