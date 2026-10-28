import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage, formatDate, formatMoney, orderCode } from "@tienda/shared";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import { Modal, ReceiptPaper, printInBrowser, type Preview } from "../components/ReceiptPreview";

// ───────────────────────── Tipos ─────────────────────────

type JobStatus = "PENDING" | "PRINTING" | "PRINTED" | "FAILED" | "CANCELLED";

interface Settings {
  enabled: boolean;
  autoPrint: boolean;
  trigger: "ON_CONFIRMED" | "ON_PAID";
  paperWidth: 58 | 80;
  connection: "windows" | "network";
  printerName: string | null;
  networkHost: string | null;
  networkPort: number;
  agentId: string | null;
  charset: "cp850" | "cp1252" | "ascii";
  cutPaper: boolean;
  printLogo: boolean;
  logoUrl: string | null;
  copies: number;
  storeName: string | null;
  title: string;
  series: string;
  headerLines: string;
  footerMessage: string;
  legalNote: string;
  effectiveStoreName: string;
  printerLabel: string;
}

interface AgentPrinter {
  name: string;
  driver?: string | null;
  port?: string | null;
  isDefault?: boolean;
  offline?: boolean;
}

interface Status {
  printer: string;
  paperWidth: number;
  autoPrint: boolean;
  agents: {
    id: string;
    name: string;
    hostname: string | null;
    version: string | null;
    lastSeenAt: string | null;
    online: boolean;
    printers: AgentPrinter[];
  }[];
  queue: Partial<Record<JobStatus, number>>;
  failures: Job[];
}

interface Job {
  id: string;
  kind: "RECEIPT" | "TEST";
  reason: "AUTO" | "MANUAL" | "REPRINT" | "RETRY" | "TEST";
  status: JobStatus;
  printerLabel: string | null;
  error: string | null;
  retriedAt: string | null;
  createdAt: string;
  finishedAt: string | null;
  receipt?: { id: string; code: string } | null;
  requestedBy?: { name: string } | null;
  agent?: { name: string } | null;
}

interface ReceiptRow {
  id: string;
  code: string;
  issuedAt: string;
  voidedAt: string | null;
  order: { id: string; number: number; status: string; paymentStatus: string };
  customerName: string | null;
  totalCents: number;
  printStatus: JobStatus | "NONE";
  lastJob: Job | null;
}

export const JOB_STATUS_LABEL: Record<JobStatus | "NONE", string> = {
  PENDING: "Pendiente",
  PRINTING: "Imprimiendo",
  PRINTED: "Impresa",
  FAILED: "Fallida",
  CANCELLED: "Cancelada",
  NONE: "Sin imprimir",
};

const REASON_LABEL: Record<Job["reason"], string> = {
  AUTO: "Automática",
  MANUAL: "Manual",
  REPRINT: "Reimpresión",
  RETRY: "Reintento",
  TEST: "Prueba",
};

export function PrintPill({ status }: { status: JobStatus | "NONE" }) {
  return <span className={`pill pill--print-${status}`}>{JOB_STATUS_LABEL[status]}</span>;
}

const TABS = [
  { id: "estado", label: "Estado" },
  { id: "boletas", label: "Boletas" },
  { id: "impresiones", label: "Historial de impresiones" },
  { id: "configuracion", label: "Configuración" },
  { id: "agente", label: "Agente de impresión" },
] as const;

type TabId = (typeof TABS)[number]["id"];

// ───────────────────────── Página ─────────────────────────

export function PrintingPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as TabId) || "estado";
  const setTab = (t: TabId) => setParams({ tab: t });

  return (
    <>
      <div className="page-head">
        <div>
          <div className="label">Ventas</div>
          <h1 className="display">Boletas e impresión</h1>
        </div>
        <TestPrintButton />
      </div>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "is-active" : ""} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "estado" && <StatusTab onGo={setTab} />}
      {tab === "boletas" && <ReceiptsTab />}
      {tab === "impresiones" && <JobsTab />}
      {tab === "configuracion" && <SettingsTab />}
      {tab === "agente" && <AgentTab />}
    </>
  );
}

function TestPrintButton() {
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api.post("/api/admin/printing/test");
          toast("Impresión de prueba enviada a la cola");
          qc.invalidateQueries({ queryKey: ["print-status"] });
          qc.invalidateQueries({ queryKey: ["print-jobs"] });
        } catch (err) {
          toast(errorMessage(err), "error");
        } finally {
          setBusy(false);
        }
      }}
    >
      🖨 Impresión de prueba
    </button>
  );
}

function useRetry() {
  const toast = useToast();
  const qc = useQueryClient();
  return async (jobId: string) => {
    try {
      await api.post(`/api/admin/printing/jobs/${jobId}/retry`);
      toast("Reintento enviado a la impresora");
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      qc.invalidateQueries({ queryKey: ["print-status"] });
      qc.invalidateQueries({ queryKey: ["print-jobs"] });
      qc.invalidateQueries({ queryKey: ["receipts"] });
    }
  };
}

// ───────────────────────── Estado ─────────────────────────

function StatusTab({ onGo }: { onGo: (t: TabId) => void }) {
  const retry = useRetry();
  const { data, isLoading } = useQuery({
    queryKey: ["print-status"],
    queryFn: () => api.get<Status>("/api/admin/printing/status"),
    refetchInterval: 5000,
  });
  if (isLoading || !data) return <div className="center"><div className="spinner" /></div>;
  const online = data.agents.filter((a) => a.online);
  const q = data.queue;

  return (
    <div className="stack">
      {data.agents.length === 0 && (
        <div className="alert alert--info">
          Para imprimir automáticamente necesitas el <strong>agente de impresión</strong> en la PC donde está la impresora.{" "}
          <button className="btn btn--sm" onClick={() => onGo("agente")}>Configurar agente</button>
        </div>
      )}
      <div className="stats">
        <div className="card stat">
          <span className="label">Agente</span>
          <span className="stat__value" style={{ color: online.length ? "var(--ok)" : "var(--faint)" }}>
            {online.length ? "En línea" : "Desconectado"}
          </span>
          <span className="stat__sub">
            {online.length
              ? online.map((a) => `${a.name}${a.hostname ? ` (${a.hostname})` : ""}`).join(", ")
              : data.agents.length
                ? `Última conexión: ${data.agents[0].lastSeenAt ? formatDate(data.agents[0].lastSeenAt, true) : "nunca"}`
                : "Sin agentes"}
          </span>
        </div>
        <div className="card stat">
          <span className="label">Impresora</span>
          <span className="stat__value" style={{ fontSize: 22 }}>{data.printer}</span>
          <span className="stat__sub">Papel de {data.paperWidth} mm</span>
        </div>
        <div className="card stat">
          <span className="label">Impresión automática</span>
          <span className="stat__value" style={{ color: data.autoPrint ? "var(--ok)" : "var(--faint)" }}>
            {data.autoPrint ? "Activada" : "Desactivada"}
          </span>
          <span className="stat__sub">al confirmar cada compra</span>
        </div>
        <div className="card stat">
          <span className="label">Cola</span>
          <span className="stat__value">{(q.PENDING ?? 0) + (q.PRINTING ?? 0)}</span>
          <span className="stat__sub">
            {q.PRINTED ?? 0} impresas ·{" "}
            <span className={data.failures.length ? "zero" : ""}>{data.failures.length} fallidas sin resolver</span>
          </span>
        </div>
      </div>

      {(q.PENDING ?? 0) > 0 && online.length === 0 && (
        <div className="alert">
          Hay {q.PENDING} boleta(s) esperando, pero ningún agente está conectado. Abre <strong>iniciar-agente.bat</strong> en la
          PC de la impresora: se imprimirán al conectarse.
        </div>
      )}

      <section className="card">
        <div className="card__head">
          <h2>Impresiones fallidas</h2>
          <span className="muted">No se reintentan solas, para evitar boletas duplicadas</span>
        </div>
        {data.failures.length === 0 ? (
          <div className="empty">Sin fallos pendientes. ✔</div>
        ) : (
          <table className="table">
            <tbody>
              {data.failures.map((j) => (
                <tr key={j.id}>
                  <td className="mono">{j.receipt ? j.receipt.code : "Prueba"}</td>
                  <td className="muted">{formatDate(j.createdAt, true)}</td>
                  <td>{j.error}</td>
                  <td className="right">
                    <button className="btn btn--sm btn--primary" onClick={() => retry(j.id)}>
                      Reintentar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

// ───────────────────────── Boletas ─────────────────────────

function ReceiptsTab() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const qs = new URLSearchParams();
  if (q.trim()) qs.set("q", q.trim());
  if (status) qs.set("status", status);
  const { data, isLoading } = useQuery({
    queryKey: ["receipts", qs.toString()],
    queryFn: () => api.get<ReceiptRow[]>(`/api/admin/printing/receipts?${qs}`),
    refetchInterval: 5000,
  });

  return (
    <>
      <div className="toolbar">
        <input className="input" placeholder="Buscar por N.º de boleta o de pedido…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todas</option>
          <option value="PRINTED">Impresas</option>
          <option value="PENDING">Pendientes</option>
          <option value="FAILED">Fallidas</option>
          <option value="NONE">Sin imprimir</option>
          <option value="VOIDED">Anuladas</option>
        </select>
      </div>
      <div className="card table-wrap">
        {isLoading ? (
          <div className="center"><div className="spinner" /></div>
        ) : !data?.length ? (
          <div className="empty">Aún no hay boletas. Se generan al confirmar cada compra.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Boleta</th>
                <th>Fecha</th>
                <th>Pedido</th>
                <th>Cliente</th>
                <th className="right">Total</th>
                <th>Impresión</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => setOpen(r.id)}>
                  <td className="mono">
                    {r.code}
                    {r.voidedAt && <span className="tag" style={{ marginLeft: 6 }}>Anulada</span>}
                  </td>
                  <td className="muted">{formatDate(r.issuedAt, true)}</td>
                  <td>
                    <Link to={`/pedidos/${r.order.id}`} onClick={(e) => e.stopPropagation()}>
                      <u>{orderCode(r.order.number)}</u>
                    </Link>
                  </td>
                  <td>{r.customerName ?? "—"}</td>
                  <td className="right num">{formatMoney(r.totalCents)}</td>
                  <td>
                    <PrintPill status={r.printStatus} />
                  </td>
                  <td className="right">
                    <button className="btn btn--sm" onClick={(e) => (e.stopPropagation(), setOpen(r.id))}>
                      Ver
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {open && <ReceiptModal receiptId={open} onClose={() => setOpen(null)} />}
    </>
  );
}

interface ReceiptDetail {
  id: string;
  code: string;
  issuedAt: string;
  voidedAt: string | null;
  voidReason: string | null;
  order: { id: string; number: number };
  printJobs: Job[];
}

/** Detalle de una boleta: vista previa, historial de impresiones y acciones. */
export function ReceiptModal({ receiptId, onClose }: { receiptId: string; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const retry = useRetry();
  const [paperWidth, setPaperWidth] = useState<58 | 80 | null>(null);
  const [busy, setBusy] = useState(false);

  const detail = useQuery({
    queryKey: ["receipt", receiptId],
    queryFn: () => api.get<ReceiptDetail>(`/api/admin/printing/receipts/${receiptId}`),
    refetchInterval: 3000,
  });
  const preview = useQuery({
    queryKey: ["receipt-preview", receiptId, paperWidth],
    queryFn: () =>
      api.get<Preview>(`/api/admin/printing/receipts/${receiptId}/preview${paperWidth ? `?paperWidth=${paperWidth}` : ""}`),
  });
  const r = detail.data;
  const active = r?.printJobs.some((j) => j.status === "PENDING" || j.status === "PRINTING");

  async function reprint() {
    setBusy(true);
    try {
      await api.post(`/api/admin/printing/receipts/${receiptId}/reprint`);
      toast("Reimpresión enviada (saldrá marcada como COPIA)");
      qc.invalidateQueries({ queryKey: ["receipt", receiptId] });
      qc.invalidateQueries({ queryKey: ["receipts"] });
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={r ? `Boleta ${r.code}` : "Boleta"} onClose={onClose}>
      <div className="receipt-modal">
        <div>
          {preview.data ? <ReceiptPaper preview={preview.data} /> : <div className="spinner" />}
          <div className="inline-form" style={{ justifyContent: "center", marginTop: 10 }}>
            {[58, 80].map((w) => (
              <button
                key={w}
                className={`btn btn--sm ${(paperWidth ?? preview.data?.paperWidth) === w ? "btn--primary" : ""}`}
                onClick={() => setPaperWidth(w as 58 | 80)}
              >
                {w} mm
              </button>
            ))}
          </div>
        </div>
        <div className="stack" style={{ alignContent: "start" }}>
          {r?.voidedAt && <div className="alert">Boleta anulada: {r.voidReason}</div>}
          <div className="form-grid">
            <button className="btn btn--primary" onClick={reprint} disabled={busy || active}>
              {active ? "Imprimiendo…" : "Reimprimir en la térmica"}
            </button>
            <button
              className="btn"
              disabled={!preview.data}
              onClick={() => preview.data && printInBrowser(preview.data, r?.code ?? "Boleta")}
            >
              Imprimir desde el navegador
            </button>
            {r && (
              <Link className="btn" to={`/pedidos/${r.order.id}`} onClick={onClose}>
                Ver pedido {orderCode(r.order.number)}
              </Link>
            )}
          </div>
          <div>
            <div className="label" style={{ marginBottom: 8 }}>Historial de impresión</div>
            {!r?.printJobs.length ? (
              <p className="muted" style={{ margin: 0 }}>Todavía no se ha impreso.</p>
            ) : (
              <ul className="timeline">
                {r.printJobs.map((j) => (
                  <li key={j.id}>
                    <span>
                      <PrintPill status={j.status} /> {REASON_LABEL[j.reason]} · {formatDate(j.createdAt, true)}
                      {j.printerLabel && <div className="muted" style={{ fontSize: 12 }}>{j.printerLabel}</div>}
                      {j.error && <div className="zero" style={{ fontSize: 12 }}>{j.error}</div>}
                      {j.status === "FAILED" && !j.retriedAt && (
                        <button className="btn btn--sm" style={{ marginTop: 6 }} onClick={() => retry(j.id)}>
                          Reintentar
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ───────────────────────── Historial de impresiones ─────────────────────────

function JobsTab() {
  const retry = useRetry();
  const [status, setStatus] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["print-jobs", status],
    queryFn: () => api.get<Job[]>(`/api/admin/printing/jobs${status ? `?status=${status}` : ""}`),
    refetchInterval: 5000,
  });
  return (
    <>
      <div className="toolbar">
        <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todas</option>
          {(["PENDING", "PRINTING", "PRINTED", "FAILED", "CANCELLED"] as JobStatus[]).map((s) => (
            <option key={s} value={s}>{JOB_STATUS_LABEL[s]}</option>
          ))}
        </select>
      </div>
      <div className="card table-wrap">
        {isLoading ? (
          <div className="center"><div className="spinner" /></div>
        ) : !data?.length ? (
          <div className="empty">Sin impresiones todavía.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Documento</th>
                <th>Tipo</th>
                <th>Estado</th>
                <th>Impresora / agente</th>
                <th>Detalle</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((j) => (
                <tr key={j.id}>
                  <td className="muted">{formatDate(j.createdAt, true)}</td>
                  <td className="mono">{j.receipt?.code ?? "Página de prueba"}</td>
                  <td>
                    {REASON_LABEL[j.reason]}
                    {j.requestedBy && <div className="muted" style={{ fontSize: 12 }}>{j.requestedBy.name}</div>}
                  </td>
                  <td><PrintPill status={j.status} /></td>
                  <td className="muted">
                    {j.printerLabel ?? "—"}
                    {j.agent && <div style={{ fontSize: 12 }}>{j.agent.name}</div>}
                  </td>
                  <td className={j.status === "FAILED" ? "zero" : "muted"} style={{ maxWidth: 320 }}>
                    {j.error ?? (j.finishedAt ? `Terminó ${formatDate(j.finishedAt, true)}` : "")}
                  </td>
                  <td className="right">
                    {j.status === "FAILED" && !j.retriedAt && (
                      <button className="btn btn--sm btn--primary" onClick={() => retry(j.id)}>
                        Reintentar
                      </button>
                    )}
                    {j.retriedAt && <span className="muted" style={{ fontSize: 12 }}>Reintentada</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

// ───────────────────────── Configuración ─────────────────────────

function SettingsTab() {
  const toast = useToast();
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["print-settings"], queryFn: () => api.get<Settings>("/api/admin/printing/settings") });
  const status = useQuery({ queryKey: ["print-status"], queryFn: () => api.get<Status>("/api/admin/printing/status") });
  const [form, setForm] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [logoVersion, setLogoVersion] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (settings.data) setForm(settings.data);
  }, [settings.data]);

  const latestReceipt = useQuery({
    queryKey: ["receipts", "latest"],
    queryFn: () => api.get<ReceiptRow[]>("/api/admin/printing/receipts"),
    select: (rows) => rows[0] ?? null,
  });
  const preview = useQuery({
    queryKey: ["settings-preview", latestReceipt.data?.id ?? "test", form?.paperWidth, settings.dataUpdatedAt, logoVersion],
    queryFn: () =>
      latestReceipt.data
        ? api.get<Preview>(`/api/admin/printing/receipts/${latestReceipt.data.id}/preview?paperWidth=${form?.paperWidth}`)
        : api.get<Preview>(`/api/admin/printing/test-preview?paperWidth=${form?.paperWidth}`),
    enabled: Boolean(form) && !latestReceipt.isLoading,
  });

  const printers = useMemo(() => {
    const map = new Map<string, AgentPrinter>();
    for (const a of status.data?.agents ?? []) for (const p of a.printers) map.set(p.name, p);
    return [...map.values()];
  }, [status.data]);

  if (!form) return <div className="center"><div className="spinner" /></div>;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    try {
      const { effectiveStoreName: _e, printerLabel: _p, logoUrl: _l, ...body } = form;
      const saved = await api.put<Settings>("/api/admin/printing/settings", {
        ...body,
        networkPort: Number(body.networkPort) || 9100,
        copies: Number(body.copies) || 1,
      });
      qc.setQueryData(["print-settings"], saved);
      qc.invalidateQueries({ queryKey: ["print-status"] });
      toast("Configuración guardada");
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  }

  async function uploadLogo(file: File | undefined) {
    if (!file) return;
    const fd = new FormData();
    fd.append("logo", file);
    try {
      const saved = await api.post<Settings>("/api/admin/printing/settings/logo", fd);
      qc.setQueryData(["print-settings"], saved);
      setLogoVersion((v) => v + 1);
      toast("Logo actualizado");
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function resetLogo() {
    try {
      const saved = await api.del<Settings>("/api/admin/printing/settings/logo");
      qc.setQueryData(["print-settings"], saved);
      setLogoVersion((v) => v + 1);
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  return (
    <form className="editor" onSubmit={save}>
      <div className="stack">
        <section className="card">
          <div className="card__head">
            <h2>Emisión de boletas</h2>
            <button className="btn btn--primary" disabled={saving}>{saving ? "Guardando…" : "Guardar"}</button>
          </div>
          <div className="card__body form-grid">
            <label className="switch">
              <input type="checkbox" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} />
              Generar una boleta por cada compra confirmada
            </label>
            <label className="switch">
              <input type="checkbox" checked={form.autoPrint} onChange={(e) => set("autoPrint", e.target.checked)} />
              Imprimirla automáticamente en la impresora térmica
            </label>
            <div className="field">
              <span className="label">¿Cuándo se emite?</span>
              <select className="select" value={form.trigger} onChange={(e) => set("trigger", e.target.value as Settings["trigger"])}>
                <option value="ON_CONFIRMED">Al confirmar el pedido (contra entrega: figura "POR COBRAR")</option>
                <option value="ON_PAID">Solo con el pago verificado (contra entrega: al marcar Entregado)</option>
              </select>
              <span className="hint">
                Un pedido pendiente nunca genera boleta. La boleta siempre muestra el estado real del pago.
              </span>
            </div>
            <div className="cols-3">
              <div className="field">
                <span className="label">Título</span>
                <input className="input" value={form.title} onChange={(e) => set("title", e.target.value)} maxLength={40} />
              </div>
              <div className="field">
                <span className="label">Serie</span>
                <input className="input mono" value={form.series} onChange={(e) => set("series", e.target.value.toUpperCase())} maxLength={6} />
                <span className="hint">Numeración: {form.series || "B001"}-00000001…</span>
              </div>
              <div className="field">
                <span className="label">Copias</span>
                <select className="select" value={form.copies} onChange={(e) => set("copies", Number(e.target.value))}>
                  {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </div>
            <div className="field">
              <span className="label">Nombre de la tienda en la boleta</span>
              <input
                className="input"
                value={form.storeName ?? ""}
                placeholder={form.effectiveStoreName}
                onChange={(e) => set("storeName", e.target.value || null)}
                maxLength={40}
              />
            </div>
            <div className="field">
              <span className="label">Encabezado (RUC, dirección, teléfono… una línea cada uno)</span>
              <textarea className="textarea" rows={3} value={form.headerLines} onChange={(e) => set("headerLines", e.target.value)} placeholder={"RUC 10XXXXXXXXX\nAv. Ejemplo 123, Lima\nWhatsApp 987 654 321"} />
            </div>
            <div className="field">
              <span className="label">Mensaje de agradecimiento</span>
              <textarea className="textarea" rows={2} value={form.footerMessage} onChange={(e) => set("footerMessage", e.target.value)} />
            </div>
            <div className="field">
              <span className="label">Nota legal (opcional)</span>
              <input className="input" value={form.legalNote} onChange={(e) => set("legalNote", e.target.value)} maxLength={400} />
              <span className="hint">
                Esta boleta es un comprobante interno de tu tienda. Para que tenga validez tributaria ante SUNAT necesitas
                emitir comprobantes electrónicos (SEE, OSE o PSE).
              </span>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card__head">
            <h2>Impresora</h2>
          </div>
          <div className="card__body form-grid">
            <div className="field">
              <span className="label">Ancho del papel</span>
              <div className="inline-form">
                {[58, 80].map((w) => (
                  <button
                    type="button"
                    key={w}
                    className={`btn ${form.paperWidth === w ? "btn--primary" : ""}`}
                    onClick={() => set("paperWidth", w as 58 | 80)}
                  >
                    {w} mm ({w === 58 ? 32 : 48} caracteres)
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span className="label">Conexión</span>
              <select className="select" value={form.connection} onChange={(e) => set("connection", e.target.value as Settings["connection"])}>
                <option value="windows">Impresora instalada en Windows (USB / Bluetooth)</option>
                <option value="network">Impresora de red (Ethernet / WiFi, IP)</option>
              </select>
            </div>
            {form.connection === "windows" ? (
              <div className="field">
                <span className="label">Impresora</span>
                <select className="select" value={form.printerName ?? ""} onChange={(e) => set("printerName", e.target.value || null)}>
                  <option value="">Predeterminada de Windows</option>
                  {printers.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                      {p.isDefault ? " (predeterminada)" : ""}
                      {p.offline ? " — sin conexión" : ""}
                    </option>
                  ))}
                  {form.printerName && !printers.some((p) => p.name === form.printerName) && (
                    <option value={form.printerName}>{form.printerName} (no detectada ahora)</option>
                  )}
                </select>
                <span className="hint">
                  {printers.length
                    ? "Lista enviada por el agente de impresión de tu PC."
                    : "Conecta el agente de impresión para ver las impresoras de tu PC."}
                </span>
              </div>
            ) : (
              <div className="cols-2">
                <div className="field">
                  <span className="label">IP de la impresora</span>
                  <input className="input mono" value={form.networkHost ?? ""} onChange={(e) => set("networkHost", e.target.value || null)} placeholder="192.168.1.50" />
                </div>
                <div className="field">
                  <span className="label">Puerto</span>
                  <input className="input mono" type="number" value={form.networkPort} onChange={(e) => set("networkPort", Number(e.target.value))} />
                </div>
              </div>
            )}
            <div className="field">
              <span className="label">Agente que imprime</span>
              <select className="select" value={form.agentId ?? ""} onChange={(e) => set("agentId", e.target.value || null)}>
                <option value="">Cualquier agente conectado</option>
                {(status.data?.agents ?? []).map((a) => (
                  <option key={a.id} value={a.id}>{a.name}{a.hostname ? ` (${a.hostname})` : ""}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <span className="label">Juego de caracteres (acentos y ñ)</span>
              <select className="select" value={form.charset} onChange={(e) => set("charset", e.target.value as Settings["charset"])}>
                <option value="cp850">CP850 (la mayoría de impresoras)</option>
                <option value="cp1252">WPC1252</option>
                <option value="ascii">Sin acentos (máxima compatibilidad)</option>
              </select>
              <span className="hint">Si salen símbolos raros en "ñ" o tildes, prueba otra opción e imprime una prueba.</span>
            </div>
            <label className="switch">
              <input type="checkbox" checked={form.cutPaper} onChange={(e) => set("cutPaper", e.target.checked)} />
              Cortar el papel al terminar (si la impresora tiene cortador)
            </label>
          </div>
        </section>

        <section className="card">
          <div className="card__head">
            <h2>Logo</h2>
          </div>
          <div className="card__body form-grid">
            <label className="switch">
              <input type="checkbox" checked={form.printLogo} onChange={(e) => set("printLogo", e.target.checked)} />
              Imprimir el logo
            </label>
            <div className="logo-box">
              <img src={`/api/admin/printing/logo-preview.png?paperWidth=${form.paperWidth}&v=${logoVersion}-${settings.dataUpdatedAt}`} alt="Logo en papel térmico" />
            </div>
            <div className="inline-form">
              <label className="btn">
                Subir logo (PNG)
                <input ref={fileInput} type="file" accept="image/png" hidden onChange={(e) => uploadLogo(e.target.files?.[0])} />
              </label>
              {settings.data?.logoUrl && (
                <button type="button" className="btn btn--ghost" onClick={resetLogo}>
                  Usar logo por defecto
                </button>
              )}
            </div>
            <span className="hint">
              Se imprime en blanco y negro. Funciona mejor un logo negro sobre fondo blanco o transparente.
            </span>
          </div>
        </section>
      </div>

      <aside className="editor__side">
        <section className="card">
          <div className="card__head">
            <h2>Vista previa</h2>
            <span className="muted" style={{ fontSize: 12 }}>{latestReceipt.data ? latestReceipt.data.code : "Página de prueba"}</span>
          </div>
          <div className="card__body">
            {preview.data ? <ReceiptPaper preview={preview.data} /> : <div className="spinner" />}
            <p className="hint muted" style={{ fontSize: 12 }}>
              Guarda los cambios para ver el encabezado y los textos nuevos en las próximas boletas.
            </p>
          </div>
        </section>
      </aside>
    </form>
  );
}

// ───────────────────────── Agente ─────────────────────────

interface AgentRow {
  id: string;
  name: string;
  hostname: string | null;
  version: string | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  online: boolean;
}

function AgentTab() {
  const toast = useToast();
  const qc = useQueryClient();
  const agents = useQuery({
    queryKey: ["print-agents"],
    queryFn: () => api.get<AgentRow[]>("/api/admin/printing/agents"),
    refetchInterval: 5000,
  });
  const [name, setName] = useState("PC de la tienda");
  const [serverUrl, setServerUrl] = useState(window.location.origin);
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/printing/agents/package", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, serverUrl }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `Error ${res.status}`);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "agente-impresion.zip";
      a.click();
      URL.revokeObjectURL(a.href);
      toast("Agente descargado. Sigue los pasos para instalarlo.");
      qc.invalidateQueries({ queryKey: ["print-agents"] });
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    if (!confirm("¿Revocar este agente? Dejará de imprimir y su token ya no servirá.")) return;
    try {
      await api.del(`/api/admin/printing/agents/${id}`);
      qc.invalidateQueries({ queryKey: ["print-agents"] });
      toast("Agente revocado");
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  return (
    <div className="editor">
      <div className="stack">
        <section className="card">
          <div className="card__head">
            <h2>Instalar el agente en la PC de la impresora</h2>
          </div>
          <div className="card__body form-grid">
            <p className="muted" style={{ margin: 0 }}>
              Una página web no puede imprimir sola en una impresora: el <strong>agente de impresión</strong> es un pequeño
              programa para Windows que recibe las boletas de tu tienda y las envía a la impresora térmica sin abrir ventanas.
            </p>
            <ol className="steps">
              <li>
                Instala <strong>Node.js</strong> (versión LTS) desde{" "}
                <a href="https://nodejs.org" target="_blank" rel="noreferrer"><u>nodejs.org</u></a>, si aún no lo tienes.
              </li>
              <li>Instala tu impresora térmica en Windows con su controlador e imprime una página de prueba de Windows.</li>
              <li>Descarga el agente (abajo) y descomprímelo en una carpeta fija, por ejemplo <span className="mono">C:\AgenteBoletas</span>.</li>
              <li>Abre <span className="mono">iniciar-agente.bat</span> y deja la ventana abierta. Aquí aparecerá "En línea".</li>
              <li>En <strong>Configuración</strong> elige la impresora y el papel, guarda y pulsa <strong>Impresión de prueba</strong>.</li>
              <li>Opcional: <span className="mono">instalar-inicio-automatico.bat</span> para que arranque al encender la PC.</li>
            </ol>
            <div className="cols-2">
              <div className="field">
                <span className="label">Nombre del equipo</span>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
              </div>
              <div className="field">
                <span className="label">Dirección de la tienda</span>
                <input className="input mono" value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} />
                <span className="hint">La dirección con la que el agente se conectará (la de este panel).</span>
              </div>
            </div>
            <button className="btn btn--primary" onClick={download} disabled={busy}>
              {busy ? "Preparando…" : "⬇ Descargar agente para Windows (.zip)"}
            </button>
            <span className="hint">
              El ZIP incluye un token secreto solo para imprimir. No lo compartas; si se pierde, revoca el agente y descarga otro.
            </span>
          </div>
        </section>
      </div>
      <aside className="editor__side">
        <section className="card">
          <div className="card__head">
            <h2>Agentes</h2>
          </div>
          {!agents.data?.length ? (
            <div className="empty">Aún no hay agentes.</div>
          ) : (
            <table className="table">
              <tbody>
                {agents.data.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <strong>{a.name}</strong>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {a.revokedAt
                          ? "Revocado"
                          : a.online
                            ? `En línea${a.hostname ? ` · ${a.hostname}` : ""}`
                            : a.lastSeenAt
                              ? `Visto ${formatDate(a.lastSeenAt, true)}`
                              : "Nunca conectado"}
                        {a.version && ` · v${a.version}`}
                      </div>
                    </td>
                    <td className="right">
                      {!a.revokedAt && (
                        <button className="btn btn--sm btn--danger" onClick={() => revoke(a.id)}>
                          Revocar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </aside>
    </div>
  );
}
