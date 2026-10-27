import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { SpinFrame } from "@tienda/shared";
import { prefersReducedMotion } from "../lib/api";

export interface SpinHandle {
  /** Muestra el fotograma que corresponde a un ángulo (grados). */
  setAngle: (deg: number) => void;
}

interface Props {
  frames: SpinFrame[];
  alt: string;
  /** girar arrastrando con mouse o dedo, zoom y teclado */
  interactive?: boolean;
  /** giro automático lento hasta que el cliente toca la zapatilla */
  autoPlay?: boolean;
  className?: string;
}

/**
 * Vista 360° hecha con fotos reales: cada fotograma es una foto tomada
 * girando la zapatilla. Arrastrar a la izquierda/derecha la gira; doble clic
 * (o el botón) acerca para ver detalles.
 */
export const Spin360 = forwardRef<SpinHandle, Props>(function Spin360(
  { frames, alt, interactive = false, autoPlay = false, className },
  ref,
) {
  const n = frames.length;
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(0);
  const [zoom, setZoom] = useState(false);
  const [origin, setOrigin] = useState("50% 50%");
  const [touched, setTouched] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; start: number } | null>(null);

  useImperativeHandle(ref, () => ({
    setAngle: (deg: number) => {
      const norm = ((deg % 360) + 360) % 360;
      setIndex(Math.round((norm / 360) * n) % n);
    },
  }));

  // Precarga de todos los fotogramas para que el giro sea fluido
  useEffect(() => {
    setLoaded(0);
    let alive = true;
    frames.forEach((f) => {
      const img = new Image();
      img.onload = img.onerror = () => alive && setLoaded((c) => c + 1);
      img.src = f.url;
    });
    return () => {
      alive = false;
    };
  }, [frames]);

  const ready = loaded >= n;

  useEffect(() => {
    if (!autoPlay || touched || !ready || prefersReducedMotion()) return;
    const t = window.setInterval(() => setIndex((i) => (i + 1) % n), 110);
    return () => window.clearInterval(t);
  }, [autoPlay, touched, ready, n]);

  const step = useCallback((delta: number) => setIndex((i) => (((i + delta) % n) + n) % n), [n]);

  if (n === 0) return null;

  const handlers = interactive
    ? {
        onPointerDown: (e: React.PointerEvent) => {
          setTouched(true);
          // Los botones (girar / acercar) no inician un arrastre
          if ((e.target as HTMLElement).closest("button")) return;
          drag.current = { x: e.clientX, start: index };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        },
        onPointerMove: (e: React.PointerEvent) => {
          const rect = box.current?.getBoundingClientRect();
          const overButton = Boolean((e.target as HTMLElement).closest("button"));
          if (zoom && rect && !overButton) {
            setOrigin(`${((e.clientX - rect.left) / rect.width) * 100}% ${((e.clientY - rect.top) / rect.height) * 100}%`);
          }
          if (!drag.current || !rect) return;
          // Un arrastre de todo el ancho = una vuelta completa
          const dx = e.clientX - drag.current.x;
          const frame = Math.round((-dx / rect.width) * n);
          setIndex((((drag.current.start + frame) % n) + n) % n);
        },
        onPointerUp: () => {
          drag.current = null;
        },
        onPointerCancel: () => {
          drag.current = null;
        },
        onDoubleClick: (e: React.MouseEvent) => {
          const rect = box.current?.getBoundingClientRect();
          if (rect) {
            setOrigin(`${((e.clientX - rect.left) / rect.width) * 100}% ${((e.clientY - rect.top) / rect.height) * 100}%`);
          }
          setZoom((z) => !z);
        },
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === "ArrowLeft") step(-1);
          if (e.key === "ArrowRight") step(1);
          setTouched(true);
        },
        tabIndex: 0,
        role: "img",
        "aria-label": `${alt}. Usa las flechas para girar.`,
      }
    : { role: "img", "aria-label": alt };

  return (
    <div
      ref={box}
      className={`spin ${interactive ? "spin--interactive" : ""} ${zoom ? "is-zoomed" : ""} ${className ?? ""}`}
      {...handlers}
    >
      <div className="spin__frames" style={{ transformOrigin: origin }}>
        {frames.map((f, i) => (
          <img
            key={f.id}
            src={f.url}
            alt=""
            draggable={false}
            className={i === index ? "is-on" : ""}
            loading={i === 0 ? "eager" : "lazy"}
          />
        ))}
      </div>
      {interactive && !ready && (
        <div className="spin__loading">
          <span className="eyebrow">
            Cargando vista 360° {loaded}/{n}
          </span>
          <span className="spin__bar" style={{ width: `${(loaded / n) * 100}%` }} />
        </div>
      )}
      {interactive && ready && (
        <div className="spin__controls">
          <button type="button" className="badge" onClick={() => step(-1)} aria-label="Girar a la izquierda">
            ◀
          </button>
          <button
            type="button"
            className="badge"
            onClick={() => {
              setOrigin("50% 50%");
              setZoom((z) => !z);
            }}
            aria-pressed={zoom}
          >
            {zoom ? "Alejar" : "Acercar"}
          </button>
          <button type="button" className="badge" onClick={() => step(1)} aria-label="Girar a la derecha">
            ▶
          </button>
        </div>
      )}
    </div>
  );
});
