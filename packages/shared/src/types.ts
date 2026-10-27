export type OrderStatus = "PENDING" | "CONFIRMED" | "PREPARING" | "SHIPPED" | "DELIVERED" | "CANCELLED";
export type ProductStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

export interface NamedRef {
  id: string;
  name: string;
  slug: string;
}

export interface ColorRef {
  id: string;
  name: string;
  hex: string;
}

export interface ProductSummary {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  brand: NamedRef | null;
  category: NamedRef | null;
  priceCents: number;
  discountPercent: number;
  finalPriceCents: number;
  accentColor: string;
  featured: boolean;
  modelUrl: string | null;
  images: { id: string; url: string; alt: string }[];
  /** tiene vista 360° hecha con fotos */
  hasSpin: boolean;
  /** fotogramas 360° (solo en los destacados de la portada) */
  spin?: SpinFrame[];
  sizes: { label: string; available: boolean }[];
  colors: ColorRef[];
  inStock: boolean;
}

export interface SpinFrame {
  id: string;
  url: string;
}

export interface ProductDetail extends Omit<ProductSummary, "images" | "spin"> {
  description: string;
  images: { id: string; url: string; alt: string; colorId: string | null }[];
  spin: SpinFrame[];
  variants: { id: string; size: string; colorId: string; available: number }[];
}

export interface CatalogPage {
  items: ProductSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CatalogFilters {
  brands: NamedRef[];
  categories: NamedRef[];
  sizes: string[];
  colors: ColorRef[];
  priceRange: { min: number; max: number } | null;
}

export interface CartLine {
  variantId: string;
  quantity: number;
  productId: string;
  productName: string;
  productSlug: string;
  brandName: string | null;
  sizeLabel: string;
  colorName: string;
  colorHex: string;
  imageUrl: string | null;
  unitListPriceCents: number;
  discountPercent: number;
  unitPriceCents: number;
  lineTotalCents: number;
  available: number;
  issue: string | null;
}

export interface CartSummary {
  lines: CartLine[];
  itemCount: number;
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  totalCents: number;
  canCheckout: boolean;
}

export interface OrderItem {
  id: string;
  productId: string | null;
  variantId: string | null;
  productName: string;
  brandName: string | null;
  sizeLabel: string;
  colorName: string;
  imageUrl: string | null;
  unitListPriceCents: number;
  discountPercent: number;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
}

export interface OrderStatusEntry {
  id: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  note: string | null;
  createdAt: string;
  changedBy?: { name: string; role: string } | null;
}

export interface Order {
  id: string;
  number: number;
  status: OrderStatus;
  inventoryState: "RESERVED" | "COMMITTED" | "RELEASED" | "RESTOCKED";
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  totalCents: number;
  paymentMethod: string;
  paymentStatus: string;
  shippingName: string;
  shippingPhone: string;
  shippingAddress: string;
  shippingDistrict: string;
  shippingCity: string;
  shippingReference: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  items: OrderItem[];
  statusHistory: OrderStatusEntry[];
}

export interface Customer {
  id: string;
  email: string;
  name: string;
  phone: string | null;
}
