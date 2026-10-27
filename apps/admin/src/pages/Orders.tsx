import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { formatDate, formatMoney, orderCode, ORDER_STATUS_LABEL, PAYMENT_STATUS_LABEL, type OrderStatus } from "@tienda/shared";
import { api } from "../lib/api";
import { OrderPill } from "../components/Pill";

interface Row {
  id: string;
  number: number;
  status: OrderStatus;
  totalCents: number;
  paymentStatus: string;
  shippingDistrict: string;
  shippingCity: string;
  createdAt: string;
  user: { name: string; email: string };
  _count: { items: number };
}

const STATUSES: OrderStatus[] = ["PENDING", "CONFIRMED", "PREPARING", "SHIPPED", "DELIVERED", "CANCELLED"];

export function OrdersPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "";
  const page = Number(params.get("page") ?? 1);
  const [q, setQ] = useState("");
  const qs = new URLSearchParams();
  if (status) qs.set("status", status);
  if (q.trim()) qs.set("q", q.trim());
  qs.set("page", String(page));

  const { data, isLoading } = useQuery({
    queryKey: ["admin-orders", qs.toString()],
    queryFn: () =>
      api.get<{ items: Row[]; total: number; pageSize: number; countsByStatus: Record<string, number> }>(`/api/admin/orders?${qs}`),
    refetchInterval: 20_000,
    placeholderData: keepPreviousData,
  });
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const setStatus = (s: string) => setParams(s ? { status: s } : {});

  return (
    <>
      <div className="page-head">
        <div>
          <div className="label">Ventas</div>
          <h1 className="display">Pedidos</h1>
        </div>
      </div>
      <div className="tabs">
        <button className={!status ? "is-active" : ""} onClick={() => setStatus("")}>
          Todos
        </button>
        {STATUSES.map((s) => (
          <button key={s} className={status === s ? "is-active" : ""} onClick={() => setStatus(s)}>
            {ORDER_STATUS_LABEL[s]} ({data?.countsByStatus[s] ?? 0})
          </button>
        ))}
      </div>
      <div className="toolbar">
        <input className="input" placeholder="Buscar por N.º de pedido, cliente o email…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="card table-wrap">
        {isLoading ? (
          <div className="center"><div className="spinner" /></div>
        ) : !data?.items.length ? (
          <div className="empty">No hay pedidos{status ? ` en estado ${ORDER_STATUS_LABEL[status as OrderStatus]}` : ""}.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Fecha</th>
                <th>Cliente</th>
                <th>Destino</th>
                <th>Estado</th>
                <th>Pago</th>
                <th className="right">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((o) => (
                <tr key={o.id} className="clickable" onClick={() => navigate(`/pedidos/${o.id}`)}>
                  <td className="mono">{orderCode(o.number)}</td>
                  <td className="muted">{formatDate(o.createdAt, true)}</td>
                  <td>
                    {o.user.name}
                    <div className="muted" style={{ fontSize: 12 }}>{o.user.email}</div>
                  </td>
                  <td className="muted">{o.shippingDistrict}, {o.shippingCity}</td>
                  <td><OrderPill status={o.status} /></td>
                  <td className="muted">{PAYMENT_STATUS_LABEL[o.paymentStatus] ?? o.paymentStatus}</td>
                  <td className="right num">
                    {formatMoney(o.totalCents)}
                    <div className="muted" style={{ fontSize: 11 }}>{o._count.items} línea(s)</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {pages > 1 && (
        <div className="toolbar" style={{ justifyContent: "center", marginTop: 16 }}>
          <button className="btn btn--sm" disabled={page <= 1} onClick={() => setParams({ ...(status ? { status } : {}), page: String(page - 1) })}>Anterior</button>
          <span className="muted" style={{ alignSelf: "center" }}>{page} / {pages}</span>
          <button className="btn btn--sm" disabled={page >= pages} onClick={() => setParams({ ...(status ? { status } : {}), page: String(page + 1) })}>Siguiente</button>
        </div>
      )}
    </>
  );
}
