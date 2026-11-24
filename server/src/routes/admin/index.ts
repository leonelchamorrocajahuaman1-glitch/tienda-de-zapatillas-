import { Router } from "express";
import { requireAdmin } from "../../middleware/auth";
import { exportBackup } from "../../services/backup";
import { adminAuthRouter } from "./auth";
import { adminCustomersRouter } from "./customers";
import { adminOrdersRouter } from "./orders";
import { adminPrintingRouter } from "./printing";
import { adminProductsRouter } from "./products";
import { adminReportsRouter } from "./reports";
import { taxonomyRouter } from "./taxonomy";

/**
 * API del panel administrativo. Todo lo que no sea /auth/login exige una
 * sesión de administrador válida, verificada en el servidor en cada petición.
 */
export const adminRouter = Router();

adminRouter.use("/auth", adminAuthRouter);
adminRouter.use(requireAdmin);
adminRouter.use("/products", adminProductsRouter);
adminRouter.use("/orders", adminOrdersRouter);
adminRouter.use("/customers", adminCustomersRouter);
adminRouter.use("/taxonomy", taxonomyRouter);
adminRouter.use("/reports", adminReportsRouter);
adminRouter.use("/printing", adminPrintingRouter);

/**
 * Copia de seguridad completa (solo administradores): todas las tablas, fotos,
 * modelos 3D y boletas. Se importa en otra instalación (p. ej. XAMPP) con
 * npm run datos:importar.
 */
adminRouter.get("/backup", async (_req, res) => {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  res.setHeader("Content-Type", "application/gzip");
  res.setHeader("Content-Disposition", `attachment; filename="sole20-copia-${stamp}.jsonl.gz"`);
  res.setHeader("Cache-Control", "no-store");
  await exportBackup(res);
});
