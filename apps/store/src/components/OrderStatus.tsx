import { ORDER_FLOW, ORDER_STATUS_LABEL, type OrderStatus } from "@tienda/shared";

export function StatusPill({ status }: { status: OrderStatus }) {
  return <span className={`status status--${status}`}>{ORDER_STATUS_LABEL[status]}</span>;
}

/** Línea de seguimiento del pedido. */
export function Tracker({ status }: { status: OrderStatus }) {
  if (status === "CANCELLED") {
    return <div className="alert">Este pedido fue cancelado. Las unidades reservadas se liberaron.</div>;
  }
  const current = ORDER_FLOW.indexOf(status);
  return (
    <ol className="tracker" aria-label="Seguimiento del pedido">
      {ORDER_FLOW.map((s, i) => (
        <li
          key={s}
          className={`tracker__step ${i <= current ? "is-done" : ""} ${i === current ? "is-current" : ""}`}
          aria-current={i === current ? "step" : undefined}
        >
          <span className="tracker__dot" />
          {ORDER_STATUS_LABEL[s]}
        </li>
      ))}
    </ol>
  );
}
