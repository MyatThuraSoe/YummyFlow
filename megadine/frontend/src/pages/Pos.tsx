import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPut } from "../lib/api";
import { useCart, type CartLine } from "../store/cart";
import { useAuth } from "../store/auth";
import { computeTotals, formatMoney, fromCents, toCents } from "../lib/format";
import { dismissFailure, enqueueOrder, failedCount, failedOrders, pendingCount, retryFailure, shouldQueue } from "../lib/outbox";
import { printOrderReceipt } from "../lib/receipts";
import { Field, Modal, useToast } from "../components/ui";

import type { Category, MenuItem, OrderShape, ServerLine, Settings, TableRow, Tender } from "./pos/pos.types";
import {
  DiscountModal,
  ModifierModal,
  OrdersModal,
  PaymentModal,
  ReceiptModal,
  RefundModal,
  ServeModal,
  SplitModal,
  VoidModal,
} from "./pos/PosModals";

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
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(pendingCount());
  const [failed, setFailed] = useState(failedCount());
  const [lastSentAt, setLastSentAt] = useState<Date | null>(null);
  // Stable idempotency ids: if a response is lost, the retry returns the same
  // order/line batch instead of creating a duplicate.
  const createKeyRef = useRef(crypto.randomUUID());
  const itemsKeyRef = useRef(crypto.randomUUID());
  const [notes, setNotes] = useState("");
  const [pickupName, setPickupName] = useState("");
  const [receipt, setReceipt] = useState<{ orderId: string; orderNumber: number; preview: string; changeGiven: string | null } | null>(null);
  const [search, setSearch] = useState("");
  const [cartCollapsed, setCartCollapsed] = useState(() => localStorage.getItem("pos_cart_collapsed") === "1");

  useEffect(() => {
    const update = () => {
      setQueued(pendingCount());
      setFailed(failedCount());
    };
    window.addEventListener("md:outbox", update);
    return () => window.removeEventListener("md:outbox", update);
  }, []);

  // A new sale gets fresh idempotency ids; recalling an open order keeps them.
  useEffect(() => {
    if (!order) {
      createKeyRef.current = crypto.randomUUID();
      itemsKeyRef.current = crypto.randomUUID();
      setLastSentAt(null);
    }
  }, [order]);

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
      idempotencyKey: createKeyRef.current,
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
    await apiPost(`/orders/${o.id}/items`, { items: cartToItems(), requestId: itemsKeyRef.current });
    cart.clearLines();
    itemsKeyRef.current = crypto.randomUUID();
    const fresh = await apiGet<{ order: OrderShape }>(`/orders/${o.id}`);
    setOrder(fresh.order);
    return fresh.order;
  }

  function queueOffline(o: OrderShape | null, opts: { sendToKitchen: boolean; payNow: boolean; tenders?: Tender[]; idemKey?: string }) {
    enqueueOrder({
      label: o ? `${t("ops:order_number", { number: o.orderNumber })} Â· ${cart.lines.length}` : `${channelLabel(cart.channel)} Â· ${cart.lines.length}`,
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
      const requestId = crypto.randomUUID();
      try {
        o = await ensureOrder();
        const withItems = await pushPendingItems(o);
        const res = await apiPost<{ tickets: number }>(`/orders/${withItems.id}/send-to-kitchen`, { requestId });
        setLastSentAt(new Date());
        return res;
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
    onMutate: () => setBusy(true),
    onSettled: () => setBusy(false),
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
    setBusy(true);
    try {
      const o = await ensureOrder();
      await apiPost(`/orders/${o.id}/discount`, { type, value, managerPin });
      const fresh = await apiGet<{ order: OrderShape }>(`/orders/${o.id}`);
      setOrder(fresh.order);
      setShowDiscount(false);
      push(t("ops:pos_discount_applied"), "ok");
      qc.invalidateQueries({ queryKey: ["orders"] });
    } finally {
      setBusy(false);
    }
  }

  async function pay(tenders: Tender[], idemKey: string, splitId?: string) {
    setBusy(true);
    try {
      await payOnce(tenders, idemKey, splitId);
    } finally {
      setBusy(false);
    }
  }

  async function payOnce(tenders: Tender[], idemKey: string, splitId?: string) {
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
        await apiPost(`/orders/${withItems.id}/send-to-kitchen`, { requestId: crypto.randomUUID() });
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
    setBusy(true);
    try {
      await holdOrderOnce();
    } finally {
      setBusy(false);
    }
  }

  async function holdOrderOnce() {
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
            {t("ops:pos_held_orders")}{queued > 0 ? ` Â· ${t("ops:pos_queued_count", { count: queued })}` : ""}
          </button>
          {queued > 0 && <span className="badge warn">{t("ops:pos_offline_queued", { count: queued })}</span>}
          {failed > 0 && (
            <button className="badge danger" onClick={() => setShowOrders(true)}>
              {t("ops:pos_outbox_failed", { count: failed })}
            </button>
          )}
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
          <span className="cart-toggle-icon">ðŸ›’</span>
          {cartCount > 0 && <span className="cart-toggle-count">{cartCount}</span>}
          <span className="cart-toggle-chevron">{cartCollapsed ? "â€¹" : "â€º"}</span>
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
                    #{tbl.number} {tbl.name ? `Â· ${tbl.name}` : ""} ({tbl.status === "OCCUPIED" ? t("ops:pos_in_use") : t("ops:pos_free")})
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
                      <div className="lname">{l.quantity}Ã— {l.itemNameSnapshot}</div>
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
                    <button className="qty-btn" onClick={() => cart.decQty(l.key)}>âˆ’</button>
                    <span className="mono" style={{ minWidth: 24, textAlign: "center" }}>{l.quantity}</span>
                    <button className="qty-btn" onClick={() => cart.incQty(l.key)}>+</button>
                    <div className="spacer" />
                    <button className="btn ghost small" onClick={() => {
                      const removed = l;
                      cart.removeLine(l.key);
                      push(t("ops:pos_removed_line", { defaultValue: "Removed" }), "info", {
                        label: t("ops:pos_undo", { defaultValue: "Undo" }),
                        onClick: () => cart.addLine(removed),
                      });
                    }}>{t("ops:remove")}</button>
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
              {toCents(order.discountAmount) > 0 && <div className="totals-row"><span className="muted">{t("ops:pos_discount")}</span><span className="mono">âˆ’{formatMoney(toCents(order.discountAmount), currency)}</span></div>}
              {toCents(order.serviceCharge) > 0 && <div className="totals-row"><span className="muted">{t("ops:pos_service")}</span><span className="mono">{formatMoney(toCents(order.serviceCharge), currency)}</span></div>}
              <div className="totals-row"><span className="muted">{t("ops:pos_tax")}</span><span className="mono">{formatMoney(toCents(order.taxAmount), currency)}</span></div>
              <div className="totals-row"><span className="muted">{t("ops:pos_order_total")}</span><span className="mono">{formatMoney(toCents(order.total), currency)}</span></div>
              {toCents(order.amountPaid) > 0 && <div className="totals-row"><span className="muted">{t("ops:pos_paid_so_far")}</span><span className="mono">âˆ’{formatMoney(toCents(order.amountPaid), currency)}</span></div>}
              {newItemsTotal > 0 && <div className="totals-row"><span className="muted">{t("ops:pos_new_items_est")}</span><span className="mono">+{formatMoney(newItemsTotal, currency)}</span></div>}
              <div className="totals-row grand"><span>{t("ops:pos_due")}</span><span className="mono">{formatMoney(chargeTotal, currency)}</span></div>
            </>
          ) : (
            <>
              <div className="totals-row"><span className="muted">{t("ops:pos_subtotal")}</span><span className="mono">{formatMoney(totals.subtotal, currency)}</span></div>
              {totals.discountAmount > 0 && <div className="totals-row"><span className="muted">{t("ops:pos_discount")}</span><span className="mono">âˆ’{formatMoney(totals.discountAmount, currency)}</span></div>}
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
              ðŸ³ {sendMut.isPending ? t("ops:pos_sending") : t("ops:pos_send_kitchen")}
            </button>
            <button className="btn" disabled={(!cart.lines.length && !order) || busy} onClick={() => setShowDiscount(true)}>ðŸ· {t("ops:pos_discount_btn")}</button>
          </div>
          {lastSentAt && (
            <p className="small muted" style={{ margin: "6px 0 0" }}>
              {t("ops:pos_last_sent", { time: lastSentAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) })}
            </p>
          )}
          <div className="row pos-fab-row" style={{ marginTop: 8, gap: 8 }}>
            <button className="btn" style={{ flex: 1 }} disabled={(!cart.lines.length && !order) || busy} onClick={holdOrder}>â¸ {t("ops:pos_hold")}</button>
            {order && <button className="btn" onClick={() => reprint(order.id)}>ðŸ–¨ {t("ops:pos_reprint")}</button>}
            {canServe && (
              <button className="btn ok" onClick={() => setShowServe(true)}>âœ… {t("ops:pos_mark_served")}</button>
            )}
            {order && order.status !== "COMPLETED" && order.status !== "CANCELLED" && cart.lines.length === 0 && (
              <button className="btn" onClick={() => setShowSplit(true)}>ðŸ‘¥ {t("ops:split_btn")}</button>
            )}
            {order && (
              <button className="btn ghost" onClick={() => { cart.reset(); setOrder(null); setNotes(""); setPickupName(""); }}>âž• {t("ops:pos_new")}</button>
            )}
          </div>
          <button
            className="btn primary block fab-charge"
            style={{ marginTop: 8, padding: "14px" }}
            disabled={(!cart.lines.length && !order) || busy || !shiftOpen || (cart.channel === "DINE_IN" && !cart.tableId && !order)}
            onClick={() => setShowPay(true)}
          >
            ðŸ’³ {t("ops:pos_charge", { amount: formatMoney(chargeTotal, currency) })}
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

