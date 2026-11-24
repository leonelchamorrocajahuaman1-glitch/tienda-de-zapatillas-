/**
 * Boletas de venta e impresión: emisión única, cola de impresión, agente,
 * reimpresión, reintentos y recuperación ante errores (sin duplicados).
 *
 *   TEST_DATABASE_URL=postgresql://.../tienda_zapatillas_test npm test
 */
import http from "node:http";
import { resetTestDb } from "./test-db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

const TEST_DB = process.env.TEST_DATABASE_URL;
const run = TEST_DB ? describe : describe.skip;

let app: Express;
let prisma: typeof import("../src/db").prisma;

const ADMIN = { email: "admin-boletas@tienda.local", password: "AdminBoletas123" };
const SHIPPING = {
  shippingName: "Lucía Prueba",
  shippingPhone: "987654321",
  shippingAddress: "Av. Larco 123",
  shippingDistrict: "Miraflores",
  shippingCity: "Lima",
};

run("Boletas e impresión", () => {
  let admin: ReturnType<typeof request.agent>;
  let customer: ReturnType<typeof request.agent>;
  let variantId: string;
  let agentToken: string;

  beforeAll(async () => {
    process.env.JWT_SECRET_STORE ??= "test-store-secret-0123456789abcdef";
    process.env.JWT_SECRET_ADMIN ??= "test-admin-secret-fedcba9876543210";
    prisma = await resetTestDb(TEST_DB!);
    const { createApp } = await import("../src/app");
    const { hashPassword } = await import("../src/lib/passwords");
    app = createApp();

    await prisma.user.create({
      data: { email: ADMIN.email, name: "Admin", role: "ADMIN", passwordHash: await hashPassword(ADMIN.password) },
    });
    const size = await prisma.size.create({ data: { label: "41", sortOrder: 410 } });
    const color = await prisma.color.create({ data: { name: "Negro", hex: "#111111" } });
    const brand = await prisma.brand.create({ data: { name: "Jordan", slug: "jordan" } });
    const product = await prisma.product.create({
      data: {
        name: "Air Jordan 1 High OG",
        slug: "air-jordan-1",
        brandId: brand.id,
        priceCents: 64990,
        discountPercent: 10,
        status: "PUBLISHED",
        publishedAt: new Date(),
        variants: { create: { sizeId: size.id, colorId: color.id, stock: 50 } },
      },
      include: { variants: true },
    });
    variantId = product.variants[0].id;

    admin = request.agent(app);
    expect((await admin.post("/api/admin/auth/login").send(ADMIN)).status).toBe(200);
    customer = request.agent(app);
    await customer.post("/api/auth/register").send({ name: "Lucía Prueba", email: "lucia@test.pe", password: "Lucia12345" });
  }, 90_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function placeOrder(quantity = 1) {
    await customer.post("/api/cart/items").send({ variantId, quantity });
    const res = await customer.post("/api/orders").send(SHIPPING);
    expect(res.status).toBe(201);
    return res.body as { id: string; number: number };
  }

  const setStatus = (orderId: string, status: string) =>
    admin.patch(`/api/admin/orders/${orderId}/status`).send({ status });

  const agentApi = (token = agentToken) => ({
    heartbeat: (body: object) => request(app).post("/api/print-agent/heartbeat").set("Authorization", `Bearer ${token}`).send(body),
    claim: () => request(app).post("/api/print-agent/jobs/claim").set("Authorization", `Bearer ${token}`).send({ waitMs: 0 }),
    result: (id: string, body: object) =>
      request(app).post(`/api/print-agent/jobs/${id}/result`).set("Authorization", `Bearer ${token}`).send(body),
  });

  const payloadText = (b64: string) => Buffer.from(b64, "base64").toString("latin1");

  async function downloadAgent(name: string) {
    const res = await admin
      .post("/api/admin/printing/agents/package")
      .send({ name, serverUrl: "http://localhost:4000" })
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    return { res, zip: res.body as Buffer, token: /"token": "([A-Za-z0-9_-]+)"/.exec((res.body as Buffer).toString("utf8"))![1] };
  }

  it("descarga el agente: ZIP con el programa y un token propio", async () => {
    const { res, zip, token } = await downloadAgent("PC caja");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/zip");
    expect(zip.subarray(0, 4).toString("hex")).toBe("504b0304");
    expect(zip.toString("utf8")).toContain("agente-impresion/agente-impresion.mjs");
    agentToken = token;
    expect(agentToken.length).toBeGreaterThan(30);
    // En la base solo queda el hash del token
    const agent = await prisma.printAgent.findFirstOrThrow({ where: { name: "PC caja" } });
    expect(agent.tokenHash).not.toContain(agentToken);
  });

  it("el agente se conecta y comparte la lista de impresoras de Windows", async () => {
    const hb = await agentApi().heartbeat({
      version: "1.0.0",
      hostname: "CAJA-01",
      printers: [{ name: "POS-80", driver: "POS-80 Printer", port: "USB001", isDefault: true }],
    });
    expect(hb.status).toBe(200);
    const status = await admin.get("/api/admin/printing/status");
    expect(status.body.agents[0].online).toBe(true);
    expect(status.body.agents[0].printers[0].name).toBe("POS-80");
    expect((await agentApi("token-falso").heartbeat({})).status).toBe(401);
  });

  it("seguridad: ni clientes ni el token del agente acceden al panel", async () => {
    expect((await customer.get("/api/admin/printing/receipts")).status).toBe(401);
    const asAgent = await request(app).get("/api/admin/printing/receipts").set("Authorization", `Bearer ${agentToken}`);
    expect(asAgent.status).toBe(401);
  });

  let receiptId: string;
  let orderId: string;

  it("un pedido PENDIENTE (pago sin verificar) no genera boleta", async () => {
    const order = await placeOrder();
    orderId = order.id;
    expect(await prisma.receipt.count()).toBe(0);
    expect((await admin.post(`/api/admin/printing/orders/${orderId}/receipt`).send({})).status).toBe(409);
  });

  it("al confirmar la compra se emite UNA boleta y se manda a imprimir", async () => {
    const [a, b] = await Promise.all([setStatus(orderId, "CONFIRMED"), setStatus(orderId, "CONFIRMED")]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const receipts = await prisma.receipt.findMany();
    expect(receipts).toHaveLength(1);
    expect(receipts[0].code).toBe("B001-00000001");
    receiptId = receipts[0].id;
    const jobs = await prisma.printJob.findMany();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ status: "PENDING", reason: "AUTO" });

    const detail = await admin.get(`/api/admin/orders/${orderId}`);
    expect(detail.body.receipt.code).toBe("B001-00000001");
    // Emitir a mano otra vez no crea otra boleta
    const again = await admin.post(`/api/admin/printing/orders/${orderId}/receipt`).send({});
    expect(again.status).toBe(200);
    expect(await prisma.receipt.count()).toBe(1);
  });

  it("dos agentes a la vez: solo uno recibe el trabajo", async () => {
    const second = (await downloadAgent("PC 2")).token;
    const [r1, r2] = await Promise.all([agentApi().claim(), agentApi(second).claim()]);
    const got = [r1, r2].filter((r) => r.status === 200);
    expect(got).toHaveLength(1);
    const job = got[0].body.job;
    expect(job.target).toEqual({ type: "windows", printerName: null });
    const text = payloadText(job.payloadBase64);
    expect(text).toContain("B001-00000001");
    expect(text).toContain("POR COBRAR"); // contra entrega: el pago aún no se cobró
    expect(text).toContain("Air Jordan 1 High OG");
    expect(text).toContain("\x1dV"); // corte de papel
    expect(text).not.toContain("COPIA");
    expect((await prisma.printJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("PRINTING");
    // informar el resultado (dos veces: es idempotente)
    const winner = got[0] === r1 ? agentApi() : agentApi(second);
    expect((await winner.result(job.id, { ok: true, printer: "POS-80" })).status).toBe(200);
    expect((await winner.result(job.id, { ok: true, printer: "POS-80" })).status).toBe(200);
    const done = await prisma.printJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(done).toMatchObject({ status: "PRINTED", printerLabel: "POS-80" });
    expect((await agentApi().claim()).status).toBe(204); // ya no queda nada
  });

  it("reimpresión: sale marcada como COPIA; si falla se reintenta UNA vez a mano", async () => {
    const re = await admin.post(`/api/admin/printing/receipts/${receiptId}/reprint`);
    expect(re.status).toBe(201);
    // No se puede pedir otra mientras está en curso
    expect((await admin.post(`/api/admin/printing/receipts/${receiptId}/reprint`)).status).toBe(409);

    const claim = await agentApi().claim();
    expect(payloadText(claim.body.job.payloadBase64)).toContain("COPIA");
    await agentApi().result(claim.body.job.id, { ok: false, error: "La impresora no tiene papel" });
    const failed = await prisma.printJob.findUniqueOrThrow({ where: { id: claim.body.job.id } });
    expect(failed).toMatchObject({ status: "FAILED", error: "La impresora no tiene papel" });

    // Un fallo NUNCA se reimprime solo
    expect((await agentApi().claim()).status).toBe(204);

    const [x, y] = await Promise.all([
      admin.post(`/api/admin/printing/jobs/${failed.id}/retry`),
      admin.post(`/api/admin/printing/jobs/${failed.id}/retry`),
    ]);
    expect([x.status, y.status].sort()).toEqual([201, 409]);
    const retry = await agentApi().claim();
    expect(retry.status).toBe(200);
    // El reintento de una reimpresión sigue saliendo como COPIA (la original ya se imprimió)
    expect(payloadText(retry.body.job.payloadBase64)).toContain("COPIA");
    await agentApi().result(retry.body.job.id, { ok: true });
    const list = await admin.get("/api/admin/printing/receipts");
    expect(list.body[0].printStatus).toBe("PRINTED");
  });

  it("si el agente se cae a mitad de impresión, queda FALLIDA y no se duplica", async () => {
    await admin.post(`/api/admin/printing/receipts/${receiptId}/reprint`);
    const claim = await agentApi().claim();
    const id = claim.body.job.id;
    await prisma.printJob.update({ where: { id }, data: { claimedAt: new Date(Date.now() - 3 * 60 * 1000) } });
    expect((await agentApi().claim()).status).toBe(204); // no se reentrega
    const stale = await prisma.printJob.findUniqueOrThrow({ where: { id } });
    expect(stale.status).toBe("FAILED");
    expect(stale.error).toMatch(/no confirmó/);
    // El agente vuelve y avisa tarde de que sí imprimió: se registra la verdad
    await agentApi().result(id, { ok: true });
    expect((await prisma.printJob.findUniqueOrThrow({ where: { id } })).status).toBe("PRINTED");
  });

  it("vista previa: ninguna línea excede el ancho del papel (58 y 80 mm)", async () => {
    for (const [paperWidth, cols] of [
      [58, 32],
      [80, 48],
    ]) {
      const prev = await admin.get(`/api/admin/printing/receipts/${receiptId}/preview?paperWidth=${paperWidth}`);
      expect(prev.body.cols).toBe(cols);
      for (const line of prev.body.lines) {
        if (line.type !== "text") continue;
        const max = line.size === "double" ? cols / 2 : cols;
        expect(line.text.length).toBeLessThanOrEqual(max);
      }
      // Diseño: TOTAL en franja invertida de ancho completo, estado del pago como sello,
      // separadores como líneas (no guiones de texto)
      const total = prev.body.lines.find((l: { text?: string }) => l.text?.includes("TOTAL"));
      expect(total).toMatchObject({ inverse: true, size: "tall" });
      expect(total.text).toHaveLength(cols);
      expect(prev.body.lines).toContainEqual(expect.objectContaining({ text: " POR COBRAR ", inverse: true }));
      expect(prev.body.lines.some((l: { type: string }) => l.type === "rule")).toBe(true);
      expect(prev.body.lines.some((l: { text?: string }) => l.text?.startsWith("-----"))).toBe(false);
    }
    const logo = await admin.get("/api/admin/printing/logo-preview.png?paperWidth=58");
    expect(logo.headers["content-type"]).toBe("image/png");
  });

  it("modo 'pago verificado': la boleta se emite al entregar (cobrado) y dice PAGADO", async () => {
    const settings = await admin.get("/api/admin/printing/settings");
    const { id: _i, updatedAt: _u, logoUrl: _l, effectiveStoreName: _e, printerLabel: _p, ...rest } = settings.body;
    const put = await admin.put("/api/admin/printing/settings").send({ ...rest, trigger: "ON_PAID", series: "B002" });
    expect(put.status).toBe(200);

    const order = await placeOrder();
    await setStatus(order.id, "CONFIRMED");
    expect(await prisma.receipt.count({ where: { orderId: order.id } })).toBe(0);
    await setStatus(order.id, "PREPARING");
    await setStatus(order.id, "SHIPPED");
    expect(await prisma.receipt.count({ where: { orderId: order.id } })).toBe(0);
    await setStatus(order.id, "DELIVERED");
    const receipt = await prisma.receipt.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(receipt.code).toBe("B002-00000001");
    const claim = await agentApi().claim();
    expect(payloadText(claim.body.job.payloadBase64)).toContain("PAGADO");
    await agentApi().result(claim.body.job.id, { ok: true });

    await admin.put("/api/admin/printing/settings").send({ ...rest, trigger: "ON_CONFIRMED", autoPrint: false });
  });

  it("si se cancela el pedido, la boleta queda ANULADA", async () => {
    const order = await placeOrder();
    await setStatus(order.id, "CONFIRMED");
    const receipt = await prisma.receipt.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(await prisma.printJob.count({ where: { receiptId: receipt.id } })).toBe(0); // autoPrint desactivado
    await setStatus(order.id, "CANCELLED");
    const voided = await prisma.receipt.findUniqueOrThrow({ where: { id: receipt.id } });
    expect(voided.voidedAt).not.toBeNull();
    const prev = await admin.get(`/api/admin/printing/receipts/${receipt.id}/preview`);
    expect(prev.body.lines.some((l: { text?: string }) => l.text?.includes("ANULADA"))).toBe(true);
  });

  it("impresión de prueba y agente revocado", async () => {
    expect((await admin.post("/api/admin/printing/test")).status).toBe(201);
    expect((await admin.post("/api/admin/printing/test")).status).toBe(409);
    const claim = await agentApi().claim();
    expect(claim.body.job.kind).toBe("TEST");
    expect(payloadText(claim.body.job.payloadBase64)).toContain("IMPRESI");
    await agentApi().result(claim.body.job.id, { ok: true });

    const agent = await prisma.printAgent.findFirstOrThrow({ where: { name: "PC caja" } });
    await admin.delete(`/api/admin/printing/agents/${agent.id}`);
    expect((await agentApi().heartbeat({})).status).toBe(401);
  });

  it("central de impresión externa: envía texto con sus tokens, sin duplicar en reintentos", async () => {
    // Central simulada: misma API que la real (POST /api/jobs, deduplica por source + external_id)
    type Received = { headers: http.IncomingHttpHeaders; body: Record<string, unknown> };
    const received: Received[] = [];
    const stored = new Set<string>();
    let mode: "ok" | "lost-response" | "unauthorized" = "ok";
    const server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (d) => (raw += d));
      req.on("end", () => {
        const body = JSON.parse(raw);
        received.push({ headers: req.headers, body });
        if (mode === "unauthorized") return void res.writeHead(401).end("token inválido");
        const key = `${body.source}|${body.external_id}`;
        const duplicate = stored.has(key);
        stored.add(key);
        if (mode === "lost-response") return void res.writeHead(503).end(); // la recibió, pero la respuesta se pierde
        res.writeHead(duplicate ? 200 : 201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ job: { id: `c${stored.size}`, status: "queued" }, duplicate }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;

    const current = (await admin.get("/api/admin/printing/settings")).body;
    const { id: _id, updatedAt: _u, logoUrl: _l, effectiveStoreName: _e, printerLabel: _p, central: _c, ...editable } = current;
    const useCentral = { ...editable, enabled: true, autoPrint: true, trigger: "ON_CONFIRMED", connection: "central", paperWidth: 58, copies: 2 };

    // Sin credenciales en el servidor no se puede activar
    const missing = await admin.put("/api/admin/printing/settings").send(useCentral);
    expect(missing.status).toBe(400);
    expect(missing.body.error).toMatch(/CENTRAL_PRINT_URL/);

    process.env.CENTRAL_PRINT_URL = `http://127.0.0.1:${port}/api/jobs`;
    process.env.CENTRAL_SITE_TOKEN = "site-token-de-prueba";
    process.env.CENTRAL_SUBMIT_TOKEN = "submit-token-de-prueba";
    const waitJob = async (where: object) => {
      for (let i = 0; i < 150; i++) {
        const job = await prisma.printJob.findFirst({ where, orderBy: { createdAt: "desc" } });
        if (job && (job.status === "PRINTED" || job.status === "FAILED")) return job;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error("el trabajo no terminó");
    };

    try {
      const saved = await admin.put("/api/admin/printing/settings").send(useCentral);
      expect(saved.status).toBe(200);
      expect(saved.body.central.host).toBe(`127.0.0.1:${port}`);
      expect(JSON.stringify(saved.body)).not.toContain("token-de-prueba"); // los tokens no salen del servidor

      // 1) Compra confirmada → se envía sola a la central
      const order = await placeOrder();
      await setStatus(order.id, "CONFIRMED");
      const receipt = await prisma.receipt.findUniqueOrThrow({ where: { orderId: order.id } });
      const first = await waitJob({ receiptId: receipt.id });
      expect(first.status).toBe("PRINTED");
      const sent = received.at(-1)!;
      expect(sent.headers["oai-sites-authorization"]).toBe("Bearer site-token-de-prueba");
      expect(sent.headers.authorization).toBe("Bearer submit-token-de-prueba");
      expect(sent.body).toMatchObject({ external_id: receipt.code, title: `Boleta ${receipt.code}`, copies: 2 });
      const content = String(sent.body.content);
      expect(content).toContain(receipt.code);
      expect(content).toContain("[ POR COBRAR ]");
      expect(content).toMatch(/TOTAL +S\/ /);
      expect(content).not.toMatch(/[\x00-\x09\x0b-\x1f]/); // solo texto, sin comandos ESC/POS
      expect(content.split("\n").every((l) => l.length <= 32)).toBe(true); // papel de 58 mm

      // 2) Reimpresión → referencia nueva (la central sí la imprime) y marcada como COPIA
      await admin.post(`/api/admin/printing/receipts/${receipt.id}/reprint`);
      const copy = await waitJob({ receiptId: receipt.id, reason: "REPRINT" });
      expect(copy.status).toBe("PRINTED");
      expect(received.at(-1)!.body.external_id).toMatch(new RegExp(`^${receipt.code}-COPIA-`));
      expect(received.at(-1)!.body.title).toContain("(COPIA)");

      // 3) La central recibe el comprobante pero la respuesta se pierde → FALLIDA (tras 3 intentos con la misma referencia)
      mode = "lost-response";
      const order2 = await placeOrder();
      await setStatus(order2.id, "CONFIRMED");
      const receipt2 = await prisma.receipt.findUniqueOrThrow({ where: { orderId: order2.id } });
      const lost = await waitJob({ receiptId: receipt2.id });
      expect(lost.status).toBe("FAILED");
      expect(lost.error).toMatch(/Reintentar es seguro/);
      expect(received.filter((r) => r.body.external_id === receipt2.code)).toHaveLength(3);
      // …al reintentar se reenvía con la MISMA referencia: la central no la imprime otra vez
      mode = "ok";
      await admin.post(`/api/admin/printing/jobs/${lost.id}/retry`);
      const retried = await waitJob({ receiptId: receipt2.id, reason: "RETRY" });
      expect(retried.status).toBe("PRINTED");
      expect(retried.printerLabel).toContain("ya estaba en la central");
      expect([...stored].filter((k) => k.endsWith(`|${receipt2.code}`))).toHaveLength(1);

      // 4) Credenciales rechazadas → FALLIDA con un mensaje claro, sin insistir
      mode = "unauthorized";
      const before = received.length;
      expect((await admin.post("/api/admin/printing/test")).status).toBe(201);
      const test = await waitJob({ kind: "TEST", status: { in: ["PRINTED", "FAILED"] }, createdAt: { gt: retried.createdAt } });
      expect(test.status).toBe("FAILED");
      expect(test.error).toMatch(/credenciales/);
      expect(received.length - before).toBe(1);

      // 5) Con la central activa, el agente propio no toma trabajos
      const { token } = await downloadAgent("PC central");
      await prisma.printJob.create({ data: { kind: "TEST", reason: "TEST", status: "PENDING" } });
      mode = "ok";
      expect((await agentApi(token).claim()).status).toBe(204);
    } finally {
      delete process.env.CENTRAL_PRINT_URL;
      delete process.env.CENTRAL_SITE_TOKEN;
      delete process.env.CENTRAL_SUBMIT_TOKEN;
      await prisma.receiptSettings.update({ where: { id: 1 }, data: { connection: "windows" } });
      server.close();
    }
  }, 60_000);
});

describe("ESC/POS", () => {
  it("codifica acentos y ñ según la tabla de caracteres", async () => {
    const { encodeText, wrap, row } = await import("../src/services/escpos");
    expect([...encodeText("ñ", "cp850")]).toEqual([0xa4]);
    expect([...encodeText("ñ", "cp1252")]).toEqual([0xf1]);
    expect(encodeText("Envío", "ascii").toString("ascii")).toBe("Envio");
    expect(wrap("Air Jordan 1 High OG Retro Chicago", 16).every((l) => l.length <= 16)).toBe(true);
    expect(row("TOTAL", "S/ 659.90", 32)).toHaveLength(32);
  });

  it("texto invertido y separadores como imagen a todo el ancho del papel", async () => {
    const { encodeEscPos, ruleRaster, bar } = await import("../src/services/escpos");
    for (const [cols, dots] of [
      [32, 384],
      [48, 576],
    ]) {
      const out = encodeEscPos(
        [
          { type: "text", text: bar("BOLETA DE VENTA", cols), inverse: true, bold: true },
          { type: "rule", style: "dashed" },
        ],
        { cols, charset: "cp850", logo: null, cut: false, copies: 1 },
      );
      const bin = out.toString("latin1");
      expect(bin).toContain("\x1dB\x01"); // invertido activado…
      expect(bin).toContain("\x1dB\x00"); // …y desactivado después
      expect(bin).not.toContain("-".repeat(cols)); // ya no hay guiones de texto
      // GS v 0 con el ancho exacto del papel (bytes por fila = puntos / 8)
      expect(bin).toContain(`\x1dv0\x00${String.fromCharCode(dots / 8)}\x00`);
      for (const style of ["solid", "dashed", "double", "thick"] as const) {
        const r = ruleRaster(style, dots);
        expect(r.width).toBe(dots);
        expect(r.data.length).toBe((dots / 8) * r.height);
        expect(r.data.some((b) => b !== 0)).toBe(true);
      }
    }
  });
});
