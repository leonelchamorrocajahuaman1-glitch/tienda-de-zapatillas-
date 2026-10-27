import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db";
import { notFound } from "../../lib/errors";
import { finalPrice } from "../../lib/pricing";
import { parse } from "../../lib/validate";

/** Catálogo público: SOLO productos publicados. Datos leídos en cada consulta. */
export const catalogRouter = Router();

const summaryInclude = {
  brand: true,
  category: true,
  images: { orderBy: { sortOrder: "asc" }, take: 2 },
  variants: { where: { active: true }, include: { size: true, color: true } },
} satisfies Prisma.ProductInclude;

type ProductWithSummary = Prisma.ProductGetPayload<{ include: typeof summaryInclude }>;

function toSummary(p: ProductWithSummary) {
  const sizes = new Map<string, { label: string; sortOrder: number; available: boolean }>();
  const colors = new Map<string, { id: string; name: string; hex: string }>();
  let totalAvailable = 0;
  for (const v of p.variants) {
    const available = Math.max(0, v.stock - v.reserved);
    totalAvailable += available;
    const prev = sizes.get(v.sizeId);
    sizes.set(v.sizeId, {
      label: v.size.label,
      sortOrder: v.size.sortOrder,
      available: (prev?.available ?? false) || available > 0,
    });
    colors.set(v.colorId, { id: v.color.id, name: v.color.name, hex: v.color.hex });
  }
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    tagline: p.tagline,
    brand: p.brand ? { id: p.brand.id, name: p.brand.name, slug: p.brand.slug } : null,
    category: p.category ? { id: p.category.id, name: p.category.name, slug: p.category.slug } : null,
    priceCents: p.priceCents,
    discountPercent: p.discountPercent,
    finalPriceCents: finalPrice(p.priceCents, p.discountPercent),
    accentColor: p.accentColor,
    featured: p.featured,
    modelUrl: p.modelUrl,
    images: p.images.map((i) => ({ id: i.id, url: i.url, alt: i.alt })),
    sizes: [...sizes.values()].sort((a, b) => a.sortOrder - b.sortOrder).map(({ label, available }) => ({ label, available })),
    colors: [...colors.values()],
    inStock: totalAvailable > 0,
  };
}

const listQuery = z.object({
  q: z.string().trim().max(80).optional(),
  brand: z.string().max(200).optional(), // slugs separados por coma
  category: z.string().max(200).optional(),
  size: z.string().max(200).optional(), // etiquetas separadas por coma
  color: z.string().max(400).optional(), // ids separados por coma
  minPrice: z.coerce.number().min(0).optional(), // en soles
  maxPrice: z.coerce.number().min(0).optional(),
  inStock: z.enum(["1", "true"]).optional(),
  sort: z.enum(["new", "price_asc", "price_desc", "name"]).default("new"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(48).default(24),
});

const csv = (s?: string) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : []);

catalogRouter.get("/products", async (req, res) => {
  const q = parse(listQuery, req.query);
  const brands = csv(q.brand);
  const categories = csv(q.category);
  const sizes = csv(q.size);
  const colors = csv(q.color);

  const variantFilter: Prisma.ProductVariantWhereInput = { active: true };
  if (sizes.length) variantFilter.size = { label: { in: sizes } };
  if (colors.length) variantFilter.colorId = { in: colors };

  const where: Prisma.ProductWhereInput = {
    status: "PUBLISHED",
    ...(q.q
      ? {
          OR: [
            { name: { contains: q.q, mode: "insensitive" } },
            { tagline: { contains: q.q, mode: "insensitive" } },
            { description: { contains: q.q, mode: "insensitive" } },
            { brand: { name: { contains: q.q, mode: "insensitive" } } },
            { category: { name: { contains: q.q, mode: "insensitive" } } },
          ],
        }
      : {}),
    ...(brands.length ? { brand: { slug: { in: brands } } } : {}),
    ...(categories.length ? { category: { slug: { in: categories } } } : {}),
    ...(sizes.length || colors.length ? { variants: { some: variantFilter } } : {}),
  };

  // El precio final depende del descuento: se filtra y ordena tras calcularlo.
  const all = await prisma.product.findMany({
    where,
    include: summaryInclude,
    orderBy: q.sort === "name" ? { name: "asc" } : { publishedAt: "desc" },
  });
  let items = all.map(toSummary);
  if (q.minPrice !== undefined) items = items.filter((p) => p.finalPriceCents >= Math.round(q.minPrice! * 100));
  if (q.maxPrice !== undefined) items = items.filter((p) => p.finalPriceCents <= Math.round(q.maxPrice! * 100));
  if (q.inStock) items = items.filter((p) => p.inStock);
  if (q.sort === "price_asc") items.sort((a, b) => a.finalPriceCents - b.finalPriceCents);
  if (q.sort === "price_desc") items.sort((a, b) => b.finalPriceCents - a.finalPriceCents);

  const total = items.length;
  const start = (q.page - 1) * q.pageSize;
  res.json({ items: items.slice(start, start + q.pageSize), total, page: q.page, pageSize: q.pageSize });
});

/** Productos destacados para las escenas cinematográficas de la portada. */
catalogRouter.get("/featured", async (_req, res) => {
  let products = await prisma.product.findMany({
    where: { status: "PUBLISHED", featured: true },
    include: summaryInclude,
    orderBy: { publishedAt: "desc" },
    take: 4,
  });
  if (products.length === 0) {
    products = await prisma.product.findMany({
      where: { status: "PUBLISHED" },
      include: summaryInclude,
      orderBy: { publishedAt: "desc" },
      take: 3,
    });
  }
  const latest = await prisma.product.findMany({
    where: { status: "PUBLISHED" },
    include: summaryInclude,
    orderBy: { publishedAt: "desc" },
    take: 8,
  });
  res.json({ featured: products.map(toSummary), latest: latest.map(toSummary) });
});

catalogRouter.get("/filters", async (_req, res) => {
  const published = { status: "PUBLISHED" as const };
  const [brands, categories, sizes, colors, prices] = await Promise.all([
    prisma.brand.findMany({ where: { products: { some: published } }, orderBy: { name: "asc" } }),
    prisma.category.findMany({ where: { products: { some: published } }, orderBy: { name: "asc" } }),
    prisma.size.findMany({
      where: { variants: { some: { active: true, product: published } } },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.color.findMany({
      where: { variants: { some: { active: true, product: published } } },
      orderBy: { name: "asc" },
    }),
    prisma.product.findMany({ where: published, select: { priceCents: true, discountPercent: true } }),
  ]);
  const finals = prices.map((p) => finalPrice(p.priceCents, p.discountPercent));
  res.json({
    brands: brands.map((b) => ({ id: b.id, name: b.name, slug: b.slug })),
    categories: categories.map((c) => ({ id: c.id, name: c.name, slug: c.slug })),
    sizes: sizes.map((s) => s.label),
    colors: colors.map((c) => ({ id: c.id, name: c.name, hex: c.hex })),
    priceRange: finals.length ? { min: Math.min(...finals), max: Math.max(...finals) } : null,
  });
});

catalogRouter.get("/products/:slug", async (req, res) => {
  const product = await prisma.product.findFirst({
    where: { slug: req.params.slug, status: "PUBLISHED" },
    include: {
      brand: true,
      category: true,
      images: { orderBy: { sortOrder: "asc" } },
      variants: {
        where: { active: true },
        include: { size: true, color: true },
      },
    },
  });
  if (!product) throw notFound("Producto no encontrado");
  const summary = toSummary({ ...product, images: product.images });
  res.json({
    ...summary,
    description: product.description,
    images: product.images.map((i) => ({ id: i.id, url: i.url, alt: i.alt, colorId: i.colorId })),
    variants: product.variants
      .sort((a, b) => a.size.sortOrder - b.size.sortOrder)
      .map((v) => ({
        id: v.id,
        size: v.size.label,
        colorId: v.colorId,
        available: Math.max(0, v.stock - v.reserved),
      })),
  });
});
