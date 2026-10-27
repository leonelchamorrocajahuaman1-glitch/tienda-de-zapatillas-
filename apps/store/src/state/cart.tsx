import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CartSummary } from "@tienda/shared";
import { api } from "../lib/api";
import { useAuth } from "./auth";

/**
 * Carrito:
 *  - Invitado: se guarda en el navegador solo { variantId, cantidad } y los
 *    precios se piden al servidor (/api/cart/quote).
 *  - Con sesión: el carrito vive en la base de datos (/api/cart).
 *  Al iniciar sesión, el carrito de invitado se fusiona con el guardado.
 */
type LocalLine = { variantId: string; quantity: number };
const KEY = "tienda.cart.v1";
const MAX = 10;

function readLocal(): LocalLine[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as LocalLine[]) : [];
    return Array.isArray(parsed) ? parsed.filter((l) => l && typeof l.variantId === "string" && l.quantity > 0) : [];
  } catch {
    return [];
  }
}

function writeLocal(lines: LocalLine[]) {
  try {
    if (lines.length) localStorage.setItem(KEY, JSON.stringify(lines));
    else localStorage.removeItem(KEY);
  } catch {
    /* almacenamiento no disponible: el carrito vive solo en memoria */
  }
}

const EMPTY: CartSummary = {
  lines: [],
  itemCount: 0,
  subtotalCents: 0,
  discountCents: 0,
  shippingCents: 0,
  totalCents: 0,
  canCheckout: false,
};

interface CartState {
  cart: CartSummary;
  loading: boolean;
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  add: (variantId: string, quantity: number) => Promise<void>;
  setQuantity: (variantId: string, quantity: number) => Promise<void>;
  remove: (variantId: string) => Promise<void>;
  refresh: () => Promise<unknown>;
}

const CartContext = createContext<CartState | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const qc = useQueryClient();
  const [local, setLocal] = useState<LocalLine[]>(readLocal);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const merging = useRef(false);

  useEffect(() => writeLocal(local), [local]);

  // Fusiona el carrito de invitado al iniciar sesión
  useEffect(() => {
    if (!user || merging.current) return;
    const pending = readLocal();
    if (pending.length === 0) return;
    merging.current = true;
    api
      .post<CartSummary>("/api/cart/merge", { items: pending })
      .then((summary) => {
        setLocal([]);
        qc.setQueryData(["cart", user.id], summary);
      })
      .finally(() => {
        merging.current = false;
      });
  }, [user, qc]);

  const query = useQuery({
    queryKey: user ? ["cart", user.id] : ["cart", "guest", local],
    queryFn: () =>
      user
        ? api.get<CartSummary>("/api/cart")
        : local.length
          ? api.post<CartSummary>("/api/cart/quote", { items: local })
          : Promise.resolve(EMPTY),
    enabled: !authLoading,
    placeholderData: (prev) => prev,
    refetchInterval: 60_000,
  });

  const setServer = useCallback(
    (summary: CartSummary) => {
      if (user) qc.setQueryData(["cart", user.id], summary);
    },
    [qc, user],
  );

  const value: CartState = {
    cart: query.data ?? EMPTY,
    loading: query.isLoading,
    drawerOpen,
    setDrawerOpen,
    async add(variantId, quantity) {
      if (user) {
        setServer(await api.post<CartSummary>("/api/cart/items", { variantId, quantity }));
      } else {
        // valida disponibilidad con el servidor antes de guardar
        const current = local.find((l) => l.variantId === variantId)?.quantity ?? 0;
        const next = Math.min(MAX, current + quantity);
        const quote = await api.post<CartSummary>("/api/cart/quote", { items: [{ variantId, quantity: next }] });
        const issue = quote.lines[0]?.issue;
        if (!quote.lines[0]) throw new Error("Producto no disponible");
        if (issue) throw new Error(issue);
        setLocal((prev) => {
          const others = prev.filter((l) => l.variantId !== variantId);
          return [...others, { variantId, quantity: next }];
        });
      }
      setDrawerOpen(true);
    },
    async setQuantity(variantId, quantity) {
      const q = Math.max(1, Math.min(MAX, quantity));
      if (user) setServer(await api.put<CartSummary>("/api/cart/items", { variantId, quantity: q }));
      else setLocal((prev) => prev.map((l) => (l.variantId === variantId ? { ...l, quantity: q } : l)));
    },
    async remove(variantId) {
      if (user) setServer(await api.del<CartSummary>(`/api/cart/items/${encodeURIComponent(variantId)}`));
      else setLocal((prev) => prev.filter((l) => l.variantId !== variantId));
    },
    refresh: () => query.refetch(),
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart fuera de CartProvider");
  return ctx;
}
