import { Link } from "react-router-dom";
import { formatMoney, type CartLine } from "@tienda/shared";
import { useState } from "react";
import { useCart } from "../state/cart";
import { MinusIcon, PlusIcon, TrashIcon } from "./Icons";

export function CartLines({ lines, compact = false }: { lines: CartLine[]; compact?: boolean }) {
  const { setQuantity, remove } = useCart();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (variantId: string, fn: () => Promise<void>) => {
    setBusy(variantId);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo actualizar");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={`cart-lines ${compact ? "cart-lines--compact" : ""}`}>
      {error && <div className="alert">{error}</div>}
      {lines.map((l) => (
        <article key={l.variantId} className={`cart-line ${busy === l.variantId ? "is-busy" : ""}`}>
          <Link to={`/zapatilla/${l.productSlug}`} className="cart-line__img">
            {l.imageUrl ? <img src={l.imageUrl} alt={l.productName} /> : <span className="eyebrow">Sin foto</span>}
          </Link>
          <div className="cart-line__info">
            <div className="eyebrow">{l.brandName ?? ""}</div>
            <Link to={`/zapatilla/${l.productSlug}`} className="cart-line__name">
              {l.productName}
            </Link>
            <div className="cart-line__meta">
              <span className="swatch" style={{ background: l.colorHex }} /> {l.colorName} · Talla {l.sizeLabel}
            </div>
            {l.issue && <div className="field-error">{l.issue}</div>}
            <div className="cart-line__row">
              <div className="stepper" aria-label="Cantidad">
                <button
                  onClick={() => run(l.variantId, () => setQuantity(l.variantId, l.quantity - 1))}
                  disabled={l.quantity <= 1 || busy !== null}
                  aria-label="Quitar una unidad"
                >
                  <MinusIcon width={16} />
                </button>
                <span>{l.quantity}</span>
                <button
                  onClick={() => run(l.variantId, () => setQuantity(l.variantId, l.quantity + 1))}
                  disabled={l.quantity >= Math.min(10, l.available) || busy !== null}
                  aria-label="Añadir una unidad"
                >
                  <PlusIcon width={16} />
                </button>
              </div>
              <span className="price">
                <span className="price__now">{formatMoney(l.lineTotalCents)}</span>
              </span>
              <button
                className="icon-btn"
                onClick={() => run(l.variantId, () => remove(l.variantId))}
                aria-label={`Eliminar ${l.productName}`}
              >
                <TrashIcon width={16} />
              </button>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

export function CartTotals({
  cart,
}: {
  cart: { subtotalCents: number; discountCents: number; shippingCents: number; totalCents: number };
}) {
  return (
    <dl className="totals">
      <div>
        <dt>Subtotal</dt>
        <dd>{formatMoney(cart.subtotalCents)}</dd>
      </div>
      {cart.discountCents > 0 && (
        <div className="totals__discount">
          <dt>Descuentos</dt>
          <dd>-{formatMoney(cart.discountCents)}</dd>
        </div>
      )}
      <div>
        <dt>Envío</dt>
        <dd>{cart.shippingCents === 0 ? "Gratis" : formatMoney(cart.shippingCents)}</dd>
      </div>
      <div className="totals__total">
        <dt>Total</dt>
        <dd>{formatMoney(cart.totalCents)}</dd>
      </div>
    </dl>
  );
}
