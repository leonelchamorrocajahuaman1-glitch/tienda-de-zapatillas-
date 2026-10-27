import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  errorMessage,
  formatDate,
  formatMoney,
  orderCode,
  ORDER_STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
  PAYMENT_STATUS_LABEL,
  type Order,
} from "@tienda/shared";
import { api } from "../lib/api";
import { StatusPill, Tracker } from "../components/OrderStatus";
import { CartTotals } from "../components/CartLines";

export default function OrderPage() {
  const { number = "" } = useParams();
  const [params] = useSearchParams();
  const isNew = params.get("nuevo") === "1";
  const qc = useQueryClient();
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["order", number],
    queryFn: () => api.get<Order>(`/api/orders/${encodeURIComponent(number)}`),
    refetchInterval: 20_000, // seguimiento del estado en vivo
  });
  const o = query.data;

  if (query.isLoading) {
    return (
      <div className="page-loading">
        <div className="spinner" />
      </div>
    );
  }
  if (!o) {
    return (
      <div className="page container empty">
        <h1 className="display page-title">Pedido no encontrado</h1>
        <Link className="btn" to="/cuenta">
          Mis pedidos
        </Link>
      </div>
    );
  }

  async function cancel() {
    if (!confirm("¿Seguro que quieres cancelar este pedido?")) return;
    setCancelling(true);
    setError(null);
    try {
      const updated = await api.post<Order>(`/api/orders/${o!.number}/cancel`);
      qc.setQueryData(["order", number], updated);
      qc.invalidateQueries({ queryKey: ["orders"] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="page container">
      {isNew && (
        <div className="banner-ok">
          <span className="eyebrow" style={{ color: "var(--ok)" }}>
            Pedido registrado
          </span>
          <h2 className="display">¡Gracias por tu compra!</h2>
          <p style={{ margin: 0 }}>
            Tu pedido <strong>{orderCode(o.number)}</strong> quedó registrado y tus tallas están reservadas. Te contactaremos
            al {o.shippingPhone} para coordinar la entrega. Pagarás {formatMoney(o.totalCents)} al recibirlo.
          </p>
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16, marginBottom: 24 }}>
        <h1 className="display" style={{ fontSize: "clamp(40px, 6vw, 72px)" }}>
          {orderCode(o.number)}
        </h1>
        <StatusPill status={o.status} />
        <span className="muted">{formatDate(o.createdAt, true)}</span>
      </div>

      <div className="panel" style={{ padding: 24, marginBottom: 28 }}>
        <Tracker status={o.status} />
      </div>

      <div className="two-col">
        <div>
          <h2 className="eyebrow">Productos</h2>
          <div className="order-items">
            {o.items.map((i) => (
              <div key={i.id} className="order-item">
                {i.imageUrl ? <img src={i.imageUrl} alt="" /> : <div className="ph" />}
                <div>
                  <div>{i.productName}</div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    Talla {i.sizeLabel} · {i.colorName} · {i.quantity} × {formatMoney(i.unitPriceCents)}
                    {i.discountPercent > 0 && ` (antes ${formatMoney(i.unitListPriceCents)})`}
                  </div>
                </div>
                <span className="price">
                  <span className="price__now">{formatMoney(i.lineTotalCents)}</span>
                </span>
              </div>
            ))}
          </div>

          <h2 className="eyebrow" style={{ marginTop: 32 }}>
            Historial
          </h2>
          <ul className="timeline">
            {o.statusHistory.map((h) => (
              <li key={h.id}>
                <span>
                  <strong>{ORDER_STATUS_LABEL[h.toStatus]}</strong> — {formatDate(h.createdAt, true)}
                  {h.note && <span className="muted"> · {h.note}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <aside className="panel summary">
          <CartTotals cart={o} />
          <hr className="divider" style={{ margin: 0 }} />
          <div style={{ fontSize: 14, display: "grid", gap: 6 }}>
            <span className="eyebrow">Entrega</span>
            <span>{o.shippingName}</span>
            <span className="muted">
              {o.shippingAddress}, {o.shippingDistrict}, {o.shippingCity}
            </span>
            {o.shippingReference && <span className="muted">Ref.: {o.shippingReference}</span>}
            <span className="muted">Tel.: {o.shippingPhone}</span>
          </div>
          <div style={{ fontSize: 14, display: "grid", gap: 6 }}>
            <span className="eyebrow">Pago</span>
            <span>
              {PAYMENT_METHOD_LABEL[o.paymentMethod] ?? o.paymentMethod} ·{" "}
              {PAYMENT_STATUS_LABEL[o.paymentStatus] ?? o.paymentStatus}
            </span>
          </div>
          {error && <div className="alert">{error}</div>}
          {o.status === "PENDING" && (
            <button className="btn btn--block" onClick={cancel} disabled={cancelling}>
              {cancelling ? "Cancelando…" : "Cancelar pedido"}
            </button>
          )}
          <Link to="/cuenta" className="btn btn--block">
            Ver todos mis pedidos
          </Link>
        </aside>
      </div>
    </div>
  );
}
