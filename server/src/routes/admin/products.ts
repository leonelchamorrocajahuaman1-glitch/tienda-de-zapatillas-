import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db";
import { badRequest, conflict, notFound } from "../../lib/errors";
import { finalPrice } from "../../lib/pricing";
import { slugify } from "../../lib/slug";
import { parse } from "../../lib/validate";
import { setStock } from "../../services/inventory";
import {
  assertValidImage,
  assertValidModel,
  imageUpload,
  modelUpload,
  publicUrl,
  removeByUrl,
} from "../../storage/uploads";

export const adminProductsRouter = Router();

const detailInclude = {
  brand: true,
  category: true,
  images: { orderBy: { sortOrder: "asc" } },
  variants: { include: { size: true, color: true } },
  priceHistory: {
    orderBy: { createdAt: "desc" },
    take: 30,
    include: { changedBy: { select: { name: true } } },
  },
} satisfies Prisma.ProductInclude;

async function loadDetail(id: string) {
  const product = await prisma.product.findUnique({ where: { id }, include: detailInclude });
  if (!product) throw notFound("Producto no encontrado");
  const sold = await prisma.orderItem.aggregate({
    where: { productId: id, order: { status: { not: "CANCELLED" } } },
    _sum: { quantity: true, lineTotalCents: true },
  });
  return {
    ...product,
    variants: product.variants.sort(
      (a, b) => a.color.name.localeCompare(b.color.name) || a.size.sortOrder - b.size.sortOrder,
    ),
    finalPriceCents: finalPrice(product.priceCents, product.discountPercent),
    unitsSold: sold._sum.quantity ?? 0,
    revenueCents: sold._sum.lineTotalCents ?? 0,
  };
}

async function uniqueSlug(base: string, excludeId?: string) {
  const root = slugify(base) || "producto";
  let slug = root;
  for (let i = 2; ; i++) {
    const found = await prisma.product.findUnique({ where: { slug } });
    if (!found || found.id === excludeId) return slug;
    slug = `${root}-${i}`;
  }
}

// ───────────────────────── Listado ─────────────────────────

adminProductsRouter.get("/", async (req, res) => {
  const q = parse(
    z.object({
      q: z.string().trim().max(80).optional(),
      status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
    }),
    req.query,
  );
  const products = await prisma.product.findMany({
    where: {
      ...(q.status ? { status: q.status } : {}),
      ...(q.q
        ? {
            OR: [
              { name: { contains: q.q, mode: "insensitive" } },
              { brand: { name: { contains: q.q, mode: "insensitive" } } },
              { variants: { some: { sku: { contains: q.q, mode: "insensitive" } } } },
            ],
          }
        : {}),
    },
    include: {
      brand: true,
      category: true,
      images: { orderBy: { sortOrder: "asc" }, take: 1 },
      variants: { select: { stock: true, reserved: true, active: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
  res.json(
    products.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      status: p.status,
      featured: p.featured,
      brand: p.brand?.name ?? null,
      category: p.category?.name ?? null,
      priceCents: p.priceCents,
      discountPercent: p.discountPercent,
      finalPriceCents: finalPrice(p.priceCents, p.discountPercent),
      imageUrl: p.images[0]?.url ?? null,
      hasModel: Boolean(p.modelUrl),
      variantCount: p.variants.length,
      stock: p.variants.reduce((s, v) => s + v.stock, 0),
      reserved: p.variants.reduce((s, v) => s + v.reserved, 0),
      updatedAt: p.updatedAt,
    })),
  );
});

adminProductsRouter.get("/:id", async (req, res) => {
  res.json(await loadDetail(req.params.id));
});

// ───────────────────────── Crear / editar ─────────────────────────

const productBody = z.object({
  name: z.string().trim().min(2, "Nombre requerido").max(120),
  slug: z.string().trim().max(80).optional(),
  tagline: z.string().trim().max(120).optional().nullable(),
  description: z.string().trim().max(5000).default(""),
  brandId: z.string().max(40).optional().nullable(),
  categoryId: z.string().max(40).optional().nullable(),
  price: z.coerce.number().positive("El precio debe ser mayor que 0").max(100000), // en soles
  discountPercent: z.coerce.number().int().min(0).max(90).default(0),
  featured: z.boolean().default(false),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#ff2a2a"),
});

const toCents = (soles: number) => Math.round(soles * 100);

adminProductsRouter.post("/", async (req, res) => {
  const body = parse(productBody, req.body);
  const priceCents = toCents(body.price);
  const product = await prisma.product.create({
    data: {
      name: body.name,
      slug: await uniqueSlug(body.slug || body.name),
      tagline: body.tagline || null,
      description: body.description,
      brandId: body.brandId || null,
      categoryId: body.categoryId || null,
      priceCents,
      discountPercent: body.discountPercent,
      featured: body.featured,
      accentColor: body.accentColor,
      status: "DRAFT",
      priceHistory: {
        create: { priceCents, discountPercent: body.discountPercent, changedById: req.user!.id },
      },
    },
  });
  res.status(201).json(await loadDetail(product.id));
});

adminProductsRouter.patch("/:id", async (req, res) => {
  const body = parse(productBody.partial(), req.body);
  const current = await prisma.product.findUnique({ where: { id: req.params.id } });
  if (!current) throw notFound("Producto no encontrado");

  const priceCents = body.price !== undefined ? toCents(body.price) : current.priceCents;
  const discountPercent = body.discountPercent ?? current.discountPercent;
  const priceChanged = priceCents !== current.priceCents || discountPercent !== current.discountPercent;

  await prisma.$transaction(async (tx) => {
    await tx.product.update({
      where: { id: current.id },
      data: {
        name: body.name,
        slug: body.slug !== undefined ? await uniqueSlug(body.slug || body.name || current.name, current.id) : undefined,
        tagline: body.tagline !== undefined ? body.tagline || null : undefined,
        description: body.description,
        brandId: body.brandId !== undefined ? body.brandId || null : undefined,
        categoryId: body.categoryId !== undefined ? body.categoryId || null : undefined,
        priceCents,
        discountPercent,
        featured: body.featured,
        accentColor: body.accentColor,
      },
    });
    if (priceChanged) {
      await tx.priceHistory.create({
        data: { productId: current.id, priceCents, discountPercent, changedById: req.user!.id },
      });
    }
  });
  res.json(await loadDetail(current.id));
});

// ───────────────────────── Publicación ─────────────────────────

adminProductsRouter.post("/:id/status", async (req, res) => {
  const body = parse(z.object({ status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]) }), req.body);
  const product = await prisma.product.findUnique({
    where: { id: req.params.id },
    include: { variants: { where: { active: true } }, images: true },
  });
  if (!product) throw notFound("Producto no encontrado");
  if (body.status === "PUBLISHED") {
    const problems: string[] = [];
    if (product.priceCents <= 0) problems.push("asignar un precio");
    if (product.variants.length === 0) problems.push("agregar al menos una talla/color al inventario");
    if (product.images.length === 0 && !product.modelUrl) problems.push("subir al menos una imagen o un modelo 3D");
    if (problems.length) throw badRequest(`Para publicar debes ${problems.join(", ")}.`);
  }
  await prisma.product.update({
    where: { id: product.id },
    data: {
      status: body.status,
      publishedAt: body.status === "PUBLISHED" ? (product.publishedAt ?? new Date()) : product.publishedAt,
    },
  });
  res.json(await loadDetail(product.id));
});

adminProductsRouter.delete("/:id", async (req, res) => {
  const product = await prisma.product.findUnique({ where: { id: req.params.id }, include: { images: true } });
  if (!product) throw notFound("Producto no encontrado");
  const sold = await prisma.orderItem.count({ where: { productId: product.id } });
  if (sold > 0) {
    throw conflict(
      "Este producto tiene pedidos asociados y no puede eliminarse. Desactívalo (archivar) para ocultarlo de la tienda.",
    );
  }
  await prisma.product.delete({ where: { id: product.id } });
  product.images.forEach((i) => removeByUrl(i.url));
  removeByUrl(product.modelUrl);
  res.json({ ok: true });
});

// ───────────────────────── Inventario por talla ─────────────────────────

const variantsBody = z.object({
  variants: z
    .array(
      z.object({
        sizeId: z.string().min(1).max(40),
        colorId: z.string().min(1).max(40),
        sku: z.string().trim().max(60).optional().nullable(),
        stock: z.coerce.number().int().min(0).max(100000),
        active: z.boolean().default(true),
      }),
    )
    .max(400),
});

/**
 * Sustituye la matriz de inventario del producto.
 * - Combinaciones nuevas: se crean.
 * - Existentes: se ajusta el stock (registrando el movimiento).
 * - Ausentes: se eliminan si nunca se vendieron; si no, se desactivan.
 */
adminProductsRouter.put("/:id/variants", async (req, res) => {
  const body = parse(variantsBody, req.body);
  const productId = req.params.id;
  const product = await prisma.product.findUnique({ where: { id: productId }, include: { variants: true } });
  if (!product) throw notFound("Producto no encontrado");

  const keys = new Set<string>();
  for (const v of body.variants) {
    const key = `${v.sizeId}:${v.colorId}`;
    if (keys.has(key)) throw badRequest("Hay combinaciones de talla y color repetidas");
    keys.add(key);
  }
  const sizeIds = [...new Set(body.variants.map((v) => v.sizeId))];
  const colorIds = [...new Set(body.variants.map((v) => v.colorId))];
  const [sizeCount, colorCount] = await Promise.all([
    prisma.size.count({ where: { id: { in: sizeIds } } }),
    prisma.color.count({ where: { id: { in: colorIds } } }),
  ]);
  if (sizeCount !== sizeIds.length || colorCount !== colorIds.length) {
    throw badRequest("Alguna talla o color seleccionado ya no existe");
  }

  await prisma.$transaction(async (tx) => {
    const existing = new Map(product.variants.map((v) => [`${v.sizeId}:${v.colorId}`, v]));
    for (const v of body.variants) {
      const key = `${v.sizeId}:${v.colorId}`;
      const current = existing.get(key);
      const sku = v.sku || null;
      if (current) {
        await setStock(tx, current.id, v.stock, { userId: req.user!.id, note: "Ajuste desde el panel" });
        await tx.productVariant.update({ where: { id: current.id }, data: { sku, active: v.active } });
        existing.delete(key);
      } else {
        const created = await tx.productVariant.create({
          data: { productId, sizeId: v.sizeId, colorId: v.colorId, sku, stock: v.stock, active: v.active },
        });
        if (v.stock > 0) {
          await tx.inventoryMovement.create({
            data: { variantId: created.id, type: "ADJUSTMENT", stockDelta: v.stock, userId: req.user!.id, note: "Stock inicial" },
          });
        }
      }
    }
    for (const leftover of existing.values()) {
      if (leftover.reserved > 0) {
        throw conflict("No puedes quitar una talla con unidades reservadas por pedidos pendientes");
      }
      const used = await tx.orderItem.count({ where: { variantId: leftover.id } });
      if (used > 0) await tx.productVariant.update({ where: { id: leftover.id }, data: { active: false } });
      else await tx.productVariant.delete({ where: { id: leftover.id } });
    }
  });
  res.json(await loadDetail(productId));
});

// ───────────────────────── Imágenes ─────────────────────────

adminProductsRouter.post("/:id/images", imageUpload.array("images", 10), async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const product = await prisma.product.findUnique({ where: { id: String(req.params.id) }, include: { images: true } });
  if (!product) {
    files.forEach((f) => removeByUrl(publicUrl("images", f.filename)));
    throw notFound("Producto no encontrado");
  }
  if (files.length === 0) throw badRequest("Selecciona al menos una imagen");
  const colorId = typeof req.body.colorId === "string" && req.body.colorId ? req.body.colorId : null;
  for (const f of files) assertValidImage(f.path);
  let order = product.images.reduce((m, i) => Math.max(m, i.sortOrder), -1);
  await prisma.productImage.createMany({
    data: files.map((f) => ({
      productId: product.id,
      url: publicUrl("images", f.filename),
      alt: product.name,
      colorId,
      sortOrder: ++order,
    })),
  });
  res.status(201).json(await loadDetail(product.id));
});

adminProductsRouter.patch("/:id/images/:imageId", async (req, res) => {
  const body = parse(
    z.object({ alt: z.string().trim().max(160).optional(), colorId: z.string().max(40).nullable().optional() }),
    req.body,
  );
  const result = await prisma.productImage.updateMany({
    where: { id: req.params.imageId, productId: req.params.id },
    data: body,
  });
  if (result.count === 0) throw notFound("Imagen no encontrada");
  res.json(await loadDetail(req.params.id));
});

adminProductsRouter.post("/:id/images/reorder", async (req, res) => {
  const body = parse(z.object({ ids: z.array(z.string()).max(50) }), req.body);
  await prisma.$transaction(
    body.ids.map((id, index) =>
      prisma.productImage.updateMany({ where: { id, productId: req.params.id }, data: { sortOrder: index } }),
    ),
  );
  res.json(await loadDetail(req.params.id));
});

adminProductsRouter.delete("/:id/images/:imageId", async (req, res) => {
  const image = await prisma.productImage.findFirst({ where: { id: req.params.imageId, productId: req.params.id } });
  if (!image) throw notFound("Imagen no encontrada");
  await prisma.productImage.delete({ where: { id: image.id } });
  // Las imágenes usadas en pedidos se conservan en disco para el historial.
  const usedInOrders = await prisma.orderItem.count({ where: { imageUrl: image.url } });
  if (!usedInOrders) removeByUrl(image.url);
  res.json(await loadDetail(req.params.id));
});

// ───────────────────────── Modelo 3D ─────────────────────────

adminProductsRouter.post("/:id/model", modelUpload.single("model"), async (req, res) => {
  const file = req.file;
  if (!file) throw badRequest("Selecciona un archivo .glb o .gltf");
  const product = await prisma.product.findUnique({ where: { id: String(req.params.id) } });
  if (!product) {
    removeByUrl(publicUrl("models", file.filename));
    throw notFound("Producto no encontrado");
  }
  assertValidModel(file.path);
  await prisma.product.update({
    where: { id: product.id },
    data: { modelUrl: publicUrl("models", file.filename), modelFileName: file.originalname.slice(0, 200) },
  });
  removeByUrl(product.modelUrl);
  res.status(201).json(await loadDetail(product.id));
});

adminProductsRouter.delete("/:id/model", async (req, res) => {
  const product = await prisma.product.findUnique({ where: { id: req.params.id } });
  if (!product) throw notFound("Producto no encontrado");
  await prisma.product.update({ where: { id: product.id }, data: { modelUrl: null, modelFileName: null } });
  removeByUrl(product.modelUrl);
  res.json(await loadDetail(product.id));
});
