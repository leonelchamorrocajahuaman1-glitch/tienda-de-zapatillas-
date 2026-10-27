export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, details);
export const unauthorized = (msg = "Debes iniciar sesión") => new HttpError(401, msg);
export const forbidden = (msg = "No tienes permiso para realizar esta acción") => new HttpError(403, msg);
export const notFound = (msg = "No encontrado") => new HttpError(404, msg);
export const conflict = (msg: string, details?: unknown) => new HttpError(409, msg, details);
