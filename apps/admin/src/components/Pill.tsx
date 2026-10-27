import { ORDER_STATUS_LABEL, type OrderStatus, type ProductStatus } from "@tienda/shared";

export const PRODUCT_STATUS_LABEL: Record<ProductStatus, string> = {
  DRAFT: "Borrador",
  PUBLISHED: "Publicado",
  ARCHIVED: "Desactivado",
};

export function OrderPill({ status }: { status: OrderStatus }) {
  return <span className={`pill pill--${status}`}>{ORDER_STATUS_LABEL[status]}</span>;
}

export function ProductPill({ status }: { status: ProductStatus }) {
  return <span className={`pill pill--${status}`}>{PRODUCT_STATUS_LABEL[status]}</span>;
}
