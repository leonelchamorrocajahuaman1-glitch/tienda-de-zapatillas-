import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, errorMessage } from "@tienda/shared";
import { useAuth } from "../state/auth";
import { AuthLayout } from "../components/AuthLayout";
import { safeNext } from "./Login";

export default function RegisterPage() {
  const { register, user } = useAuth();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user && !busy) return <Navigate to={next} replace />;

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      await register({ ...form, phone: form.phone || undefined });
      navigate(next, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <h1 className="display">Crear cuenta</h1>
      <form className="form-grid" onSubmit={submit}>
        <div className="field">
          <label htmlFor="name">Nombre completo</label>
          <input id="name" className="input" autoComplete="name" required value={form.name} onChange={set("name")} />
          {errors.name && <span className="field-error">{errors.name}</span>}
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" className="input" type="email" autoComplete="email" required value={form.email} onChange={set("email")} />
          {errors.email && <span className="field-error">{errors.email}</span>}
        </div>
        <div className="field">
          <label htmlFor="phone">Teléfono (opcional)</label>
          <input id="phone" className="input" type="tel" autoComplete="tel" value={form.phone} onChange={set("phone")} />
        </div>
        <div className="field">
          <label htmlFor="password">Contraseña</label>
          <input id="password" className="input" type="password" autoComplete="new-password" required minLength={8} value={form.password} onChange={set("password")} />
          <span className="muted" style={{ fontSize: 12 }}>Mínimo 8 caracteres, con letras y números.</span>
          {errors.password && <span className="field-error">{errors.password}</span>}
        </div>
        {error && <div className="alert">{error}</div>}
        <button className="btn btn--primary btn--block" disabled={busy}>
          {busy ? "Creando cuenta…" : "Crear cuenta"}
        </button>
      </form>
      <p className="muted">
        ¿Ya tienes cuenta? <Link to={`/ingresar?next=${encodeURIComponent(next)}`} style={{ color: "var(--text)" }}>Ingresa</Link>
      </p>
    </AuthLayout>
  );
}
