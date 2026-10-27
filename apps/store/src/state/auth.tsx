import { createContext, useContext, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, type Customer } from "@tienda/shared";
import { api } from "../lib/api";

interface AuthState {
  user: Customer | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<Customer>;
  register: (data: { name: string; email: string; password: string; phone?: string }) => Promise<Customer>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return (await api.get<{ user: Customer }>("/api/auth/me")).user;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const value: AuthState = {
    user: me.data ?? null,
    loading: me.isLoading,
    async login(email, password) {
      const { user } = await api.post<{ user: Customer }>("/api/auth/login", { email, password });
      qc.setQueryData(["me"], user);
      return user;
    },
    async register(data) {
      const { user } = await api.post<{ user: Customer }>("/api/auth/register", data);
      qc.setQueryData(["me"], user);
      return user;
    },
    async logout() {
      await api.post("/api/auth/logout");
      qc.setQueryData(["me"], null);
      qc.removeQueries({ queryKey: ["orders"] });
      qc.removeQueries({ queryKey: ["order"] });
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth fuera de AuthProvider");
  return ctx;
}
