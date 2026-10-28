import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@tienda/shared";
import { api } from "../lib/api";
import { Modal } from "./ReceiptPreview";

export interface ProductOption {
  id: string;
  name: string;
  slug: string;
  brand: string | null;
  hasModel: boolean;
}

type Status = { state: "ready" } | { state: "uploading" } | { state: "done" } | { state: "error"; message: string };

interface Item {
  file: File;
  productId: string;
  status: Status;
}

const MAX_MB = 60;

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\.(glb|gltf)$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Zapatilla cuyo nombre se parece más al nombre del archivo
 * ("air-max-270.glb" → Air Max 270). Si no hay una clara, queda sin asignar.
 */
export function matchProduct(fileName: string, products: ProductOption[]): string {
  const file = norm(fileName);
  const fileTokens = new Set(file.split(" "));
  const scored = products.map((p) => {
    const names = [p.name, p.slug, `${p.brand ?? ""} ${p.name}`].map(norm);
    if (names.some((n) => n.replace(/ /g, "") === file.replace(/ /g, ""))) return { id: p.id, score: 1 };
    let score = 0;
    for (const n of names) {
      const tokens = new Set(n.split(" "));
      const common = [...fileTokens].filter((t) => tokens.has(t)).length;
      score = Math.max(score, common / new Set([...fileTokens, ...tokens]).size);
    }
    return { id: p.id, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const [best, second] = scored;
  return best && best.score >= 0.5 && (!second || best.score > second.score) ? best.id : "";
}

/**
 * Subida de varios modelos 3D a la vez: cada archivo se asigna a una zapatilla
 * (por su nombre, y se puede corregir) y se suben de uno en uno.
 */
export function ModelBulkUpload({ products, onClose }: { products: ProductOption[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const sorted = useMemo(() => [...products].sort((a, b) => a.name.localeCompare(b.name, "es")), [products]);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const added = [...list].filter((f) => /\.(glb|gltf)$/i.test(f.name));
    setItems((prev) => [
      ...prev,
      ...added
        .filter((f) => !prev.some((i) => i.file.name === f.name && i.file.size === f.size))
        .map((file) => ({ file, productId: matchProduct(file.name, products), status: { state: "ready" } as Status })),
    ]);
  }

  const problem = (item: Item): string | null => {
    if (item.file.size > MAX_MB * 1024 * 1024) return `Pesa más de ${MAX_MB} MB`;
    if (!item.productId) return "Elige la zapatilla";
    if (items.filter((i) => i.productId === item.productId).length > 1) return "Hay dos archivos para esta zapatilla";
    return null;
  };

  const pending = items.filter((i) => i.status.state !== "done");
  const canUpload = !running && pending.length > 0 && pending.every((i) => !problem(i));

  async function uploadAll() {
    setRunning(true);
    // De uno en uno: así el servidor nunca procesa dos modelos grandes a la vez
    for (const item of pending) {
      const update = (status: Status) => setItems((prev) => prev.map((i) => (i.file === item.file ? { ...i, status } : i)));
      update({ state: "uploading" });
      try {
        const fd = new FormData();
        fd.append("model", item.file);
        await api.post(`/api/admin/products/${item.productId}/model`, fd);
        update({ state: "done" });
      } catch (err) {
        update({ state: "error", message: errorMessage(err) });
      }
    }
    setRunning(false);
    qc.invalidateQueries({ queryKey: ["admin-products"] });
    qc.invalidateQueries({ queryKey: ["admin-product"] });
  }

  const done = items.filter((i) => i.status.state === "done").length;

  return (
    <Modal title="Subir modelos 3D" onClose={() => !running && onClose()}>
      <div className="form-grid">
        <p className="muted" style={{ margin: 0 }}>
          Elige todos tus archivos <span className="mono">.glb</span> a la vez. Cada uno se asigna a la zapatilla con el nombre
          más parecido (por ejemplo <span className="mono">air-max-270.glb</span> → Air Max 270); revisa la lista y corrige
          lo que haga falta. Si una zapatilla ya tenía modelo, se reemplaza. Precios, stock y fotos no cambian.
        </p>
        <label className="dropzone">
          <input
            type="file"
            multiple
            accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
            disabled={running}
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <strong>{items.length ? "Añadir más archivos" : "Elegir archivos .glb"}</strong>
          <span style={{ fontSize: 12 }}>Puedes seleccionar varios a la vez (Ctrl o Mayús + clic). Máx. {MAX_MB} MB cada uno.</span>
        </label>

        {items.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Archivo</th>
                  <th>Zapatilla</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const issue = item.status.state === "ready" ? problem(item) : null;
                  return (
                    <tr key={`${item.file.name}-${item.file.size}`}>
                      <td>
                        <div className="mono" style={{ wordBreak: "break-all" }}>{item.file.name}</div>
                        <div className="muted" style={{ fontSize: 12 }}>{(item.file.size / 1024 / 1024).toFixed(1)} MB</div>
                      </td>
                      <td>
                        <select
                          className="select"
                          aria-label={`Zapatilla para ${item.file.name}`}
                          value={item.productId}
                          disabled={running || item.status.state === "done"}
                          onChange={(e) =>
                            setItems((prev) => prev.map((i) => (i === item ? { ...i, productId: e.target.value, status: { state: "ready" } } : i)))
                          }
                        >
                          <option value="">— Elegir zapatilla —</option>
                          {sorted.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                              {p.hasModel ? " · ya tiene 3D (se reemplaza)" : ""}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td style={{ fontSize: 13 }}>
                        {item.status.state === "uploading" ? (
                          <span className="muted">Subiendo…</span>
                        ) : item.status.state === "done" ? (
                          <span style={{ color: "var(--ok)" }}>✓ Subido</span>
                        ) : item.status.state === "error" ? (
                          <span style={{ color: "#ff7676" }}>{item.status.message}</span>
                        ) : issue ? (
                          <span style={{ color: "var(--warn)" }}>{issue}</span>
                        ) : (
                          <span className="muted">Listo para subir</span>
                        )}
                      </td>
                      <td className="right">
                        {!running && item.status.state !== "done" && (
                          <button
                            type="button"
                            className="btn btn--sm btn--ghost"
                            aria-label={`Quitar ${item.file.name}`}
                            onClick={() => setItems((prev) => prev.filter((i) => i !== item))}
                          >
                            ✕
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap" }}>
          {done > 0 && !running && <span className="muted">{done} de {items.length} subidos</span>}
          <button type="button" className="btn" onClick={onClose} disabled={running}>
            {done > 0 && pending.length === 0 ? "Cerrar" : "Cancelar"}
          </button>
          <button type="button" className="btn btn--primary" onClick={uploadAll} disabled={!canUpload}>
            {running ? "Subiendo…" : `Subir ${pending.length || ""} ${pending.length === 1 ? "modelo" : "modelos"}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
