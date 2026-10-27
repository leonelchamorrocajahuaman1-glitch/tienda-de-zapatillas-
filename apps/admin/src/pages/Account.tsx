import { useState } from "react";
import { errorMessage } from "@tienda/shared";
import { api } from "../lib/api";
import { useAdminAuth } from "../lib/auth";
import { useToast } from "../components/Toast";

export function AccountPage() {
  const { user } = useAdminAuth();
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/api/admin/auth/password", { currentPassword: current, newPassword: next });
      setCurrent("");
      setNext("");
      toast("Contraseña actualizada");
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="label">Seguridad</div>
          <h1 className="display">Mi cuenta</h1>
          <span className="muted">{user?.name} · {user?.email}</span>
        </div>
      </div>
      <form className="card" style={{ maxWidth: 480 }} onSubmit={submit}>
        <div className="card__head"><h2>Cambiar contraseña</h2></div>
        <div className="card__body form-grid">
          <div className="field">
            <label className="label" htmlFor="cur">Contraseña actual</label>
            <input id="cur" className="input" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor="new">Nueva contraseña</label>
            <input id="new" className="input" type="password" autoComplete="new-password" required minLength={10} value={next} onChange={(e) => setNext(e.target.value)} />
            <span className="hint">Mínimo 10 caracteres.</span>
          </div>
          <button className="btn btn--primary" disabled={busy}>{busy ? "Guardando…" : "Actualizar contraseña"}</button>
        </div>
      </form>
    </>
  );
}
