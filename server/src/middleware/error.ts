import type { ErrorRequestHandler, RequestHandler } from "express";
import { Prisma } from "@prisma/client";
import multer from "multer";
import { HttpError } from "../lib/errors";

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: "Ruta no encontrada" });
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }
  if (err instanceof multer.MulterError) {
    const msg = err.code === "LIMIT_FILE_SIZE" ? "El archivo es demasiado grande" : `Error al subir el archivo: ${err.message}`;
    res.status(400).json({ error: msg });
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      res.status(409).json({ error: "Ya existe un registro con ese valor único", details: err.meta });
      return;
    }
    if (err.code === "P2025") {
      res.status(404).json({ error: "No encontrado" });
      return;
    }
    if (err.code === "P2003") {
      res.status(409).json({ error: "El registro está en uso y no se puede eliminar" });
      return;
    }
  }
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: "JSON inválido" });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Error interno del servidor" });
};
