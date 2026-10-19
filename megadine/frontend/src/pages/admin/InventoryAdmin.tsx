import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost, apiPut } from "../../lib/api";
import { Field, Modal, useToast } from "../../components/ui";

interface Ingredient { id: string; name: string; stockUnit: string; currentStock: string; reorderLevel: string | null; costPerUnit: string }
interface Movement { id: string; type: string; quantity: string; reason: string | null; createdAt: string; ingredient: { name: string; stockUnit: string } }
interface MenuItemLite { id: string; name: string }
interface MenuCat { id: string; name: string; items: MenuItemLite[] }
interface RecipeLine { id: string; quantity: string; ingredient: { id: string; name: string; stockUnit: string; costPerUnit: string } }
interface WastageReport {
  rows: { ingredientName: string; quantity: number; unit: string; cost: number; reason: string | null; note: string | null; at: string }[];
  totalCost: number;
  byReason: { reason: string; quantity: number; cost: number }[];
  byDay: { date: string; cost: number }[];
}

const ADJ_TYPES = ["PURCHASE_RECEIPT", "WASTAGE", "STOCKTAKE_ADJUSTMENT", "RETURN"];
export const WASTAGE_REASONS = ["burned", "dropped", "expired", "over-prepared", "other"];

export default function InventoryAdmin() {
  const qc = useQueryClient();
  const { push } = useToast();
  const { t } = useTranslation(["admin", "common"]);
  const typeLabel = (s: string) => t(`admin:mt_${s.toLowerCase()}`, { defaultValue: s.replace(/_/g, " ") });
  const { data } = useQuery({ queryKey: ["ingredients"], queryFn: () => apiGet<{ ingredients: Ingredient[] }>("/inventory/ingredients") });
  const { data: movements } = useQuery({ queryKey: ["movements"], queryFn: () => apiGet<{ movements: Movement[] }>("/inventory/movements", { limit: 50 }) });
  const { data: wastage } = useQuery({
    queryKey: ["wastage-report"],
    queryFn: () => {
      const to = new Date();
      const from = new Date(to.getTime() - 6 * 24 * 60 * 60 * 1000);
      return apiGet<WastageReport>("/reports/wastage", { from: from.toISOString(), to: to.toISOString() });
    },
  });
  const [adjust, setAdjust] = useState<Ingredient | null>(null);
  const [open, setOpen] = useState(false);
  const [showRecipe, setShowRecipe] = useState(false);
  const [showWastage, setShowWastage] = useState(false);
  const [form, setForm] = useState({ name: "", stockUnit: "unit", currentStock: "0", reorderLevel: "", costPerUnit: "0" });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["ingredients"] });
    qc.invalidateQueries({ queryKey: ["movements"] });
    qc.invalidateQueries({ queryKey: ["wastage-report"] });
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
    onSuccess: () => { setOpen(false); setForm({ name: "", stockUnit: "unit", currentStock: "0", reorderLevel: "", costPerUnit: "0" }); invalidate(); push(t("admin:inv_ingredient_added"), "ok"); },
    onError: (e) => push(e instanceof Error ? e.message : t("admin:tba_failed"), "error"),
  });

  return (
    <div>
      <div className="row" style={{ marginBottom: 14 }}>
        <button className="btn primary" onClick={() => setOpen(true)}>{t("admin:inv_add")}</button>
        <button className="btn" onClick={() => setShowRecipe(true)}>{t("admin:inv_recipe_editor")}</button>
        <button className="btn" onClick={() => setShowWastage(true)}>{t("admin:inv_record_wastage")}</button>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h3>{t("admin:inv_ingredients")}</h3>
          <table className="tbl">
            <thead>
              <tr><th>{t("admin:col_name")}</th><th>{t("admin:inv_col_stock")}</th><th>{t("admin:inv_col_reorder")}</th><th /></tr>
            </thead>
            <tbody>
              {(data?.ingredients ?? []).map((i) => {
                const low = i.reorderLevel !== null && Number(i.currentStock) <= Number(i.reorderLevel);
                return (
                  <tr key={i.id}>
                    <td>{i.name}</td>
                    <td className="mono">
                      {Number(i.currentStock).toFixed(2)} {i.stockUnit}
                      {low && <span className="badge danger" style={{ marginLeft: 6 }}>{t("admin:inv_low")}</span>}
                    </td>
                    <td className="mono muted">{i.reorderLevel !== null ? Number(i.reorderLevel).toFixed(2) : "—"}</td>
                    <td><button className="btn small" onClick={() => setAdjust(i)}>{t("admin:inv_adjust")}</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h3>{t("admin:inv_recent_movements")}</h3>
          <table className="tbl">
            <thead>
              <tr><th>{t("admin:col_item")}</th><th>{t("admin:col_type")}</th><th>{t("admin:col_qty")}</th><th>{t("admin:inv_col_when")}</th></tr>
            </thead>
            <tbody>
              {(movements?.movements ?? []).map((m) => (
                <tr key={m.id}>
                  <td>{m.ingredient.name}</td>
                  <td className="small">{typeLabel(m.type)}</td>
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
          title={t("admin:inv_new_ingredient")}
          onClose={() => setOpen(false)}
          footer={<><button className="btn ghost" onClick={() => setOpen(false)}>{t("common:cancel")}</button><button className="btn primary" disabled={!form.name} onClick={() => create.mutate()}>{t("admin:tba_btn_add")}</button></>}
        >
          <Field label={t("admin:col_name")}><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <div className="row">
            <Field label={t("admin:inv_fld_unit")}><input className="input" value={form.stockUnit} onChange={(e) => setForm({ ...form, stockUnit: e.target.value })} /></Field>
            <Field label={t("admin:inv_fld_current_stock")}><input className="input" type="number" value={form.currentStock} onChange={(e) => setForm({ ...form, currentStock: e.target.value })} /></Field>
          </div>
          <div className="row">
            <Field label={t("admin:inv_fld_reorder_level")}><input className="input" type="number" value={form.reorderLevel} onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })} /></Field>
            <Field label={t("admin:inv_fld_cost_unit")}><input className="input" type="number" value={form.costPerUnit} onChange={(e) => setForm({ ...form, costPerUnit: e.target.value })} /></Field>
          </div>
        </Modal>
      )}

      <div className="card" style={{ marginTop: 14 }}>
        <div className="row">
          <h3 style={{ flex: 1 }}>{t("admin:inv_wastage_report")}</h3>
          <span className="badge danger">{t("admin:inv_wastage_total")}: {Number(wastage?.totalCost ?? 0).toFixed(2)}</span>
        </div>
        {wastage && wastage.byReason.length > 0 ? (
          <table className="tbl">
            <thead>
              <tr>
                <th>{t("admin:inv_wastage_reason_col")}</th>
                <th style={{ textAlign: "right" }}>{t("admin:inv_wastage_qty_col")}</th>
                <th style={{ textAlign: "right" }}>{t("admin:inv_wastage_cost_col")}</th>
              </tr>
            </thead>
            <tbody>
              {wastage.byReason.map((r) => (
                <tr key={r.reason}>
                  <td>{t(`admin:waste_${r.reason.replace(/-/g, "_")}`, { defaultValue: r.reason })}</td>
                  <td className="mono" style={{ textAlign: "right" }}>{r.quantity.toFixed(2)}</td>
                  <td className="mono" style={{ textAlign: "right" }}>{r.cost.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted small">{t("admin:inv_wastage_none")}</p>
        )}
      </div>

      {adjust && <AdjustModal ingredient={adjust} onClose={() => setAdjust(null)} onDone={() => { setAdjust(null); invalidate(); }} />}
      {showRecipe && <RecipeModal ingredients={data?.ingredients ?? []} onClose={() => setShowRecipe(false)} />}
      {showWastage && (
        <WastageModal
          ingredients={data?.ingredients ?? []}
          onClose={() => setShowWastage(false)}
          onDone={() => { setShowWastage(false); invalidate(); }}
        />
      )}
    </div>
  );
}

function WastageModal({ ingredients, onClose, onDone }: { ingredients: Ingredient[]; onClose: () => void; onDone: () => void }) {
  const { push } = useToast();
  const { t } = useTranslation(["admin", "common"]);
  const [ingredientId, setIngredientId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("burned");
  const [note, setNote] = useState("");

  const mut = useMutation({
    mutationFn: () => apiPost("/inventory/wastage", { ingredientId, quantity: Number(quantity), reason, note: note || undefined }),
    onSuccess: () => { push(t("admin:inv_wastage_saved"), "ok"); onDone(); },
    onError: (e) => push(e instanceof Error ? e.message : t("admin:tba_failed"), "error"),
  });

  const selected = ingredients.find((i) => i.id === ingredientId);
  const reasonLabel = (r: string) => t(`admin:waste_${r.replace(/-/g, "_")}`, { defaultValue: r });

  return (
    <Modal
      title={t("admin:inv_wastage_title")}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>{t("common:cancel")}</button>
          <button className="btn danger" disabled={!ingredientId || !(Number(quantity) > 0) || mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? "…" : t("admin:inv_wastage_save")}
          </button>
        </>
      }
    >
      <Field label={t("admin:inv_wastage_ingredient")}>
        <select className="input" value={ingredientId} onChange={(e) => setIngredientId(e.target.value)}>
          <option value="">{t("admin:inv_wastage_pick_ingredient")}</option>
          {ingredients.map((i) => (
            <option key={i.id} value={i.id}>{i.name} ({Number(i.currentStock).toFixed(2)} {i.stockUnit})</option>
          ))}
        </select>
      </Field>
      <Field label={t("admin:inv_wastage_quantity")}>
        <input className="input" type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} min="0" />
      </Field>
      <Field label={t("admin:inv_wastage_reason")}>
        <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
          {WASTAGE_REASONS.map((r) => <option key={r} value={r}>{reasonLabel(r)}</option>)}
        </select>
      </Field>
      <Field label={t("admin:inv_wastage_notes")}>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
      </Field>
      {selected && Number(quantity) > 0 && (
        <p className="muted small">
          {t("admin:inv_wastage_cost_hint", { amount: (Number(quantity) * Number(selected.costPerUnit)).toFixed(2) })}
        </p>
      )}
    </Modal>
  );
}

function RecipeModal({ ingredients, onClose }: { ingredients: Ingredient[]; onClose: () => void }) {
  const { push } = useToast();
  const { t } = useTranslation(["admin", "common"]);
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
    onSuccess: () => { push(t("admin:inv_recipe_saved"), "ok"); onClose(); },
    onError: (e) => push(e instanceof Error ? e.message : t("admin:tba_failed"), "error"),
  });

  const cost = lines.reduce((s, l) => {
    const ing = ingredients.find((i) => i.id === l.ingredientId);
    return s + (ing ? Number(ing.costPerUnit) * Number(l.quantity || 0) : 0);
  }, 0);

  return (
    <Modal
      title={t("admin:inv_recipe_editor")}
      onClose={onClose}
      wide
      footer={<><button className="btn ghost" onClick={onClose}>{t("common:cancel")}</button><button className="btn primary" disabled={!itemId || save.isPending} onClick={() => save.mutate()}>{t("admin:inv_save_recipe")}</button></>}
    >
      <Field label={t("admin:inv_fld_menu_item")}>
        <select className="input" value={itemId} onChange={(e) => { setItemId(e.target.value); setLines([]); }}>
          <option value="">{t("admin:inv_select_item")}</option>
          {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
      </Field>

      {itemId && (
        <>
          {isLoading && <p className="muted small">{t("common:loading")}</p>}
          <table className="tbl" style={{ marginTop: 10 }}>
            <thead><tr><th>{t("admin:col_ingredient")}</th><th>{t("admin:col_qty")}</th><th /></tr></thead>
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
                    <td><button className="btn ghost small" onClick={() => setLines((ls) => ls.filter((_, i2) => i2 !== idx))}>{t("admin:mnu_remove")}</button></td>
                  </tr>
                );
              })}
              {lines.length === 0 && !isLoading && <tr><td colSpan={3} className="muted">{t("admin:inv_no_ingredients")}</td></tr>}
            </tbody>
          </table>

          <div className="row" style={{ marginTop: 10 }}>
            <select className="input" value={pick.ingredientId} onChange={(e) => setPick({ ...pick, ingredientId: e.target.value })}>
              <option value="">{t("admin:inv_add_ingredient_opt")}</option>
              {ingredients.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.stockUnit})</option>)}
            </select>
            <input className="input" type="number" placeholder={t("admin:inv_qty_placeholder")} style={{ maxWidth: 120 }} value={pick.quantity} onChange={(e) => setPick({ ...pick, quantity: e.target.value })} />
            <button
              className="btn"
              disabled={!pick.ingredientId || !pick.quantity}
              onClick={() => { setLines((ls) => [...ls, { ingredientId: pick.ingredientId, quantity: pick.quantity }]); setPick({ ingredientId: "", quantity: "" }); }}
            >
              {t("admin:tba_btn_add")}
            </button>
          </div>

          <p className="muted small" style={{ marginTop: 10 }}>{t("admin:inv_theoretical_cost")} <strong>{cost.toFixed(2)}</strong> {t("admin:inv_theoretical_hint")}</p>
        </>
      )}
    </Modal>
  );
}

function AdjustModal({ ingredient, onClose, onDone }: { ingredient: Ingredient; onClose: () => void; onDone: () => void }) {
  const { push } = useToast();
  const { t } = useTranslation(["admin", "common"]);
  const typeLabel = (s: string) => t(`admin:mt_${s.toLowerCase()}`, { defaultValue: s.replace(/_/g, " ") });
  const [quantity, setQuantity] = useState("");
  const [type, setType] = useState("PURCHASE_RECEIPT");
  const [reason, setReason] = useState("");
  const [unitCost, setUnitCost] = useState("");

  const mut = useMutation({
    mutationFn: () => apiPost(`/inventory/ingredients/${ingredient.id}/adjust`, { quantity: Number(quantity), type, reason: reason || undefined, unitCost: unitCost ? Number(unitCost) : undefined }),
    onSuccess: () => { push(t("admin:inv_stock_adjusted"), "ok"); onDone(); },
    onError: (e) => push(e instanceof Error ? e.message : t("admin:tba_failed"), "error"),
  });

  return (
    <Modal
      title={t("admin:inv_adjust_title", { name: ingredient.name })}
      onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>{t("common:cancel")}</button><button className="btn primary" disabled={!quantity} onClick={() => mut.mutate()}>{t("admin:sh_apply")}</button></>}
    >
      <p className="muted small">{t("admin:inv_current", { amount: Number(ingredient.currentStock).toFixed(2), unit: ingredient.stockUnit })}</p>
      <Field label={t("admin:col_type")}>
        <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
          {ADJ_TYPES.map((ty) => <option key={ty} value={ty}>{typeLabel(ty)}</option>)}
        </select>
      </Field>
      <Field label={t("admin:inv_fld_quantity")}><input className="input" type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></Field>
      <Field label={t("admin:inv_fld_unit_cost_opt")}><input className="input" type="number" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} /></Field>
      <Field label={t("admin:col_reason")}><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </Modal>
  );
}
