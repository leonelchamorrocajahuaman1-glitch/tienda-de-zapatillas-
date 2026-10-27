import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { formatDate, formatMoney, orderCode, type OrderStatus } from "@tienda/shared";
import { api } from "../lib/api";
import { OrderPill } from "../components/Pill";

interface SaleRow {
  orderId: string;
  orderNumber: number;
  date: string;
  status: OrderStatus;
  customer: string;
  product: string;
  brand: string | null;
  size: string;
  color: string;
  quantity: number;
  unitListPriceCents: number;
  discountPercent: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

export function SalesPage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const qs = new URLSearchParams();
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  const { data, isLoading } = useQuery({
    queryKey: ["sales", qs.toString()],
    queryFn: () => api.get<{ rows: SaleRow[]; totals: { units: number; revenueCents: number; orders: number } }>(`/api/admin/reports/sales?${qs}`),
  });
  const csv = new URLSearchParams(qs);
  csv.set("format", "csv");

  return (
    <>
      <div className="page-head">
        <div>
          <div className="label">Reportes</div>
          <h1 className="display">Historial de ventas</h1>
        </div>
        <a className="btn" href={`/api/admin/reports/sales?${csv}`}>
          Exportar CSV (Excel)
        </a>
      </div>
      <p className="muted" style={{ marginTop: -12 }}>
        Incluye pedidos confirmados, en preparación, enviados y entregados, con el precio exacto cobrado en cada venta.
      </p>
      <div className="toolbar">
        <label className="field">
          <span className="label">Desde</span>
          <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Hasta</span>
          <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      {data && (
        <div className="stats">
          <div className="card stat"><span className="label">Ingresos (productos)</span><span className="stat__value">{formatMoney(data.totals.revenueCents)}</span></div>
          <div className="card stat"><span className="label">Unidades</span><span className="stat__value">{data.totals.units}</span></div>
          <div className="card stat"><span className="label">Pedidos</span><span className="stat__value">{data.totals.orders}</span></div>
        </div>
      )}
      <div className="card table-wrap">
        {isLoading ? (
          <div className="center"><div className="spinner" /></div>
        ) : !data?.rows.length ? (
          <div className="empty">No hay ventas en este periodo. Las ventas aparecen cuando confirmas un pedido.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Pedido</th>
                <th>Cliente</th>
                <th>Producto</th>
                <th>Talla / color</th>
                <th className="right">Cant.</th>
                <th className="right">Precio cobrado</th>
                <th className="right">Total</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={`${r.orderId}-${i}`}>
                  <td className="muted">{formatDate(r.date)}</td>
                  <td className="mono"><Link to={`/pedidos/${r.orderId}`}><u>{orderCode(r.orderNumber)}</u></Link></td>
                  <td>{r.customer}</td>
                  <td>{r.product}<div className="muted" style={{ fontSize: 12 }}>{r.brand}</div></td>
                  <td>{r.size} · {r.color}</td>
                  <td className="right num">{r.quantity}</td>
                  <td className="right num">
                    {formatMoney(r.unitPriceCents)}
                    {r.discountPercent > 0 && <div className="muted" style={{ fontSize: 11 }}>lista {formatMoney(r.unitListPriceCents)} −{r.discountPercent}%</div>}
                  </td>
                  <td className="right num">{formatMoney(r.lineTotalCents)}</td>
                  <td><OrderPill status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
