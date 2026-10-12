import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDel, apiGet, apiPatch, apiPost } from "../../lib/api";
import { formatMoney, toCents } from "../../lib/format";
import { Field, Modal, useToast } from "../../components/ui";

interface Variant { id: string; name: string; priceAdjust: string; isAvailable: boolean }
interface Option { id: string; name: string; price: string; isAvailable: boolean }
interface ModGroup { id: string; name: string; required: boolean; minSelect: number; maxSelect: number | null; options: Option[] }
interface Item { id: string; name: string; price: string; station: string; isAvailable: boolean; isActive: boolean; variants: Variant[]; modifierGroups: ModGroup[] }
interface Category { id: string; name: string; isActive: boolean; items: Item[] }
interface Settings { restaurant: { currency: string } | null }

const STATIONS = ["GRILL", "FRYER", "SALAD", "BAR", "DESSERT", "KITCHEN"];

export default function MenuAdmin() {
  const qc = useQueryClient();
  const { push } = useToast();
  const { data } = useQuery({ queryKey: ["menu", "all"], queryFn: () => apiGet<{ categories: Category[] }>("/menu", { all: "true" }) });
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => apiGet<Settings>("/admin/settings") });
  const currency = settings?.restaurant?.currency ?? "USD";
  const [showCat, setShowCat] = useState(false);
  const [catName, setCatName] = useState("");
  const [addTo, setAddTo] = useState<Category | null>(null);
  const [manage, setManage] = useState<Item | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["menu"] });

  const addCat = useMutation({
    mutationFn: () => apiPost("/menu/categories", { name: catName }),
    onSuccess: () => { setCatName(""); setShowCat(false); invalidate(); push("Category added", "ok"); },
    onError: (e) => push(e instanceof Error ? e.message : "Failed", "error"),
  });

  const toggle = useMutation({
    mutationFn: ({ id, isAvailable }: { id: string; isAvailable: boolean }) => apiPost(`/menu/items/${id}/availability`, { isAvailable }),
    onSuccess: invalidate,
  });

  const del = useMutation({
    mutationFn: (id: string) => apiDel(`/menu/items/${id}`),
    onSuccess: () => { invalidate(); push("Item removed", "ok"); },
  });

  return (
    <div>
      <div className="row" style={{ marginBottom: 14 }}>
        <button className="btn primary" onClick={() => setShowCat(true)}>+ Category</button>
      </div>

      <div className="grid cols-2">
        {(data?.categories ?? []).map((c) => (
          <div className="card" key={c.id}>
            <div className="row">
              <h3 style={{ margin: 0, flex: 1 }}>{c.name}</h3>
              <button className="btn small" onClick={() => setAddTo(c)}>+ Item</button>
            </div>
            <table className="tbl" style={{ marginTop: 8 }}>
              <thead>
                <tr><th>Item</th><th>Price</th><th>Station</th><th /></tr>
              </thead>
              <tbody>
                {c.items.map((i) => (
                  <tr key={i.id}>
                    <td>
                      {i.name}
                      {i.variants.length > 0 && <span className="badge muted" style={{ marginLeft: 6 }}>{i.variants.length} var</span>}
                      {i.modifierGroups.length > 0 && <span className="badge muted" style={{ marginLeft: 6 }}>{i.modifierGroups.length} mod</span>}
                    </td>
                    <td className="mono">{formatMoney(toCents(i.price), currency)}</td>
                    <td className="small muted">{i.station}</td>
                    <td>
                      <div className="row" style={{ justifyContent: "flex-end" }}>
                        <button className="btn small" onClick={() => setManage(i)}>Options</button>
                        <button className={`btn small ${i.isAvailable ? "" : "danger"}`} onClick={() => toggle.mutate({ id: i.id, isAvailable: !i.isAvailable })}>
                          {i.isAvailable ? "86" : "Restore"}
                        </button>
                        <button className="btn ghost small" onClick={() => del.mutate(i.id)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {c.items.length === 0 && <tr><td colSpan={4} className="muted">No items.</td></tr>}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {showCat && (
        <Modal title="New category" onClose={() => setShowCat(false)} footer={<><button className="btn ghost" onClick={() => setShowCat(false)}>Cancel</button><button className="btn primary" disabled={!catName} onClick={() => addCat.mutate()}>Add</button></>}>
          <Field label="Name"><input className="input" value={catName} onChange={(e) => setCatName(e.target.value)} /></Field>
        </Modal>
      )}

      {addTo && <ItemModal category={addTo} currency={currency} onClose={() => setAddTo(null)} onSaved={() => { setAddTo(null); invalidate(); }} />}
      {manage && <ItemOptionsModal item={manage} currency={currency} onClose={() => { setManage(null); invalidate(); }} />}
    </div>
  );
}

function ItemModal({ category, currency, onClose, onSaved }: { category: Category; currency: string; onClose: () => void; onSaved: () => void }) {
  const { push } = useToast();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [station, setStation] = useState("KITCHEN");
  const [desc, setDesc] = useState("");

  const mut = useMutation({
    mutationFn: () => apiPost("/menu/items", { categoryId: category.id, name, price: Number(price), station, description: desc || undefined }),
    onSuccess: () => { push("Item added", "ok"); onSaved(); },
    onError: (e) => push(e instanceof Error ? e.message : "Failed", "error"),
  });

  return (
    <Modal
      title={`New item · ${category.name}`}
      onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!name || !price} onClick={() => mut.mutate()}>Add</button></>}
    >
      <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label={`Price (${currency})`}><input className="input" type="number" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
      <Field label="Station">
        <select className="input" value={station} onChange={(e) => setStation(e.target.value)}>
          {STATIONS.map((s) => <option key={s}>{s}</option>)}
        </select>
      </Field>
      <Field label="Description"><input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
    </Modal>
  );
}

function ItemOptionsModal({ item, currency, onClose }: { item: Item; currency: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { push } = useToast();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["menu"] });
  const [vName, setVName] = useState("");
  const [vAdj, setVAdj] = useState("");
  const [gName, setGName] = useState("");
  const [gRequired, setGRequired] = useState(false);
  const [newOpts, setNewOpts] = useState<Record<string, { name: string; price: string }>>({});

  const fail = (e: unknown) => push(e instanceof Error ? e.message : "Failed", "error");

  const addVariant = useMutation({
    mutationFn: () => apiPost(`/menu/items/${item.id}/variants`, { name: vName, priceAdjust: vAdj ? Number(vAdj) : 0 }),
    onSuccess: () => { setVName(""); setVAdj(""); invalidate(); },
    onError: fail,
  });
  const delVariant = useMutation({ mutationFn: (id: string) => apiDel(`/menu/variants/${id}`), onSuccess: invalidate, onError: fail });

  const addGroup = useMutation({
    mutationFn: () => apiPost(`/menu/items/${item.id}/modifier-groups`, { name: gName, required: gRequired, maxSelect: 1 }),
    onSuccess: () => { setGName(""); setGRequired(false); invalidate(); },
    onError: fail,
  });
  const delGroup = useMutation({ mutationFn: (id: string) => apiDel(`/menu/modifier-groups/${id}`), onSuccess: invalidate, onError: fail });

  const addOption = useMutation({
    mutationFn: ({ groupId, name, price }: { groupId: string; name: string; price: string }) =>
      apiPost(`/menu/modifier-groups/${groupId}/options`, { name, price: price ? Number(price) : 0 }),
    onSuccess: (_d, v) => { setNewOpts((s) => ({ ...s, [v.groupId]: { name: "", price: "" } })); invalidate(); },
    onError: fail,
  });
  const delOption = useMutation({ mutationFn: (id: string) => apiDel(`/menu/modifier-options/${id}`), onSuccess: invalidate, onError: fail });
  const toggleOption = useMutation({
    mutationFn: ({ id, isAvailable }: { id: string; isAvailable: boolean }) => apiPatch(`/menu/modifier-options/${id}`, { isAvailable }),
    onSuccess: invalidate,
  });

  return (
    <Modal title={`Options · ${item.name}`} onClose={onClose} wide footer={<button className="btn primary" onClick={onClose}>Done</button>}>
      <div className="card" style={{ marginBottom: 14 }}>
        <h3 style={{ marginTop: 0 }}>Variants</h3>
        {item.variants.map((v) => (
          <div className="row" key={v.id} style={{ marginBottom: 6 }}>
            <span style={{ flex: 1 }}>{v.name}</span>
            <span className="mono muted small">{Number(v.priceAdjust) >= 0 ? "+" : ""}{formatMoney(toCents(v.priceAdjust), currency)}</span>
            <button className="btn ghost small" onClick={() => delVariant.mutate(v.id)}>Remove</button>
          </div>
        ))}
        {item.variants.length === 0 && <p className="muted small">No variants (e.g. Small / Large).</p>}
        <div className="row" style={{ marginTop: 8 }}>
          <input className="input" placeholder="Variant name" value={vName} onChange={(e) => setVName(e.target.value)} />
          <input className="input" type="number" placeholder="+/- price" value={vAdj} onChange={(e) => setVAdj(e.target.value)} style={{ maxWidth: 120 }} />
          <button className="btn" disabled={!vName} onClick={() => addVariant.mutate()}>Add</button>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Modifier groups</h3>
        {item.modifierGroups.map((g) => (
          <div key={g.id} style={{ borderTop: "1px solid var(--line)", paddingTop: 8, marginTop: 8 }}>
            <div className="row">
              <strong style={{ flex: 1 }}>{g.name}{g.required ? " (required)" : ""}</strong>
              <button className="btn ghost small" onClick={() => delGroup.mutate(g.id)}>Remove group</button>
            </div>
            {g.options.map((o) => (
              <div className="row" key={o.id} style={{ marginTop: 4 }}>
                <span style={{ flex: 1 }} className={o.isAvailable ? "" : "muted"}>{o.name}</span>
                <span className="mono muted small">{Number(o.price) ? `+${formatMoney(toCents(o.price), currency)}` : "no charge"}</span>
                <button className="btn ghost small" onClick={() => toggleOption.mutate({ id: o.id, isAvailable: !o.isAvailable })}>{o.isAvailable ? "86" : "Restore"}</button>
                <button className="btn ghost small" onClick={() => delOption.mutate(o.id)}>×</button>
              </div>
            ))}
            <div className="row" style={{ marginTop: 6 }}>
              <input
                className="input"
                placeholder="Option name"
                value={newOpts[g.id]?.name ?? ""}
                onChange={(e) => setNewOpts((s) => ({ ...s, [g.id]: { name: e.target.value, price: s[g.id]?.price ?? "" } }))}
              />
              <input
                className="input"
                type="number"
                placeholder="+price"
                style={{ maxWidth: 110 }}
                value={newOpts[g.id]?.price ?? ""}
                onChange={(e) => setNewOpts((s) => ({ ...s, [g.id]: { name: s[g.id]?.name ?? "", price: e.target.value } }))}
              />
              <button
                className="btn"
                disabled={!(newOpts[g.id]?.name)}
                onClick={() => addOption.mutate({ groupId: g.id, name: newOpts[g.id]!.name, price: newOpts[g.id]!.price })}
              >
                Add option
              </button>
            </div>
          </div>
        ))}
        {item.modifierGroups.length === 0 && <p className="muted small">No modifier groups (e.g. additives, doneness).</p>}
        <div className="row" style={{ marginTop: 8 }}>
          <input className="input" placeholder="Group name" value={gName} onChange={(e) => setGName(e.target.value)} />
          <label className="row small" style={{ gap: 6 }}>
            <input type="checkbox" checked={gRequired} onChange={(e) => setGRequired(e.target.checked)} /> required
          </label>
          <button className="btn" disabled={!gName} onClick={() => addGroup.mutate()}>Add group</button>
        </div>
      </div>
      <p className="muted small" style={{ marginTop: 10 }}>Base price {formatMoney(toCents(item.price), currency)}</p>
    </Modal>
  );
}
