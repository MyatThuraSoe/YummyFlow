import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPut } from "../lib/api";
import { useCart, type CartLine } from "../store/cart";
import { useAuth } from "../store/auth";
import { computeTotals, formatMoney, fromCents, toCents } from "../lib/format";
import { enqueueOrder, pendingCount, shouldQueue } from "../lib/outbox";
import { printOrderReceipt } from "../lib/receipts";
import { Field, Modal, useToast } from "../components/ui";

interface MenuOption { id: string; name: string; price: string; isAvailable: boolean }
interface ModifierGroup { id: string; name: string; required: boolean; minSelect: number; maxSelect: number | null; options: MenuOption[] }
interface Variant { id: string; name: string; priceAdjust: string; isAvailable: boolean }
interface MenuItem { id: string; name: string; description: string | null; price: string; isAvailable: boolean; station: string; variants: Variant[]; modifierGroups: ModifierGroup[] }
interface Category { id: string; name: string; items: MenuItem[] }
interface TableRow { id: string; number: number; name: string | null; status: string; capacity: number; zone: string }
interface Settings { restaurant: { currency: string; taxRate: string; taxInclusive: boolean; serviceChargePct: string } | null }

interface ServerLine { id: string; menuItemId: string; itemNameSnapshot: string; variantSnapshot: string | null; unitPriceSnapshot: string; quantity: number; lineTotal: string; isVoided: boolean; notes: string | null; servedQuantity?: number; modifiers: { id: string; nameSnapshot: string; priceSnapshot: string }[] }
interface OrderShape {
  id: string; orderNumber: number; total: string; subtotal: string; taxAmount: string; serviceCharge: string; discountAmount: string; amountPaid: string; paymentStatus: string;
  status: string; priority?: string; channel: string; tableId: string | null; lines: ServerLine[];
  tableSession?: { table: { number: number; name: string | null } } | null;
}

type Tender = { method: string; amount: number; cashReceived?: number; reference?: string | null };

export default function Pos() {
  const qc = useQueryClient();
  const { push } = useToast();
  const { can } = useAuth();
  const { t } = useTranslation(["ops", "common"]);
  const cart = useCart();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [modItem, setModItem] = useState<MenuItem | null>(null);
  const [showPay, setShowPay] = useState(false);
  const [showDiscount, setShowDiscount] = useState(false);
  const [showOrders, setShowOrders] = useState(false);
  const [showServe, setShowServe] = useState(false);
  const [showSplit, setShowSplit] = useState(false);
  const [splitPay, setSplitPay] = useState<{ id: string; name: string; total: number } | null>(null);
  const [order, setOrder] = useState<OrderShape | null>(null);
  const [voidTarget, setVoidTarget] = useState<ServerLine | null>(null);
  const [busy] = useState(false);
  const [queued, setQueued] = useState(pendingCount());
  const [notes, setNotes] = useState("");
  const [pickupName, setPickupName] = useState("");
  const [receipt, setReceipt] = useState<{ orderId: string; orderNumber: number; preview: string; changeGiven: string | null } | null>(null);
  const [search, setSearch] = useState("");
  const [cartCollapsed, setCartCollapsed] = useState(() => localStorage.getItem("pos_cart_collapsed") === "1");

  const { data: menu } = useQuery({ queryKey: ["menu"], queryFn: () => apiGet<{ categories: Category[] }>("/menu") });
  const { data: tables } = useQuery({ queryKey: ["tables"], queryFn: () => apiGet<{ tables: TableRow[] }>("/tables") });
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => apiGet<Settings>("/admin/settings") });
  const { data: shiftRes } = useQuery({ queryKey: ["shift"], queryFn: () => apiGet<{ shift: { id: string } | null }>("/shifts/current") });

  const currency = settings?.restaurant?.currency ?? "USD";
  const cfg = {
    taxRate: Number(settings?.restaurant?.taxRate ?? 0.085),
    taxInclusive: settings?.restaurant?.taxInclusive ?? false,
    serviceChargePct: Number(settings?.restaurant?.serviceChargePct ?? 0),
  };
  const categories = menu?.categories ?? [];
  const current = categories.find((c) => c.id === activeCat) ?? categories[0];
  const searchTerm = search.trim().toLowerCase();
  const searchResults = searchTerm ? categories.flatMap((c) => c.items).filter((i) => i.name.toLowerCase().includes(searchTerm)) : null;
  const gridItems = searchResults ?? current?.items ?? [];
  const cartCount = (order?.lines.filter((l) => !l.isVoided).length ?? 0) + cart.lines.length;
  const availableTables = (tables?.tables ?? []).filter((t) => t.status === "AVAILABLE" || t.status === "OCCUPIED");
  const shiftOpen = !!shiftRes?.shift;
  const locked = !!cart.orderId;

  const lineTotals = cart.lineTotals();
  const totals = useMemo(() => computeTotals(lineTotals, 0, cfg), [lineTotals, cfg]);
  const orderDue = order ? Math.max(0, toCents(order.total) - toCents(order.amountPaid ?? "0")) : 0;
  const newItemsTotal = cart.lines.length ? totals.total : 0;
  const chargeTotal = order ? orderDue + newItemsTotal : totals.total;

  const channelLabel = (channel: string) => t(`ops:channel_${String(channel).toLowerCase()}`, { defaultValue: String(channel).replace("_", " ") });
  const statusLabel = (status: string) => t(`ops:order_status_${String(status).toLowerCase()}`, { defaultValue: String(status).replaceAll("_", " ") });

  const serveableLines = order?.lines.filter((l) => !l.isVoided) ?? [];
  const serveTotal = serveableLines.reduce((s, l) => s + l.quantity, 0);
  const serveDone = serveableLines.reduce((s, l) => s + Math.min(l.servedQuantity ?? 0, l.quantity), 0);
  const canServe = !!order && !["DRAFT", "COMPLETED", "CANCELLED"].includes(order.status) && serveDone < serveTotal;

  function recallOrder(o: OrderShape) {
    cart.loadFromServer({
      channel: o.channel as never,
      tableId: o.tableId,
      tableLabel: o.tableSession?.table ? `#${o.tableSession.table.number}` : null,
      orderId: o.id,
      orderNumber: o.orderNumber,
      orderDiscount: 0,
      lines: [],
    });
    setOrder(o);
    setShowOrders(false);
    push(t("ops:pos_recalled", { number: o.orderNumber }), "ok");
  }

  useEffect(() => {
    const tid = searchParams.get("tableId");
    if (!tid) return;
    setSearchParams({}, { replace: true });
    if (cart.orderId) return;
    apiGet<{ orders: OrderShape[] }>("/orders/open", { tableId: tid })
      .then((res) => {
        if (res.orders[0]) recallOrder(res.orders[0]);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pickTable(tableId: string) {
    const tbl = availableTables.find((x) => x.id === tableId);
    if (!tableId || !tbl) {
      cart.setTable(null, null);
      return;
    }
    cart.setTable(tbl.id, `#${tbl.number}`);
    if (tbl.status === "OCCUPIED") {
      try {
        const res = await apiGet<{ orders: OrderShape[] }>("/orders/open", { tableId: tbl.id });
        if (res.orders[0]) recallOrder(res.orders[0]);
        else push(t("ops:pos_table_in_use_no_order", { number: tbl.number }), "info");
      } catch {
        /* keep the selection; creating a new order will surface any conflict */
      }
    }
  }

  function addItem(item: MenuItem) {
    const needsModal = item.variants.length > 0 || item.modifierGroups.some((g) => g.options.length > 0);
    if (needsModal) return setModItem(item);
    cart.addLine({ menuItemId: item.id, name: item.name, unitPrice: toCents(item.price), modifiers: [], quantity: 1, variantId: null, variantName: null });
  }

  function onSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter" || !searchTerm) return;
    const all = categories.flatMap((c) => c.items);
    const target = all.find((i) => i.name.toLowerCase() === searchTerm) ?? (searchResults?.length === 1 ? searchResults[0] : null);
    if (!target || !target.isAvailable) return;
    addItem(target);
    setSearch("");
    push(t("ops:pos_search_added", { name: target.name }), "ok");
  }

  function toggleCart() {
    setCartCollapsed((c) => {
      localStorage.setItem("pos_cart_collapsed", c ? "0" : "1");
      return !c;
    });
  }

  function cartToItems() {
    return cart.lines.map((l) => ({
      menuItemId: l.menuItemId,
      quantity: l.quantity,
      variantId: l.variantId || null,
      modifierOptionIds: l.modifiers.map((m) => m.id),
      notes: l.notes ?? null,
    }));
  }

  function buildCreateBody() {
    return {
      channel: cart.channel,
      tableId: cart.channel === "DINE_IN" ? cart.tableId : null,
      shiftId: shiftRes?.shift?.id ?? null,
      items: cartToItems(),
      notes: notes || null,
      pickupName: cart.channel === "DINE_IN" ? null : pickupName || null,
    };
  }

  async function ensureOrder(): Promise<OrderShape> {
    if (order) return order;
    const res = await apiPost<{ order: OrderShape }>("/orders", buildCreateBody());
    cart.setOrder(res.order.id, res.order.orderNumber);
    cart.clearLines();
    setOrder(res.order);
    qc.invalidateQueries({ queryKey: ["orders"] });
    return res.order;
  }

  /** Append not-yet-submitted cart lines to the server order (round 2+). */
  async function pushPendingItems(o: OrderShape): Promise<OrderShape> {
    if (!cart.lines.length) return o;
    await apiPost(`/orders/${o.id}/items`, { items: cartToItems() });
    cart.clearLines();
    const fresh = await apiGet<{ order: OrderShape }>(`/orders/${o.id}`);
    setOrder(fresh.order);
    return fresh.order;
  }

  function queueOffline(o: OrderShape | null, opts: { sendToKitchen: boolean; payNow: boolean; tenders?: Tender[]; idemKey?: string }) {
    enqueueOrder({
      label: o ? `${t("ops:order_number", { number: o.orderNumber })} · ${cart.lines.length}` : `${channelLabel(cart.channel)} · ${cart.lines.length}`,
      orderId: o?.id ?? null,
      addItems: cartToItems(),
      create: o ? null : buildCreateBody(),
      sendToKitchen: opts.sendToKitchen,
      pay: opts.payNow
        ? {
            shiftId: shiftRes?.shift?.id ?? null,
            idempotencyKey: opts.idemKey ?? `pay-${crypto.randomUUID()}`,
            payments: opts.tenders ?? [{ method: "CASH", amount: Number(fromCents(chargeTotal)) }],
          }
        : null,
    });
    setQueued(pendingCount());
    qc.invalidateQueries({ queryKey: ["outbox"] });
  }

  const sendMut = useMutation({
    mutationFn: async () => {
      let o: OrderShape | null = null;
      try {
        o = await ensureOrder();
        const withItems = await pushPendingItems(o);
        return await apiPost<{ tickets: number }>(`/orders/${withItems.id}/send-to-kitchen`);
      } catch (e) {
        if (!shouldQueue(e)) throw e;
        queueOffline(o, { sendToKitchen: true, payNow: false });
        if (o) cart.clearLines();
        else {
          cart.reset();
          setOrder(null);
        }
        return null;
      }
    },
    onSuccess: (r) => {
      if (!r) {
        push(t("ops:pos_offline_queued_toast"), "info");
        return;
      }
      push(t("ops:pos_sent_kitchen_toast", { count: r.tickets }), "ok");
      qc.invalidateQueries({ queryKey: ["tickets"] });
      qc.invalidateQueries({ queryKey: ["tables"] });
    },
    onError: (e) => push(e instanceof Error ? e.message : t("ops:failed"), "error"),
  });

  async function doDiscount(type: "PERCENT" | "ABSOLUTE", value: number, managerPin?: string) {
    const o = await ensureOrder();
    await apiPost(`/orders/${o.id}/discount`, { type, value, managerPin });
    const fresh = await apiGet<{ order: OrderShape }>(`/orders/${o.id}`);
    setOrder(fresh.order);
    setShowDiscount(false);
    push(t("ops:pos_discount_applied"), "ok");
    qc.invalidateQueries({ queryKey: ["orders"] });
  }

  async function pay(tenders: Tender[], idemKey: string, splitId?: string) {
    let o: OrderShape | null = order;
    try {
      if (splitId && shouldQueue()) {
        push(t("ops:split_offline"), "error");
        return;
      }
      if (!shouldQueue()) {
        o = await ensureOrder();
        const withItems = await pushPendingItems(o);
        // Anything not yet in the kitchen must still reach it before the sale
        // completes (send-to-kitchen only creates tickets for unsent lines).
        await apiPost(`/orders/${withItems.id}/send-to-kitchen`);
        const res = await apiPost<{ order: { orderNumber: number; paymentStatus: string; receiptPreview: string; changeGiven: string | null } }>("/payments", {
          orderId: withItems.id,
          shiftId: shiftRes?.shift?.id ?? null,
          idempotencyKey: idemKey,
          splitId: splitId ?? null,
          payments: tenders,
        });
        setShowPay(false);
        setSplitPay(null);
        if (res.order.paymentStatus !== "SUCCEEDED") {
          push(t("ops:pos_partial_payment"), "info");
          const fresh = await apiGet<{ order: OrderShape }>(`/orders/${withItems.id}`);
          setOrder(fresh.order);
          cart.clearLines();
          qc.invalidateQueries({ queryKey: ["splits", withItems.id] });
          return;
        }
        push(t("ops:pos_payment_complete", { number: res.order.orderNumber }), "ok");
        cart.reset();
        setOrder(null);
        setNotes("");
        setPickupName("");
        setReceipt({ orderId: withItems.id, orderNumber: res.order.orderNumber, preview: res.order.receiptPreview, changeGiven: res.order.changeGiven });
        qc.invalidateQueries({ queryKey: ["orders"] });
        qc.invalidateQueries({ queryKey: ["tables"] });
        qc.invalidateQueries({ queryKey: ["shift"] });
        return;
      }
    } catch (e) {
      if (!shouldQueue(e)) throw e;
    }
    queueOffline(o, { sendToKitchen: true, payNow: true, tenders, idemKey });
    setShowPay(false);
    cart.reset();
    setOrder(null);
    setNotes("");
    setPickupName("");
    push(t("ops:pos_offline_payment_queued"), "info");
  }

  async function holdOrder() {
    if (!cart.lines.length && !order) return;
    let o: OrderShape | null = order;
    try {
      o = await ensureOrder();
      if (cart.lines.length) o = await pushPendingItems(o);
      push(t("ops:pos_order_held", { number: o.orderNumber }), "ok");
    } catch (e) {
      if (!shouldQueue(e)) {
        push(e instanceof Error ? e.message : t("ops:failed"), "error");
        return;
      }
      queueOffline(o, { sendToKitchen: false, payNow: false });
      if (o) cart.clearLines();
      push(t("ops:pos_offline_queued_toast"), "info");
    }
    cart.reset();
    setOrder(null);
    setNotes("");
    setPickupName("");
    setShowOrders(true);
  }

  async function reprint(orderId: string) {
    try {
      await apiPost(`/orders/${orderId}/reprint`);
      push(t("ops:receipt_sent"), "ok");
    } catch (e) {
      push(e instanceof Error ? e.message : t("ops:reprint_failed"), "error");
    }
  }

  function onServed(saved: OrderShape, newlyServed: number) {
    setOrder(saved);
    const fully = saved.lines.filter((l) => !l.isVoided).every((l) => (l.servedQuantity ?? 0) >= l.quantity);
    push(fully ? t("ops:pos_served_toast") : t("ops:pos_lines_served_toast", { count: newlyServed }), "ok");
    qc.invalidateQueries({ queryKey: ["tables"] });
    setShowServe(false);
  }

  async function voidLine(lineId: string, reason: string, managerPin?: string) {
    const o = order!;
    await apiPost(`/orders/${o.id}/void-line`, { lineId, reason, managerPin });
    const fresh = await apiGet<{ order: OrderShape }>(`/orders/${o.id}`);
    setOrder(fresh.order);
    setVoidTarget(null);
    push(t("ops:pos_line_voided"), "ok");
  }

  async function openShift() {
    try {
      await apiPost("/shifts/open", { openingFloat: 0 });
      qc.invalidateQueries({ queryKey: ["shift"] });
      push(t("ops:pos_shift_opened"), "ok");
    } catch (e) {
      push(e instanceof Error ? e.message : t("ops:pos_failed_open_shift"), "error");
    }
  }

  return (
    <div className={`pos ${cartCollapsed ? "cart-min" : ""}`}>
      <section className="pos-menu">
        <div className="row" style={{ marginBottom: 8 }}>
          <button className="btn" onClick={() => setShowOrders(true)}>
            {t("ops:pos_held_orders")}{queued > 0 ? ` · ${t("ops:pos_queued_count", { count: queued })}` : ""}
          </button>
          {queued > 0 && <span className="badge warn">{t("ops:pos_offline_queued", { count: queued })}</span>}
          <div className="spacer" />
          <input
            className="input pos-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={onSearchKey}
            placeholder={t("ops:pos_search_ph")}
            aria-label={t("ops:pos_search_ph")}
          />
        </div>
        <div className="cat-tabs">
          {categories.map((c) => (
            <button key={c.id} className={`cat-tab ${!searchTerm && current?.id === c.id ? "active" : ""}`} onClick={() => { setSearch(""); setActiveCat(c.id); }}>
              {c.name}
            </button>
          ))}
        </div>
        <div className="item-grid">
          {gridItems.map((item) => (
            <button
              key={item.id}
              className={`item-card ${!item.isAvailable ? "unavailable" : ""}`}
              disabled={!item.isAvailable}
              onClick={() => addItem(item)}
            >
              <span className="name">{item.name}</span>
              <span className="price">{formatMoney(toCents(item.price), currency)}</span>
            </button>
          ))}
          {gridItems.length === 0 && <p className="muted">{searchTerm ? t("ops:pos_search_none", { query: search.trim() }) : t("ops:pos_no_items_category")}</p>}
        </div>
      </section>

      <aside className={`pos-cart ${cartCollapsed ? "collapsed" : ""}`}>
        <button className="cart-toggle" onClick={toggleCart} title={cartCollapsed ? t("ops:pos_cart_show") : t("ops:pos_cart_hide")}>
          <span className="cart-toggle-icon">🛒</span>
          {cartCount > 0 && <span className="cart-toggle-count">{cartCount}</span>}
          <span className="cart-toggle-chevron">{cartCollapsed ? "‹" : "›"}</span>
        </button>
        <div className="cart-config" style={{ padding: 12, borderBottom: "1px solid var(--line)" }}>
          <div className="row">
            <select className="input" value={cart.channel} onChange={(e) => cart.setChannel(e.target.value as never)} disabled={locked}>
              <option value="DINE_IN">{t("ops:channel_dine_in")}</option>
              <option value="TAKEAWAY">{t("ops:channel_takeaway")}</option>
              <option value="PARCEL">{t("ops:channel_parcel")}</option>
            </select>
            {cart.channel === "DINE_IN" && (
              <select className="input" value={cart.tableId ?? ""} onChange={(e) => pickTable(e.target.value)} disabled={locked}>
                <option value="">{t("ops:pos_table_placeholder")}</option>
                {availableTables.map((tbl) => (
                  <option key={tbl.id} value={tbl.id}>
                    #{tbl.number} {tbl.name ? `· ${tbl.name}` : ""} ({tbl.status === "OCCUPIED" ? t("ops:pos_in_use") : t("ops:pos_free")})
                  </option>
                ))}
              </select>
            )}
          </div>
          {!locked && (
            <div className="row" style={{ marginTop: 8 }}>
              {cart.channel !== "DINE_IN" && (
                <input className="input" placeholder={t("ops:pos_pickup_name")} value={pickupName} onChange={(e) => setPickupName(e.target.value)} />
              )}
              <input className="input" placeholder={t("ops:pos_order_notes")} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          )}
        </div>

        <div className="cart-lines">
          {order && (
            <>
              <div className="row" style={{ padding: 12 }}>
                <strong>{t("ops:order_number", { number: order.orderNumber })}</strong>
                <div className="spacer" />
                {order.priority && order.priority !== "NORMAL" && (
                  <span className={`badge ${order.priority === "RUSH" ? "danger" : order.priority === "VIP" ? "warn" : "info"}`}>
                    {t(`ops:priority_${order.priority.toLowerCase()}`)}
                  </span>
                )}
                <span className={`badge ${order.status === "DRAFT" ? "muted" : "ok"}`}>{statusLabel(order.status)}</span>
                {serveDone > 0 && serveDone < serveTotal && (
                  <span className="badge warn">{t("ops:pos_serve_progress", { served: serveDone, total: serveTotal })}</span>
                )}
              </div>
              {order.lines.filter((l) => !l.isVoided).map((l) => (
                <div className="cart-line" key={l.id}>
                  <div className="row">
                    <div style={{ flex: 1 }}>
                      <div className="lname">{l.quantity}× {l.itemNameSnapshot}</div>
                      {l.modifiers.length > 0 && <div className="small muted">+ {l.modifiers.map((m) => m.nameSnapshot).join(", ")}</div>}
                      {l.notes && <div className="small muted">{l.notes}</div>}
                      {(l.servedQuantity ?? 0) > 0 && (
                        <div className="small muted">{t("ops:pos_serve_progress", { served: l.servedQuantity, total: l.quantity })}</div>
                      )}
                    </div>
                    <div className="mono">{formatMoney(toCents(l.lineTotal), currency)}</div>
                    {order.status !== "COMPLETED" && order.status !== "CANCELLED" && (
                      <button className="btn ghost small" onClick={() => setVoidTarget(l)}>{t("ops:pos_void")}</button>
                    )}
                  </div>
                </div>
              ))}
              {order.lines.some((l) => l.isVoided) && (
                <p className="muted small" style={{ padding: "4px 12px" }}>
                  {t("ops:pos_void_hidden", { count: order.lines.filter((l) => l.isVoided).length })}
                </p>
              )}
            </>
          )}

          {!order && cart.lines.length === 0 && <p className="muted" style={{ padding: 12 }}>{t("ops:pos_tap_items")}</p>}

          {cart.lines.length > 0 && (
            <>
              {order && <p className="muted small" style={{ padding: "10px 12px 0" }}>{t("ops:pos_new_items_pending")}</p>}
              {cart.lines.map((l: CartLine) => (
                <div className="cart-line" key={l.key}>
                  <div className="row">
                    <div style={{ flex: 1 }}>
                      <div className="lname">{l.name}</div>
                      {l.variantName && <div className="small muted">{l.variantName}</div>}
                      {l.modifiers.length > 0 && <div className="small muted">+ {l.modifiers.map((m) => m.name).join(", ")}</div>}
                    </div>
                    <div className="mono">{formatMoney(cart.lineTotal(l), currency)}</div>
                  </div>
                  <div className="row" style={{ marginTop: 6 }}>
                    <button className="qty-btn" onClick={() => cart.decQty(l.key)}>−</button>
                    <span className="mono" style={{ minWidth: 24, textAlign: "center" }}>{l.quantity}</span>
                    <button className="qty-btn" onClick={() => cart.incQty(l.key)}>+</button>
                    <div className="spacer" />
                    <button className="btn ghost small" onClick={() => cart.removeLine(l.key)}>{t("ops:remove")}</button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        <div className="cart-footer">
          {!shiftOpen && (
            <div className="row" style={{ marginBottom: 10 }}>
              <span className="badge warn">{t("ops:pos_no_open_shift")}</span>
              <div className="spacer" />
              <button className="btn" onClick={openShift}>{t("ops:pos_open_shift")}</button>
            </div>
          )}
          {order ? (
            <>
              <div className="totals-row"><span className="muted">{t("ops:pos_order_subtotal")}</span><span className="mono">{formatMoney(toCents(order.subtotal), currency)}</span></div>
              {toCents(order.discountAmount) > 0 && <div className="totals-row"><span className="muted">{t("ops:pos_discount")}</span><span className="mono">−{formatMoney(toCents(order.discountAmount), currency)}</span></div>}
              {toCents(order.serviceCharge) > 0 && <div className="totals-row"><span className="muted">{t("ops:pos_service")}</span><span className="mono">{formatMoney(toCents(order.serviceCharge), currency)}</span></div>}
              <div className="totals-row"><span className="muted">{t("ops:pos_tax")}</span><span className="mono">{formatMoney(toCents(order.taxAmount), currency)}</span></div>
              <div className="totals-row"><span className="muted">{t("ops:pos_order_total")}</span><span className="mono">{formatMoney(toCents(order.total), currency)}</span></div>
              {toCents(order.amountPaid) > 0 && <div className="totals-row"><span className="muted">{t("ops:pos_paid_so_far")}</span><span className="mono">−{formatMoney(toCents(order.amountPaid), currency)}</span></div>}
              {newItemsTotal > 0 && <div className="totals-row"><span className="muted">{t("ops:pos_new_items_est")}</span><span className="mono">+{formatMoney(newItemsTotal, currency)}</span></div>}
              <div className="totals-row grand"><span>{t("ops:pos_due")}</span><span className="mono">{formatMoney(chargeTotal, currency)}</span></div>
            </>
          ) : (
            <>
              <div className="totals-row"><span className="muted">{t("ops:pos_subtotal")}</span><span className="mono">{formatMoney(totals.subtotal, currency)}</span></div>
              {totals.discountAmount > 0 && <div className="totals-row"><span className="muted">{t("ops:pos_discount")}</span><span className="mono">−{formatMoney(totals.discountAmount, currency)}</span></div>}
              {totals.serviceCharge > 0 && <div className="totals-row"><span className="muted">{t("ops:pos_service")}</span><span className="mono">{formatMoney(totals.serviceCharge, currency)}</span></div>}
              <div className="totals-row"><span className="muted">{t("ops:pos_tax")}</span><span className="mono">{formatMoney(totals.taxAmount, currency)}</span></div>
              <div className="totals-row grand"><span>{t("ops:pos_total")}</span><span className="mono">{formatMoney(totals.total, currency)}</span></div>
            </>
          )}

          <div className="row pos-fab-row" style={{ marginTop: 12, gap: 8 }}>
            <button
              className="btn primary"
              style={{ flex: 1 }}
              disabled={(!cart.lines.length && !order) || busy || (cart.channel === "DINE_IN" && !cart.tableId && !order)}
              onClick={() => sendMut.mutate()}
            >
              🍳 {sendMut.isPending ? t("ops:pos_sending") : t("ops:pos_send_kitchen")}
            </button>
            <button className="btn" disabled={(!cart.lines.length && !order) || busy} onClick={() => setShowDiscount(true)}>🏷 {t("ops:pos_discount_btn")}</button>
          </div>
          <div className="row pos-fab-row" style={{ marginTop: 8, gap: 8 }}>
            <button className="btn" style={{ flex: 1 }} disabled={(!cart.lines.length && !order) || busy} onClick={holdOrder}>⏸ {t("ops:pos_hold")}</button>
            {order && <button className="btn" onClick={() => reprint(order.id)}>🖨 {t("ops:pos_reprint")}</button>}
            {canServe && (
              <button className="btn ok" onClick={() => setShowServe(true)}>✅ {t("ops:pos_mark_served")}</button>
            )}
            {order && order.status !== "COMPLETED" && order.status !== "CANCELLED" && cart.lines.length === 0 && (
              <button className="btn" onClick={() => setShowSplit(true)}>👥 {t("ops:split_btn")}</button>
            )}
            {order && (
              <button className="btn ghost" onClick={() => { cart.reset(); setOrder(null); setNotes(""); setPickupName(""); }}>➕ {t("ops:pos_new")}</button>
            )}
          </div>
          <button
            className="btn primary block fab-charge"
            style={{ marginTop: 8, padding: "14px" }}
            disabled={(!cart.lines.length && !order) || busy || !shiftOpen || (cart.channel === "DINE_IN" && !cart.tableId && !order)}
            onClick={() => setShowPay(true)}
          >
            💳 {t("ops:pos_charge", { amount: formatMoney(chargeTotal, currency) })}
          </button>
        </div>
      </aside>

      {modItem && (
        <ModifierModal
          item={modItem}
          currency={currency}
          onClose={() => setModItem(null)}
          onAdd={(line) => { cart.addLine(line); setModItem(null); }}
        />
      )}

      {showDiscount && (
        <DiscountModal onClose={() => setShowDiscount(false)} onApply={doDiscount} currency={currency} subtotal={totals.subtotal} />
      )}

      {showPay && <PaymentModal currency={currency} total={chargeTotal} onClose={() => setShowPay(false)} onPay={pay} />}

      {showServe && order && (
        <ServeModal
          order={order}
          onClose={() => setShowServe(false)}
          onSaved={onServed}
        />
      )}

      {showSplit && order && (
        <SplitModal
          order={order}
          currency={currency}
          onClose={() => setShowSplit(false)}
          onPaySplit={(split) => setSplitPay({ id: split.id, name: split.personName, total: toCents(split.total) })}
        />
      )}

      {splitPay && (
        <PaymentModal
          currency={currency}
          total={splitPay.total}
          title={t("ops:split_pay_title", { name: splitPay.name })}
          onClose={() => setSplitPay(null)}
          onPay={(tenders, idemKey) => pay(tenders, idemKey, splitPay.id)}
        />
      )}

      {receipt && (
        <ReceiptModal
          currency={currency}
          orderNumber={receipt.orderNumber}
          preview={receipt.preview}
          changeGiven={receipt.changeGiven}
          orderId={receipt.orderId}
          onClose={() => setReceipt(null)}
        />
      )}

      {showOrders && (
        <OrdersModal currency={currency} canRefund={can("order.refund")} onClose={() => setShowOrders(false)} onRecall={recallOrder} />
      )}

      {voidTarget && <VoidModal line={voidTarget} onClose={() => setVoidTarget(null)} onSubmit={voidLine} />}
    </div>
  );
}

function OrdersModal({
  currency,
  canRefund,
  onClose,
  onRecall,
}: {
  currency: string;
  canRefund: boolean;
  onClose: () => void;
  onRecall: (o: OrderShape) => void;
}) {
  const { push } = useToast();
  const qc = useQueryClient();
  const { t } = useTranslation(["ops", "common"]);
  const [tab, setTab] = useState<"OPEN" | "RECENT">("OPEN");
  const [refundOrder, setRefundOrder] = useState<OrderShape | null>(null);

  const { data: open } = useQuery({ queryKey: ["orders", "open"], queryFn: () => apiGet<{ orders: OrderShape[] }>("/orders/open"), enabled: tab === "OPEN" });
  const { data: recent } = useQuery({
    queryKey: ["orders", "recent"],
    queryFn: () => apiGet<{ orders: OrderShape[] }>("/orders", { status: "COMPLETED", limit: 25 }),
    enabled: tab === "RECENT",
  });

  async function reprint(id: string) {
    try {
      await apiPost(`/orders/${id}/reprint`);
      push(t("ops:receipt_sent"), "ok");
    } catch (e) {
      push(e instanceof Error ? e.message : t("ops:reprint_failed"), "error");
    }
  }

  const rows = tab === "OPEN" ? open?.orders ?? [] : recent?.orders ?? [];
  const channelLabel = (channel: string) => t(`ops:channel_${String(channel).toLowerCase()}`, { defaultValue: String(channel).replace("_", " ") });

  return (
    <Modal title={t("ops:orders_title")} onClose={onClose} wide footer={<button className="btn ghost" onClick={onClose}>{t("ops:close")}</button>}>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className={`cat-tab ${tab === "OPEN" ? "active" : ""}`} onClick={() => setTab("OPEN")}>{t("ops:orders_held_open")}</button>
        <button className={`cat-tab ${tab === "RECENT" ? "active" : ""}`} onClick={() => setTab("RECENT")}>{t("ops:orders_recent")}</button>
      </div>
      <table className="tbl">
        <thead><tr><th>#</th><th>{t("ops:orders_items_header")}</th><th style={{ textAlign: "right" }}>{t("ops:orders_total_header")}</th><th /></tr></thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id}>
              <td>#{o.orderNumber}</td>
              <td className="small muted">{t("ops:orders_item_count", { count: o.lines.filter((l) => !l.isVoided).length, channel: channelLabel(o.channel) })}</td>
              <td className="mono" style={{ textAlign: "right" }}>{formatMoney(toCents(o.total), currency)}</td>
              <td>
                <div className="row" style={{ justifyContent: "flex-end" }}>
                  {tab === "OPEN" && <button className="btn small primary" onClick={() => onRecall(o)}>{t("ops:orders_recall")}</button>}
                  {tab === "RECENT" && <button className="btn small" onClick={() => reprint(o.id)}>{t("ops:pos_reprint")}</button>}
                  {tab === "RECENT" && canRefund && <button className="btn small danger" onClick={() => setRefundOrder(o)}>{t("ops:orders_refund")}</button>}
                </div>
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={4} className="muted">{t("ops:orders_nothing")}</td></tr>}
        </tbody>
      </table>

      {refundOrder && (
        <RefundModal
          order={refundOrder}
          currency={currency}
          onClose={() => setRefundOrder(null)}
          onDone={() => { setRefundOrder(null); qc.invalidateQueries({ queryKey: ["orders"] }); }}
        />
      )}
    </Modal>
  );
}

function VoidModal({ line, onClose, onSubmit }: { line: ServerLine; onClose: () => void; onSubmit: (lineId: string, reason: string, managerPin?: string) => Promise<void> }) {
  const { t } = useTranslation(["ops", "common"]);
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setErr("");
    try {
      await onSubmit(line.id, reason, pin || undefined);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("ops:void_failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={t("ops:void_title", { name: line.itemNameSnapshot })}
      onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>{t("ops:cancel")}</button><button className="btn danger" disabled={!reason || busy} onClick={submit}>{busy ? "…" : t("ops:void_submit")}</button></>}
    >
      <Field label={t("ops:void_reason")}><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("ops:void_reason_placeholder")} /></Field>
      <Field label={t("ops:void_manager_pin")}><input className="input" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="••••" /></Field>
      {err && <p className="badge danger">{err}</p>}
    </Modal>
  );
}

interface RefundedLineEntry { lineId: string; quantity: number; amountCents: number }
interface RefundDetailOrder extends OrderShape {
  payments: { id: string; amount: string; refunds: { id: string; amount: string; refundedLines: RefundedLineEntry[] | null }[] }[];
}

function RefundModal({ order, currency, onClose, onDone }: { order: OrderShape; currency: string; onClose: () => void; onDone: () => void }) {
  const { push } = useToast();
  const { t } = useTranslation(["ops", "common"]);
  const [amount, setAmount] = useState(fromCents(toCents(order.total)));
  const [sel, setSel] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const [restock, setRestock] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const { data } = useQuery({
    queryKey: ["order-refund", order.id],
    queryFn: () => apiGet<{ order: RefundDetailOrder }>(`/orders/${order.id}`),
  });
  const detail = data?.order;
  const lines = (detail?.lines ?? order.lines).filter((l) => !l.isVoided);

  const priorByLine = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of detail?.payments ?? []) {
      for (const r of p.refunds ?? []) {
        for (const e of r.refundedLines ?? []) map.set(e.lineId, (map.get(e.lineId) ?? 0) + e.quantity);
      }
    }
    return map;
  }, [detail]);

  const selected = Object.entries(sel).filter(([, q]) => q > 0);
  const autoCents = selected.reduce((s, [lineId, q]) => {
    const line = lines.find((l) => l.id === lineId);
    if (!line) return s;
    return s + Math.round((toCents(line.lineTotal) * q) / line.quantity);
  }, 0);

  function remainingFor(line: ServerLine) {
    return Math.max(0, line.quantity - (priorByLine.get(line.id) ?? 0));
  }
  function toggleLine(line: ServerLine) {
    const remaining = remainingFor(line);
    setSel((s) => ({ ...s, [line.id]: (s[line.id] ?? 0) > 0 ? 0 : remaining }));
  }
  function setQty(line: ServerLine, q: number) {
    setSel((s) => ({ ...s, [line.id]: Math.max(0, Math.min(q, remainingFor(line))) }));
  }

  async function submit() {
    setBusy(true);
    setErr("");
    try {
      const body: Record<string, unknown> = { orderId: order.id, reason, managerPin: pin, restock };
      if (selected.length) body.lines = selected.map(([lineId, quantity]) => ({ lineId, quantity }));
      else body.amount = Number(amount);
      await apiPost("/payments/refund", body);
      push(t("ops:refund_recorded"), "ok");
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("ops:refund_failed"));
    } finally {
      setBusy(false);
    }
  }

  const valid = reason.trim().length >= 2 && pin.length >= 4 && (selected.length > 0 || Number(amount) > 0);

  return (
    <Modal
      title={t("ops:refund_title", { number: order.orderNumber })}
      onClose={onClose}
      wide
      footer={<><button className="btn ghost" onClick={onClose}>{t("ops:cancel")}</button><button className="btn danger" disabled={busy || !valid} onClick={submit}>{busy ? "…" : t("ops:refund_submit")}</button></>}
    >
      <p className="muted small">{t("ops:refund_order_total", { amount: formatMoney(toCents(order.total), currency) })}</p>

      <p className="small" style={{ marginTop: 10, marginBottom: 4 }}>{t("ops:refund_select_hint")}</p>
      <table className="tbl">
        <tbody>
          {lines.map((l) => {
            const prior = priorByLine.get(l.id) ?? 0;
            const remaining = remainingFor(l);
            const qty = sel[l.id] ?? 0;
            return (
              <tr key={l.id}>
                <td>
                  <label className="row small" style={{ gap: 6 }}>
                    <input type="checkbox" checked={qty > 0} disabled={remaining <= 0} onChange={() => toggleLine(l)} />
                    <span>{l.quantity}× {l.itemNameSnapshot}</span>
                  </label>
                </td>
                <td className="mono" style={{ textAlign: "right" }}>{formatMoney(toCents(l.lineTotal), currency)}</td>
                <td style={{ width: 170 }}>
                  {prior > 0 && <span className="badge warn">{t("ops:refund_line_refunded", { qty: prior, total: l.quantity })}</span>}
                  {qty > 0 && (
                    <span className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
                      <button className="qty-btn" onClick={() => setQty(l, qty - 1)}>−</button>
                      <span className="mono">{qty}</span>
                      <button className="qty-btn" onClick={() => setQty(l, qty + 1)}>+</button>
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <Field label={t("ops:refund_amount", { currency })}>
        <input
          className="input"
          type="number"
          value={selected.length ? fromCents(autoCents) : amount}
          disabled={selected.length > 0}
          onChange={(e) => setAmount(e.target.value)}
        />
      </Field>
      <Field label={t("ops:refund_reason")}><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <Field label={t("ops:refund_manager_pin")}><input className="input" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="••••" /></Field>
      <label className="row small" style={{ gap: 6 }}>
        <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} /> {t("ops:refund_restock")}
      </label>
      {err && <p className="badge danger">{err}</p>}
    </Modal>
  );
}

function ServeModal({
  order,
  onClose,
  onSaved,
}: {
  order: OrderShape;
  onClose: () => void;
  onSaved: (saved: OrderShape, newlyServed: number) => void;
}) {
  const { t } = useTranslation(["ops", "common"]);
  const active = order.lines.filter((l) => !l.isVoided);
  const [qty, setQty] = useState<Record<string, number>>(() =>
    Object.fromEntries(active.map((l) => [l.id, Math.min(l.servedQuantity ?? 0, l.quantity)])),
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const totalServedNow = active.reduce((s, l) => s + (qty[l.id] ?? 0), 0);
  const totalServedBefore = active.reduce((s, l) => s + Math.min(l.servedQuantity ?? 0, l.quantity), 0);

  function bump(line: ServerLine, delta: number) {
    setQty((prev) => {
      const next = Math.max(0, Math.min(line.quantity, (prev[line.id] ?? 0) + delta));
      return { ...prev, [line.id]: next };
    });
  }

  function serveAll() {
    setQty(Object.fromEntries(active.map((l) => [l.id, l.quantity])));
  }

  async function submit() {
    setBusy(true);
    setErr("");
    try {
      const res = await apiPost<{ order: OrderShape }>(`/orders/${order.id}/serve-lines`, {
        lines: active.map((l) => ({ lineId: l.id, quantity: qty[l.id] ?? 0 })),
      });
      onSaved(res.order, totalServedNow - totalServedBefore);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("ops:failed"));
      setBusy(false);
    }
  }

  return (
    <Modal
      title={t("ops:pos_serve_title", { number: order.orderNumber })}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>{t("ops:cancel")}</button>
          <button className="btn" onClick={serveAll}>{t("ops:pos_serve_all")}</button>
          <button className="btn ok" disabled={busy || totalServedNow === totalServedBefore} onClick={submit}>
            {busy ? "…" : t("ops:done")}
          </button>
        </>
      }
    >
      {active.map((l) => (
        <div key={l.id} className="row" style={{ padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
          <div style={{ flex: 1 }}>
            <div className="lname">{l.itemNameSnapshot}</div>
            <div className="small muted">{t("ops:pos_serve_progress", { served: qty[l.id] ?? 0, total: l.quantity })}</div>
          </div>
          <button className="qty-btn" onClick={() => bump(l, -1)}>−</button>
          <span className="mono" style={{ minWidth: 32, textAlign: "center" }}>{qty[l.id] ?? 0}/{l.quantity}</span>
          <button className="qty-btn" onClick={() => bump(l, 1)}>+</button>
        </div>
      ))}
      {err && <p className="badge danger">{err}</p>}
    </Modal>
  );
}

interface SplitRow {
  id: string;
  personName: string;
  lineIds: string[];
  subtotal: string;
  discount: string;
  serviceCharge: string;
  tax: string;
  total: string;
  paid: boolean;
  paidAt: string | null;
}

function SplitModal({
  order,
  currency,
  onClose,
  onPaySplit,
}: {
  order: OrderShape;
  currency: string;
  onClose: () => void;
  onPaySplit: (split: SplitRow) => void;
}) {
  const { push } = useToast();
  const qc = useQueryClient();
  const { t } = useTranslation(["ops", "common"]);
  const lines = order.lines.filter((l) => !l.isVoided);

  const { data } = useQuery({ queryKey: ["splits", order.id], queryFn: () => apiGet<{ splits: SplitRow[] }>(`/orders/${order.id}/splits`) });
  const saved = data?.splits ?? [];

  const [persons, setPersons] = useState<{ key: string; name: string; lineIds: string[] }[]>(() => [
    { key: "p1", name: `${t("ops:split_person")} 1`, lineIds: [] },
    { key: "p2", name: `${t("ops:split_person")} 2`, lineIds: [] },
  ]);
  const [dirty, setDirty] = useState(false);
  const [active, setActive] = useState(0);
  const [err, setErr] = useState("");
  const [receipt, setReceipt] = useState<{ name: string; splitId: string; text: string } | null>(null);
  const [printBusy, setPrintBusy] = useState(false);

  useQuery({
    queryKey: ["split-sync", order.id, saved.map((s) => s.id).join(","), saved.map((s) => (s.paid ? "1" : "0")).join("")],
    queryFn: () => {
      if (!dirty && saved.length > 0) {
        setPersons(saved.map((s) => ({ key: s.id, name: s.personName, lineIds: s.lineIds })));
      }
      return null;
    },
    enabled: !!data && !dirty,
  });

  const assigned = new Set(persons.flatMap((p) => p.lineIds));
  const pool = lines.filter((l) => !assigned.has(l.id));

  function assign(lineId: string, personIdx: number) {
    setDirty(true);
    setErr("");
    setPersons((ps) =>
      ps.map((p, i) => ({
        ...p,
        lineIds: i === personIdx ? [...p.lineIds.filter((id) => id !== lineId), lineId] : p.lineIds.filter((id) => id !== lineId),
      })),
    );
  }
  function unassign(lineId: string) {
    setDirty(true);
    setErr("");
    setPersons((ps) => ps.map((p) => ({ ...p, lineIds: p.lineIds.filter((id) => id !== lineId) })));
  }
  function addPerson() {
    setDirty(true);
    setPersons((ps) => [...ps, { key: `p${Date.now()}`, name: `${t("ops:split_person")} ${ps.length + 1}`, lineIds: [] }]);
  }
  function removePerson(idx: number) {
    setDirty(true);
    setPersons((ps) => ps.filter((_, i) => i !== idx));
    setActive((a) => (a >= idx && a > 0 ? a - 1 : a));
  }

  const save = useMutation({
    mutationFn: () =>
      apiPut(`/orders/${order.id}/splits`, {
        splits: persons.map((p) => ({ personName: p.name.trim() || t("ops:split_person"), lineIds: p.lineIds })),
      }),
    onSuccess: () => {
      setDirty(false);
      setErr("");
      push(t("ops:split_saved"), "ok");
      qc.invalidateQueries({ queryKey: ["splits", order.id] });
    },
    onError: (e) => setErr(e instanceof Error ? e.message : t("ops:failed")),
  });

  function saveSplit() {
    if (pool.length > 0) return setErr(t("ops:split_must_assign_all"));
    if (persons.some((p) => p.lineIds.length === 0)) return setErr(t("ops:split_empty_person"));
    save.mutate();
  }

  async function openReceipt(row: SplitRow) {
    try {
      const r = await apiGet<{ receipt: string }>(`/orders/${order.id}/splits/${row.id}/receipt`);
      setReceipt({ name: row.personName, splitId: row.id, text: r.receipt });
    } catch (e) {
      push(e instanceof Error ? e.message : t("ops:failed"), "error");
    }
  }
  async function printSplit(row: SplitRow) {
    setPrintBusy(true);
    try {
      await apiPost(`/orders/${order.id}/splits/${row.id}/print`);
      push(t("ops:split_print_ok"), "ok");
    } catch (e) {
      push(e instanceof Error ? e.message : t("ops:print_failed"), "error");
    } finally {
      setPrintBusy(false);
    }
  }

  return (
    <Modal
      title={t("ops:split_title", { number: order.orderNumber })}
      onClose={onClose}
      wide
      footer={<><button className="btn ghost" onClick={onClose}>{t("ops:close")}</button><button className="btn primary" disabled={save.isPending} onClick={saveSplit}>{save.isPending ? "…" : t("ops:split_save")}</button></>}
    >
      <p className="muted small">{t("ops:split_hint")}</p>

      <div className="grid cols-2" style={{ marginTop: 10 }}>
        {persons.map((p, i) => (
          <div
            key={p.key}
            className="card"
            style={{ outline: active === i ? "2px solid var(--accent)" : undefined, cursor: "pointer" }}
            onClick={() => setActive(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const lineId = e.dataTransfer.getData("text/plain");
              if (lineId) assign(lineId, i);
            }}
          >
            <div className="row">
              <input
                className="input"
                value={p.name}
                onFocus={() => setActive(i)}
                onChange={(e) => {
                  setDirty(true);
                  setPersons((ps) => ps.map((x, i2) => (i2 === i ? { ...x, name: e.target.value } : x)));
                }}
              />
              <button className="btn ghost small" disabled={persons.length <= 2} onClick={() => removePerson(i)}>✕</button>
            </div>
            {p.lineIds.map((id) => {
              const l = lines.find((x) => x.id === id);
              if (!l) return null;
              return (
                <div key={id} className="row" style={{ marginTop: 6 }} draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", id)}>
                  <span className="small">{l.quantity}× {l.itemNameSnapshot} · {formatMoney(toCents(l.lineTotal), currency)}</span>
                  <div className="spacer" />
                  <button className="btn ghost small" onClick={() => unassign(id)}>✕</button>
                </div>
              );
            })}
            {p.lineIds.length === 0 && <p className="muted small">{t("ops:split_drop_here")}</p>}
          </div>
        ))}
      </div>

      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn" onClick={addPerson} disabled={persons.length >= 20}>{t("ops:split_add_person")}</button>
      </div>

      <h4 style={{ marginTop: 14, marginBottom: 6 }}>{t("ops:split_unassigned")} ({pool.length})</h4>
      <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
        {pool.map((l) => (
          <button
            key={l.id}
            className="btn small"
            draggable
            onDragStart={(e) => e.dataTransfer.setData("text/plain", l.id)}
            onClick={() => assign(l.id, active)}
          >
            {l.quantity}× {l.itemNameSnapshot}
          </button>
        ))}
        {pool.length === 0 && <span className="badge ok">{t("ops:split_all_assigned")}</span>}
      </div>

      {saved.length > 0 && !dirty && (
        <>
          <h4 style={{ marginTop: 16, marginBottom: 6 }}>{t("ops:split_saved_title")}</h4>
          <table className="tbl">
            <thead>
              <tr>
                <th>{t("ops:split_col_person")}</th>
                <th style={{ textAlign: "right" }}>{t("ops:split_col_total")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {saved.map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.personName}{" "}
                    {s.paid ? <span className="badge ok">{t("ops:split_paid")}</span> : <span className="badge warn">{t("ops:split_unpaid")}</span>}
                  </td>
                  <td className="mono" style={{ textAlign: "right" }}>{formatMoney(toCents(s.total), currency)}</td>
                  <td>
                    <div className="row" style={{ justifyContent: "flex-end", gap: 6 }}>
                      {!s.paid && (
                        <button className="btn small primary" onClick={() => onPaySplit(s)}>
                          {t("ops:split_pay", { name: s.personName })}
                        </button>
                      )}
                      <button className="btn small" onClick={() => openReceipt(s)}>{t("ops:split_receipt")}</button>
                      <button className="btn small" disabled={printBusy} onClick={() => printSplit(s)}>{t("ops:split_print")}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {err && <p className="badge danger" style={{ marginTop: 10 }}>{err}</p>}

      {receipt && (
        <Modal
          title={t("ops:split_receipt_title", { name: receipt.name })}
          onClose={() => setReceipt(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setReceipt(null)}>{t("ops:done")}</button>
              <button
                className="btn primary"
                disabled={printBusy}
                onClick={() => {
                  const row = saved.find((s) => s.id === receipt.splitId);
                  if (row) printSplit(row);
                }}
              >
                {t("ops:split_print")}
              </button>
            </>
          }
        >
          <pre className="receipt-paper">{receipt.text || "…"}</pre>
        </Modal>
      )}
    </Modal>
  );
}

function ModifierModal({
  item,
  currency,
  onClose,
  onAdd,
}: {
  item: MenuItem;
  currency: string;
  onClose: () => void;
  onAdd: (line: Omit<CartLine, "key">) => void;
}) {
  const { t } = useTranslation(["ops", "common"]);
  const [variantId, setVariantId] = useState<string | null>(item.variants[0]?.id ?? null);
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");

  const variant = item.variants.find((v) => v.id === variantId);
  const unitPrice = toCents(item.price) + (variant ? toCents(variant.priceAdjust) : 0);
  const chosen: MenuOption[] = item.modifierGroups.flatMap((g) => g.options.filter((o) => (selected[g.id] ?? []).includes(o.id)));

  function toggle(group: ModifierGroup, optId: string) {
    setSelected((prev) => {
      const cur = prev[group.id] ?? [];
      const isOn = cur.includes(optId);
      let next: string[];
      if (isOn) next = cur.filter((x) => x !== optId);
      else if (group.maxSelect === 1) next = [optId];
      else next = [...cur, optId];
      if (group.maxSelect && next.length > group.maxSelect) next = next.slice(-group.maxSelect);
      return { ...prev, [group.id]: next };
    });
  }

  const invalid = item.modifierGroups.some((g) => g.required && (selected[g.id] ?? []).length < Math.max(1, g.minSelect));

  return (
    <Modal
      title={item.name}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>{t("ops:cancel")}</button>
          <button
            className="btn primary"
            disabled={invalid}
            onClick={() =>
              onAdd({
                menuItemId: item.id,
                name: item.name,
                unitPrice,
                variantId,
                variantName: variant?.name ?? null,
                modifiers: chosen.map((o) => ({ id: o.id, name: o.name, price: toCents(o.price) })),
                quantity: qty,
                notes: notes || null,
              })
            }
          >
            {t("ops:mod_add", { amount: formatMoney((unitPrice + chosen.reduce((s, o) => s + toCents(o.price), 0)) * qty, currency) })}
          </button>
        </>
      }
    >
      {item.variants.length > 0 && (
        <div className="field">
          <span className="small muted">{t("ops:mod_variant")}</span>
          <div className="row wrap" style={{ marginTop: 6 }}>
            {item.variants.map((v) => (
              <button key={v.id} className={`cat-tab ${variantId === v.id ? "active" : ""}`} onClick={() => setVariantId(v.id)}>
                {v.name} {Number(v.priceAdjust) ? `(+${formatMoney(toCents(v.priceAdjust), currency)})` : ""}
              </button>
            ))}
          </div>
        </div>
      )}
      {item.modifierGroups.map((g) => (
        <div className="field" key={g.id}>
          <span className="small muted">
            {g.name} {g.required ? t("ops:mod_required") : ""} {g.maxSelect ? t("ops:mod_max", { count: g.maxSelect }) : ""}
          </span>
          <div className="grid cols-2" style={{ marginTop: 6 }}>
            {g.options.map((o) => {
              const on = (selected[g.id] ?? []).includes(o.id);
              return (
                <button key={o.id} className={`btn ${on ? "primary" : ""}`} onClick={() => toggle(g, o.id)}>
                  {o.name} {Number(o.price) ? `+${formatMoney(toCents(o.price), currency)}` : ""}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="row">
        <div>
          <span className="small muted">{t("ops:mod_qty")}</span>
          <div className="row" style={{ marginTop: 6 }}>
            <button className="qty-btn" onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
            <span className="mono" style={{ minWidth: 24, textAlign: "center" }}>{qty}</span>
            <button className="qty-btn" onClick={() => setQty((q) => q + 1)}>+</button>
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <Field label={t("ops:mod_notes")}>
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("ops:mod_notes_placeholder")} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function DiscountModal({
  subtotal,
  currency,
  onClose,
  onApply,
}: {
  subtotal: number;
  currency: string;
  onClose: () => void;
  onApply: (type: "PERCENT" | "ABSOLUTE", value: number, managerPin?: string) => Promise<void>;
}) {
  const { t } = useTranslation(["ops", "common"]);
  const [type, setType] = useState<"PERCENT" | "ABSOLUTE">("PERCENT");
  const [value, setValue] = useState(10);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const amount = type === "PERCENT" ? Math.round(subtotal * (value / 100)) : toCents(value);
  const needsManager = subtotal > 0 && amount / subtotal > 0.1;

  async function apply() {
    setBusy(true);
    setErr("");
    try {
      await onApply(type, value, pin || undefined);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("ops:failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={t("ops:disc_title")}
      onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>{t("ops:cancel")}</button><button className="btn primary" disabled={busy} onClick={apply}>{busy ? "…" : t("ops:disc_apply")}</button></>}
    >
      <div className="row" style={{ marginBottom: 10 }}>
        <button className={`cat-tab ${type === "PERCENT" ? "active" : ""}`} onClick={() => setType("PERCENT")}>{t("ops:disc_percent")}</button>
        <button className={`cat-tab ${type === "ABSOLUTE" ? "active" : ""}`} onClick={() => setType("ABSOLUTE")}>{t("ops:disc_amount")}</button>
      </div>
      <Field label={type === "PERCENT" ? t("ops:disc_percent_off") : t("ops:disc_amount_label", { currency })}>
        <input className="input" type="number" value={value} onChange={(e) => setValue(Number(e.target.value))} />
      </Field>
      <p className="muted small">{t("ops:disc_total", { amount: formatMoney(amount, currency) })}</p>
      {needsManager && (
        <Field label={t("ops:disc_manager_pin")}>
          <input className="input" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="••••" />
        </Field>
      )}
      {err && <p className="badge danger">{err}</p>}
    </Modal>
  );
}

function PaymentModal({
  total,
  currency,
  onClose,
  onPay,
  title,
}: {
  total: number;
  currency: string;
  onClose: () => void;
  onPay: (tenders: Tender[], idemKey: string) => Promise<void>;
  title?: string;
}) {
  const { t } = useTranslation(["ops", "common"]);
  const [idemKey] = useState(() => `pay-${crypto.randomUUID()}`);
  const [tenders, setTenders] = useState<{ method: string; amount: string; cash: string; reference: string }[]>([
    { method: "CASH", amount: fromCents(total), cash: fromCents(total), reference: "" },
  ]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const tendered = tenders.reduce((s, t) => s + toCents(t.amount || "0"), 0);
  const remaining = total - tendered;
  const cashChange = tenders.reduce((s, t) => (t.method === "CASH" ? s + (toCents(t.cash || "0") - toCents(t.amount || "0")) : s), 0);

  function update(i: number, patch: Partial<{ method: string; amount: string; cash: string; reference: string }>) {
    setTenders((ts) => ts.map((tnd, idx) => (idx === i ? { ...tnd, ...patch } : tnd)));
  }

  async function submit() {
    setBusy(true);
    setErr("");
    try {
      await onPay(
        tenders.map((tnd) => ({
          method: tnd.method,
          amount: Number(tnd.amount),
          cashReceived: tnd.method === "CASH" ? Number(tnd.cash) : undefined,
          reference: tnd.method !== "CASH" && tnd.reference ? tnd.reference : undefined,
        })),
        idemKey,
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("ops:pay_failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={title ?? t("ops:pay_title")}
      onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>{t("ops:cancel")}</button><button className="btn primary" disabled={busy || tendered < total} onClick={submit}>{busy ? t("ops:pay_processing") : t("ops:pay_pay", { amount: formatMoney(total, currency) })}</button></>}
    >
      <div className="totals-row grand" style={{ marginTop: 0 }}>
        <span>{t("ops:pay_due")}</span>
        <span className="mono">{formatMoney(total, currency)}</span>
      </div>
      <div style={{ marginTop: 12 }}>
        {tenders.map((tender, i) => (
          <div key={i} className="card" style={{ marginBottom: 10 }}>
            <div className="row">
              <select className="input" value={tender.method} onChange={(e) => update(i, { method: e.target.value })}>
                <option value="CASH">{t("ops:cash")}</option>
                <option value="CARD">{t("ops:card")}</option>
                <option value="MOBILE">{t("ops:mobile")}</option>
              </select>
              <input className="input" type="number" value={tender.amount} onChange={(e) => update(i, { amount: e.target.value })} placeholder={t("ops:pay_amount_placeholder")} />
            </div>
            {tender.method === "CASH" && (
              <div className="row" style={{ marginTop: 8 }}>
                <span className="muted small" style={{ minWidth: 90 }}>{t("ops:pay_cash_received")}</span>
                <input className="input" type="number" value={tender.cash} onChange={(e) => update(i, { cash: e.target.value })} />
              </div>
            )}
            {tender.method !== "CASH" && (
              <div className="row" style={{ marginTop: 8 }}>
                <span className="muted small" style={{ minWidth: 90 }}>{t("ops:pay_reference")}</span>
                <input className="input" value={tender.reference} onChange={(e) => update(i, { reference: e.target.value })} placeholder={t("ops:pay_reference_placeholder")} />
              </div>
            )}
            {i > 0 && (
              <button className="btn ghost small" style={{ marginTop: 8 }} onClick={() => setTenders((ts) => ts.filter((_, idx) => idx !== i))}>{t("ops:remove")}</button>
            )}
          </div>
        ))}
      </div>
      <div className="row">
        <button className="btn" onClick={() => setTenders((ts) => [...ts, { method: "CARD", amount: fromCents(Math.max(0, remaining)), cash: "0", reference: "" }])} disabled={remaining <= 0}>
          {t("ops:pay_split")}
        </button>
        <div className="spacer" />
        <span className={remaining > 0 ? "badge warn" : "badge ok"}>
          {remaining > 0 ? t("ops:pay_remaining", { amount: formatMoney(remaining, currency) }) : t("ops:pay_fully_tendered")}
        </span>
      </div>
      {cashChange > 0 && <p className="muted" style={{ marginTop: 10 }}>{t("ops:pay_change_due", { amount: formatMoney(cashChange, currency) })}</p>}
      {err && <p className="badge danger" style={{ marginTop: 10 }}>{err}</p>}
    </Modal>
  );
}

function ReceiptModal({
  currency,
  orderNumber,
  preview,
  changeGiven,
  orderId,
  onClose,
}: {
  currency: string;
  orderNumber: number;
  preview: string;
  changeGiven: string | null;
  orderId: string;
  onClose: () => void;
}) {
  const { push } = useToast();
  const { t } = useTranslation(["ops", "common"]);
  const [busy, setBusy] = useState(false);

  async function print() {
    setBusy(true);
    try {
      const r = await printOrderReceipt(orderId);
      push(r.simulated ? t("ops:receipt_printed_simulated") : t("ops:receipt_sent"), "ok");
    } catch (e) {
      push(e instanceof Error ? e.message : t("ops:print_failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={t("ops:receipt_title", { number: orderNumber })}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>{t("ops:done")}</button>
          <button className="btn primary" disabled={busy} onClick={print}>{busy ? "…" : t("ops:receipt_print")}</button>
        </>
      }
    >
      {changeGiven !== null && Number(changeGiven) > 0 && (
        <div className="totals-row grand" style={{ marginTop: 0 }}>
          <span>{t("ops:receipt_change_due")}</span>
          <span className="mono">{formatMoney(toCents(changeGiven), currency)}</span>
        </div>
      )}
      <pre className="receipt-paper">{preview || "…"}</pre>
    </Modal>
  );
}
