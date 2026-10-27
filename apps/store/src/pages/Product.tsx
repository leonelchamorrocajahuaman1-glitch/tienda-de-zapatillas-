import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import gsap from "gsap";
import { ApiError, errorMessage, formatMoney, type ProductDetail } from "@tienda/shared";
import { api, prefersReducedMotion, useStoreSettings } from "../lib/api";
import { useCart } from "../state/cart";
import { ProductVisual, NoModel } from "../components/ProductVisual";
import { ModelViewer } from "../components/ModelViewer";
import { Price } from "../components/Price";
import { SplitText } from "../components/SplitText";
import { CubeIcon, MinusIcon, PlusIcon } from "../components/Icons";

export default function ProductPage() {
  const { slug = "" } = useParams();
  const { add } = useCart();
  const query = useQuery({
    queryKey: ["product", slug],
    queryFn: () => api.get<ProductDetail>(`/api/catalog/products/${encodeURIComponent(slug)}`),
    // precio y disponibilidad se vuelven a consultar periódicamente
    refetchInterval: 30_000,
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 1,
  });
  const p = query.data;
  const { data: settings } = useStoreSettings();

  const [colorId, setColorId] = useState<string | null>(null);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [view, setView] = useState<"3d" | "photos">("3d");
  const [imageIdx, setImageIdx] = useState(0);
  const [modelFailed, setModelFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  // Color inicial: el primero con stock
  useEffect(() => {
    if (!p || (colorId && p.colors.some((c) => c.id === colorId))) return;
    const withStock = p.colors.find((c) => p.variants.some((v) => v.colorId === c.id && v.available > 0));
    setColorId((withStock ?? p.colors[0])?.id ?? null);
  }, [p, colorId]);

  useEffect(() => {
    if (!p) return;
    setView(p.modelUrl && !modelFailed ? "3d" : "photos");
  }, [p?.modelUrl, modelFailed]); // eslint-disable-line react-hooks/exhaustive-deps

  const variants = useMemo(() => (p ? p.variants.filter((v) => v.colorId === colorId) : []), [p, colorId]);
  const selected = variants.find((v) => v.id === variantId) ?? null;

  // Si cambia la disponibilidad (otro cliente compró) se ajusta la selección
  useEffect(() => {
    if (!selected) return;
    if (selected.available === 0) setVariantId(null);
    else if (qty > selected.available) setQty(selected.available);
  }, [selected, qty]);

  const images = useMemo(() => {
    if (!p) return [];
    const forColor = p.images.filter((i) => !i.colorId || i.colorId === colorId);
    return forColor.length ? forColor : p.images;
  }, [p, colorId]);

  useEffect(() => setImageIdx(0), [colorId]);

  useLayoutEffect(() => {
    if (!p || !root.current || prefersReducedMotion()) return;
    const ctx = gsap.context(() => {
      gsap.from(".pdp__name .split-char", { yPercent: 110, opacity: 0, stagger: 0.03, duration: 0.9, ease: "expo.out" });
      gsap.from(".pdp__info > *:not(.pdp__name)", { y: 24, opacity: 0, stagger: 0.05, duration: 0.7, delay: 0.2 });
      gsap.from(".viewer", { scale: 0.96, opacity: 0, duration: 1, ease: "expo.out" });
    }, root);
    return () => ctx.revert();
  }, [p?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (query.isLoading) {
    return (
      <div className="page-loading">
        <div className="spinner" />
      </div>
    );
  }
  if (query.isError || !p) {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    return (
      <div className="page container empty">
        <h1 className="display page-title">{notFound ? "No disponible" : "Error"}</h1>
        <p>{notFound ? "Esta zapatilla no existe o ya no está publicada." : errorMessage(query.error)}</p>
        <Link className="btn btn--primary" to="/catalogo">
          Volver al catálogo
        </Link>
      </div>
    );
  }

  const totalAvailable = p.variants.reduce((s, v) => s + v.available, 0);
  const hasModel = Boolean(p.modelUrl) && !modelFailed;
  const maxQty = Math.min(10, selected?.available ?? 1);

  async function onAdd() {
    if (!selected) {
      setError("Selecciona una talla");
      return;
    }
    setAdding(true);
    setError(null);
    try {
      await add(selected.id, qty);
      setQty(1);
    } catch (e) {
      setError(errorMessage(e));
      query.refetch();
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="page container" ref={root} style={{ "--accent-scene": p.accentColor } as React.CSSProperties}>
      <div className="pdp">
        <section className="pdp__visual" aria-label="Visualización del producto">
          <div className="viewer">
            {(hasModel || images.length > 0) && (
              <div className="viewer__tabs" role="tablist">
                {hasModel && (
                  <button
                    role="tab"
                    aria-selected={view === "3d"}
                    className={`badge ${view === "3d" ? "is-active" : ""}`}
                    onClick={() => setView("3d")}
                  >
                    <CubeIcon width={12} height={12} /> 3D
                  </button>
                )}
                {images.length > 0 && (
                  <button
                    role="tab"
                    aria-selected={view === "photos"}
                    className={`badge ${view === "photos" ? "is-active" : ""}`}
                    onClick={() => setView("photos")}
                  >
                    Fotos
                  </button>
                )}
              </div>
            )}

            {view === "3d" && hasModel ? (
              <>
                <ModelViewer
                  src={p.modelUrl!}
                  alt={`Modelo 3D de ${p.name}`}
                  poster={images[0]?.url}
                  interactive
                  autoRotate
                  cameraOrbit="30deg 75deg auto"
                  className="visual"
                  onError={() => setModelFailed(true)}
                />
                <span className="viewer__hint eyebrow">Arrastra para girar · Rueda o pellizco para acercar</span>
              </>
            ) : images[imageIdx] ? (
              <ProductVisual name={p.name} modelUrl={null} images={[images[imageIdx]]} />
            ) : (
              <NoModel name={p.name} />
            )}
          </div>
          {!p.modelUrl && <p className="eyebrow">Este producto aún no tiene modelo 3D</p>}
          {modelFailed && <p className="eyebrow">No se pudo cargar el modelo 3D; se muestran las fotos</p>}
          {images.length > 1 && (
            <div className="thumbs">
              {images.map((img, i) => (
                <button
                  key={img.id}
                  className={`thumb ${view === "photos" && i === imageIdx ? "is-active" : ""}`}
                  onClick={() => {
                    setImageIdx(i);
                    setView("photos");
                  }}
                  aria-label={`Foto ${i + 1}`}
                >
                  <img src={img.url} alt="" />
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="pdp__info">
          <div className="eyebrow eyebrow--accent">
            {[p.brand?.name, p.category?.name].filter(Boolean).join(" · ") || "Zapatillas"}
          </div>
          <h1 className="display pdp__name">
            <SplitText text={p.name} />
          </h1>
          {p.tagline && <p className="pdp__tagline">{p.tagline}</p>}
          <Price
            className="pdp__price"
            priceCents={p.priceCents}
            finalPriceCents={p.finalPriceCents}
            discountPercent={p.discountPercent}
          />
          <div className="pdp__stock">
            <span className={`dot ${totalAvailable === 0 ? "dot--off" : totalAvailable <= 5 ? "dot--warn" : ""}`} />
            {totalAvailable === 0
              ? "Agotado"
              : selected
                ? `${selected.available} disponible(s) en talla ${selected.size}`
                : "Disponible — elige tu talla"}
          </div>

          {p.colors.length > 1 && (
            <div className="field">
              <span className="label">Color: {p.colors.find((c) => c.id === colorId)?.name}</span>
              <div className="swatches">
                {p.colors.map((c) => (
                  <button
                    key={c.id}
                    className={`swatch-btn ${c.id === colorId ? "is-active" : ""}`}
                    style={{ background: c.hex }}
                    title={c.name}
                    aria-label={c.name}
                    aria-pressed={c.id === colorId}
                    onClick={() => {
                      setColorId(c.id);
                      setVariantId(null);
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="field">
            <span className="label">
              Talla (EU){p.colors.length === 1 ? ` · ${p.colors[0].name}` : ""}
            </span>
            <div className="size-grid" role="radiogroup" aria-label="Talla">
              {variants.map((v) => (
                <button
                  key={v.id}
                  role="radio"
                  aria-checked={v.id === variantId}
                  className={`chip ${v.id === variantId ? "is-active" : ""}`}
                  disabled={v.available === 0}
                  onClick={() => {
                    setVariantId(v.id);
                    setError(null);
                  }}
                >
                  {v.size}
                  {v.available > 0 && v.available <= 3 && <small>Últ. {v.available}</small>}
                </button>
              ))}
            </div>
          </div>

          <div className="buy-row">
            <div className="stepper stepper--lg" aria-label="Cantidad">
              <button onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1} aria-label="Menos">
                <MinusIcon width={16} />
              </button>
              <span>{qty}</span>
              <button onClick={() => setQty((q) => Math.min(maxQty, q + 1))} disabled={qty >= maxQty} aria-label="Más">
                <PlusIcon width={16} />
              </button>
            </div>
            <button
              className="btn btn--primary btn--glitch"
              data-label="Añadir al carrito"
              onClick={onAdd}
              disabled={adding || totalAvailable === 0}
            >
              {adding ? "Añadiendo…" : totalAvailable === 0 ? "Agotado" : "Añadir al carrito"}
            </button>
          </div>
          {error && <div className="alert">{error}</div>}

          <div className="panel perks">
            <div>
              <span className="muted">Pago</span>
              <span>Contra entrega</span>
            </div>
            {settings && (
              <div>
                <span className="muted">Envío</span>
                <span>
                  {formatMoney(settings.shippingFlatCents)} · gratis desde {formatMoney(settings.freeShippingMinCents)}
                </span>
              </div>
            )}
          </div>

          {p.description && (
            <div>
              <div className="eyebrow">Descripción</div>
              <p className="pdp__desc">{p.description}</p>
            </div>
          )}
          <span className="updated">
            Precio y stock actualizados {new Date(query.dataUpdatedAt).toLocaleTimeString("es-PE")}
          </span>
        </section>
      </div>
    </div>
  );
}
