import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPut } from "../../lib/api";
import { Field, Modal, useToast } from "../../components/ui";

interface Ingredient { id: string; name: string; stockUnit: string; currentStock: string; reorderLevel: string | null; costPerUnit: string }
interface Movement { id: string; type: string; quantity: string; reason: string | null; createdAt: string; ingredient: { name: string; stockUnit: string } }
interface MenuItemLite { id: string; name: string }
interface MenuCat { id: string; name: string; items: MenuItemLite[] }
interface RecipeLine { id: string; quantity: string; ingredient: { id: string; name: string; stockUnit: string; costPerUnit: string } }

const ADJ_TYPES = ["PURCHASE_RECEIPT", "WASTAGE", "STOCKTAKE_ADJUSTMENT", "RETURN"];

export default function InventoryAdmin() {
  const qc = useQueryClient();
  const { push } = useToast();
  const { data } = useQuery({ queryKey: ["ingredients"], queryFn: () => apiGet<{ ingredients: Ingredient[] }>("/inventory/ingredients") });
  const { data: movements } = useQuery({ queryKey: ["movements"], queryFn: () => apiGet<{ movements: Movement[] }>("/inventory/movements", { limit: 50 }) });
  const [adjust, setAdjust] = useState<Ingredient | null>(null);
  const [open, setOpen] = useState(false);
  const [showRecipe, setShowRecipe] = useState(false);
  const [form, setForm] = useState({ name: "", stockUnit: "unit", currentStock: "0", reorderLevel: "", costPerUnit: "0" });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["ingredients"] });
    qc.invalidateQueries({ queryKey: ["movements"] });
  };

  const create = useMutation({
    mutationFn: () =>
      apiPost("/inventory/ingredients", {
        name: form.name,
        stockUnit: form.stockUnit,
        currentStock: Number(form.currentStock),
        reorderLevel: form.reorderLevel === "" ? null : Number(form.reorderLevel),
        costPerUnit: Number(form.costPerUnit),
      }),
    onSuccess: () => { setOpen(false); setForm({ name: "", stockUnit: "unit", currentStock: "0", reorderLevel: "", costPerUnit: "0" }); invalidate(); push("Ingredient added", "ok"); },
    onError: (e) => push(e instanceof Error ? e.message : "Failed", "error"),
  });

  return (
    <div>
      <div className="row" style={{ marginBottom: 14 }}>
        <button className="btn primary" onClick={() => setOpen(true)}>+ Ingredient</button>
        <button className="btn" onClick={() => setShowRecipe(true)}>Recipe editor</button>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h3>Ingredients</h3>
          <table className="tbl">
            <thead>
              <tr><th>Name</th><th>Stock</th><th>Reorder</th><th /></tr>
            </thead>
            <tbody>
              {(data?.ingredients ?? []).map((i) => {
                const low = i.reorderLevel !== null && Number(i.currentStock) <= Number(i.reorderLevel);
                return (
                  <tr key={i.id}>
                    <td>{i.name}</td>
                    <td className="mono">
                      {Number(i.currentStock).toFixed(2)} {i.stockUnit}
                      {low && <span className="badge danger" style={{ marginLeft: 6 }}>low</span>}
                    </td>
                    <td className="mono muted">{i.reorderLevel !== null ? Number(i.reorderLevel).toFixed(2) : "—"}</td>
                    <td><button className="btn small" onClick={() => setAdjust(i)}>Adjust</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h3>Recent movements</h3>
          <table className="tbl">
            <thead>
              <tr><th>Item</th><th>Type</th><th>Qty</th><th>When</th></tr>
            </thead>
            <tbody>
              {(movements?.movements ?? []).map((m) => (
                <tr key={m.id}>
                  <td>{m.ingredient.name}</td>
                  <td className="small">{m.type}</td>
                  <td className="mono">{Number(m.quantity).toFixed(2)} {m.ingredient.stockUnit}</td>
                  <td className="small muted">{new Date(m.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {open && (
        <Modal
          title="New ingredient"
          onClose={() => setOpen(false)}
          footer={<><button className="btn ghost" onClick={() => setOpen(false)}>Cancel</button><button className="btn primary" disabled={!form.name} onClick={() => create.mutate()}>Add</button></>}
        >
          <Field label="Name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <div className="row">
            <Field label="Unit"><input className="input" value={form.stockUnit} onChange={(e) => setForm({ ...form, stockUnit: e.target.value })} /></Field>
            <Field label="Current stock"><input className="input" type="number" value={form.currentStock} onChange={(e) => setForm({ ...form, currentStock: e.target.value })} /></Field>
          </div>
          <div className="row">
            <Field label="Reorder level"><input className="input" type="number" value={form.reorderLevel} onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })} /></Field>
            <Field label="Cost / unit"><input className="input" type="number" value={form.costPerUnit} onChange={(e) => setForm({ ...form, costPerUnit: e.target.value })} /></Field>
          </div>
        </Modal>
      )}

      {adjust && <AdjustModal ingredient={adjust} onClose={() => setAdjust(null)} onDone={() => { setAdjust(null); invalidate(); }} />}
      {showRecipe && <RecipeModal ingredients={data?.ingredients ?? []} onClose={() => setShowRecipe(false)} />}
    </div>
  );
}

function RecipeModal({ ingredients, onClose }: { ingredients: Ingredient[]; onClose: () => void }) {
  const { push } = useToast();
  const { data: menu } = useQuery({ queryKey: ["menu"], queryFn: () => apiGet<{ categories: MenuCat[] }>("/menu") });
  const items = (menu?.categories ?? []).flatMap((c) => c.items);
  const [itemId, setItemId] = useState("");
  const [lines, setLines] = useState<{ ingredientId: string; quantity: string }[]>([]);
  const [pick, setPick] = useState({ ingredientId: "", quantity: "" });

  const { data: recipe, isLoading } = useQuery({
    queryKey: ["recipe", itemId],
    queryFn: () => apiGet<{ lines: RecipeLine[] }>(`/inventory/items/${itemId}/recipe`),
    enabled: !!itemId,
  });

  useQuery({
    queryKey: ["recipe-sync", itemId, recipe?.lines?.length],
    queryFn: () => {
      setLines((recipe?.lines ?? []).map((l) => ({ ingredientId: l.ingredient.id, quantity: String(Number(l.quantity)) })));
      return null;
    },
    enabled: !!recipe,
  });

  const save = useMutation({
    mutationFn: () => apiPut(`/inventory/items/${itemId}/recipe`, { lines: lines.filter((l) => l.ingredientId && Number(l.quantity) > 0).map((l) => ({ ingredientId: l.ingredientId, quantity: Number(l.quantity) })) }),
    onSuccess: () => { push("Recipe saved", "ok"); onClose(); },
    onError: (e) => push(e instanceof Error ? e.message : "Failed", "error"),
  });

  const cost = lines.reduce((s, l) => {
    const ing = ingredients.find((i) => i.id === l.ingredientId);
    return s + (ing ? Number(ing.costPerUnit) * Number(l.quantity || 0) : 0);
  }, 0);

  return (
    <Modal
      title="Recipe editor"
      onClose={onClose}
      wide
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!itemId || save.isPending} onClick={() => save.mutate()}>Save recipe</button></>}
    >
      <Field label="Menu item">
        <select className="input" value={itemId} onChange={(e) => { setItemId(e.target.value); setLines([]); }}>
          <option value="">Select item…</option>
          {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
      </Field>

      {itemId && (
        <>
          {isLoading && <p className="muted small">Loading…</p>}
          <table className="tbl" style={{ marginTop: 10 }}>
            <thead><tr><th>Ingredient</th><th>Qty</th><th /></tr></thead>
            <tbody>
              {lines.map((l, idx) => {
                const ing = ingredients.find((i) => i.id === l.ingredientId);
                return (
                  <tr key={idx}>
                    <td>{ing?.name ?? l.ingredientId}</td>
                    <td>
                      <input
                        className="input"
                        type="number"
                        style={{ maxWidth: 120 }}
                        value={l.quantity}
                        onChange={(e) => setLines((ls) => ls.map((x, i2) => (i2 === idx ? { ...x, quantity: e.target.value } : x)))}
                      />
                      <span className="muted small" style={{ marginLeft: 6 }}>{ing?.stockUnit}</span>
                    </td>
                    <td><button className="btn ghost small" onClick={() => setLines((ls) => ls.filter((_, i2) => i2 !== idx))}>Remove</button></td>
                  </tr>
                );
              })}
              {lines.length === 0 && !isLoading && <tr><td colSpan={3} className="muted">No ingredients yet.</td></tr>}
            </tbody>
          </table>

          <div className="row" style={{ marginTop: 10 }}>
            <select className="input" value={pick.ingredientId} onChange={(e) => setPick({ ...pick, ingredientId: e.target.value })}>
              <option value="">Add ingredient…</option>
              {ingredients.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.stockUnit})</option>)}
            </select>
            <input className="input" type="number" placeholder="qty" style={{ maxWidth: 120 }} value={pick.quantity} onChange={(e) => setPick({ ...pick, quantity: e.target.value })} />
            <button
              className="btn"
              disabled={!pick.ingredientId || !pick.quantity}
              onClick={() => { setLines((ls) => [...ls, { ingredientId: pick.ingredientId, quantity: pick.quantity }]); setPick({ ingredientId: "", quantity: "" }); }}
            >
              Add
            </button>
          </div>

          <p className="muted small" style={{ marginTop: 10 }}>Theoretical plate cost: <strong>{cost.toFixed(2)}</strong> (sum of ingredient cost × qty)</p>
        </>
      )}
    </Modal>
  );
}

function AdjustModal({ ingredient, onClose, onDone }: { ingredient: Ingredient; onClose: () => void; onDone: () => void }) {
  const { push } = useToast();
  const [quantity, setQuantity] = useState("");
  const [type, setType] = useState("PURCHASE_RECEIPT");
  const [reason, setReason] = useState("");
  const [unitCost, setUnitCost] = useState("");

  const mut = useMutation({
    mutationFn: () => apiPost(`/inventory/ingredients/${ingredient.id}/adjust`, { quantity: Number(quantity), type, reason: reason || undefined, unitCost: unitCost ? Number(unitCost) : undefined }),
    onSuccess: () => { push("Stock adjusted", "ok"); onDone(); },
    onError: (e) => push(e instanceof Error ? e.message : "Failed", "error"),
  });

  return (
    <Modal
      title={`Adjust · ${ingredient.name}`}
      onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!quantity} onClick={() => mut.mutate()}>Apply</button></>}
    >
      <p className="muted small">Current: {Number(ingredient.currentStock).toFixed(2)} {ingredient.stockUnit}</p>
      <Field label="Type">
        <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
          {ADJ_TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
      </Field>
      <Field label="Quantity (use negative to reduce)"><input className="input" type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></Field>
      <Field label="Unit cost (optional)"><input className="input" type="number" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} /></Field>
      <Field label="Reason"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </Modal>
  );
}
