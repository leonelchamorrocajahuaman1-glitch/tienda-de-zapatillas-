import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../../db";
import { conflict, unauthorized } from "../../lib/errors";
import { dummyVerify, hashPassword, verifyPassword } from "../../lib/passwords";
import { parse } from "../../lib/validate";
import { clearSession, issueSession, requireCustomer } from "../../middleware/auth";

export const authRouter = Router();

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });

const email = z.string().trim().toLowerCase().email("Email inválido").max(160);
const password = z
  .string()
  .min(8, "La contraseña debe tener al menos 8 caracteres")
  .max(128)
  .regex(/[A-Za-z]/, "La contraseña debe incluir letras")
  .regex(/[0-9]/, "La contraseña debe incluir números");

const publicUser = (u: { id: string; email: string; name: string; phone: string | null; role: string }) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  phone: u.phone,
});

authRouter.post("/register", limiter, async (req, res) => {
  const body = parse(
    z.object({
      name: z.string().trim().min(2, "Ingresa tu nombre").max(120),
      email,
      password,
      phone: z.string().trim().max(30).optional().nullable(),
    }),
    req.body,
  );
  const exists = await prisma.user.findUnique({ where: { email: body.email } });
  if (exists) throw conflict("Ya existe una cuenta con ese email");
  const user = await prisma.user.create({
    data: {
      name: body.name,
      email: body.email,
      phone: body.phone || null,
      passwordHash: await hashPassword(body.password),
      role: "CUSTOMER", // el registro público NUNCA crea administradores
    },
  });
  issueSession(res, "store", user);
  res.status(201).json({ user: publicUser(user) });
});

authRouter.post("/login", limiter, async (req, res) => {
  const body = parse(z.object({ email, password: z.string().min(1).max(128) }), req.body);
  const user = await prisma.user.findUnique({ where: { email: body.email } });
  if (!user) {
    await dummyVerify(body.password);
    throw unauthorized("Email o contraseña incorrectos");
  }
  const ok = await verifyPassword(body.password, user.passwordHash);
  if (!ok || !user.isActive) throw unauthorized("Email o contraseña incorrectos");
  issueSession(res, "store", user);
  res.json({ user: publicUser(user) });
});

authRouter.post("/logout", (_req, res) => {
  clearSession(res, "store");
  res.json({ ok: true });
});

authRouter.get("/me", requireCustomer, async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  res.json({ user: publicUser(user) });
});

authRouter.patch("/me", requireCustomer, async (req, res) => {
  const body = parse(
    z.object({
      name: z.string().trim().min(2).max(120).optional(),
      phone: z.string().trim().max(30).optional().nullable(),
    }),
    req.body,
  );
  const user = await prisma.user.update({ where: { id: req.user!.id }, data: body });
  res.json({ user: publicUser(user) });
});
