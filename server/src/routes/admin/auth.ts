import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../../db";
import { unauthorized } from "../../lib/errors";
import { dummyVerify, hashPassword, verifyPassword } from "../../lib/passwords";
import { parse } from "../../lib/validate";
import { clearSession, issueSession, requireAdmin } from "../../middleware/auth";

export const adminAuthRouter = Router();

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });

adminAuthRouter.post("/login", limiter, async (req, res) => {
  const body = parse(
    z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(128) }),
    req.body,
  );
  const user = await prisma.user.findUnique({ where: { email: body.email } });
  if (!user) {
    await dummyVerify(body.password);
    throw unauthorized("Credenciales incorrectas");
  }
  const ok = await verifyPassword(body.password, user.passwordHash);
  // Mismo mensaje para clientes y contraseñas erróneas: no revela qué cuentas son admin.
  if (!ok || !user.isActive || user.role !== "ADMIN") throw unauthorized("Credenciales incorrectas");
  issueSession(res, "admin", user);
  res.json({ user: { id: user.id, email: user.email, name: user.name } });
});

adminAuthRouter.post("/logout", (_req, res) => {
  clearSession(res, "admin");
  res.json({ ok: true });
});

adminAuthRouter.get("/me", requireAdmin, (req, res) => {
  res.json({ user: req.user });
});

adminAuthRouter.post("/password", requireAdmin, async (req, res) => {
  const body = parse(
    z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(10, "Mínimo 10 caracteres").max(128),
    }),
    req.body,
  );
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (!(await verifyPassword(body.currentPassword, user.passwordHash))) {
    throw unauthorized("La contraseña actual no es correcta");
  }
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(body.newPassword) } });
  res.json({ ok: true });
});
