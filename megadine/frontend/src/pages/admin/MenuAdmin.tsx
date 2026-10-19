import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiDel, apiGet, apiPatch, apiPost } from "../../lib/api";
import { formatMoney, fromCents, toCents } from "../../lib/format";
import { Field, Modal, useToast } from "../../components/ui";

interface Variant { id: string; name: string; priceAdjust: string; isAvailable: boolean }
interface Option { id: string; name: string; price: string; isAvailable: boolean }
interface ModGroup { id: string; name: string; required: boolean; minSelect: number; maxSelect: number | null; options: Option[] }
interface Item { id: string; name: string; description?: string | null; prepTime?: number; price: string; station: string; isAvailable: boolean; isActive: boolean; variants: Variant[]; modifierGroups: ModGroup[] }
interface Category { id: string; name: string; isActive: boolean; items: Item[] }
interface Settings { restaurant: { currency: string } | null }

const STATIONS = ["GRILL", "FRYER", "SALAD", "BAR", "DESSERT", "KITCHEN"];

export default function MenuAdmin() {
  const qc = useQueryClient();
  const { push } = useToast();
  const { t } = useTranslation(["admin", "common"]);
  const stationLabel = (s: string) => t(`admin:stn_${s.toLowerCase()}`, { defaultValue: s });
  const { data } = useQuery({ queryKey: ["menu", "all"], queryFn: () => apiGet<{ categories: Category[] }>("/menu", { all: "true" }) });
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => apiGet<Settings>("/admin/settings") });
  const currency = settings?.restaurant?.currency ?? "USD";
  const [showCat, setShowCat] = useState(false);
  const [catName, setCatName] = useState("");
  const [addTo, setAddTo] = useState<Category | null>(null);
  const [editItem, setEditItem] = useState<{ category: Category; item: Item } | null>(null);
  const [editCat, setEditCat] = useState<Category | null>(null);
  const [manage, setManage] = useState<Item | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["menu"] });

  const addCat = useMutation({
    mutationFn: () => apiPost("/menu/categories", { name: catName }),
    onSuccess: () => { setCatName(""); setShowCat(false); invalidate(); push(t("admin:mnu_category_added"), "ok"); },
    onError: (e) => push(e instanceof Error ? e.message : t("admin:tba_failed"), "error"),
  });

  const toggle = useMutation({
    mutationFn: ({ id, isAvailable }: { id: string; isAvailable: boolean }) => apiPost(`/menu/items/${id}/availability`, { isAvailable }),
    onSuccess: invalidate,
  });

  const del = useMutation({
    mutationFn: (id: string) => apiDel(`/menu/items/${id}`),
    onSuccess: () => { invalidate(); push(t("admin:mnu_item_removed"), "ok"); },
  });

  return (
    <div>
      <div className="row" style={{ marginBottom: 14 }}>
        <button className="btn primary" onClick={() => setShowCat(true)}>{t("admin:mnu_add_category")}</button>
      </div>

      <div className="grid cols-2">
        {(data?.categories ?? []).map((c) => (
          <div className="card" key={c.id}>
            <div className="row">
              <h3 style={{ margin: 0, flex: 1 }}>{c.name}</h3>
              <button className="btn ghost small" onClick={() => setEditCat(c)}>{t("admin:tba_edit")}</button>
              <button className="btn small" onClick={() => setAddTo(c)}>{t("admin:mnu_add_item")}</button>
            </div>
            <table className="tbl" style={{ marginTop: 8 }}>
              <thead>
                <tr><th>{t("admin:col_item")}</th><th>{t("admin:mnu_col_price")}</th><th>{t("admin:mnu_col_station")}</th><th /></tr>
              </thead>
              <tbody>
                {c.items.map((i) => (
                  <tr key={i.id}>
                    <td>
                      {i.name}
                      {i.variants.length > 0 && <span className="badge muted" style={{ marginLeft: 6 }}>{t("admin:mnu_variants_badge", { count: i.variants.length })}</span>}
                      {i.modifierGroups.length > 0 && <span className="badge muted" style={{ marginLeft: 6 }}>{t("admin:mnu_mod_badge", { count: i.modifierGroups.length })}</span>}
                    </td>
                    <td className="mono">{formatMoney(toCents(i.price), currency)}</td>
                    <td className="small muted">{stationLabel(i.station)}</td>
                    <td>
                      <div className="row" style={{ justifyContent: "flex-end" }}>
                        <button className="btn small ghost" onClick={() => setEditItem({ category: c, item: i })}>{t("admin:tba_edit")}</button>
                        <button className="btn small" onClick={() => setManage(i)}>{t("admin:mnu_options")}</button>
                        <button className={`btn small ${i.isAvailable ? "" : "danger"}`} onClick={() => toggle.mutate({ id: i.id, isAvailable: !i.isAvailable })}>
                          {i.isAvailable ? "86" : t("admin:mnu_restore")}
                        </button>
                        <button className="btn ghost small" onClick={() => del.mutate(i.id)}>{t("admin:exp_delete")}</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {c.items.length === 0 && <tr><td colSpan={4} className="muted">{t("admin:mnu_empty_items")}</td></tr>}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {showCat && (
        <Modal title={t("admin:mnu_new_category")} onClose={() => setShowCat(false)} footer={<><button className="btn ghost" onClick={() => setShowCat(false)}>{t("common:cancel")}</button><button className="btn primary" disabled={!catName} onClick={() => addCat.mutate()}>{t("admin:tba_btn_add")}</button></>}>
          <Field label={t("admin:col_name")}><input className="input" value={catName} onChange={(e) => setCatName(e.target.value)} /></Field>
        </Modal>
      )}

      {addTo && <ItemModal category={addTo} currency={currency} onClose={() => setAddTo(null)} onSaved={() => { setAddTo(null); invalidate(); }} />}
      {editItem && <ItemModal category={editItem.category} item={editItem.item} currency={currency} onClose={() => setEditItem(null)} onSaved={() => { setEditItem(null); invalidate(); }} />}
      {editCat && <CategoryModal category={editCat} onClose={() => setEditCat(null)} onSaved={() => { setEditCat(null); invalidate(); }} />}
      {manage && <ItemOptionsModal item={manage} currency={currency} onClose={() => { setManage(null); invalidate(); }} />}
    </div>
  );
}

function CategoryModal({ category, onClose, onSaved }: { category: Category; onClose: () => void; onSaved: () => void }) {
  const { push } = useToast();
  const { t } = useTranslation(["admin", "common"]);
  const [name, setName] = useState(category.name);

  const mut = useMutation({
    mutationFn: () => apiPatch(`/menu/categories/${category.id}`, { name }),
    onSuccess: () => { push(t("admin:mnu_category_updated"), "ok"); onSaved(); },
    onError: (e) => push(e instanceof Error ? e.message : t("admin:tba_failed"), "error"),
  });

  return (
    <Modal
      title={t("admin:mnu_edit_category_title", { name: category.name })}
      onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>{t("common:cancel")}</button><button className="btn primary" disabled={!name.trim() || mut.isPending} onClick={() => mut.mutate()}>{t("admin:tba_btn_save")}</button></>}
    >
      <Field label={t("admin:col_name")}><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
    </Modal>
  );
}

function ItemModal({ category, currency, item, onClose, onSaved }: { category: Category; currency: string; item?: Item; onClose: () => void; onSaved: () => void }) {
  const { push } = useToast();
  const { t } = useTranslation(["admin", "common"]);
  const stationLabel = (s: string) => t(`admin:stn_${s.toLowerCase()}`, { defaultValue: s });
  const [name, setName] = useState(item?.name ?? "");
  const [price, setPrice] = useState(item ? fromCents(toCents(item.price)) : "");
  const [station, setStation] = useState(item?.station ?? "KITCHEN");
  const [desc, setDesc] = useState(item?.description ?? "");
  const [prep, setPrep] = useState(item?.prepTime != null ? String(item.prepTime) : "10");

  const mut = useMutation({
    mutationFn: () => {
      const body = { name, price: Number(price), station, description: desc || null, prepTime: Number(prep) || 0 };
      return item ? apiPatch(`/menu/items/${item.id}`, body) : apiPost("/menu/items", { categoryId: category.id, ...body });
    },
    onSuccess: () => { push(item ? t("admin:mnu_item_updated") : t("admin:mnu_item_added"), "ok"); onSaved(); },
    onError: (e) => push(e instanceof Error ? e.message : t("admin:tba_failed"), "error"),
  });

  return (
    <Modal
      title={t("admin:mnu_item_title", { action: item ? t("admin:mnu_edit_item") : t("admin:mnu_new_item"), name: category.name })}
      onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>{t("common:cancel")}</button><button className="btn primary" disabled={!name || !price || mut.isPending} onClick={() => mut.mutate()}>{item ? t("admin:tba_btn_save") : t("admin:tba_btn_add")}</button></>}
    >
      <Field label={t("admin:col_name")}><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label={t("admin:mnu_fld_price", { currency })}><input className="input" type="number" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
      <Field label={t("admin:mnu_col_station")}>
        <select className="input" value={station} onChange={(e) => setStation(e.target.value)}>
          {STATIONS.map((st) => <option key={st} value={st}>{stationLabel(st)}</option>)}
        </select>
      </Field>
      <Field label={t("admin:mnu_fld_prep")}><input className="input" type="number" value={prep} onChange={(e) => setPrep(e.target.value)} /></Field>
      <Field label={t("admin:mnu_fld_description")}><input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
    </Modal>
  );
}

function ItemOptionsModal({ item, currency, onClose }: { item: Item; currency: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { push } = useToast();
  const { t } = useTranslation(["admin", "common"]);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["menu"] });
  const [vName, setVName] = useState("");
  const [vAdj, setVAdj] = useState("");
  const [gName, setGName] = useState("");
  const [gRequired, setGRequired] = useState(false);
  const [newOpts, setNewOpts] = useState<Record<string, { name: string; price: string }>>({});

  const fail = (e: unknown) => push(e instanceof Error ? e.message : t("admin:tba_failed"), "error");

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
    <Modal title={t("admin:mnu_options_title", { name: item.name })} onClose={onClose} wide footer={<button className="btn primary" onClick={onClose}>{t("admin:mnu_done")}</button>}>
      <div className="card" style={{ marginBottom: 14 }}>
        <h3 style={{ marginTop: 0 }}>{t("admin:mnu_variants")}</h3>
        {item.variants.map((v) => (
          <div className="row" key={v.id} style={{ marginBottom: 6 }}>
            <span style={{ flex: 1 }}>{v.name}</span>
            <span className="mono muted small">{Number(v.priceAdjust) >= 0 ? "+" : ""}{formatMoney(toCents(v.priceAdjust), currency)}</span>
            <button className="btn ghost small" onClick={() => delVariant.mutate(v.id)}>{t("admin:mnu_remove")}</button>
          </div>
        ))}
        {item.variants.length === 0 && <p className="muted small">{t("admin:mnu_no_variants")}</p>}
        <div className="row" style={{ marginTop: 8 }}>
          <input className="input" placeholder={t("admin:mnu_variant_name")} value={vName} onChange={(e) => setVName(e.target.value)} />
          <input className="input" type="number" placeholder={t("admin:mnu_variant_adj")} value={vAdj} onChange={(e) => setVAdj(e.target.value)} style={{ maxWidth: 120 }} />
          <button className="btn" disabled={!vName} onClick={() => addVariant.mutate()}>{t("admin:tba_btn_add")}</button>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("admin:mnu_mod_groups")}</h3>
        {item.modifierGroups.map((g) => (
          <div key={g.id} style={{ borderTop: "1px solid var(--line)", paddingTop: 8, marginTop: 8 }}>
            <div className="row">
              <strong style={{ flex: 1 }}>{g.name}{g.required ? t("admin:mnu_required_suffix") : ""}</strong>
              <button className="btn ghost small" onClick={() => delGroup.mutate(g.id)}>{t("admin:mnu_remove_group")}</button>
            </div>
            {g.options.map((o) => (
              <div className="row" key={o.id} style={{ marginTop: 4 }}>
                <span style={{ flex: 1 }} className={o.isAvailable ? "" : "muted"}>{o.name}</span>
                <span className="mono muted small">{Number(o.price) ? `+${formatMoney(toCents(o.price), currency)}` : t("admin:mnu_no_charge")}</span>
                <button className="btn ghost small" onClick={() => toggleOption.mutate({ id: o.id, isAvailable: !o.isAvailable })}>{o.isAvailable ? "86" : t("admin:mnu_restore")}</button>
                <button className="btn ghost small" onClick={() => delOption.mutate(o.id)}>×</button>
              </div>
            ))}
            <div className="row" style={{ marginTop: 6 }}>
              <input
                className="input"
                placeholder={t("admin:mnu_option_name")}
                value={newOpts[g.id]?.name ?? ""}
                onChange={(e) => setNewOpts((s) => ({ ...s, [g.id]: { name: e.target.value, price: s[g.id]?.price ?? "" } }))}
              />
              <input
                className="input"
                type="number"
                placeholder={t("admin:mnu_plus_price")}
                style={{ maxWidth: 110 }}
                value={newOpts[g.id]?.price ?? ""}
                onChange={(e) => setNewOpts((s) => ({ ...s, [g.id]: { name: s[g.id]?.name ?? "", price: e.target.value } }))}
              />
              <button
                className="btn"
                disabled={!(newOpts[g.id]?.name)}
                onClick={() => addOption.mutate({ groupId: g.id, name: newOpts[g.id]!.name, price: newOpts[g.id]!.price })}
              >
                {t("admin:mnu_add_option")}
              </button>
            </div>
          </div>
        ))}
        {item.modifierGroups.length === 0 && <p className="muted small">{t("admin:mnu_no_groups")}</p>}
        <div className="row" style={{ marginTop: 8 }}>
          <input className="input" placeholder={t("admin:mnu_group_name")} value={gName} onChange={(e) => setGName(e.target.value)} />
          <label className="row small" style={{ gap: 6 }}>
            <input type="checkbox" checked={gRequired} onChange={(e) => setGRequired(e.target.checked)} /> {t("admin:mnu_required")}
          </label>
          <button className="btn" disabled={!gName} onClick={() => addGroup.mutate()}>{t("admin:mnu_add_group")}</button>
        </div>
      </div>
      <p className="muted small" style={{ marginTop: 10 }}>{t("admin:mnu_base_price", { amount: formatMoney(toCents(item.price), currency) })}</p>
    </Modal>
  );
}
