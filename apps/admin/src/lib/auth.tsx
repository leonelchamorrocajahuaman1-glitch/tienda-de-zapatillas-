import { createContext, useContext, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@tienda/shared";
import { api } from "./api";

export interface AdminUser {
  id: string;
  email: string;
  name: string;
}

interface State {
  user: AdminUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<State | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ["admin-me"],
    queryFn: async () => {
      try {
        return (await api.get<{ user: AdminUser }>("/api/admin/auth/me")).user;
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return null;
        throw e;
      }
    },
    retry: false,
  });
  const value: State = {
    user: me.data ?? null,
    loading: me.isLoading,
    async login(email, password) {
      const { user } = await api.post<{ user: AdminUser }>("/api/admin/auth/login", { email, password });
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "admin-me" });
      qc.setQueryData(["admin-me"], user);
    },
    async logout() {
      await api.post("/api/admin/auth/logout");
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "admin-me" });
      qc.setQueryData(["admin-me"], null);
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAdminAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAdminAuth fuera del proveedor");
  return c;
}
