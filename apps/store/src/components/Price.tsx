import { formatMoney } from "@tienda/shared";

export function Price({
  priceCents,
  finalPriceCents,
  discountPercent,
  className,
}: {
  priceCents: number;
  finalPriceCents: number;
  discountPercent: number;
  className?: string;
}) {
  return (
    <span className={`price ${className ?? ""}`}>
      <span className="price__now">{formatMoney(finalPriceCents)}</span>
      {discountPercent > 0 && (
        <>
          <span className="price__was">{formatMoney(priceCents)}</span>
          <span className="price__off">-{discountPercent}%</span>
        </>
      )}
    </span>
  );
}
