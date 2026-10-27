import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { formatMoney, type CatalogFilters, type CatalogPage } from "@tienda/shared";
import { api } from "../lib/api";
import { useReveal } from "../lib/useReveal";
import { ProductCard } from "../components/ProductCard";
import { CloseIcon, FilterIcon } from "../components/Icons";

const LIST_KEYS = ["brand", "category", "size", "color"] as const;

export default function CatalogPage() {
  const [params, setParams] = useSearchParams();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [q, setQ] = useState(params.get("q") ?? "");
  const root = useRef<HTMLDivElement>(null);

  const filters = useQuery({
    queryKey: ["filters"],
    queryFn: () => api.get<CatalogFilters>("/api/catalog/filters"),
  });

  const queryString = params.toString();
  const results = useQuery({
    queryKey: ["catalog", queryString],
    queryFn: () => api.get<CatalogPage>(`/api/catalog/products${queryString ? `?${queryString}` : ""}`),
    placeholderData: keepPreviousData,
  });

  // Búsqueda con pequeña espera mientras se escribe
  useEffect(() => {
    const t = setTimeout(() => {
      const current = params.get("q") ?? "";
      if (q.trim() === current) return;
      update((p) => (q.trim() ? p.set("q", q.trim()) : p.delete("q")));
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  useEffect(() => setQ(params.get("q") ?? ""), [params]);

  function update(mutate: (p: URLSearchParams) => void) {
    const next = new URLSearchParams(params);
    mutate(next);
    next.delete("page");
    setParams(next, { replace: true });
  }

  const listOf = (key: (typeof LIST_KEYS)[number]) => (params.get(key) ?? "").split(",").filter(Boolean);
  const toggle = (key: (typeof LIST_KEYS)[number], value: string) =>
    update((p) => {
      const list = new Set(listOf(key));
      if (list.has(value)) list.delete(value);
      else list.add(value);
      if (list.size) p.set(key, [...list].join(","));
      else p.delete(key);
    });

  const setValue = (key: string, value: string) => update((p) => (value ? p.set(key, value) : p.delete(key)));

  const activeCount =
    LIST_KEYS.reduce((n, k) => n + listOf(k).length, 0) +
    (params.get("minPrice") ? 1 : 0) +
    (params.get("maxPrice") ? 1 : 0) +
    (params.get("inStock") ? 1 : 0);

  const data = results.data;
  const page = data?.page ?? 1;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  useReveal(root, [queryString, data?.items.length]);

  const f = filters.data;

  return (
    <div className="page container" ref={root}>
      <header className="catalog-hero">
        <span className="eyebrow eyebrow--accent">Colección completa</span>
        <h1 className="display page-title">
          <span className="glitch" data-text="Catálogo">
            Catálogo
          </span>
        </h1>
        <div className="catalog-toolbar">
          <input
            className="input"
            type="search"
            placeholder="Buscar zapatillas…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Buscar"
          />
          <select
            className="select"
            value={params.get("sort") ?? "new"}
            onChange={(e) => setValue("sort", e.target.value === "new" ? "" : e.target.value)}
            aria-label="Ordenar"
          >
            <option value="new">Más recientes</option>
            <option value="price_asc">Precio: menor a mayor</option>
            <option value="price_desc">Precio: mayor a menor</option>
            <option value="name">Nombre</option>
          </select>
          <button className="btn filters-toggle" onClick={() => setFiltersOpen(true)}>
            <FilterIcon width={16} /> Filtros {activeCount > 0 && `(${activeCount})`}
          </button>
        </div>
      </header>

      <div className="catalog-layout">
        <aside className={`filters ${filtersOpen ? "is-open" : ""}`} aria-label="Filtros">
          <button className="icon-btn filters__close" onClick={() => setFiltersOpen(false)} aria-label="Cerrar filtros">
            <CloseIcon />
          </button>

          {f && f.brands.length > 0 && (
            <div className="filters__group">
              <div className="filters__title">Marca</div>
              {f.brands.map((b) => (
                <label key={b.id} className="check">
                  <input type="checkbox" checked={listOf("brand").includes(b.slug)} onChange={() => toggle("brand", b.slug)} />
                  {b.name}
                </label>
              ))}
            </div>
          )}

          {f && f.categories.length > 0 && (
            <div className="filters__group">
              <div className="filters__title">Categoría</div>
              {f.categories.map((c) => (
                <label key={c.id} className="check">
                  <input
                    type="checkbox"
                    checked={listOf("category").includes(c.slug)}
                    onChange={() => toggle("category", c.slug)}
                  />
                  {c.name}
                </label>
              ))}
            </div>
          )}

          {f && f.sizes.length > 0 && (
            <div className="filters__group">
              <div className="filters__title">Talla (EU)</div>
              <div className="chips">
                {f.sizes.map((s) => (
                  <button
                    key={s}
                    className={`chip ${listOf("size").includes(s) ? "is-active" : ""}`}
                    onClick={() => toggle("size", s)}
                    aria-pressed={listOf("size").includes(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {f && f.colors.length > 0 && (
            <div className="filters__group">
              <div className="filters__title">Color</div>
              <div className="swatches">
                {f.colors.map((c) => (
                  <button
                    key={c.id}
                    className={`swatch-btn ${listOf("color").includes(c.id) ? "is-active" : ""}`}
                    style={{ background: c.hex }}
                    onClick={() => toggle("color", c.id)}
                    title={c.name}
                    aria-label={c.name}
                    aria-pressed={listOf("color").includes(c.id)}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="filters__group">
            <div className="filters__title">
              Precio (S/)
              {f?.priceRange && (
                <span className="muted">
                  {" "}
                  · {formatMoney(f.priceRange.min)} – {formatMoney(f.priceRange.max)}
                </span>
              )}
            </div>
            <div className="price-range">
              <input
                className="input"
                type="number"
                min={0}
                inputMode="decimal"
                key={`min-${params.get("minPrice") ?? ""}`}
                placeholder="Mín."
                defaultValue={params.get("minPrice") ?? ""}
                onBlur={(e) => setValue("minPrice", e.target.value)}
                aria-label="Precio mínimo"
              />
              <input
                className="input"
                type="number"
                min={0}
                inputMode="decimal"
                key={`max-${params.get("maxPrice") ?? ""}`}
                placeholder="Máx."
                defaultValue={params.get("maxPrice") ?? ""}
                onBlur={(e) => setValue("maxPrice", e.target.value)}
                aria-label="Precio máximo"
              />
            </div>
          </div>

          <label className="check">
            <input
              type="checkbox"
              checked={Boolean(params.get("inStock"))}
              onChange={(e) => setValue("inStock", e.target.checked ? "1" : "")}
            />
            Solo con stock
          </label>

          {activeCount > 0 && (
            <button
              className="btn btn--sm"
              onClick={() =>
                setParams(params.get("q") ? new URLSearchParams({ q: params.get("q")! }) : new URLSearchParams(), {
                  replace: true,
                })
              }
            >
              Limpiar filtros
            </button>
          )}
        </aside>

        <section aria-live="polite">
          <div className="results-meta eyebrow">
            {results.isLoading ? "Cargando…" : `${data?.total ?? 0} zapatilla(s)`}
            {results.isFetching && !results.isLoading && " · actualizando"}
          </div>
          {results.isError && <div className="alert">No se pudo cargar el catálogo. ¿Está iniciada la API?</div>}
          {data && data.items.length === 0 && (
            <div className="empty">
              <p className="display" style={{ fontSize: 40 }}>
                Sin resultados
              </p>
              <p>Prueba con otros filtros o una búsqueda distinta.</p>
            </div>
          )}
          <div className="grid">
            {data?.items.map((p, i) => <ProductCard key={p.id} product={p} index={i} />)}
          </div>
          {pages > 1 && (
            <nav className="pager" aria-label="Paginación">
              <button
                className="btn btn--sm"
                disabled={page <= 1}
                onClick={() => {
                  const n = new URLSearchParams(params);
                  n.set("page", String(page - 1));
                  setParams(n);
                }}
              >
                Anterior
              </button>
              <span className="eyebrow" style={{ alignSelf: "center" }}>
                {page} / {pages}
              </span>
              <button
                className="btn btn--sm"
                disabled={page >= pages}
                onClick={() => {
                  const n = new URLSearchParams(params);
                  n.set("page", String(page + 1));
                  setParams(n);
                }}
              >
                Siguiente
              </button>
            </nav>
          )}
        </section>
      </div>
      {filtersOpen && <div className="drawer__backdrop" style={{ position: "fixed", opacity: 1, zIndex: 65 }} onClick={() => setFiltersOpen(false)} />}
    </div>
  );
}
