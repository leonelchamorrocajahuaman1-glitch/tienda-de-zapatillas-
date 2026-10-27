export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }

  /** Errores de validación por campo devueltos por el servidor. */
  get fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    const out: Record<string, string> = {};
    for (const d of this.details as { path?: string; message?: string }[]) {
      if (d.path && d.message && !out[d.path]) out[d.path] = d.message;
    }
    return out;
  }
}

type Body = Record<string, unknown> | unknown[] | FormData | undefined;

/**
 * Cliente HTTP mínimo. Las cookies de sesión son httpOnly: el navegador las
 * envía solo, el código JavaScript nunca ve el token.
 */
export function createApi(base = "") {
  async function request<T>(method: string, path: string, body?: Body): Promise<T> {
    const isForm = typeof FormData !== "undefined" && body instanceof FormData;
    const res = await fetch(base + path, {
      method,
      credentials: "include",
      headers: body && !isForm ? { "Content-Type": "application/json" } : undefined,
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
    const text = await res.text();
    let data: unknown = undefined;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!res.ok) {
      const err = data as { error?: string; details?: unknown } | undefined;
      throw new ApiError(res.status, err?.error ?? `Error ${res.status}`, err?.details);
    }
    return data as T;
  }
  return {
    get: <T>(path: string) => request<T>("GET", path),
    post: <T>(path: string, body?: Body) => request<T>("POST", path, body ?? {}),
    put: <T>(path: string, body?: Body) => request<T>("PUT", path, body ?? {}),
    patch: <T>(path: string, body?: Body) => request<T>("PATCH", path, body ?? {}),
    del: <T>(path: string) => request<T>("DELETE", path),
  };
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof TypeError) return "No se pudo conectar con el servidor. ¿Está iniciada la API?";
  if (err instanceof Error) return err.message;
  return "Ocurrió un error inesperado";
}
