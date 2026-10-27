import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, errorMessage, formatDate, formatMoney, type ProductStatus } from "@tienda/shared";
import { api, soles, STORE_URL } from "../lib/api";
import { useToast } from "../components/Toast";
import { ProductPill } from "../components/Pill";
import { ModelPreview } from "../components/ModelPreview";

interface Ref {
  id: string;
  name: string;
}
interface Color extends Ref {
  hex: string;
}
interface Size {
  id: string;
  label: string;
  sortOrder: number;
}
interface Variant {
  id: string;
  sizeId: string;
  colorId: string;
  sku: string | null;
  stock: number;
  reserved: number;
  active: boolean;
  size: Size;
  color: Color;
}
interface Product {
  id: string;
  name: string;
  slug: string;
  tagline: string | null;
  description: string;
  brandId: string | null;
  categoryId: string | null;
  priceCents: number;
  discountPercent: number;
  finalPriceCents: number;
  featured: boolean;
  accentColor: string;
  status: ProductStatus;
  modelUrl: string | null;
  modelFileName: string | null;
  publishedAt: string | null;
  images: { id: string; url: string; alt: string; colorId: string | null; sortOrder: number }[];
  variants: Variant[];
  priceHistory: { id: string; priceCents: number; discountPercent: number; createdAt: string; changedBy: { name: string } | null }[];
  unitsSold: number;
  revenueCents: number;
}

type Form = {
  name: string;
  slug: string;
  tagline: string;
  description: string;
  brandId: string;
  categoryId: string;
  price: string;
  discountPercent: string;
  featured: boolean;
  accentColor: string;
};

const EMPTY: Form = {
  name: "",
  slug: "",
  tagline: "",
  description: "",
  brandId: "",
  categoryId: "",
  price: "",
  discountPercent: "0",
  featured: false,
  accentColor: "#ff2a2a",
};

export function ProductEditorPage() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();

  const product = useQuery({
    queryKey: ["admin-product", id],
    queryFn: () => api.get<Product>(`/api/admin/products/${id}`),
    enabled: !isNew,
  });
  const brands = useQuery({ queryKey: ["brands"], queryFn: () => api.get<Ref[]>("/api/admin/taxonomy/brands") });
  const categories = useQuery({ queryKey: ["categories"], queryFn: () => api.get<Ref[]>("/api/admin/taxonomy/categories") });
  const colors = useQuery({ queryKey: ["colors"], queryFn: () => api.get<Color[]>("/api/admin/taxonomy/colors") });
  const sizes = useQuery({ queryKey: ["sizes"], queryFn: () => api.get<Size[]>("/api/admin/taxonomy/sizes") });

  const [form, setForm] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const p = product.data;

  useEffect(() => {
    if (!p) return;
    setForm({
      name: p.name,
      slug: p.slug,
      tagline: p.tagline ?? "",
      description: p.description,
      brandId: p.brandId ?? "",
      categoryId: p.categoryId ?? "",
      price: p.priceCents > 0 ? soles(p.priceCents) : "",
      discountPercent: String(p.discountPercent),
      featured: p.featured,
      accentColor: p.accentColor,
    });
  }, [p]);

  const setProduct = (data: Product) => {
    qc.setQueryData(["admin-product", data.id], data);
    qc.invalidateQueries({ queryKey: ["admin-products"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const finalPreview = useMemo(() => {
    const price = Number.parseFloat(form.price);
    const d = Number.parseInt(form.discountPercent, 10) || 0;
    if (!Number.isFinite(price) || price <= 0) return null;
    return Math.round(Math.round(price * 100) * (100 - d) / 100);
  }, [form.price, form.discountPercent]);

  async function saveGeneral(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    const body = {
      name: form.name,
      slug: form.slug || undefined,
      tagline: form.tagline || null,
      description: form.description,
      brandId: form.brandId || null,
      categoryId: form.categoryId || null,
      price: Number.parseFloat(form.price),
      discountPercent: Number.parseInt(form.discountPercent, 10) || 0,
      featured: form.featured,
      accentColor: form.accentColor,
    };
    try {
      if (isNew) {
        const created = await api.post<Product>("/api/admin/products", body);
        setProduct(created);
        toast("Producto creado como borrador. Ahora agrega tallas, imágenes y publícalo.");
        navigate(`/productos/${created.id}`, { replace: true });
      } else {
        setProduct(await api.patch<Product>(`/api/admin/products/${id}`, body));
        toast("Cambios guardados. La tienda ya muestra los datos nuevos.");
      }
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      toast(errorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(status: ProductStatus) {
    try {
      setProduct(await api.post<Product>(`/api/admin/products/${id}/status`, { status }));
      toast(
        status === "PUBLISHED"
          ? "Publicado: ya aparece en el catálogo de la tienda"
          : status === "ARCHIVED"
            ? "Producto desactivado y oculto de la tienda"
            : "Producto despublicado (borrador)",
      );
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  async function remove() {
    if (!confirm("¿Eliminar este producto definitivamente? Esta acción no se puede deshacer.")) return;
    try {
      await api.del(`/api/admin/products/${id}`);
      qc.invalidateQueries({ queryKey: ["admin-products"] });
      toast("Producto eliminado");
      navigate("/productos");
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  if (!isNew && product.isLoading) return <div className="center"><div className="spinner" /></div>;
  if (!isNew && !p) return <div className="alert">Producto no encontrado.</div>;

  const field = (k: keyof Form, label: string, input: React.ReactNode, hint?: string) => (
    <div className="field">
      <label className="label" htmlFor={k}>
        {label}
      </label>
      {input}
      {hint && <span className="hint">{hint}</span>}
      {errors[k] && <span className="alert" style={{ padding: "4px 8px" }}>{errors[k]}</span>}
    </div>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <Link to="/productos" className="label">
            ← Productos
          </Link>
          <h1 className="display">{isNew ? "Nueva zapatilla" : p!.name}</h1>
        </div>
        {p && (
          <div className="page-head__actions">
            <ProductPill status={p.status} />
            {p.status === "PUBLISHED" && (
              <a className="btn" href={`${STORE_URL}/zapatilla/${p.slug}`} target="_blank" rel="noreferrer">
                Ver en la tienda ↗
              </a>
            )}
          </div>
        )}
      </div>

      <div className="editor">
        <div className="stack">
          <form className="card" onSubmit={saveGeneral}>
            <div className="card__head">
              <h2>Datos generales y precio</h2>
              <button className="btn btn--primary" disabled={saving}>
                {saving ? "Guardando…" : isNew ? "Crear producto" : "Guardar cambios"}
              </button>
            </div>
            <div className="card__body form-grid">
              <div className="cols-2">
                {field("name", "Nombre", <input id="name" className="input" required value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Urban X" />)}
                {field("slug", "URL (slug)", <input id="slug" className="input" value={form.slug} onChange={(e) => set("slug", e.target.value)} placeholder="se genera del nombre" />, "Dirección pública: /zapatilla/<slug>")}
              </div>
              {field("tagline", "Frase cinematográfica", <input id="tagline" className="input" value={form.tagline} maxLength={120} onChange={(e) => set("tagline", e.target.value)} placeholder="Born from the streets" />, "Aparece letra a letra en la escena 3D de la portada")}
              {field("description", "Descripción", <textarea id="description" className="textarea" value={form.description} onChange={(e) => set("description", e.target.value)} />)}
              <div className="cols-2">
                {field(
                  "brandId",
                  "Marca",
                  <select id="brandId" className="select" value={form.brandId} onChange={(e) => set("brandId", e.target.value)}>
                    <option value="">— Sin marca —</option>
                    {brands.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>,
                )}
                {field(
                  "categoryId",
                  "Categoría",
                  <select id="categoryId" className="select" value={form.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
                    <option value="">— Sin categoría —</option>
                    {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>,
                )}
              </div>
              <div className="cols-3">
                {field("price", "Precio (S/)", <input id="price" className="input" type="number" min="0.01" step="0.01" required value={form.price} onChange={(e) => set("price", e.target.value)} placeholder="199.90" />)}
                {field("discountPercent", "Descuento (%)", <input id="discountPercent" className="input" type="number" min="0" max="90" step="1" value={form.discountPercent} onChange={(e) => set("discountPercent", e.target.value)} />)}
                <div className="field">
                  <span className="label">Precio final</span>
                  <div className="input num" style={{ display: "flex", alignItems: "center" }}>
                    {finalPreview !== null ? formatMoney(finalPreview) : "—"}
                  </div>
                </div>
              </div>
              <div className="cols-2">
                {field("accentColor", "Color de luz en la escena 3D", <input id="accentColor" className="input" type="color" value={form.accentColor} onChange={(e) => set("accentColor", e.target.value)} style={{ padding: 4 }} />)}
                <label className="switch" style={{ alignSelf: "end", height: 40 }}>
                  <input type="checkbox" checked={form.featured} onChange={(e) => set("featured", e.target.checked)} />
                  Destacar en la portada cinematográfica
                </label>
              </div>
            </div>
          </form>

          {p ? (
            <>
              <InventoryCard product={p} colors={colors.data ?? []} sizes={sizes.data ?? []} onSaved={setProduct} />
              <ImagesCard product={p} colors={colors.data ?? []} onSaved={setProduct} />
              <ModelCard product={p} onSaved={setProduct} />
            </>
          ) : (
            <div className="alert alert--info">
              Crea el producto para poder agregar tallas e inventario, imágenes y el modelo 3D.
            </div>
          )}
        </div>

        {p && (
          <aside className="editor__side">
            <section className="card">
              <div className="card__head">
                <h2>Publicación</h2>
                <ProductPill status={p.status} />
              </div>
              <div className="card__body form-grid">
                <p className="muted" style={{ margin: 0 }}>
                  {p.status === "PUBLISHED"
                    ? `Visible en la tienda desde ${p.publishedAt ? formatDate(p.publishedAt) : "hoy"}.`
                    : p.status === "DRAFT"
                      ? "Borrador: solo se ve en este panel."
                      : "Desactivado: oculto en la tienda, se conserva para el historial de ventas."}
                </p>
                {p.status !== "PUBLISHED" && (
                  <button className="btn btn--primary" onClick={() => changeStatus("PUBLISHED")}>
                    Publicar en la tienda
                  </button>
                )}
                {p.status === "PUBLISHED" && (
                  <button className="btn" onClick={() => changeStatus("DRAFT")}>
                    Despublicar
                  </button>
                )}
                {p.status !== "ARCHIVED" && (
                  <button className="btn" onClick={() => changeStatus("ARCHIVED")}>
                    Desactivar
                  </button>
                )}
                <button className="btn btn--danger" onClick={remove}>
                  Eliminar
                </button>
                <span className="hint muted" style={{ fontSize: 12 }}>
                  Los productos con pedidos no se pueden eliminar: desactívalos.
                </span>
              </div>
            </section>

            <section className="card">
              <div className="card__head">
                <h2>Rendimiento</h2>
              </div>
              <div className="card__body">
                <dl className="kv">
                  <dt>Unidades vendidas</dt>
                  <dd className="num">{p.unitsSold}</dd>
                  <dt>Ingresos</dt>
                  <dd className="num">{formatMoney(p.revenueCents)}</dd>
                  <dt>Stock disponible</dt>
                  <dd className="num">{p.variants.reduce((s, v) => s + (v.active ? v.stock - v.reserved : 0), 0)}</dd>
                </dl>
              </div>
            </section>

            <section className="card">
              <div className="card__head">
                <h2>Historial de precios</h2>
              </div>
              <table className="table">
                <tbody>
                  {p.priceHistory.map((h) => (
                    <tr key={h.id}>
                      <td className="muted" style={{ fontSize: 12 }}>
                        {formatDate(h.createdAt, true)}
                        <div>{h.changedBy?.name ?? ""}</div>
                      </td>
                      <td className="right num">
                        {formatMoney(Math.round((h.priceCents * (100 - h.discountPercent)) / 100))}
                        {h.discountPercent > 0 && (
                          <div className="muted" style={{ fontSize: 11 }}>
                            {formatMoney(h.priceCents)} −{h.discountPercent}%
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </aside>
        )}
      </div>
    </>
  );
}

// ─────────────────────────── Inventario por talla ───────────────────────────

type Cell = { stock: string; sku: string; active: boolean };

function InventoryCard({
  product,
  colors,
  sizes,
  onSaved,
}: {
  product: Product;
  colors: Color[];
  sizes: Size[];
  onSaved: (p: Product) => void;
}) {
  const toast = useToast();
  const [colorIds, setColorIds] = useState<string[]>([]);
  const [sizeIds, setSizeIds] = useState<string[]>([]);
  const [cells, setCells] = useState<Record<string, Cell>>({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const c = [...new Set(product.variants.map((v) => v.colorId))];
    const s = [...new Set(product.variants.map((v) => v.sizeId))];
    setColorIds(c);
    setSizeIds(s);
    setCells(
      Object.fromEntries(
        product.variants.map((v) => [`${v.sizeId}:${v.colorId}`, { stock: String(v.stock), sku: v.sku ?? "", active: v.active }]),
      ),
    );
    setDirty(false);
  }, [product]);

  const byKey = useMemo(() => new Map(product.variants.map((v) => [`${v.sizeId}:${v.colorId}`, v])), [product.variants]);
  const sortedSizes = sizes.filter((s) => sizeIds.includes(s.id));
  const sortedColors = colors.filter((c) => colorIds.includes(c.id));

  const toggle = (list: string[], setList: (l: string[]) => void, id: string) => {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
    setDirty(true);
  };
  const cell = (key: string): Cell => cells[key] ?? { stock: "0", sku: "", active: true };
  const setCell = (key: string, patch: Partial<Cell>) => {
    setCells((c) => ({ ...c, [key]: { ...cell(key), ...patch } }));
    setDirty(true);
  };

  async function save() {
    const variants = sortedColors.flatMap((c) =>
      sortedSizes.map((s) => {
        const k = `${s.id}:${c.id}`;
        const v = cell(k);
        return { sizeId: s.id, colorId: c.id, stock: Number.parseInt(v.stock, 10) || 0, sku: v.sku || null, active: v.active };
      }),
    );
    setSaving(true);
    try {
      onSaved(await api.put<Product>(`/api/admin/products/${product.id}/variants`, { variants }));
      toast("Inventario actualizado");
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card">
      <div className="card__head">
        <h2>Tallas, colores y existencias</h2>
        <button className="btn btn--primary" onClick={save} disabled={saving || !dirty}>
          {saving ? "Guardando…" : "Guardar inventario"}
        </button>
      </div>
      <div className="card__body form-grid">
        <div className="field">
          <span className="label">Colores</span>
          <div className="picker">
            {colors.map((c) => (
              <button key={c.id} type="button" className={colorIds.includes(c.id) ? "is-on" : ""} onClick={() => toggle(colorIds, setColorIds, c.id)}>
                <span className="dot" style={{ background: c.hex }} /> {c.name}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="label">Tallas (EU)</span>
          <div className="picker">
            {sizes.map((s) => (
              <button key={s.id} type="button" className={sizeIds.includes(s.id) ? "is-on" : ""} onClick={() => toggle(sizeIds, setSizeIds, s.id)}>
                {s.label}
              </button>
            ))}
          </div>
          <span className="hint">
            ¿Falta un color o una talla? Créalos en <Link to="/catalogo-base"><u>Marcas, categorías y tallas</u></Link>.
          </span>
        </div>

        {sortedColors.length > 0 && sortedSizes.length > 0 ? (
          <div className="table-wrap">
            <table className="table matrix">
              <thead>
                <tr>
                  <th>Color</th>
                  <th>Talla</th>
                  <th>Stock físico</th>
                  <th>Reservado</th>
                  <th>Disponible</th>
                  <th>SKU</th>
                  <th>Activa</th>
                </tr>
              </thead>
              <tbody>
                {sortedColors.flatMap((c) =>
                  sortedSizes.map((s) => {
                    const k = `${s.id}:${c.id}`;
                    const v = cell(k);
                    const existing = byKey.get(k);
                    const reserved = existing?.reserved ?? 0;
                    const available = (Number.parseInt(v.stock, 10) || 0) - reserved;
                    return (
                      <tr key={k}>
                        <td>
                          <span className="dot" style={{ background: c.hex }} /> {c.name}
                        </td>
                        <td className="mono">{s.label}</td>
                        <td>
                          <input className="input input--sm num" type="number" min={reserved} value={v.stock} onChange={(e) => setCell(k, { stock: e.target.value })} aria-label={`Stock ${c.name} ${s.label}`} />
                        </td>
                        <td className="num muted">{reserved}</td>
                        <td className={`num ${available <= 0 ? "zero" : available <= 3 ? "low" : ""}`}>{available}</td>
                        <td>
                          <input className="input input--sm" style={{ width: 130 }} value={v.sku} onChange={(e) => setCell(k, { sku: e.target.value })} aria-label="SKU" />
                        </td>
                        <td>
                          <input type="checkbox" checked={v.active} onChange={(e) => setCell(k, { active: e.target.checked })} aria-label="Activa" />
                        </td>
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            Selecciona al menos un color y una talla para definir el inventario.
          </p>
        )}
        <span className="hint muted" style={{ fontSize: 12 }}>
          "Reservado" son unidades de pedidos pendientes: se descuentan del stock físico al confirmar el pedido. El stock no puede
          quedar por debajo de lo reservado.
        </span>
      </div>
    </section>
  );
}

// ─────────────────────────── Imágenes ───────────────────────────

function ImagesCard({ product, colors, onSaved }: { product: Product; colors: Color[]; onSaved: (p: Product) => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [colorId, setColorId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [over, setOver] = useState(false);
  const productColors = colors.filter((c) => product.variants.some((v) => v.colorId === c.id));

  async function upload(files: FileList | File[]) {
    const list = [...files];
    if (!list.length) return;
    const fd = new FormData();
    list.forEach((f) => fd.append("images", f));
    if (colorId) fd.append("colorId", colorId);
    setUploading(true);
    try {
      onSaved(await api.post<Product>(`/api/admin/products/${product.id}/images`, fd));
      toast(`${list.length} imagen(es) subida(s)`);
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  async function del(imageId: string) {
    if (!confirm("¿Eliminar esta imagen?")) return;
    try {
      onSaved(await api.del<Product>(`/api/admin/products/${product.id}/images/${imageId}`));
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  async function move(index: number, dir: -1 | 1) {
    const ids = product.images.map((i) => i.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    try {
      onSaved(await api.post<Product>(`/api/admin/products/${product.id}/images/reorder`, { ids }));
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  async function assignColor(imageId: string, value: string) {
    try {
      onSaved(await api.patch<Product>(`/api/admin/products/${product.id}/images/${imageId}`, { colorId: value || null }));
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  return (
    <section className="card">
      <div className="card__head">
        <h2>Imágenes</h2>
        <span className="muted">{product.images.length} imagen(es) · la primera es la portada</span>
      </div>
      <div className="card__body form-grid">
        <label
          className={`dropzone ${over ? "is-over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            upload(e.dataTransfer.files);
          }}
        >
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple onChange={(e) => e.target.files && upload(e.target.files)} />
          <strong>{uploading ? "Subiendo…" : "Arrastra imágenes aquí o haz clic para elegir"}</strong>
          <span style={{ fontSize: 12 }}>JPG, PNG, WEBP o AVIF · máx. 8 MB c/u · recomendado: fondo transparente (PNG/WEBP)</span>
        </label>
        {productColors.length > 1 && (
          <div className="field" style={{ maxWidth: 300 }}>
            <span className="label">Asociar las nuevas imágenes al color</span>
            <select className="select" value={colorId} onChange={(e) => setColorId(e.target.value)}>
              <option value="">Todos los colores</option>
              {productColors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
        {product.images.length > 0 && (
          <div className="images-grid">
            {product.images.map((img, i) => (
              <div key={img.id} className="img-tile">
                <img src={img.url} alt={img.alt} />
                {productColors.length > 1 && (
                  <select className="select input--sm" value={img.colorId ?? ""} onChange={(e) => assignColor(img.id, e.target.value)} aria-label="Color de la imagen">
                    <option value="">Todos</option>
                    {productColors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                )}
                <div className="img-tile__actions">
                  <button className="btn btn--sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Mover antes">←</button>
                  <button className="btn btn--sm btn--danger" onClick={() => del(img.id)}>Quitar</button>
                  <button className="btn btn--sm" onClick={() => move(i, 1)} disabled={i === product.images.length - 1} aria-label="Mover después">→</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ─────────────────────────── Modelo 3D ───────────────────────────

function ModelCard({ product, onSaved }: { product: Product; onSaved: (p: Product) => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function upload(file: File | undefined) {
    if (!file) return;
    const fd = new FormData();
    fd.append("model", file);
    setUploading(true);
    try {
      onSaved(await api.post<Product>(`/api/admin/products/${product.id}/model`, fd));
      toast("Modelo 3D asociado al producto");
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove() {
    if (!confirm("¿Quitar el modelo 3D de este producto?")) return;
    try {
      onSaved(await api.del<Product>(`/api/admin/products/${product.id}/model`));
      toast("Modelo 3D eliminado");
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  return (
    <section className="card">
      <div className="card__head">
        <h2>Modelo 3D</h2>
        {product.modelUrl && (
          <button className="btn btn--sm btn--danger" onClick={remove}>
            Quitar modelo
          </button>
        )}
      </div>
      <div className="card__body form-grid">
        {product.modelUrl ? (
          <>
            <ModelPreview key={product.modelUrl} src={product.modelUrl} />
            <span className="muted">
              Archivo: <span className="mono">{product.modelFileName}</span> — gira con el mouse, acerca con la rueda.
            </span>
          </>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            Sin modelo 3D. La tienda mostrará las fotos del producto en su lugar.
          </p>
        )}
        <label className="dropzone">
          <input ref={input} type="file" accept=".glb,.gltf,model/gltf-binary,model/gltf+json" onChange={(e) => upload(e.target.files?.[0])} />
          <strong>{uploading ? "Subiendo modelo…" : product.modelUrl ? "Reemplazar modelo 3D" : "Subir modelo 3D (.glb o .gltf)"}</strong>
          <span style={{ fontSize: 12 }}>
            Máx. 60 MB. Usa .glb (un solo archivo con texturas). Un .gltf debe llevar texturas y buffers incrustados.
          </span>
        </label>
      </div>
    </section>
  );
}
