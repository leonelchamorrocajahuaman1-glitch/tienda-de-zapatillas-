import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { formatDate, formatMoney } from "@tienda/shared";
import { api } from "../lib/api";

interface Row {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  isActive: boolean;
  createdAt: string;
  orderCount: number;
  totalSpentCents: number;
  lastOrderAt: string | null;
}

export function CustomersPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["customers", q.trim()],
    queryFn: () => api.get<Row[]>(`/api/admin/customers${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`),
  });
  return (
    <>
      <div className="page-head">
        <div>
          <div className="label">Tienda</div>
          <h1 className="display">Clientes</h1>
        </div>
        <span className="muted">{data?.length ?? 0} registrados</span>
      </div>
      <div className="toolbar">
        <input className="input" placeholder="Buscar por nombre, email o teléfono…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="card table-wrap">
        {isLoading ? (
          <div className="center"><div className="spinner" /></div>
        ) : !data?.length ? (
          <div className="empty">Aún no hay clientes registrados.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Teléfono</th>
                <th>Registro</th>
                <th className="right">Pedidos</th>
                <th className="right">Total comprado</th>
                <th>Último pedido</th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id} className="clickable" onClick={() => navigate(`/clientes/${c.id}`)}>
                  <td>
                    {c.name} {!c.isActive && <span className="tag">bloqueado</span>}
                    <div className="muted" style={{ fontSize: 12 }}>{c.email}</div>
                  </td>
                  <td className="muted">{c.phone ?? "—"}</td>
                  <td className="muted">{formatDate(c.createdAt)}</td>
                  <td className="right num">{c.orderCount}</td>
                  <td className="right num">{formatMoney(c.totalSpentCents)}</td>
                  <td className="muted">{c.lastOrderAt ? formatDate(c.lastOrderAt) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
