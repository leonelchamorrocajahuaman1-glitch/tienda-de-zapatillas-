import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { ProductSummary } from "@tienda/shared";
import { releaseActiveCard, setActiveCard, useIsActiveCard, useReducedMotion } from "../lib/motion";
import { CubeIcon } from "./Icons";
import { ModelViewer } from "./ModelViewer";
import { NoModel } from "./ProductVisual";
import { Price } from "./Price";

/** Pausa antes de cargar el 3D al pasar el mouse (evita cargas al cruzar la cuadrícula). */
const HOVER_INTENT_MS = 180;
/** Igual que el fundido foto ⇄ modelo en store.css (.card__model). */
const FADE_MS = 200;

/**
 * Tarjeta de producto. Muestra la foto; si el producto tiene un modelo 3D real
 * se puede ver girando en la misma tarjeta (mouse encima, o botón "Ver 3D" en
 * pantallas táctiles / con teclado). Solo hay un visor activo en toda la página.
 */
export function ProductCard({ product, index = 0 }: { product: ProductSummary; index?: number }) {
  const [first, second] = product.images;
  const id = product.id;
  const reduced = useReducedMotion();
  const [failed, setFailed] = useState(false);
  // La vista previa es un giro automático: con movimiento reducido no se ofrece
  // (en la ficha del producto el 3D sigue disponible con control manual).
  const canPreview = Boolean(product.modelUrl) && !failed && !reduced;
  const active = useIsActiveCard(id) && canPreview;
  const [mounted, setMounted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<number>();

  // Al apagarse, el modelo se desvanece y luego se desmonta (libera memoria y WebGL)
  useEffect(() => {
    if (active) {
      setMounted(true);
      return;
    }
    const t = window.setTimeout(() => {
      setMounted(false);
      setLoaded(false);
    }, FADE_MS);
    return () => window.clearTimeout(t);
  }, [active]);

  // Si la tarjeta activa sale de la pantalla (scroll en el celular), se apaga
  useEffect(() => {
    const el = root.current;
    if (!active || !el) return;
    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) releaseActiveCard(id);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [active, id]);

  useEffect(
    () => () => {
      window.clearTimeout(hoverTimer.current);
      releaseActiveCard(id);
    },
    [id],
  );

  const onLoad = useCallback(() => setLoaded(true), []);
  const onError = useCallback(() => {
    setFailed(true);
    releaseActiveCard(id);
  }, [id]);

  const hover = canPreview
    ? {
        onPointerEnter: (e: React.PointerEvent) => {
          if (e.pointerType !== "mouse") return;
          window.clearTimeout(hoverTimer.current);
          hoverTimer.current = window.setTimeout(() => setActiveCard(id), HOVER_INTENT_MS);
        },
        onPointerLeave: (e: React.PointerEvent) => {
          if (e.pointerType !== "mouse") return;
          window.clearTimeout(hoverTimer.current);
          releaseActiveCard(id);
        },
      }
    : {};

  const showing3d = active && loaded;

  return (
    <div
      ref={root}
      className={`card ${product.inStock ? "" : "is-soldout"}`}
      style={{ "--card-accent": product.accentColor, "--i": index } as React.CSSProperties}
      data-reveal
      {...hover}
    >
      <Link to={`/zapatilla/${product.slug}`} className="card__link">
        <div className={`card__media ${showing3d ? "is-3d" : ""}`}>
          <div className="card__glow" aria-hidden />
          {first ? (
            <>
              <img className="card__img" src={first.url} alt={first.alt || product.name} loading="lazy" />
              {second && <img className="card__img card__img--alt" src={second.url} alt="" loading="lazy" aria-hidden />}
            </>
          ) : (
            <NoModel name={product.name} label={product.modelUrl ? "Foto no disponible" : undefined} />
          )}
          {mounted && product.modelUrl && (
            <ModelViewer
              src={product.modelUrl}
              alt={`Modelo 3D de ${product.name}`}
              autoRotate
              rotationSpeed="30deg"
              cameraOrbit="30deg 75deg auto"
              className="card__model"
              onLoad={onLoad}
              onError={onError}
            />
          )}
          <div className="card__badges">
            {product.modelUrl && (
              <span className="badge badge--3d">
                <CubeIcon width={12} height={12} /> 3D
              </span>
            )}
            {product.hasSpin && <span className="badge badge--3d">360°</span>}
            {product.discountPercent > 0 && <span className="badge badge--accent">-{product.discountPercent}%</span>}
          </div>
          {!product.inStock && <span className="card__soldout display">Agotado</span>}
        </div>
        <div className="card__body">
          <div className="eyebrow">{[product.brand?.name, product.category?.name].filter(Boolean).join(" · ")}</div>
          <h3 className="card__name">{product.name}</h3>
          <Price
            priceCents={product.priceCents}
            finalPriceCents={product.finalPriceCents}
            discountPercent={product.discountPercent}
          />
        </div>
      </Link>
      {canPreview && (
        <button
          type="button"
          className={`badge card__3d ${active ? "is-active" : ""}`}
          aria-pressed={active}
          aria-busy={active && !loaded}
          aria-label={`Ver ${product.name} en 3D`}
          onClick={() => (active ? releaseActiveCard(id) : setActiveCard(id))}
        >
          {active && !loaded ? <span className="card__3d-spinner" aria-hidden /> : <CubeIcon width={12} height={12} />}
          Ver 3D
        </button>
      )}
    </div>
  );
}
