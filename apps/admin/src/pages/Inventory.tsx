import { useQuery } from "@tanstack/react-query";
import { formatDate, orderCode } from "@tienda/shared";
import { api } from "../lib/api";

interface Movement {
  id: string;
  type: "ADJUSTMENT" | "RESERVE" | "RELEASE" | "COMMIT" | "RESTOCK";
  stockDelta: number;
  reservedDelta: number;
  product: string;
  size: string;
  color: string;
  orderNumber: number | null;
  user: string | null;
  note: string | null;
  createdAt: string;
}

const TYPE_LABEL: Record<Movement["type"], string> = {
  ADJUSTMENT: "Ajuste manual",
  RESERVE: "Reserva (pedido pendiente)",
  RELEASE: "Reserva liberada",
  COMMIT: "Salida (pedido confirmado)",
  RESTOCK: "Devolución al stock",
};

const delta = (n: number) => (n === 0 ? "—" : n > 0 ? `+${n}` : String(n));

export function InventoryPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["movements"],
    queryFn: () => api.get<Movement[]>("/api/admin/reports/inventory-movements"),
    refetchInterval: 30_000,
  });
  return (
    <>
      <div className="page-head">
        <div>
          <div className="label">Auditoría</div>
          <h1 className="display">Movimientos de inventario</h1>
        </div>
      </div>
      <div className="alert alert--info" style={{ marginBottom: 16 }}>
        Reglas: al registrarse un pedido se <strong>reservan</strong> las unidades; al <strong>confirmarlo</strong> salen del
        stock físico; si se <strong>cancela</strong> se libera la reserva o vuelven al stock. Cada pedido mueve sus unidades una
        sola vez.
      </div>
      <div className="card table-wrap">
        {isLoading ? (
          <div className="center"><div className="spinner" /></div>
        ) : !data?.length ? (
          <div className="empty">Sin movimientos todavía.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Movimiento</th>
                <th>Producto</th>
                <th className="right">Stock físico</th>
                <th className="right">Reservado</th>
                <th>Origen</th>
              </tr>
            </thead>
            <tbody>
              {data.map((m) => (
                <tr key={m.id}>
                  <td className="muted">{formatDate(m.createdAt, true)}</td>
                  <td>{TYPE_LABEL[m.type]}</td>
                  <td>{m.product}<div className="muted" style={{ fontSize: 12 }}>Talla {m.size} · {m.color}</div></td>
                  <td className={`right num ${m.stockDelta < 0 ? "zero" : ""}`}>{delta(m.stockDelta)}</td>
                  <td className="right num muted">{delta(m.reservedDelta)}</td>
                  <td className="muted">
                    {m.orderNumber ? orderCode(m.orderNumber) : m.note ?? ""}
                    {m.user && <div style={{ fontSize: 12 }}>{m.user}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
