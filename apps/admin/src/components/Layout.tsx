import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, STORE_NAME, STORE_URL } from "../lib/api";
import { useAdminAuth } from "../lib/auth";

const links = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/pedidos", label: "Pedidos", badge: "pending" as const },
  { to: "/productos", label: "Productos" },
  { to: "/catalogo-base", label: "Marcas, categorías y tallas" },
  { to: "/clientes", label: "Clientes" },
  { to: "/ventas", label: "Historial de ventas" },
  { to: "/inventario", label: "Movimientos de inventario" },
  { to: "/cuenta", label: "Mi cuenta" },
];

export function Layout() {
  const { user, logout } = useAdminAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);

  const pending = useQuery({
    queryKey: ["orders-count"],
    queryFn: () => api.get<{ countsByStatus: Record<string, number> }>("/api/admin/orders?pageSize=1"),
    refetchInterval: 30_000,
    select: (d) => d.countsByStatus.PENDING ?? 0,
  });

  return (
    <div className="shell">
      <aside className={`sidebar ${open ? "is-open" : ""}`}>
        <div className="brand">
          <span className="brand__mark" aria-hidden />
          <div>
            <div className="brand__name">{STORE_NAME}</div>
            <div className="brand__tag">ADMIN</div>
          </div>
        </div>
        <nav aria-label="Panel">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className="nav-link">
              {l.label}
              {l.badge === "pending" && (pending.data ?? 0) > 0 && <span className="count">{pending.data}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar__foot">
          <a className="btn btn--sm" href={STORE_URL || "/"} target="_blank" rel="noreferrer">
            Ver tienda ↗
          </a>
          <div className="muted" style={{ fontSize: 12 }}>
            {user?.name}
            <br />
            {user?.email}
          </div>
          <button className="btn btn--sm btn--ghost" onClick={logout}>
            Cerrar sesión
          </button>
        </div>
      </aside>
      <div>
        <div className="topbar">
          <button className="btn btn--sm" onClick={() => setOpen((o) => !o)} aria-label="Menú">
            ☰
          </button>
          <span className="brand__name">{STORE_NAME}</span>
          <span className="brand__tag">ADMIN</span>
        </div>
        <main className="main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
