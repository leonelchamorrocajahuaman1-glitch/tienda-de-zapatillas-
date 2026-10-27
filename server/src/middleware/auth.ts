import type { CookieOptions, NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { Role } from "@prisma/client";
import { config } from "../config";
import { prisma } from "../db";
import { forbidden, unauthorized } from "../lib/errors";

/**
 * Dos sesiones independientes:
 *  - "store": clientes en la tienda pública (cookie tz_store)
 *  - "admin": panel administrativo (cookie tz_admin, solo enviada a /api/admin,
 *             firmada con otro secreto y emitida únicamente a usuarios ADMIN)
 */
export type Scope = "store" | "admin";

const SCOPES = {
  store: { cookie: "tz_store", path: "/api", secret: () => config.jwtSecretStore, ttlSeconds: 60 * 60 * 24 * 7 },
  admin: { cookie: "tz_admin", path: "/api/admin", secret: () => config.jwtSecretAdmin, ttlSeconds: 60 * 60 * 8 },
} as const;

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

function cookieOptions(scope: Scope): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "strict",
    secure: config.isProduction,
    path: SCOPES[scope].path,
  };
}

export function issueSession(res: Response, scope: Scope, user: { id: string; role: Role }) {
  const s = SCOPES[scope];
  const token = jwt.sign({ sub: user.id, role: user.role, scope }, s.secret(), { expiresIn: s.ttlSeconds });
  res.cookie(s.cookie, token, { ...cookieOptions(scope), maxAge: s.ttlSeconds * 1000 });
}

export function clearSession(res: Response, scope: Scope) {
  res.clearCookie(SCOPES[scope].cookie, cookieOptions(scope));
}

async function resolveUser(req: Request, scope: Scope): Promise<AuthUser | null> {
  const s = SCOPES[scope];
  const token = req.cookies?.[s.cookie];
  if (!token) return null;
  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(token, s.secret()) as jwt.JwtPayload;
  } catch {
    return null;
  }
  if (payload.scope !== scope || typeof payload.sub !== "string") return null;
  // Se consulta la BD en cada petición: si se desactiva una cuenta o se le quita
  // el rol de administrador, pierde el acceso de inmediato.
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true, name: true, role: true, isActive: true },
  });
  if (!user || !user.isActive) return null;
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

/** Requiere sesión de cliente en la tienda. */
export async function requireCustomer(req: Request, _res: Response, next: NextFunction) {
  const user = await resolveUser(req, "store");
  if (!user) throw unauthorized();
  req.user = user;
  next();
}

/** Adjunta el cliente si hay sesión, sin exigirla. */
export async function optionalCustomer(req: Request, _res: Response, next: NextFunction) {
  req.user = (await resolveUser(req, "store")) ?? undefined;
  next();
}

/** Requiere sesión de administrador (cookie del panel + rol ADMIN en la BD). */
export async function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  const user = await resolveUser(req, "admin");
  if (!user) throw unauthorized("Sesión de administrador requerida");
  if (user.role !== "ADMIN") throw forbidden();
  req.user = user;
  next();
}
