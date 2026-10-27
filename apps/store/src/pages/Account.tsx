import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { formatDate, formatMoney, orderCode, type Order } from "@tienda/shared";
import { api } from "../lib/api";
import { useAuth } from "../state/auth";
import { StatusPill } from "../components/OrderStatus";

export default function AccountPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const orders = useQuery({
    queryKey: ["orders"],
    queryFn: () => api.get<Order[]>("/api/orders"),
    refetchInterval: 30_000,
  });

  return (
    <div className="page container">
      <span className="eyebrow eyebrow--accent">Hola, {user?.name}</span>
      <h1 className="display page-title">Mis pedidos</h1>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "8px 0 32px" }}>
        <span className="muted">{user?.email}</span>
        <button
          className="btn btn--sm"
          onClick={async () => {
            await logout();
            navigate("/");
          }}
        >
          Cerrar sesión
        </button>
      </div>

      {orders.isLoading && <div className="spinner" />}
      {orders.isError && <div className="alert">No se pudieron cargar tus pedidos.</div>}
      {orders.data && orders.data.length === 0 && (
        <div className="empty">
          <p>Aún no tienes pedidos.</p>
          <Link className="btn btn--primary" to="/catalogo">
            Ir al catálogo
          </Link>
        </div>
      )}
      <div className="orders-list">
        {orders.data?.map((o) => (
          <Link key={o.id} to={`/cuenta/pedidos/${o.number}`} className="order-row">
            <div className="order-row__thumbs">
              {o.items.slice(0, 3).map((i) => (i.imageUrl ? <img key={i.id} src={i.imageUrl} alt="" /> : null))}
            </div>
            <div>
              <div style={{ fontFamily: "var(--font-mono)" }}>{orderCode(o.number)}</div>
              <div className="muted" style={{ fontSize: 13 }}>
                {formatDate(o.createdAt)} · {o.items.reduce((s, i) => s + i.quantity, 0)} artículo(s)
              </div>
            </div>
            <StatusPill status={o.status} />
            <span className="price">
              <span className="price__now">{formatMoney(o.totalCents)}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
