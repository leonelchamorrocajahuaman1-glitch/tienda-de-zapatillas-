import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "@tienda/shared";
import { App } from "./App";
import { AdminAuthProvider } from "./lib/auth";
import { ToastProvider } from "./components/Toast";
import "./styles/admin.css";

// Si la sesión de administrador caduca, cualquier petición 401 devuelve al login.
const onError = (err: unknown) => {
  if (err instanceof ApiError && err.status === 401) queryClient.setQueryData(["admin-me"], null);
};
const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: { queries: { refetchOnWindowFocus: true, staleTime: 5_000, retry: false } },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename="/admin">
        <AdminAuthProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AdminAuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
