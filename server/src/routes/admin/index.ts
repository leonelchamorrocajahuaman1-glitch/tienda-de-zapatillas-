import { Router } from "express";
import { requireAdmin } from "../../middleware/auth";
import { adminAuthRouter } from "./auth";
import { adminCustomersRouter } from "./customers";
import { adminOrdersRouter } from "./orders";
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
