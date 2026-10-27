import { useEffect, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { STORE_NAME } from "../lib/api";
import { useAuth } from "../state/auth";
import { useCart } from "../state/cart";
import { BagIcon, CloseIcon, MenuIcon, SearchIcon, UserIcon } from "./Icons";

export function Header() {
  const { user } = useAuth();
  const { cart, setDrawerOpen } = useCart();
  const [scrolled, setScrolled] = useState(false);
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState(false);
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setMenu(false);
    setSearch(false);
  }, [location.pathname]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    navigate(`/catalogo${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`);
    setSearch(false);
  };

  return (
    <header className={`site-header ${scrolled || location.pathname !== "/" ? "is-solid" : ""}`}>
      <div className="site-header__inner container">
        <Link to="/" className="logo" aria-label={`${STORE_NAME} — inicio`}>
          <span className="logo__mark" aria-hidden />
          <span className="logo__text">{STORE_NAME}</span>
        </Link>

        <nav className={`main-nav ${menu ? "is-open" : ""}`} aria-label="Principal">
          <NavLink to="/" end>
            Inicio
          </NavLink>
          <NavLink to="/catalogo">Catálogo</NavLink>
          <NavLink to="/catalogo?sort=new">Lanzamientos</NavLink>
          <NavLink to={user ? "/cuenta" : "/ingresar"}>{user ? "Mis pedidos" : "Ingresar"}</NavLink>
        </nav>

        <div className="header-actions">
          <button className="icon-btn" onClick={() => setSearch((s) => !s)} aria-label="Buscar">
            {search ? <CloseIcon /> : <SearchIcon />}
          </button>
          <Link className="icon-btn hide-mobile" to={user ? "/cuenta" : "/ingresar"} aria-label="Mi cuenta">
            <UserIcon />
          </Link>
          <button className="icon-btn cart-btn" onClick={() => setDrawerOpen(true)} aria-label="Abrir carrito">
            <BagIcon />
            {cart.itemCount > 0 && <span className="cart-count">{cart.itemCount}</span>}
          </button>
          <button className="icon-btn show-mobile" onClick={() => setMenu((m) => !m)} aria-label="Menú">
            {menu ? <CloseIcon /> : <MenuIcon />}
          </button>
        </div>
      </div>
      {search && (
        <form className="header-search container" onSubmit={submit} role="search">
          <SearchIcon />
          <input
            autoFocus
            className="header-search__input"
            placeholder="Busca por modelo, marca o categoría…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Buscar zapatillas"
          />
          <button className="btn btn--sm btn--primary" type="submit">
            Buscar
          </button>
        </form>
      )}
    </header>
  );
}
