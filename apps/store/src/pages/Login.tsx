import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { errorMessage } from "@tienda/shared";
import { useAuth } from "../state/auth";
import { AuthLayout } from "../components/AuthLayout";

/** Solo se permiten rutas internas como destino tras iniciar sesión. */
export const safeNext = (next: string | null) => (next && next.startsWith("/") && !next.startsWith("//") ? next : "/cuenta");

export default function LoginPage() {
  const { login, user } = useAuth();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user && !busy) return <Navigate to={next} replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate(next, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <h1 className="display">Ingresar</h1>
      <form className="form-grid" onSubmit={submit}>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="password">Contraseña</label>
          <input id="password" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <div className="alert">{error}</div>}
        <button className="btn btn--primary btn--block" disabled={busy}>
          {busy ? "Ingresando…" : "Ingresar"}
        </button>
      </form>
      <p className="muted">
        ¿Primera vez? <Link to={`/registro?next=${encodeURIComponent(next)}`} style={{ color: "var(--text)" }}>Crea tu cuenta</Link>
      </p>
    </AuthLayout>
  );
}
