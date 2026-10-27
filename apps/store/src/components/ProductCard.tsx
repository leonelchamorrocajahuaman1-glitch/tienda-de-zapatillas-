import { Link } from "react-router-dom";
import type { ProductSummary } from "@tienda/shared";
import { CubeIcon } from "./Icons";
import { NoModel } from "./ProductVisual";
import { Price } from "./Price";

export function ProductCard({ product, index = 0 }: { product: ProductSummary; index?: number }) {
  const [first, second] = product.images;
  return (
    <Link
      to={`/zapatilla/${product.slug}`}
      className={`card ${product.inStock ? "" : "is-soldout"}`}
      style={{ "--card-accent": product.accentColor, "--i": index } as React.CSSProperties}
      data-reveal
    >
      <div className="card__media">
        <div className="card__glow" aria-hidden />
        {first ? (
          <>
            <img className="card__img" src={first.url} alt={first.alt || product.name} loading="lazy" />
            {second && <img className="card__img card__img--alt" src={second.url} alt="" loading="lazy" aria-hidden />}
          </>
        ) : (
          <NoModel name={product.name} />
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
  );
}
