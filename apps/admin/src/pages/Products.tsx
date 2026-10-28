import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { formatMoney, type ProductStatus } from "@tienda/shared";
import { api } from "../lib/api";
import { ProductPill } from "../components/Pill";
import { ModelBulkUpload } from "../components/ModelBulkUpload";

interface Row {
  id: string;
  name: string;
  slug: string;
  status: ProductStatus;
  featured: boolean;
  brand: string | null;
  category: string | null;
  priceCents: number;
  discountPercent: number;
  finalPriceCents: number;
  imageUrl: string | null;
  hasModel: boolean;
  variantCount: number;
  stock: number;
  reserved: number;
}

export function ProductsPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [uploadingModels, setUploadingModels] = useState(false);
  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  if (status) params.set("status", status);
  const { data, isLoading } = useQuery({
    queryKey: ["admin-products", params.toString()],
    queryFn: () => api.get<Row[]>(`/api/admin/products?${params}`),
  });
  // Todas las zapatillas (sin filtros) para asignarles los modelos 3D
  const all = useQuery({
    queryKey: ["admin-products", ""],
    queryFn: () => api.get<Row[]>("/api/admin/products?"),
    enabled: uploadingModels,
  });

  return (
    <>
      <div className="page-head">
        <div>
          <div className="label">Catálogo</div>
          <h1 className="display">Productos</h1>
        </div>
        <div className="page-head__actions">
          <button className="btn" onClick={() => setUploadingModels(true)}>
            Subir modelos 3D
          </button>
          <Link to="/productos/nuevo" className="btn btn--primary">
            + Nueva zapatilla
          </Link>
        </div>
      </div>
      {uploadingModels && all.data && <ModelBulkUpload products={all.data} onClose={() => setUploadingModels(false)} />}
      <div className="toolbar">
        <input className="input" placeholder="Buscar por nombre, marca o SKU…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todos los estados</option>
          <option value="PUBLISHED">Publicados</option>
          <option value="DRAFT">Borradores</option>
          <option value="ARCHIVED">Desactivados</option>
        </select>
      </div>
      <div className="card table-wrap">
        {isLoading ? (
          <div className="center"><div className="spinner" /></div>
        ) : !data?.length ? (
          <div className="empty">
            No hay productos.{" "}
            <Link to="/productos/nuevo"><u>Registra el primero</u></Link>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Estado</th>
                <th>Marca / categoría</th>
                <th className="right">Precio</th>
                <th className="right">Stock</th>
                <th>3D</th>
              </tr>
            </thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.id} className="clickable" onClick={() => navigate(`/productos/${p.id}`)}>
                  <td>
                    <div className="prod-cell">
                      {p.imageUrl ? <img className="thumb" src={p.imageUrl} alt="" /> : <div className="thumb" />}
                      <div>
                        <strong>{p.name}</strong>
                        {p.featured && <span className="tag" style={{ marginLeft: 8 }}>Portada</span>}
                        <div className="muted" style={{ fontSize: 12 }}>/{p.slug}</div>
                      </div>
                    </div>
                  </td>
                  <td><ProductPill status={p.status} /></td>
                  <td className="muted">{[p.brand, p.category].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="right num">
                    {p.priceCents === 0 ? <span className="tag low">Sin precio</span> : formatMoney(p.finalPriceCents)}
                    {p.discountPercent > 0 && <div className="muted" style={{ fontSize: 11 }}>-{p.discountPercent}% de {formatMoney(p.priceCents)}</div>}
                  </td>
                  <td className={`right num ${p.stock - p.reserved <= 0 ? "zero" : ""}`}>
                    {p.stock - p.reserved}
                    <div className="muted" style={{ fontSize: 11 }}>
                      {p.variantCount} tallas{p.reserved ? ` · ${p.reserved} reserv.` : ""}
                    </div>
                  </td>
                  <td>{p.hasModel ? <span className="tag" style={{ color: "var(--cyan)" }}>GLB</span> : <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
