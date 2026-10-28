import { useState } from "react";
import { Link, useParams } from "react-router-dom";
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
  type OrderStatus,
} from "@tienda/shared";
import { api } from "../lib/api";
import { OrderPill } from "../components/Pill";
import { useToast } from "../components/Toast";
import { PrintPill, ReceiptModal } from "./Printing";

type AdminOrder = Order & {
  receipt: {
    id: string;
    code: string;
    voidedAt: string | null;
    printJobs: { id: string; status: "PENDING" | "PRINTING" | "PRINTED" | "FAILED" | "CANCELLED"; error: string | null }[];
  } | null;
  allowedTransitions: OrderStatus[];
  user: { id: string; name: string; email: string; phone: string | null };
};

const INVENTORY_LABEL: Record<Order["inventoryState"], string> = {
  RESERVED: "Unidades reservadas (aún en el stock físico)",
  COMMITTED: "Unidades descontadas del stock",
  RELEASED: "Reserva liberada",
  RESTOCKED: "Unidades devueltas al stock",
};

const ACTION_LABEL: Record<OrderStatus, string> = {
  PENDING: "Marcar pendiente",
  CONFIRMED: "Confirmar pedido",
  PREPARING: "Marcar en preparación",
  SHIPPED: "Marcar como enviado",
  DELIVERED: "Marcar como entregado",
  CANCELLED: "Cancelar pedido",
};

const ACTION_HINT: Partial<Record<OrderStatus, string>> = {
  CONFIRMED: "Descuenta las unidades del stock físico.",
  CANCELLED: "Libera la reserva o devuelve las unidades al stock.",
  DELIVERED: "El pago contra entrega se marca como cobrado.",
};

export function OrderDetailPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<OrderStatus | null>(null);

  const { data: o, isLoading } = useQuery({
    queryKey: ["admin-order", id],
    queryFn: () => api.get<AdminOrder>(`/api/admin/orders/${id}`),
    refetchInterval: 20_000,
  });

  async function change(status: OrderStatus) {
    if (status === "CANCELLED" && !confirm("¿Cancelar este pedido?")) return;
    setBusy(status);
    try {
      const updated = await api.patch<AdminOrder>(`/api/admin/orders/${id}/status`, { status, note: note || undefined });
      qc.setQueryData(["admin-order", id], updated);
      qc.invalidateQueries({ queryKey: ["admin-orders"] });
      qc.invalidateQueries({ queryKey: ["orders-count"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["admin-products"] });
      setNote("");
      toast(`Pedido ${ORDER_STATUS_LABEL[status].toLowerCase()}`);
    } catch (err) {
      toast(errorMessage(err), "error");
      qc.invalidateQueries({ queryKey: ["admin-order", id] });
    } finally {
      setBusy(null);
    }
  }

  if (isLoading) return <div className="center"><div className="spinner" /></div>;
  if (!o) return <div className="alert">Pedido no encontrado.</div>;

  return (
    <>
      <div className="page-head">
        <div>
          <Link to="/pedidos" className="label">← Pedidos</Link>
          <h1 className="display">{orderCode(o.number)}</h1>
          <span className="muted">{formatDate(o.createdAt, true)}</span>
        </div>
        <OrderPill status={o.status} />
      </div>

      <div className="editor">
        <div className="stack">
          <section className="card">
            <div className="card__head"><h2>Productos</h2></div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Talla / color</th>
                    <th className="right">Cant.</th>
                    <th className="right">Precio unit.</th>
                    <th className="right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {o.items.map((i) => (
                    <tr key={i.id}>
                      <td>
                        <div className="prod-cell">
                          {i.imageUrl ? <img className="thumb" src={i.imageUrl} alt="" /> : <div className="thumb" />}
                          <div>
                            {i.productId ? <Link to={`/productos/${i.productId}`}><u>{i.productName}</u></Link> : i.productName}
                            <div className="muted" style={{ fontSize: 12 }}>{i.brandName}</div>
                          </div>
                        </div>
                      </td>
                      <td>{i.sizeLabel} · {i.colorName}</td>
                      <td className="right num">{i.quantity}</td>
                      <td className="right num">
                        {formatMoney(i.unitPriceCents)}
                        {i.discountPercent > 0 && <div className="muted" style={{ fontSize: 11 }}>{formatMoney(i.unitListPriceCents)} −{i.discountPercent}%</div>}
                      </td>
                      <td className="right num">{formatMoney(i.lineTotalCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card__body">
              <dl className="kv" style={{ justifyContent: "end" }}>
                <dt>Subtotal</dt><dd className="num">{formatMoney(o.subtotalCents)}</dd>
                {o.discountCents > 0 && (<><dt>Descuentos</dt><dd className="num">−{formatMoney(o.discountCents)}</dd></>)}
                <dt>Envío</dt><dd className="num">{formatMoney(o.shippingCents)}</dd>
                <dt><strong>Total</strong></dt><dd className="num"><strong>{formatMoney(o.totalCents)}</strong></dd>
              </dl>
            </div>
          </section>

          <section className="card">
            <div className="card__head"><h2>Historial de estados</h2></div>
            <div className="card__body">
              <ul className="timeline">
                {o.statusHistory.map((h) => (
                  <li key={h.id}>
                    <span>
                      <strong>{ORDER_STATUS_LABEL[h.toStatus]}</strong> · {formatDate(h.createdAt, true)}
                      {h.changedBy && <span className="muted"> · {h.changedBy.name}{h.changedBy.role === "CUSTOMER" ? " (cliente)" : ""}</span>}
                      {h.note && <div className="muted">{h.note}</div>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>

        <aside className="editor__side">
          <section className="card">
            <div className="card__head"><h2>Actualizar estado</h2></div>
            <div className="card__body form-grid">
              {o.allowedTransitions.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>Este pedido está cerrado ({ORDER_STATUS_LABEL[o.status]}).</p>
              ) : (
                <>
                  <input className="input" placeholder="Nota (opcional): n.º de guía, motivo…" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
                  {o.allowedTransitions.map((s) => (
                    <div key={s} className="field">
                      <button className={`btn ${s === "CANCELLED" ? "btn--danger" : "btn--primary"}`} disabled={busy !== null} onClick={() => change(s)}>
                        {busy === s ? "Procesando…" : ACTION_LABEL[s]}
                      </button>
                      {ACTION_HINT[s] && <span className="hint">{ACTION_HINT[s]}</span>}
                    </div>
                  ))}
                </>
              )}
              <div className="alert alert--info" style={{ fontSize: 13 }}>
                Inventario: {INVENTORY_LABEL[o.inventoryState]}
              </div>
            </div>
          </section>

          <ReceiptCard order={o} />

          <section className="card">
            <div className="card__head"><h2>Cliente y entrega</h2></div>
            <div className="card__body">
              <dl className="kv">
                <dt>Cliente</dt>
                <dd><Link to={`/clientes/${o.user.id}`}><u>{o.user.name}</u></Link><div className="muted">{o.user.email}</div></dd>
                <dt>Recibe</dt><dd>{o.shippingName}</dd>
                <dt>Teléfono</dt><dd><a href={`tel:${o.shippingPhone}`}>{o.shippingPhone}</a></dd>
                <dt>Dirección</dt><dd>{o.shippingAddress}<div className="muted">{o.shippingDistrict}, {o.shippingCity}</div></dd>
                {o.shippingReference && (<><dt>Referencia</dt><dd>{o.shippingReference}</dd></>)}
                {o.notes && (<><dt>Notas</dt><dd>{o.notes}</dd></>)}
                <dt>Pago</dt>
                <dd>{PAYMENT_METHOD_LABEL[o.paymentMethod] ?? o.paymentMethod}<div className="muted">{PAYMENT_STATUS_LABEL[o.paymentStatus] ?? o.paymentStatus}</div></dd>
              </dl>
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}

/** Boleta del pedido: estado de impresión, vista previa y reimpresión. */
function ReceiptCard({ order }: { order: AdminOrder }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const r = order.receipt;
  const eligible = !["PENDING", "CANCELLED"].includes(order.status);

  async function issue() {
    setBusy(true);
    try {
      await api.post(`/api/admin/printing/orders/${order.id}/receipt`, { print: true });
      toast("Boleta emitida y enviada a la impresora");
      qc.invalidateQueries({ queryKey: ["admin-order", order.id] });
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }

  const last = r?.printJobs[0];
  return (
    <section className="card">
      <div className="card__head">
        <h2>Boleta de venta</h2>
        {r && <PrintPill status={last?.status ?? "NONE"} />}
      </div>
      <div className="card__body form-grid">
        {r ? (
          <>
            <div className="mono" style={{ fontSize: 18 }}>
              {r.code} {r.voidedAt && <span className="tag">Anulada</span>}
            </div>
            {last?.status === "FAILED" && <div className="alert" style={{ fontSize: 13 }}>{last.error}</div>}
            <button className="btn" onClick={() => setOpen(true)}>
              Ver / reimprimir boleta
            </button>
          </>
        ) : eligible ? (
          <>
            <p className="muted" style={{ margin: 0 }}>Este pedido aún no tiene boleta.</p>
            <button className="btn btn--primary" onClick={issue} disabled={busy}>
              {busy ? "Emitiendo…" : "Emitir e imprimir boleta"}
            </button>
          </>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            {order.status === "PENDING"
              ? "La boleta se emite al confirmar el pedido."
              : "Pedido cancelado: no se emite boleta."}
          </p>
        )}
      </div>
      {open && r && (
        <ReceiptModal
          receiptId={r.id}
          onClose={() => {
            setOpen(false);
            qc.invalidateQueries({ queryKey: ["admin-order", order.id] });
          }}
        />
      )}
    </section>
  );
}
