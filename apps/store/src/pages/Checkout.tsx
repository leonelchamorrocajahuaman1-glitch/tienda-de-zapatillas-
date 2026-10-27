import { useMemo, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, errorMessage, type Order } from "@tienda/shared";
import { api, useStoreSettings, uuid } from "../lib/api";
import { useAuth } from "../state/auth";
import { useCart } from "../state/cart";
import { CartTotals } from "../components/CartLines";

type Field =
  | "shippingName"
  | "shippingPhone"
  | "shippingAddress"
  | "shippingDistrict"
  | "shippingCity"
  | "shippingReference"
  | "notes";

export default function CheckoutPage() {
  const { user } = useAuth();
  const { cart, loading, refresh } = useCart();
  const { data: settings } = useStoreSettings();
  const qc = useQueryClient();
  const navigate = useNavigate();
  // Una clave por intento de compra: si se envía dos veces no se duplica el pedido
  const idempotencyKey = useMemo(() => uuid(), []);
  const [form, setForm] = useState<Record<Field, string>>({
    shippingName: user?.name ?? "",
    shippingPhone: user?.phone ?? "",
    shippingAddress: "",
    shippingDistrict: "",
    shippingCity: "Lima",
    shippingReference: "",
    notes: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  if (!loading && cart.lines.length === 0 && !sending) return <Navigate to="/carrito" replace />;

  const set = (k: Field) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setError(null);
    setErrors({});
    try {
      const order = await api.post<Order>("/api/orders", {
        ...form,
        paymentMethod: "CASH_ON_DELIVERY",
        idempotencyKey,
      });
      qc.invalidateQueries({ queryKey: ["cart"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["product"] });
      navigate(`/cuenta/pedidos/${order.number}?nuevo=1`, { replace: true });
    } catch (err) {
      setSending(false);
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      setError(errorMessage(err));
      refresh();
    }
  }

  const input = (k: Field, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="field">
      <label htmlFor={k}>{label}</label>
      <input id={k} className="input" value={form[k]} onChange={set(k)} {...props} />
      {errors[k] && <span className="field-error">{errors[k]}</span>}
    </div>
  );

  return (
    <div className="page container">
      <h1 className="display page-title">Confirmar pedido</h1>
      <form className="two-col" onSubmit={submit}>
        <div className="form-grid">
          <h2 className="eyebrow">Datos de entrega</h2>
          <div className="form-grid form-grid--2">
            {input("shippingName", "Nombre de quien recibe", { required: true, autoComplete: "name" })}
            {input("shippingPhone", "Teléfono", { required: true, type: "tel", autoComplete: "tel", placeholder: "987 654 321" })}
          </div>
          {input("shippingAddress", "Dirección", { required: true, autoComplete: "street-address", placeholder: "Av. / Jr. / Calle, número, dpto." })}
          <div className="form-grid form-grid--2">
            {input("shippingDistrict", "Distrito", { required: true })}
            {input("shippingCity", "Ciudad / Provincia", { required: true })}
          </div>
          {input("shippingReference", "Referencia (opcional)", { placeholder: "Frente al parque…" })}
          <div className="field">
            <label htmlFor="notes">Notas para el pedido (opcional)</label>
            <textarea id="notes" className="textarea" value={form.notes} onChange={set("notes")} maxLength={500} />
          </div>

          <h2 className="eyebrow">Método de pago</h2>
          <label className="pay-option">
            <input type="radio" name="pay" checked readOnly />
            <span>
              <strong>{settings?.paymentMethods[0]?.label ?? "Pago contra entrega"}</strong>
              <br />
              <span className="muted">
                Pagas al recibir tu pedido. No se realiza ningún cobro en línea. El pago electrónico estará disponible más adelante.
              </span>
            </span>
          </label>
        </div>

        <aside className="panel summary">
          <h2 className="eyebrow">Tu pedido</h2>
          <div className="order-items">
            {cart.lines.map((l) => (
              <div key={l.variantId} className="order-item">
                {l.imageUrl ? <img src={l.imageUrl} alt="" /> : <div className="ph" />}
                <div>
                  <div>{l.productName}</div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    Talla {l.sizeLabel} · {l.colorName} · x{l.quantity}
                  </div>
                  {l.issue && <div className="field-error">{l.issue}</div>}
                </div>
              </div>
            ))}
          </div>
          <CartTotals cart={cart} />
          {error && <div className="alert">{error}</div>}
          <button className="btn btn--primary btn--block" type="submit" disabled={sending || !cart.canCheckout}>
            {sending ? "Registrando pedido…" : "Confirmar pedido"}
          </button>
          <Link to="/carrito" className="muted" style={{ fontSize: 13, textAlign: "center" }}>
            Volver al carrito
          </Link>
        </aside>
      </form>
    </div>
  );
}
