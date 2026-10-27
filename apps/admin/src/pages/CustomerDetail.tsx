import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage, formatDate, formatMoney, orderCode, type OrderStatus } from "@tienda/shared";
import { api } from "../lib/api";
import { OrderPill } from "../components/Pill";
import { useToast } from "../components/Toast";

interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  isActive: boolean;
  createdAt: string;
  orders: { id: string; number: number; status: OrderStatus; totalCents: number; createdAt: string; _count: { items: number } }[];
}

export function CustomerDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: c, isLoading } = useQuery({
    queryKey: ["customer", id],
    queryFn: () => api.get<Customer>(`/api/admin/customers/${id}`),
  });

  async function toggleActive() {
    if (!c) return;
    if (c.isActive && !confirm("¿Bloquear a este cliente? No podrá iniciar sesión ni comprar.")) return;
    try {
      await api.patch(`/api/admin/customers/${id}`, { isActive: !c.isActive });
      qc.invalidateQueries({ queryKey: ["customer", id] });
      qc.invalidateQueries({ queryKey: ["customers"] });
      toast(c.isActive ? "Cliente bloqueado" : "Cliente reactivado");
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  if (isLoading) return <div className="center"><div className="spinner" /></div>;
  if (!c) return <div className="alert">Cliente no encontrado.</div>;

  const valid = c.orders.filter((o) => o.status !== "CANCELLED");
  return (
    <>
      <div className="page-head">
        <div>
          <Link to="/clientes" className="label">← Clientes</Link>
          <h1 className="display">{c.name}</h1>
          <span className="muted">{c.email} · {c.phone ?? "sin teléfono"} · cliente desde {formatDate(c.createdAt)}</span>
        </div>
        <button className={`btn ${c.isActive ? "btn--danger" : ""}`} onClick={toggleActive}>
          {c.isActive ? "Bloquear cuenta" : "Reactivar cuenta"}
        </button>
      </div>
      <div className="stats">
        <div className="card stat"><span className="label">Pedidos</span><span className="stat__value">{valid.length}</span></div>
        <div className="card stat"><span className="label">Total comprado</span><span className="stat__value">{formatMoney(valid.reduce((s, o) => s + o.totalCents, 0))}</span></div>
      </div>
      <div className="card table-wrap">
        {c.orders.length === 0 ? (
          <div className="empty">Este cliente aún no ha hecho pedidos.</div>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Pedido</th><th>Fecha</th><th>Estado</th><th className="right">Total</th></tr>
            </thead>
            <tbody>
              {c.orders.map((o) => (
                <tr key={o.id} className="clickable" onClick={() => navigate(`/pedidos/${o.id}`)}>
                  <td className="mono">{orderCode(o.number)}</td>
                  <td className="muted">{formatDate(o.createdAt, true)}</td>
                  <td><OrderPill status={o.status} /></td>
                  <td className="right num">{formatMoney(o.totalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
