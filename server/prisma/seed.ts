/**
 * Datos iniciales.
 * Solo crea datos de CONFIGURACIÓN (administrador, tallas, colores, categorías
 * y marcas base). NO crea productos ni pedidos falsos: los productos se
 * registran desde el panel administrativo.
 * Se puede ejecutar varias veces sin duplicar nada.
 */
import path from "node:path";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

dotenv.config({ path: path.resolve(__dirname, "../.env") });
const prisma = new PrismaClient();

const slugify = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) throw new Error("Define ADMIN_EMAIL y ADMIN_PASSWORD en server/.env");
  if (password.length < 10) throw new Error("ADMIN_PASSWORD debe tener al menos 10 caracteres");

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.role !== "ADMIN") {
      await prisma.user.update({ where: { email }, data: { role: "ADMIN", isActive: true } });
      console.log(`✔ ${email} ahora es administrador`);
    } else {
      console.log(`✔ Administrador ${email} ya existe (contraseña sin cambios)`);
    }
  } else {
    await prisma.user.create({
      data: {
        email,
        name: process.env.ADMIN_NAME || "Administrador",
        role: "ADMIN",
        passwordHash: await bcrypt.hash(password, 12),
      },
    });
    console.log(`✔ Administrador creado: ${email}`);
  }

  // Tallas EU habituales en Perú (35–45, incluidas medias tallas comunes)
  const sizes = ["35", "36", "37", "38", "38.5", "39", "40", "40.5", "41", "42", "42.5", "43", "44", "45"];
  for (const label of sizes) {
    await prisma.size.upsert({
      where: { label },
      update: {},
      create: { label, sortOrder: Math.round(Number.parseFloat(label) * 10) },
    });
  }

  const colors: [string, string][] = [
    ["Negro", "#111111"], ["Blanco", "#f5f5f5"], ["Rojo", "#d7261e"], ["Azul", "#1f4bd8"],
    ["Gris", "#8a8d91"], ["Verde", "#1f7a4d"], ["Beige", "#d9c7a7"], ["Marrón", "#6b4428"],
  ];
  for (const [name, hex] of colors) {
    await prisma.color.upsert({ where: { name }, update: {}, create: { name, hex } });
  }

  for (const name of ["Urbanas", "Running", "Basketball", "Training", "Skate"]) {
    await prisma.category.upsert({ where: { name }, update: {}, create: { name, slug: slugify(name) } });
  }

  // Marcas base (se pueden editar o eliminar desde el panel)
  for (const name of ["Nike", "Adidas", "Puma", "New Balance", "Converse", "Vans"]) {
    await prisma.brand.upsert({ where: { name }, update: {}, create: { name, slug: slugify(name) } });
  }

  console.log("✔ Tallas, colores, categorías y marcas base listos");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
