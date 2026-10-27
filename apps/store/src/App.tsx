import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Header } from "./components/Header";
import { Footer } from "./components/Footer";
import { CartDrawer } from "./components/CartDrawer";
import { useAuth } from "./state/auth";
import { HomePage } from "./pages/Home";

const CatalogPage = lazy(() => import("./pages/Catalog"));
const ProductPage = lazy(() => import("./pages/Product"));
const CartPage = lazy(() => import("./pages/Cart"));
const CheckoutPage = lazy(() => import("./pages/Checkout"));
const AccountPage = lazy(() => import("./pages/Account"));
const OrderPage = lazy(() => import("./pages/Order"));
const LoginPage = lazy(() => import("./pages/Login"));
const RegisterPage = lazy(() => import("./pages/Register"));
const NotFoundPage = lazy(() => import("./pages/NotFound"));

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading />;
  if (!user) return <Navigate to={`/ingresar?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return children;
}

function Loading() {
  return (
    <div className="page-loading">
      <div className="spinner" aria-label="Cargando" />
    </div>
  );
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export function App() {
  return (
    <>
      <div className="grain" aria-hidden />
      <ScrollToTop />
      <Header />
      <main>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/catalogo" element={<CatalogPage />} />
            <Route path="/zapatilla/:slug" element={<ProductPage />} />
            <Route path="/carrito" element={<CartPage />} />
            <Route
              path="/checkout"
              element={
                <RequireAuth>
                  <CheckoutPage />
                </RequireAuth>
              }
            />
            <Route
              path="/cuenta"
              element={
                <RequireAuth>
                  <AccountPage />
                </RequireAuth>
              }
            />
            <Route
              path="/cuenta/pedidos/:number"
              element={
                <RequireAuth>
                  <OrderPage />
                </RequireAuth>
              }
            />
            <Route path="/ingresar" element={<LoginPage />} />
            <Route path="/registro" element={<RegisterPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </main>
      <Footer />
      <CartDrawer />
    </>
  );
}
