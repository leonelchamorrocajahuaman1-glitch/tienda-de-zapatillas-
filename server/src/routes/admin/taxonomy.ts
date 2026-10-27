import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db";
import { conflict } from "../../lib/errors";
import { slugify } from "../../lib/slug";
import { parse } from "../../lib/validate";

/** Gestión de marcas, categorías, colores y tallas. */
export const taxonomyRouter = Router();

const name = z.string().trim().min(1, "Nombre requerido").max(60);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color hexadecimal inválido (#RRGGBB)");

// ── Marcas ──
taxonomyRouter.get("/brands", async (_req, res) => {
  res.json(
    await prisma.brand.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { products: true } } } }),
  );
});
taxonomyRouter.post("/brands", async (req, res) => {
  const body = parse(z.object({ name }), req.body);
  res.status(201).json(await prisma.brand.create({ data: { name: body.name, slug: slugify(body.name) } }));
});
taxonomyRouter.patch("/brands/:id", async (req, res) => {
  const body = parse(z.object({ name }), req.body);
  res.json(await prisma.brand.update({ where: { id: req.params.id }, data: { name: body.name, slug: slugify(body.name) } }));
});
taxonomyRouter.delete("/brands/:id", async (req, res) => {
  const used = await prisma.product.count({ where: { brandId: req.params.id } });
  if (used) throw conflict(`La marca tiene ${used} producto(s). Reasígnalos antes de eliminarla.`);
  await prisma.brand.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// ── Categorías ──
taxonomyRouter.get("/categories", async (_req, res) => {
  res.json(
    await prisma.category.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { products: true } } } }),
  );
});
taxonomyRouter.post("/categories", async (req, res) => {
  const body = parse(z.object({ name }), req.body);
  res.status(201).json(await prisma.category.create({ data: { name: body.name, slug: slugify(body.name) } }));
});
taxonomyRouter.patch("/categories/:id", async (req, res) => {
  const body = parse(z.object({ name }), req.body);
  res.json(
    await prisma.category.update({ where: { id: req.params.id }, data: { name: body.name, slug: slugify(body.name) } }),
  );
});
taxonomyRouter.delete("/categories/:id", async (req, res) => {
  const used = await prisma.product.count({ where: { categoryId: req.params.id } });
  if (used) throw conflict(`La categoría tiene ${used} producto(s). Reasígnalos antes de eliminarla.`);
  await prisma.category.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// ── Colores ──
taxonomyRouter.get("/colors", async (_req, res) => {
  res.json(
    await prisma.color.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { variants: true } } } }),
  );
});
taxonomyRouter.post("/colors", async (req, res) => {
  const body = parse(z.object({ name, hex }), req.body);
  res.status(201).json(await prisma.color.create({ data: body }));
});
taxonomyRouter.patch("/colors/:id", async (req, res) => {
  const body = parse(z.object({ name: name.optional(), hex: hex.optional() }), req.body);
  res.json(await prisma.color.update({ where: { id: req.params.id }, data: body }));
});
taxonomyRouter.delete("/colors/:id", async (req, res) => {
  const used = await prisma.productVariant.count({ where: { colorId: req.params.id } });
  if (used) throw conflict(`El color se usa en ${used} variante(s) de inventario.`);
  await prisma.color.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// ── Tallas ──
taxonomyRouter.get("/sizes", async (_req, res) => {
  res.json(
    await prisma.size.findMany({ orderBy: { sortOrder: "asc" }, include: { _count: { select: { variants: true } } } }),
  );
});
const sizeBody = z.object({
  label: z.string().trim().min(1).max(10),
  sortOrder: z.coerce.number().int().min(0).max(10000).optional(),
});
taxonomyRouter.post("/sizes", async (req, res) => {
  const body = parse(sizeBody, req.body);
  const sortOrder = body.sortOrder ?? Math.round((Number.parseFloat(body.label) || 0) * 10);
  res.status(201).json(await prisma.size.create({ data: { label: body.label, sortOrder } }));
});
taxonomyRouter.patch("/sizes/:id", async (req, res) => {
  const body = parse(sizeBody.partial(), req.body);
  res.json(await prisma.size.update({ where: { id: req.params.id }, data: body }));
});
taxonomyRouter.delete("/sizes/:id", async (req, res) => {
  const used = await prisma.productVariant.count({ where: { sizeId: req.params.id } });
  if (used) throw conflict(`La talla se usa en ${used} variante(s) de inventario.`);
  await prisma.size.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});
