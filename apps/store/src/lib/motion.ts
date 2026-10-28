import { useSyncExternalStore } from "react";

/**
 * Preferencias que deciden si algo se mueve solo. Son hooks (no lecturas
 * sueltas) para reaccionar en vivo si el sistema o la pestaña cambian.
 */

const REDUCED = "(prefers-reduced-motion: reduce)";

function subscribeReduced(cb: () => void) {
  const mq = window.matchMedia(REDUCED);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/** true si el sistema pide reducir el movimiento. */
export function useReducedMotion() {
  return useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia(REDUCED).matches,
    () => false,
  );
}

function subscribeVisibility(cb: () => void) {
  document.addEventListener("visibilitychange", cb);
  return () => document.removeEventListener("visibilitychange", cb);
}

/** false mientras la pestaña está oculta (otra pestaña, ventana minimizada…). */
export function usePageVisible() {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === "visible",
    () => true,
  );
}

/* ── Un único visor 3D activo en las tarjetas ──────────────────────────────
   Cada visor descarga su modelo y dibuja con WebGL: en una cuadrícula solo
   se permite uno a la vez. Activar otro apaga el anterior. */

let activeCard: string | null = null;
const cardListeners = new Set<() => void>();

function subscribeCard(cb: () => void) {
  cardListeners.add(cb);
  return () => {
    cardListeners.delete(cb);
  };
}

export function setActiveCard(id: string | null) {
  if (activeCard === id) return;
  activeCard = id;
  cardListeners.forEach((cb) => cb());
}

/** Apaga el visor de `id` solo si sigue siendo el activo. */
export function releaseActiveCard(id: string) {
  if (activeCard === id) setActiveCard(null);
}

export function useIsActiveCard(id: string) {
  return useSyncExternalStore(
    subscribeCard,
    () => activeCard === id,
    () => false,
  );
}
