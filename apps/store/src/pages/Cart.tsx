import { Link, useNavigate } from "react-router-dom";
import { formatMoney } from "@tienda/shared";
import { useAuth } from "../state/auth";
import { useCart } from "../state/cart";
import { useStoreSettings } from "../lib/api";
import { CartLines, CartTotals } from "../components/CartLines";
import { ArrowIcon } from "../components/Icons";

export default function CartPage() {
  const { cart, loading } = useCart();
  const { user } = useAuth();
  const { data: settings } = useStoreSettings();
  const navigate = useNavigate();

  const missingForFree =
    settings && cart.shippingCents > 0 ? settings.freeShippingMinCents - (cart.subtotalCents - cart.discountCents) : 0;

  return (
    <div className="page container">
      <h1 className="display page-title">Carrito</h1>
      {loading ? (
        <div className="page-loading">
          <div className="spinner" />
        </div>
      ) : cart.lines.length === 0 ? (
        <div className="empty">
          <p>Tu carrito está vacío.</p>
          <Link className="btn btn--primary" to="/catalogo">
            Explorar zapatillas
          </Link>
        </div>
      ) : (
        <div className="two-col">
          <CartLines lines={cart.lines} />
          <aside className="panel summary">
            <h2 className="eyebrow">Resumen</h2>
            <CartTotals cart={cart} />
            {missingForFree > 0 && (
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                Te faltan {formatMoney(missingForFree)} para el envío gratis.
              </p>
            )}
            {!cart.canCheckout && <div className="alert alert--warn">Revisa los productos marcados antes de continuar.</div>}
            <button
              className="btn btn--primary btn--block btn--glitch"
              data-label="Continuar con el pedido"
              disabled={!cart.canCheckout}
              onClick={() => navigate(user ? "/checkout" : "/ingresar?next=/checkout")}
            >
              Continuar con el pedido <ArrowIcon width={16} />
            </button>
            {!user && <p className="muted" style={{ margin: 0, fontSize: 13 }}>Necesitas iniciar sesión o crear una cuenta para confirmar el pedido. Tu carrito se conserva.</p>}
          </aside>
        </div>
      )}
    </div>
  );
}
