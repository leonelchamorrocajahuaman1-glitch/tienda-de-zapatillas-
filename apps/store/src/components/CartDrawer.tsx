import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { useCart } from "../state/cart";
import { CartLines, CartTotals } from "./CartLines";
import { CloseIcon } from "./Icons";

export function CartDrawer() {
  const { cart, drawerOpen, setDrawerOpen } = useCart();
  const location = useLocation();

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname, setDrawerOpen]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawerOpen(false);
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [drawerOpen, setDrawerOpen]);

  return (
    <div className={`drawer ${drawerOpen ? "is-open" : ""}`} aria-hidden={!drawerOpen}>
      <div className="drawer__backdrop" onClick={() => setDrawerOpen(false)} />
      <aside className="drawer__panel" role="dialog" aria-label="Carrito" aria-modal="true">
        <div className="drawer__head">
          <h2 className="display">Carrito</h2>
          <span className="eyebrow">{cart.itemCount} artículo(s)</span>
          <button className="icon-btn" onClick={() => setDrawerOpen(false)} aria-label="Cerrar carrito">
            <CloseIcon />
          </button>
        </div>
        {cart.lines.length === 0 ? (
          <div className="empty">
            <p>Tu carrito está vacío.</p>
            <Link className="btn btn--primary" to="/catalogo">
              Ver catálogo
            </Link>
          </div>
        ) : (
          <>
            <div className="drawer__body">
              <CartLines lines={cart.lines} compact />
            </div>
            <div className="drawer__foot">
              <CartTotals cart={cart} />
              <Link className="btn btn--primary btn--block" to="/carrito">
                Revisar y pagar
              </Link>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
