/**
 * Importa el catálogo de server/catalog/productos.json a la base de datos.
 *
 *   npm run catalogo:importar
 *
 * - Crea marcas, categorías y colores que falten.
 * - Crea cada producto (por su slug) con sus imágenes.
 * - Sin precio o sin stock, el producto queda como BORRADOR: complétalo en el
 *   panel (o en el JSON) y publícalo.
 * - Es seguro ejecutarlo varias veces: nunca sobrescribe lo que se haya editado
 *   en el panel; solo completa lo que falta.
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { prisma } from "../src/db";
import { slugify } from "../src/lib/slug";
import { imageMime, saveFile } from "../src/storage/uploads";

const CATALOG_DIR = path.resolve(__dirname, "../catalog");
const IMAGES_DIR = path.join(CATALOG_DIR, "imagenes");

const DEFAULT_HEX: Record<string, string> = {
  negro: "#111111",
  blanco: "#f5f5f5",
  rojo: "#d7261e",
  azul: "#1f4bd8",
  gris: "#8a8d91",
  verde: "#1f7a4d",
  beige: "#d9c7a7",
  marrón: "#6b4428",
  morado: "#6b3fd4",
  naranja: "#f26b1d",
};

const item = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  nombre: z.string().min(2),
  marca: z.string().min(1).nullable().optional(),
  categoria: z.string().min(1).nullable().optional(),
  frase: z.string().max(120).nullable().optional(),
  descripcion: z.string().max(5000).default(""),
  color: z.string().min(1),
  acento: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#ff2a2a"),
  destacado: z.boolean().default(false),
  publicar: z.boolean().default(true),
  precio: z.number().positive().nullable().default(null),
  descuento: z.number().int().min(0).max(90).default(0),
  stock: z.record(z.string(), z.number().int().min(0)).default({}),
  imagenes: z.array(z.string()).default([]),
});
const file = z.object({ productos: z.array(item) });

async function findOrCreateBrand(name: string) {
  return (
    (await prisma.brand.findFirst({ where: { name: { equals: name, mode: "insensitive" } } })) ??
    (await prisma.brand.create({ data: { name, slug: slugify(name) } }))
  );
}

async function findOrCreateCategory(name: string) {
  return (
    (await prisma.category.findFirst({ where: { name: { equals: name, mode: "insensitive" } } })) ??
    (await prisma.category.create({ data: { name, slug: slugify(name) } }))
  );
}

async function findOrCreateColor(name: string) {
  return (
    (await prisma.color.findFirst({ where: { name: { equals: name, mode: "insensitive" } } })) ??
    (await prisma.color.create({ data: { name, hex: DEFAULT_HEX[name.toLowerCase()] ?? "#888888" } }))
  );
}

async function storeImage(fileName: string): Promise<string> {
  const source = path.join(IMAGES_DIR, fileName);
  if (!fs.existsSync(source)) throw new Error(`No existe la imagen ${source}`);
  const data = fs.readFileSync(source);
  return saveFile("image", data, imageMime(data), fileName);
}

/**
 * Si una foto del catálogo cambió en el repositorio (p. ej. una versión de más
 * calidad), la sustituye en la tienda. Solo toca las fotos que vinieron del
 * catálogo (mismo nombre de archivo); las que subiste desde el panel no se tocan.
 */
async function refreshCatalogImages(productId: string, fileNames: string[]): Promise<number> {
  const images = await prisma.productImage.findMany({ where: { productId, kind: "GALLERY" } });
  let updated = 0;
  for (const image of images) {
    const id = image.url.match(/^\/uploads\/([a-z0-9]+)/i)?.[1];
    if (!id) continue;
    const stored = await prisma.storedFile.findUnique({ where: { id }, select: { fileName: true, data: true } });
    if (!stored || !fileNames.includes(stored.fileName)) continue;
    const source = path.join(IMAGES_DIR, stored.fileName);
    if (!fs.existsSync(source)) continue;
    const data = fs.readFileSync(source);
    if (Buffer.from(stored.data).equals(data)) continue;
    const url = await saveFile("image", data, imageMime(data), stored.fileName);
    await prisma.productImage.update({ where: { id: image.id }, data: { url } });
    // Los pedidos antiguos conservan su foto original
    const usedInOrders = await prisma.orderItem.count({ where: { imageUrl: image.url } });
    if (!usedInOrders) await prisma.storedFile.delete({ where: { id } });
    updated++;
  }
  return updated;
}

async function main() {
  // Opciones:
  //   npm run catalogo:importar -- ruta/al/archivo.json   (otro archivo)
  //   --arranque   (lo usa el arranque en el hosting): si la base está vacía importa todo;
  //                si ya tiene productos, solo COMPLETA los existentes (precio, stock,
  //                imágenes, publicación) y no vuelve a crear los que borraste en el panel.
  const args = process.argv.slice(2);
  const onlyComplete = args.includes("--arranque") && (await prisma.product.count()) > 0;
  const fileArg = args.find((a) => !a.startsWith("--"));
  const catalogFile = fileArg ? path.resolve(fileArg) : path.join(CATALOG_DIR, "productos.json");
  const raw = JSON.parse(fs.readFileSync(catalogFile, "utf8"));
  const parsed = file.safeParse(raw);
  if (!parsed.success) {
    console.error("productos.json tiene errores:");
    for (const issue of parsed.error.issues) console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    process.exit(1);
  }
  const products = parsed.data.productos;
  const sizes = new Map((await prisma.size.findMany()).map((s) => [s.label, s]));
  const report: { producto: string; estado: string; precio: string; stock: number; notas: string }[] = [];
  const now = Date.now();

  for (const [index, p] of products.entries()) {
    const notes: string[] = [];
    if (onlyComplete && !(await prisma.product.findUnique({ where: { slug: p.slug }, select: { id: true } }))) {
      continue; // borrado en el panel: no se vuelve a crear
    }
    const brand = p.marca ? await findOrCreateBrand(p.marca) : null;
    const category = p.categoria ? await findOrCreateCategory(p.categoria) : null;
    const color = await findOrCreateColor(p.color);
    const priceCents = p.precio ? Math.round(p.precio * 100) : 0;

    let product = await prisma.product.findUnique({ where: { slug: p.slug } });
    if (!product) {
      product = await prisma.product.create({
        data: {
          slug: p.slug,
          name: p.nombre,
          tagline: p.frase ?? null,
          description: p.descripcion,
          brandId: brand?.id ?? null,
          categoryId: category?.id ?? null,
          priceCents,
          discountPercent: p.descuento,
          featured: p.destacado,
          accentColor: p.acento,
          status: "DRAFT",
          ...(priceCents > 0
            ? { priceHistory: { create: { priceCents, discountPercent: p.descuento } } }
            : {}),
        },
      });
      notes.push("creado");
    } else if (product.priceCents === 0 && priceCents > 0) {
      product = await prisma.product.update({
        where: { id: product.id },
        data: {
          priceCents,
          discountPercent: p.descuento,
          priceHistory: { create: { priceCents, discountPercent: p.descuento } },
        },
      });
      notes.push("precio asignado");
    }

    const imageCount = await prisma.productImage.count({ where: { productId: product.id, kind: "GALLERY" } });
    if (imageCount === 0 && p.imagenes.length) {
      for (const [i, img] of p.imagenes.entries()) {
        await prisma.productImage.create({
          data: { productId: product.id, url: await storeImage(img), alt: product.name, sortOrder: i },
        });
      }
      notes.push(`${p.imagenes.length} imágenes`);
    } else if (imageCount > 0) {
      const updated = await refreshCatalogImages(product.id, p.imagenes);
      if (updated) notes.push(`${updated} imagen(es) mejoradas`);
    }

    const variantCount = await prisma.productVariant.count({ where: { productId: product.id } });
    const stockEntries = Object.entries(p.stock);
    if (variantCount === 0 && stockEntries.length) {
      for (const [label, qty] of stockEntries) {
        const size = sizes.get(label);
        if (!size) {
          notes.push(`talla ${label} no existe (créala en el panel)`);
          continue;
        }
        const variant = await prisma.productVariant.create({
          data: { productId: product.id, sizeId: size.id, colorId: color.id, stock: qty },
        });
        if (qty > 0) {
          await prisma.inventoryMovement.create({
            data: { variantId: variant.id, type: "ADJUSTMENT", stockDelta: qty, note: "Importación de catálogo" },
          });
        }
      }
      notes.push("inventario creado");
    }

    // Publica solo productos completos que nunca se publicaron
    // (si lo despublicaste en el panel, el importador lo respeta).
    const [images, variants] = await Promise.all([
      prisma.productImage.count({ where: { productId: product.id } }),
      prisma.productVariant.count({ where: { productId: product.id, active: true } }),
    ]);
    if (p.publicar && product.status === "DRAFT" && !product.publishedAt) {
      if (product.priceCents > 0 && variants > 0 && images > 0) {
        product = await prisma.product.update({
          where: { id: product.id },
          // el primero del JSON aparece primero en "Más recientes"
          data: { status: "PUBLISHED", publishedAt: new Date(now - index * 1000) },
        });
        notes.push("publicado");
      } else {
        const missing = [product.priceCents > 0 ? null : "precio", variants > 0 ? null : "stock"].filter(Boolean);
        if (missing.length) notes.push(`borrador: falta ${missing.join(" y ")}`);
      }
    }

    const totalStock = await prisma.productVariant.aggregate({
      where: { productId: product.id },
      _sum: { stock: true },
    });
    report.push({
      producto: product.name,
      estado: product.status,
      precio: product.priceCents ? `S/ ${(product.priceCents / 100).toFixed(2)}` : "—",
      stock: totalStock._sum.stock ?? 0,
      notas: notes.join(", ") || "sin cambios",
    });
  }

  console.table(report);
  const drafts = report.filter((r) => r.estado === "DRAFT").length;
  if (drafts) {
    console.log(
      `\n${drafts} producto(s) en borrador. Ponles precio y stock en el panel (Productos) y pulsa "Publicar en la tienda",\n` +
        "o complétalos en server/catalog/productos.json y vuelve a ejecutar: npm run catalogo:importar\n",
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
