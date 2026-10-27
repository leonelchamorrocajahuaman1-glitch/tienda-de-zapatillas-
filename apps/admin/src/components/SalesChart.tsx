import { useState } from "react";
import { formatMoney } from "@tienda/shared";

interface Point {
  date: string;
  totalCents: number;
  orders: number;
}

const fmtDay = (iso: string) =>
  new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

/** Columnas de ventas diarias (una sola serie): barras finas, punta redondeada y tooltip. */
export function SalesChart({ data }: { data: Point[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = 240;
  const pad = { top: 12, right: 8, bottom: 26, left: 56 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const max = Math.max(...data.map((d) => d.totalCents), 1);
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const band = innerW / data.length;
  const barW = Math.min(18, band - 2);
  const y = (v: number) => pad.top + innerH - (v / top) * innerH;
  const total = data.reduce((s, d) => s + d.totalCents, 0);

  if (total === 0) {
    return <div className="empty">Aún no hay ventas confirmadas en los últimos 30 días.</div>;
  }

  const h = hover !== null ? data[hover] : null;

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Ventas confirmadas por día, últimos 30 días">
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid-line" x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} />
            <text className="axis-text" x={pad.left - 8} y={y(t) + 3} textAnchor="end">
              {t >= 100000 ? `S/ ${Math.round(t / 100000)}k` : `S/ ${Math.round(t / 100)}`}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = pad.left + i * band + (band - barW) / 2;
          const barH = Math.max(0, pad.top + innerH - y(d.totalCents));
          const r = Math.min(4, barH / 2, barW / 2);
          const y0 = pad.top + innerH;
          return (
            <g key={d.date}>
              <rect
                className="bar-hit"
                x={pad.left + i * band}
                y={pad.top}
                width={band}
                height={innerH}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
              {barH > 0 && (
                <path
                  className={`bar ${hover === i ? "is-hover" : ""}`}
                  d={`M${x},${y0} V${y0 - barH + r} Q${x},${y0 - barH} ${x + r},${y0 - barH} H${x + barW - r} Q${x + barW},${y0 - barH} ${x + barW},${y0 - barH + r} V${y0} Z`}
                  pointerEvents="none"
                />
              )}
              {i % 5 === 0 && (
                <text className="axis-text" x={pad.left + i * band + band / 2} y={H - 8} textAnchor="middle">
                  {fmtDay(d.date)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {h && hover !== null && (
        <div
          className="chart__tip"
          style={{
            left: `${((pad.left + hover * band + band / 2) / W) * 100}%`,
            top: `${(y(h.totalCents) / H) * 100}%`,
          }}
        >
          <strong>{fmtDay(h.date)}</strong>
          <br />
          {formatMoney(h.totalCents)} · {h.orders} pedido(s)
        </div>
      )}
      <table className="sr-only">
        <caption>Ventas por día</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.date}>
              <td>{d.date}</td>
              <td>{formatMoney(d.totalCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function niceStep(raw: number) {
  const mag = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}
