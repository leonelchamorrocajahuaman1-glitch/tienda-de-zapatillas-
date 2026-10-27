/**
 * Prueba de extremo a extremo del flujo obligatorio contra una base de datos
 * PostgreSQL de PRUEBAS (TEST_DATABASE_URL). Nunca usa la base de datos real.
 *
 *   TEST_DATABASE_URL=postgresql://.../tienda_zapatillas_test npm test
 */
import { execSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

const TEST_DB = process.env.TEST_DATABASE_URL;
const run = TEST_DB ? describe : describe.skip;

let app: Express;
let prisma: typeof import("../src/db").prisma;

const ADMIN = { email: "admin-test@tienda.local", password: "AdminTest12345" };

// PNG de 1×1 píxel
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** GLB mínimo válido (solo un nodo vacío): sirve para probar la subida, no es un modelo de zapatilla. */
function minimalGlb(): Buffer {
  let json = Buffer.from(JSON.stringify({ asset: { version: "2.0" }, scenes: [{ nodes: [0] }], nodes: [{}] }));
  const pad = (4 - (json.length % 4)) % 4;
  json = Buffer.concat([json, Buffer.alloc(pad, 0x20)]);
  const header = Buffer.alloc(12);
  header.write("glTF", 0, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length, 8);
  const chunk = Buffer.alloc(8);
  chunk.writeUInt32LE(json.length, 0);
  chunk.write("JSON", 4, "ascii");
  return Buffer.concat([header, chunk, json]);
}

run("Flujo completo tienda + panel sobre la misma base de datos", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.UPLOADS_DIR = path.join(os.tmpdir(), `tienda-test-uploads-${process.pid}`);
    process.env.JWT_SECRET_STORE ??= "test-store-secret-0123456789abcdef";
    process.env.JWT_SECRET_ADMIN ??= "test-admin-secret-fedcba9876543210";
    const env = { ...process.env, DATABASE_URL: TEST_DB! };
    const cwd = path.resolve(__dirname, "..");
    if (!/_test(\?|$)/.test(new URL(TEST_DB!).pathname + "")) {
      throw new Error("Por seguridad, TEST_DATABASE_URL debe apuntar a una base cuyo nombre termine en _test");
    }
    execSync("npx prisma migrate deploy", { cwd, env, stdio: "ignore" });

    ({ prisma } = await import("../src/db"));
    // Base de pruebas: se vacía antes de cada ejecución.
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(
      `TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`,
    );
    const { createApp } = await import("../src/app");
    const { hashPassword } = await import("../src/lib/passwords");
    app = createApp();

    await prisma.user.create({
      data: { email: ADMIN.email, name: "Admin Test", role: "ADMIN", passwordHash: await hashPassword(ADMIN.password) },
    });
    await prisma.size.createMany({ data: [{ label: "40", sortOrder: 400 }, { label: "41", sortOrder: 410 }] });
    await prisma.color.create({ data: { name: "Negro", hex: "#111111" } });
    await prisma.brand.create({ data: { name: "Urban Lab", slug: "urban-lab" } });
    await prisma.category.create({ data: { name: "Urbanas", slug: "urbanas" } });
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const admin = () => request.agent(app);
  let adminAgent: ReturnType<typeof request.agent>;
  let customer: ReturnType<typeof request.agent>;
  let productId: string;
  let variant40: string;
  let orderNumber: number;
  let orderId: string;

  it("1. el administrador inicia sesión en el panel", async () => {
    adminAgent = admin();
    const res = await adminAgent.post("/api/admin/auth/login").send(ADMIN);
    expect(res.status).toBe(200);
    expect((await adminAgent.get("/api/admin/auth/me")).status).toBe(200);
  });

  it("2-4. registra Urban X a S/ 199.90 con tallas y existencias", async () => {
    const [brand, category, sizes, colors] = await Promise.all([
      prisma.brand.findFirstOrThrow(),
      prisma.category.findFirstOrThrow(),
      prisma.size.findMany({ orderBy: { sortOrder: "asc" } }),
      prisma.color.findFirstOrThrow(),
    ]);
    const created = await adminAgent.post("/api/admin/products").send({
      name: "Urban X",
      price: 199.9,
      brandId: brand.id,
      categoryId: category.id,
      tagline: "Born from the streets",
      description: "Zapatilla urbana",
      featured: true,
    });
    expect(created.status).toBe(201);
    expect(created.body.priceCents).toBe(19990);
    expect(created.body.status).toBe("DRAFT");
    productId = created.body.id;

    const inv = await adminAgent.put(`/api/admin/products/${productId}/variants`).send({
      variants: [
        { sizeId: sizes[0].id, colorId: colors.id, stock: 5 },
        { sizeId: sizes[1].id, colorId: colors.id, stock: 1 },
      ],
    });
    expect(inv.status).toBe(200);
    variant40 = inv.body.variants.find((v: { size: { label: string } }) => v.size.label === "40").id;
  });

  it("no se puede publicar sin imagen ni modelo", async () => {
    const res = await adminAgent.post(`/api/admin/products/${productId}/status`).send({ status: "PUBLISHED" });
    expect(res.status).toBe(400);
  });

  it("5. sube imagen y modelo 3D", async () => {
    const img = await adminAgent
      .post(`/api/admin/products/${productId}/images`)
      .attach("images", PNG, { filename: "urban-x.png", contentType: "image/png" });
    expect(img.status).toBe(201);
    expect(img.body.images).toHaveLength(1);

    const fake = await adminAgent
      .post(`/api/admin/products/${productId}/images`)
      .attach("images", Buffer.from("no soy una imagen"), { filename: "x.png", contentType: "image/png" });
    expect(fake.status).toBe(400);

    const model = await adminAgent
      .post(`/api/admin/products/${productId}/model`)
      .attach("model", minimalGlb(), { filename: "urban-x.glb", contentType: "model/gltf-binary" });
    expect(model.status).toBe(201);
    expect(model.body.modelUrl).toMatch(/^\/uploads\/models\/.+\.glb$/);
  });

  it("6-7. lo publica y aparece en el catálogo de la tienda", async () => {
    const before = await request(app).get("/api/catalog/products");
    expect(before.body.items).toHaveLength(0);

    const pub = await adminAgent.post(`/api/admin/products/${productId}/status`).send({ status: "PUBLISHED" });
    expect(pub.status).toBe(200);

    const list = await request(app).get("/api/catalog/products?q=urban");
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].finalPriceCents).toBe(19990);
  });

  it("8. el cliente consulta el detalle", async () => {
    const res = await request(app).get("/api/catalog/products/urban-x");
    expect(res.status).toBe(200);
    expect(res.body.variants.find((v: { id: string }) => v.id === variant40).available).toBe(5);
    expect(res.body.modelUrl).toBeTruthy();
  });

  it("seguridad: un cliente no puede usar el panel ni cambiar precios", async () => {
    customer = request.agent(app);
    const reg = await customer
      .post("/api/auth/register")
      .send({ name: "Cliente Uno", email: "cliente1@test.pe", password: "Cliente123" });
    expect(reg.status).toBe(201);

    expect((await customer.get("/api/admin/products")).status).toBe(401);
    expect((await customer.patch(`/api/admin/products/${productId}`).send({ price: 1 })).status).toBe(401);
    // El login del panel rechaza cuentas de cliente
    const asAdmin = await customer.post("/api/admin/auth/login").send({ email: "cliente1@test.pe", password: "Cliente123" });
    expect(asAdmin.status).toBe(401);
    // El registro público ignora cualquier intento de asignarse un rol
    const sneaky = await request(app)
      .post("/api/auth/register")
      .send({ name: "Pirata", email: "pirata@test.pe", password: "Pirata1234", role: "ADMIN" });
    expect(sneaky.status).toBe(201);
    expect((await prisma.user.findUniqueOrThrow({ where: { email: "pirata@test.pe" } })).role).toBe("CUSTOMER");
  });

  it("9-11. añade al carrito, confirma el pedido y queda registrado (precio del servidor)", async () => {
    const add = await customer.post("/api/cart/items").send({ variantId: variant40, quantity: 2, priceCents: 1 });
    expect(add.status).toBe(200);
    expect(add.body.lines[0].unitPriceCents).toBe(19990);

    const order = await customer.post("/api/orders").send({
      shippingName: "Cliente Uno",
      shippingPhone: "987654321",
      shippingAddress: "Av. Siempre Viva 123",
      shippingDistrict: "Miraflores",
      shippingCity: "Lima",
      totalCents: 100, // se ignora
      idempotencyKey: "5f0b8f6e-6d3b-4c1e-9b9a-2f0d6a8f1c11",
    });
    expect(order.status).toBe(201);
    expect(order.body.status).toBe("PENDING");
    expect(order.body.totalCents).toBe(19990 * 2); // >= S/ 300: envío gratis
    expect(order.body.items[0].unitPriceCents).toBe(19990);
    orderNumber = order.body.number;
    orderId = order.body.id;

    // Doble envío con la misma clave: no duplica el pedido
    const again = await customer.post("/api/orders").send({
      shippingName: "Cliente Uno",
      shippingPhone: "987654321",
      shippingAddress: "Av. Siempre Viva 123",
      shippingDistrict: "Miraflores",
      shippingCity: "Lima",
      idempotencyKey: "5f0b8f6e-6d3b-4c1e-9b9a-2f0d6a8f1c11",
    });
    expect(again.body.id).toBe(orderId);
    expect(await prisma.order.count()).toBe(1);

    const v = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant40 } });
    expect(v.stock).toBe(5);
    expect(v.reserved).toBe(2);
    const detail = await request(app).get("/api/catalog/products/urban-x");
    expect(detail.body.variants.find((x: { id: string }) => x.id === variant40).available).toBe(3);

    const mine = await customer.get("/api/orders");
    expect(mine.body).toHaveLength(1);
  });

  it("un cliente no puede ver pedidos ajenos", async () => {
    const other = request.agent(app);
    await other.post("/api/auth/register").send({ name: "Cliente Dos", email: "cliente2@test.pe", password: "Cliente123" });
    expect((await other.get(`/api/orders/${orderNumber}`)).status).toBe(404);
    expect((await other.post(`/api/orders/${orderNumber}/cancel`)).status).toBe(404);
  });

  it("12-13. el admin ve el pedido y al confirmarlo se descuenta el stock una sola vez", async () => {
    const list = await adminAgent.get("/api/admin/orders");
    expect(list.body.items.map((o: { id: string }) => o.id)).toContain(orderId);

    const confirm = await adminAgent.patch(`/api/admin/orders/${orderId}/status`).send({ status: "CONFIRMED" });
    expect(confirm.status).toBe(200);
    let v = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant40 } });
    expect(v.stock).toBe(3);
    expect(v.reserved).toBe(0);

    const twice = await adminAgent.patch(`/api/admin/orders/${orderId}/status`).send({ status: "CONFIRMED" });
    expect(twice.status).toBe(409);
    v = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant40 } });
    expect(v.stock).toBe(3);

    // El cliente ya no puede cancelar un pedido confirmado
    expect((await customer.post(`/api/orders/${orderNumber}/cancel`)).status).toBe(409);

    // Cancelación por el admin tras confirmar: las unidades vuelven al almacén
    const cancel = await adminAgent.patch(`/api/admin/orders/${orderId}/status`).send({ status: "CANCELLED" });
    expect(cancel.status).toBe(200);
    v = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant40 } });
    expect(v.stock).toBe(5);
    const movements = await prisma.inventoryMovement.findMany({ where: { orderId } });
    expect(movements.map((m) => m.type).sort()).toEqual(["COMMIT", "RESERVE", "RESTOCK"]);
  });

  it("dos clientes compiten por la última unidad: solo uno la obtiene", async () => {
    const variant41 = (await prisma.productVariant.findFirstOrThrow({ where: { productId, size: { label: "41" } } })).id;
    const buyers = await Promise.all(
      ["a", "b"].map(async (k) => {
        const agent = request.agent(app);
        await agent.post("/api/auth/register").send({ name: `Rival ${k}`, email: `rival-${k}@test.pe`, password: "Rival12345" });
        await agent.post("/api/cart/items").send({ variantId: variant41, quantity: 1 });
        return agent;
      }),
    );
    const shipping = {
      shippingName: "Rival",
      shippingPhone: "999888777",
      shippingAddress: "Jr. Prueba 1",
      shippingDistrict: "Surco",
      shippingCity: "Lima",
    };
    const results = await Promise.all(buyers.map((b) => b.post("/api/orders").send(shipping)));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const v = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant41 } });
    expect(v.reserved).toBe(1);
    expect(v.stock - v.reserved).toBe(0);
  });

  it("los cambios de precio del admin se reflejan en la tienda y se guarda el historial", async () => {
    const res = await adminAgent.patch(`/api/admin/products/${productId}`).send({ price: 179.9, discountPercent: 10 });
    expect(res.status).toBe(200);
    expect(res.body.priceHistory).toHaveLength(2);
    const detail = await request(app).get("/api/catalog/products/urban-x");
    expect(detail.body.finalPriceCents).toBe(16191);
    // El pedido antiguo conserva el precio con el que se vendió
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId } });
    expect(item.unitPriceCents).toBe(19990);
  });

  it("el stock no puede bajar de lo reservado por pedidos pendientes", async () => {
    const detail = await adminAgent.get(`/api/admin/products/${productId}`);
    const variants = detail.body.variants.map((v: { sizeId: string; colorId: string; size: { label: string } }) => ({
      sizeId: v.sizeId,
      colorId: v.colorId,
      stock: v.size.label === "41" ? 0 : 5,
    }));
    const res = await adminAgent.put(`/api/admin/products/${productId}/variants`).send({ variants });
    expect(res.status).toBe(409);
  });

  it("despublicar oculta el producto de la tienda", async () => {
    await adminAgent.post(`/api/admin/products/${productId}/status`).send({ status: "DRAFT" });
    expect((await request(app).get("/api/catalog/products/urban-x")).status).toBe(404);
  });
});
