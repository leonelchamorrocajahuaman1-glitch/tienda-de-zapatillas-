import { Link } from "react-router-dom";
import { STORE_NAME } from "../lib/api";

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="container site-footer__inner">
        <div>
          <div className="display site-footer__brand">{STORE_NAME}</div>
          <p className="muted">Zapatillas premium. Envíos a todo el Perú con pago contra entrega.</p>
        </div>
        <nav className="site-footer__nav" aria-label="Pie de página">
          <Link to="/catalogo">Catálogo</Link>
          <Link to="/carrito">Carrito</Link>
          <Link to="/cuenta">Mis pedidos</Link>
        </nav>
        <p className="eyebrow">© {new Date().getFullYear()} {STORE_NAME}</p>
      </div>
    </footer>
  );
}
