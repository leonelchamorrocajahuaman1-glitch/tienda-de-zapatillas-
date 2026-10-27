import fs from "node:fs";
import path from "node:path";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { config } from "./config";
import { errorHandler, notFoundHandler } from "./middleware/error";
import { serveUpload } from "./storage/uploads";
import { adminRouter } from "./routes/admin";
import { authRouter } from "./routes/public/auth";
import { cartRouter } from "./routes/public/cart";
import { catalogRouter } from "./routes/public/catalog";
import { ordersRouter } from "./routes/public/orders";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "same-site" },
      // HSTS y upgrade-insecure-requests solo tienen sentido detrás de HTTPS (producción)
      strictTransportSecurity: config.isProduction,
      contentSecurityPolicy: {
        directives: {
          upgradeInsecureRequests: config.isProduction ? [] : null,
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
          imgSrc: ["'self'", "data:", "blob:"],
          // gstatic: decodificadores Draco/KTX2 que <model-viewer> descarga si el modelo los usa
          connectSrc: ["'self'", "blob:", "data:", "https://www.gstatic.com"],
          workerSrc: ["'self'", "blob:"],
          mediaSrc: ["'self'", "blob:"],
        },
      },
    }),
  );
  if (config.corsOrigins.length) {
    app.use(cors({ origin: config.corsOrigins, credentials: true }));
  }
  app.use(express.json({ limit: "200kb" }));
  app.use(cookieParser());

  // Archivos subidos (imágenes y modelos 3D), guardados en la base de datos
  app.get("/uploads/:file", serveUpload);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  // API pública de la tienda
  app.use("/api/auth", authRouter);
  app.use("/api/catalog", catalogRouter);
  app.use("/api/cart", cartRouter);
  app.use("/api/orders", ordersRouter);

  // API privada del panel administrativo
  app.use("/api/admin", adminRouter);

  app.use("/api", notFoundHandler);

  // En producción la misma API sirve las dos aplicaciones compiladas:
  //   /admin/*  → panel administrativo
  //   /*        → tienda pública
  if (config.isProduction) {
    const serveSpa = (mount: string, dir: string) => {
      if (!fs.existsSync(dir)) return;
      app.use(mount, express.static(dir, { index: false, maxAge: "1h" }));
      app.get(mount === "/" ? "/{*splat}" : `${mount}{/*splat}`, (_req, res) => {
        res.sendFile(path.join(dir, "index.html"));
      });
    };
    serveSpa("/admin", config.adminDist);
    serveSpa("/", config.storeDist);
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
