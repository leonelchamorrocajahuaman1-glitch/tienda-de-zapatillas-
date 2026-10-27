import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@tienda/shared";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";

type Kind = "brands" | "categories" | "colors" | "sizes";
interface Item {
  id: string;
  name?: string;
  label?: string;
  hex?: string;
  sortOrder?: number;
  _count: { products?: number; variants?: number };
}

const TABS: { kind: Kind; label: string; singular: string }[] = [
  { kind: "brands", label: "Marcas", singular: "marca" },
  { kind: "categories", label: "Categorías", singular: "categoría" },
  { kind: "colors", label: "Colores", singular: "color" },
  { kind: "sizes", label: "Tallas", singular: "talla" },
];

export function TaxonomyPage() {
  const [kind, setKind] = useState<Kind>("brands");
  const tab = TABS.find((t) => t.kind === kind)!;
  return (
    <>
      <div className="page-head">
        <div>
          <div className="label">Configuración del catálogo</div>
          <h1 className="display">Marcas, categorías y tallas</h1>
        </div>
      </div>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.kind} className={kind === t.kind ? "is-active" : ""} onClick={() => setKind(t.kind)}>
            {t.label}
          </button>
        ))}
      </div>
      <TaxonomyList key={kind} kind={kind} singular={tab.singular} />
    </>
  );
}

function TaxonomyList({ kind, singular }: { kind: Kind; singular: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery({ queryKey: [kind], queryFn: () => api.get<Item[]>(`/api/admin/taxonomy/${kind}`) });
  const [name, setName] = useState("");
  const [hex, setHex] = useState("#111111");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editHex, setEditHex] = useState("#111111");
  const isSize = kind === "sizes";
  const isColor = kind === "colors";

  const refresh = () => qc.invalidateQueries({ queryKey: [kind] });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.post(`/api/admin/taxonomy/${kind}`, isSize ? { label: name } : isColor ? { name, hex } : { name });
      setName("");
      refresh();
      toast("Agregado correctamente");
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  async function save(id: string) {
    try {
      await api.patch(`/api/admin/taxonomy/${kind}/${id}`, isSize ? { label: editName } : isColor ? { name: editName, hex: editHex } : { name: editName });
      setEditing(null);
      refresh();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  async function del(id: string) {
    if (!confirm(`¿Eliminar esta ${singular}?`)) return;
    try {
      await api.del(`/api/admin/taxonomy/${kind}/${id}`);
      refresh();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  return (
    <div className="card">
      <div className="card__body">
        <form className="inline-form" onSubmit={create}>
          <input className="input" required placeholder={isSize ? "Nueva talla, p. ej. 39.5" : `Nueva ${singular}`} value={name} onChange={(e) => setName(e.target.value)} />
          {isColor && <input className="input" type="color" value={hex} onChange={(e) => setHex(e.target.value)} style={{ flex: "0 0 60px", padding: 4 }} aria-label="Color" />}
          <button className="btn btn--primary">Agregar</button>
        </form>
      </div>
      {isLoading ? (
        <div className="center"><div className="spinner" /></div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{isSize ? "Talla" : "Nombre"}</th>
              <th className="right">En uso</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.map((it) => {
              const used = it._count.products ?? it._count.variants ?? 0;
              const label = it.label ?? it.name ?? "";
              return (
                <tr key={it.id}>
                  <td>
                    {editing === it.id ? (
                      <div className="inline-form">
                        <input className="input input--sm" value={editName} onChange={(e) => setEditName(e.target.value)} />
                        {isColor && <input className="input input--sm" type="color" value={editHex} onChange={(e) => setEditHex(e.target.value)} style={{ flex: "0 0 50px", padding: 2 }} />}
                      </div>
                    ) : (
                      <>
                        {isColor && <span className="dot" style={{ background: it.hex, marginRight: 8 }} />}
                        {label}
                      </>
                    )}
                  </td>
                  <td className="right num muted">{used} {kind === "colors" || kind === "sizes" ? "variante(s)" : "producto(s)"}</td>
                  <td className="right" style={{ whiteSpace: "nowrap" }}>
                    {editing === it.id ? (
                      <>
                        <button className="btn btn--sm btn--primary" onClick={() => save(it.id)}>Guardar</button>{" "}
                        <button className="btn btn--sm" onClick={() => setEditing(null)}>Cancelar</button>
                      </>
                    ) : (
                      <>
                        <button className="btn btn--sm" onClick={() => { setEditing(it.id); setEditName(label); setEditHex(it.hex ?? "#111111"); }}>Editar</button>{" "}
                        <button className="btn btn--sm btn--danger" onClick={() => del(it.id)} disabled={used > 0} title={used > 0 ? "En uso: no se puede eliminar" : undefined}>Eliminar</button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
