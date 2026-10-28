import { Navigate, Route, Routes } from "react-router-dom";
import { useAdminAuth } from "./lib/auth";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/Login";
import { DashboardPage } from "./pages/Dashboard";
import { ProductsPage } from "./pages/Products";
import { ProductEditorPage } from "./pages/ProductEditor";
import { OrdersPage } from "./pages/Orders";
import { OrderDetailPage } from "./pages/OrderDetail";
import { CustomersPage } from "./pages/Customers";
import { CustomerDetailPage } from "./pages/CustomerDetail";
import { TaxonomyPage } from "./pages/Taxonomy";
import { SalesPage } from "./pages/Sales";
import { InventoryPage } from "./pages/Inventory";
import { AccountPage } from "./pages/Account";
import { PrintingPage } from "./pages/Printing";

export function App() {
  const { user, loading } = useAdminAuth();
  if (loading) {
    return (
      <div className="center" style={{ minHeight: "100vh" }}>
        <div className="spinner" />
      </div>
    );
  }
  // Sin sesión de administrador solo existe la pantalla de acceso
  if (!user) return <LoginPage />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="productos" element={<ProductsPage />} />
        <Route path="productos/nuevo" element={<ProductEditorPage key="new" />} />
        <Route path="productos/:id" element={<ProductEditorPage key="edit" />} />
        <Route path="pedidos" element={<OrdersPage />} />
        <Route path="pedidos/:id" element={<OrderDetailPage />} />
        <Route path="clientes" element={<CustomersPage />} />
        <Route path="clientes/:id" element={<CustomerDetailPage />} />
        <Route path="catalogo-base" element={<TaxonomyPage />} />
        <Route path="ventas" element={<SalesPage />} />
        <Route path="boletas" element={<PrintingPage />} />
        <Route path="inventario" element={<InventoryPage />} />
        <Route path="cuenta" element={<AccountPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
