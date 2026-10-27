import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { AuthProvider } from "./state/auth";
import { CartProvider } from "./state/cart";
import { STORE_NAME } from "./lib/api";
import "./styles/global.css";
import "./styles/store.css";

document.title = `${STORE_NAME} — Zapatillas`;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Precios y stock se vuelven a consultar al volver a la pestaña
      refetchOnWindowFocus: true,
      staleTime: 15_000,
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <CartProvider>
            <App />
          </CartProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
