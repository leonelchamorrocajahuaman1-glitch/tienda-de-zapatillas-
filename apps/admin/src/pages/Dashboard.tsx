import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { formatDate, formatMoney, orderCode, type OrderStatus } from "@tienda/shared";
import { api } from "../lib/api";
import { OrderPill } from "../components/Pill";
import { SalesChart } from "../components/SalesChart";

interface Dashboard {
  revenueCents: number;
  revenue30dCents: number;
  soldOrders: number;
  averageTicketCents: number;
  ordersByStatus: Partial<Record<OrderStatus, number>>;
  productsByStatus: Partial<Record<"DRAFT" | "PUBLISHED" | "ARCHIVED", number>>;
  stock: { units: number; reserved: number; variants: number; outOfStock: number };
  customers: number;
  lowStock: {
    variantId: string;
    productId: string;
    productName: string;
    size: string;
    color: string;
    stock: number;
    reserved: number;
    available: number;
  }[];
  salesByDay: { date: string; totalCents: number; orders: number }[];
  topProducts: { productId: string | null; name: string; units: number; revenueCents: number }[];
  recentOrders: { id: string; number: number; customer: string; status: OrderStatus; totalCents: number; createdAt: string }[];
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<Dashboard>("/api/admin/reports/dashboard"),
    refetchInterval: 30_000,
  });

  if (isLoading) return <div className="center"><div className="spinner" /></div>;
  if (isError || !data) return <div className="alert">No se pudo cargar el dashboard.</div>;

  const pending = data.ordersByStatus.PENDING ?? 0;
  const inProgress = (data.ordersByStatus.CONFIRMED ?? 0) + (data.ordersByStatus.PREPARING ?? 0) + (data.ordersByStatus.SHIPPED ?? 0);
  const totalProducts = Object.values(data.productsByStatus).reduce((s, n) => s + (n ?? 0), 0);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="label">Resumen del negocio</div>
          <h1 className="display">Dashboard</h1>
        </div>
        <div className="page-head__actions">
          <Link to="/productos/nuevo" className="btn btn--primary">
            + Nueva zapatilla
          </Link>
          <Link to="/pedidos?status=PENDING" className="btn">
            Pedidos pendientes ({pending})
          </Link>
        </div>
      </div>

      {totalProducts === 0 && (
        <div className="alert alert--info" style={{ marginBottom: 20 }}>
          Aún no hay productos. Empieza registrando tu primera zapatilla en <Link to="/productos/nuevo"><u>Nueva zapatilla</u></Link>.
        </div>
      )}

      <div className="stats">
        <div className="card stat">
          <span className="label">Ventas totales</span>
          <span className="stat__value">{formatMoney(data.revenueCents)}</span>
          <span className="stat__sub">{data.soldOrders} pedido(s) confirmado(s) o posteriores</span>
        </div>
        <div className="card stat">
          <span className="label">Últimos 30 días</span>
          <span className="stat__value">{formatMoney(data.revenue30dCents)}</span>
          <span className="stat__sub">Ticket medio {formatMoney(data.averageTicketCents)}</span>
        </div>
        <div className="card stat">
          <span className="label">Pedidos</span>
          <span className="stat__value">{pending}</span>
          <span className="stat__sub">pendientes · {inProgress} en curso · {data.ordersByStatus.DELIVERED ?? 0} entregados</span>
        </div>
        <div className="card stat">
          <span className="label">Productos</span>
          <span className="stat__value">{data.productsByStatus.PUBLISHED ?? 0}</span>
          <span className="stat__sub">
            publicados · {data.productsByStatus.DRAFT ?? 0} borradores · {data.productsByStatus.ARCHIVED ?? 0} desactivados
          </span>
        </div>
        <div className="card stat">
          <span className="label">Stock</span>
          <span className="stat__value">{data.stock.units - data.stock.reserved}</span>
          <span className="stat__sub">
            disponibles · {data.stock.reserved} reservadas · {data.stock.outOfStock} tallas agotadas
          </span>
        </div>
        <div className="card stat">
          <span className="label">Clientes</span>
          <span className="stat__value">{data.customers}</span>
          <span className="stat__sub">cuentas registradas</span>
        </div>
      </div>

      <div className="dash-grid">
        <div className="stack">
          <section className="card">
            <div className="card__head">
              <h2>Ventas confirmadas por día · últimos 30 días</h2>
            </div>
            <div className="card__body">
              <SalesChart data={data.salesByDay} />
            </div>
          </section>

          <section className="card">
            <div className="card__head">
              <h2>Pedidos recientes</h2>
              <Link to="/pedidos" className="btn btn--sm">Ver todos</Link>
            </div>
            {data.recentOrders.length === 0 ? (
              <div className="empty">Todavía no hay pedidos.</div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Pedido</th>
                      <th>Cliente</th>
                      <th>Fecha</th>
                      <th>Estado</th>
                      <th className="right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentOrders.map((o) => (
                      <tr key={o.id} className="clickable" onClick={() => navigate(`/pedidos/${o.id}`)}>
                        <td className="mono">{orderCode(o.number)}</td>
                        <td>{o.customer}</td>
                        <td className="muted">{formatDate(o.createdAt, true)}</td>
                        <td><OrderPill status={o.status} /></td>
                        <td className="right num">{formatMoney(o.totalCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <div className="stack">
          <section className="card">
            <div className="card__head">
              <h2>Stock bajo (≤ 3 disponibles)</h2>
            </div>
            {data.lowStock.length === 0 ? (
              <div className="empty">Sin alertas de stock.</div>
            ) : (
              <table className="table">
                <tbody>
                  {data.lowStock.map((v) => (
                    <tr key={v.variantId} className="clickable" onClick={() => navigate(`/productos/${v.productId}`)}>
                      <td>
                        {v.productName}
                        <div className="muted" style={{ fontSize: 12 }}>
                          Talla {v.size} · {v.color}
                        </div>
                      </td>
                      <td className={`right num ${v.available <= 0 ? "zero" : "low"}`}>
                        {v.available}
                        {v.reserved > 0 && <div className="muted" style={{ fontSize: 11 }}>{v.reserved} reserv.</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="card">
            <div className="card__head">
              <h2>Más vendidos</h2>
            </div>
            {data.topProducts.length === 0 ? (
              <div className="empty">Sin ventas todavía.</div>
            ) : (
              <table className="table">
                <tbody>
                  {data.topProducts.map((t, i) => (
                    <tr key={`${t.productId}-${i}`}>
                      <td>{t.name}</td>
                      <td className="right num">{t.units} u.</td>
                      <td className="right num">{formatMoney(t.revenueCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
