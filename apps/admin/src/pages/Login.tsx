import { useState } from "react";
import { errorMessage } from "@tienda/shared";
import { useAdminAuth } from "../lib/auth";
import { STORE_NAME } from "../lib/api";

export function LoginPage() {
  const { login } = useAdminAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="card login__box" onSubmit={submit}>
        <div className="brand" style={{ padding: 0 }}>
          <span className="brand__mark" aria-hidden />
          <div>
            <div className="brand__name">{STORE_NAME}</div>
            <div className="brand__tag">PANEL ADMINISTRATIVO</div>
          </div>
        </div>
        <h1 className="display">Acceso privado</h1>
        <p className="muted" style={{ margin: 0 }}>
          Solo para administradores. Las cuentas de clientes no tienen acceso.
        </p>
        <div className="field">
          <label className="label" htmlFor="email">
            Email
          </label>
          <input id="email" className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="password">
            Contraseña
          </label>
          <input id="password" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <div className="alert">{error}</div>}
        <button className="btn btn--primary" disabled={busy}>
          {busy ? "Verificando…" : "Entrar al panel"}
        </button>
      </form>
    </div>
  );
}
