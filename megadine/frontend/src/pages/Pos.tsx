import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "../lib/api";
import { useCart, type CartLine } from "../store/cart";
import { useAuth } from "../store/auth";
import { computeTotals, formatMoney, fromCents, toCents } from "../lib/format";
import { enqueueOrder, pendingCount, shouldQueue } from "../lib/outbox";
import { Field, Modal, useToast } from "../components/ui";

interface MenuOption { id: string; name: string; price: string; isAvailable: boolean }
interface ModifierGroup { id: string; name: string; required: boolean; minSelect: number; maxSelect: number | null; options: MenuOption[] }
interface Variant { id: string; name: string; priceAdjust: string; isAvailable: boolean }
interface MenuItem { id: string; name: string; description: string | null; price: string; isAvailable: boolean; station: string; variants: Variant[]; modifierGroups: ModifierGroup[] }
interface Category { id: string; name: string; items: MenuItem[] }
interface TableRow { id: string; number: number; name: string | null; status: string; capacity: number; zone: string }
interface Settings { restaurant: { currency: string; taxRate: string; taxInclusive: boolean; serviceChargePct: string } | null }

interface ServerLine { id: string; menuItemId: string; itemNameSnapshot: string; variantSnapshot: string | null; unitPriceSnapshot: string; quantity: number; lineTotal: string; isVoided: boolean; notes: string | null; modifiers: { id: string; nameSnapshot: string; priceSnapshot: string }[] }
interface OrderShape {
  id: string; orderNumber: number; total: string; subtotal: string; taxAmount: string; serviceCharge: string; discountAmount: string;
  status: string; channel: string; tableId: string | null; lines: ServerLine[];
  tableSession?: { table: { number: number; name: string | null } } | null;
}

export default function Pos() {
  const qc = useQueryClient();
  const { push } = useToast();
  const { can } = useAuth();
  const cart = useCart();
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [modItem, setModItem] = useState<MenuItem | null>(null);
  const [showPay, setShowPay] = useState(false);
  const [showDiscount, setShowDiscount] = useState(false);
  const [showOrders, setShowOrders] = useState(false);
  const [order, setOrder] = useState<OrderShape | null>(null);
  const [voidTarget, setVoidTarget] = useState<ServerLine | null>(null);
  const [busy] = useState(false);
  const [queued, setQueued] = useState(pendingCount());

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
  const availableTables = (tables?.tables ?? []).filter((t) => t.status === "AVAILABLE" || t.status === "OCCUPIED");
  const shiftOpen = !!shiftRes?.shift;
  const locked = !!cart.orderId;

  const lineTotals = cart.lineTotals();
  const totals = useMemo(() => computeTotals(lineTotals, cart.orderDiscount, cfg), [lineTotals, cart.orderDiscount, cfg]);
  const serverTotal = order ? toCents(order.total) : totals.total;

  function addItem(item: MenuItem) {
    if (locked) return;
    const needsModal = item.variants.length > 0 || item.modifierGroups.some((g) => g.options.length > 0);
    if (needsModal) return setModItem(item);
    cart.addLine({ menuItemId: item.id, name: item.name, unitPrice: toCents(item.price), modifiers: [], quantity: 1, variantId: null, variantName: null });
  }

  function buildCreateBody() {
    return {
      channel: cart.channel,
      tableId: cart.channel === "DINE_IN" ? cart.tableId : null,
      shiftId: shiftRes?.shift?.id ?? null,
      items: cart.lines.map((l) => ({
        menuItemId: l.menuItemId,
        quantity: l.quantity,
        variantId: l.variantId || null,
        modifierOptionIds: l.modifiers.map((m) => m.id),
        notes: l.notes ?? null,
      })),
      orderDiscount: cart.orderDiscount ? Number(fromCents(cart.orderDiscount)) : undefined,
    };
  }

  async function ensureOrder(): Promise<OrderShape> {
    if (order) return order;
    const res = await apiPost<{ order: OrderShape }>("/orders", buildCreateBody());
    cart.setOrder(res.order.id, res.order.orderNumber);
    setOrder(res.order);
    qc.invalidateQueries({ queryKey: ["orders"] });
    return res.order;
  }

  function queueOffline(sendToKitchen: boolean, payNow: boolean) {
    enqueueOrder({
      label: `${cart.channel} · ${cart.lines.length} item(s)`,
      create: buildCreateBody(),
      sendToKitchen,
      pay: payNow
        ? {
            shiftId: shiftRes?.shift?.id ?? null,
            idempotencyKey: `pay-${crypto.randomUUID()}`,
            payments: [{ method: "CASH", amount: Number(fromCents(serverTotal)) }],
          }
        : null,
    });
    setQueued(pendingCount());
    cart.reset();
    setOrder(null);
    push("Offline — order queued and will sync automatically", "info");
    qc.invalidateQueries({ queryKey: ["outbox"] });
  }

  const sendMut = useMutation({
    mutationFn: async () => {
      const o = await ensureOrder();
      return apiPost<{ tickets: number }>(`/orders/${o.id}/send-to-kitchen`);
    },
    onSuccess: (r) => {
      push(`Sent to kitchen (${r.tickets} ticket${r.tickets === 1 ? "" : "s"})`, "ok");
      qc.invalidateQueries({ queryKey: ["tickets"] });
      qc.invalidateQueries({ queryKey: ["tables"] });
    },
    onError: (e) => {
      if (shouldQueue(e)) queueOffline(true, false);
      else push(e instanceof Error ? e.message : "Failed", "error");
    },
  });

  async function doDiscount(type: "PERCENT" | "ABSOLUTE", value: number, managerPin?: string) {
    const o = await ensureOrder();
    await apiPost(`/orders/${o.id}/discount`, { type, value, managerPin });
    const fresh = await apiGet<{ order: OrderShape }>(`/orders/${o.id}`);
    setOrder(fresh.order);
    const discountCents = type === "PERCENT" ? Math.round(toCents(fresh.order.subtotal) * (value / 100)) : toCents(value);
    cart.setOrderDiscount(discountCents);
    setShowDiscount(false);
    push("Discount applied", "ok");
    qc.invalidateQueries({ queryKey: ["orders"] });
  }

  async function pay(tenders: { method: string; amount: number; cashReceived?: number }[]) {
    if (shouldQueue()) {
      enqueueOrder({
        label: `${cart.channel} · ${cart.lines.length} item(s)`,
        create: buildCreateBody(),
        sendToKitchen: false,
        pay: { shiftId: shiftRes?.shift?.id ?? null, idempotencyKey: `pay-${crypto.randomUUID()}`, payments: tenders },
      });
      setQueued(pendingCount());
      setShowPay(false);
      setOrder(null);
      cart.reset();
      push("Offline — payment queued and will sync automatically", "info");
      return;
    }
    try {
      const o = await ensureOrder();
      await apiPost("/payments", {
        orderId: o.id,
        shiftId: shiftRes?.shift?.id ?? null,
        idempotencyKey: `pay-${o.id}`,
        payments: tenders,
      });
      push(`Payment complete — order #${o.orderNumber}`, "ok");
      setShowPay(false);
      setOrder(null);
      cart.reset();
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["tables"] });
      qc.invalidateQueries({ queryKey: ["shift"] });
    } catch (e) {
      if (shouldQueue(e)) {
        enqueueOrder({
          label: `${cart.channel} · ${cart.lines.length} item(s)`,
          create: buildCreateBody(),
          sendToKitchen: false,
          pay: { shiftId: shiftRes?.shift?.id ?? null, idempotencyKey: `pay-${crypto.randomUUID()}`, payments: tenders },
        });
        setQueued(pendingCount());
        setShowPay(false);
        setOrder(null);
        cart.reset();
        push("Offline — payment queued and will sync automatically", "info");
      } else {
        throw e;
      }
    }
  }

  async function holdOrder() {
    if (!cart.lines.length) return;
    try {
      await ensureOrder();
      push(`Order #${cart.orderNumber} held`, "ok");
      cart.reset();
      setOrder(null);
      setShowOrders(true);
    } catch (e) {
      if (shouldQueue(e)) queueOffline(false, false);
      else push(e instanceof Error ? e.message : "Failed", "error");
    }
  }

  async function reprint(orderId: string) {
    try {
      await apiPost(`/orders/${orderId}/reprint`);
      push("Receipt sent to printer", "ok");
    } catch (e) {
      push(e instanceof Error ? e.message : "Reprint failed", "error");
    }
  }

  async function voidLine(lineId: string, reason: string, managerPin?: string) {
    const o = order!;
    await apiPost(`/orders/${o.id}/void-line`, { lineId, reason, managerPin });
    const fresh = await apiGet<{ order: OrderShape }>(`/orders/${o.id}`);
    setOrder(fresh.order);
    setVoidTarget(null);
    push("Line voided", "ok");
  }

  async function openShift() {
    try {
      await apiPost("/shifts/open", { openingFloat: 0 });
      qc.invalidateQueries({ queryKey: ["shift"] });
      push("Shift opened", "ok");
    } catch (e) {
      push(e instanceof Error ? e.message : "Failed to open shift", "error");
    }
  }

  return (
    <div className="pos">
      <section className="pos-menu">
        <div className="row" style={{ marginBottom: 8 }}>
          <button className="btn" onClick={() => setShowOrders(true)}>
            Held orders{queued > 0 ? ` · ${queued} queued` : ""}
          </button>
          {queued > 0 && <span className="badge warn">{queued} offline queued</span>}
        </div>
        <div className="cat-tabs">
          {categories.map((c) => (
            <button key={c.id} className={`cat-tab ${current?.id === c.id ? "active" : ""}`} onClick={() => setActiveCat(c.id)}>
              {c.name}
            </button>
          ))}
        </div>
        <div className="item-grid">
          {(current?.items ?? []).map((item) => (
            <button
              key={item.id}
              className={`item-card ${!item.isAvailable ? "unavailable" : ""}`}
              disabled={!item.isAvailable || locked}
              onClick={() => addItem(item)}
            >
              <span className="name">{item.name}</span>
              <span className="price">{formatMoney(toCents(item.price), currency)}</span>
            </button>
          ))}
          {current?.items.length === 0 && <p className="muted">No items in this category.</p>}
        </div>
      </section>

      <aside className="pos-cart">
        <div className="row" style={{ padding: 12, borderBottom: "1px solid var(--line)" }}>
          <select className="input" value={cart.channel} onChange={(e) => cart.setChannel(e.target.value as never)} disabled={locked}>
            <option value="DINE_IN">Dine-in</option>
            <option value="TAKEAWAY">Takeaway</option>
            <option value="PARCEL">Parcel</option>
          </select>
          {cart.channel === "DINE_IN" && (
            <select
              className="input"
              value={cart.tableId ?? ""}
              onChange={(e) => {
                const t = availableTables.find((x) => x.id === e.target.value);
                cart.setTable(e.target.value || null, t ? `#${t.number}` : null);
              }}
              disabled={locked}
            >
              <option value="">Table…</option>
              {availableTables.map((t) => (
                <option key={t.id} value={t.id}>
                  #{t.number} {t.name ? `· ${t.name}` : ""} ({t.status === "OCCUPIED" ? "in use" : "free"})
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="cart-lines">
          {!locked && cart.lines.length === 0 && <p className="muted" style={{ padding: 12 }}>Tap items to build the order.</p>}
          {!locked &&
            cart.lines.map((l: CartLine) => (
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
                  <button className="btn ghost small" onClick={() => cart.removeLine(l.key)}>Remove</button>
                </div>
              </div>
            ))}

          {locked && order && (
            <>
              <div className="row" style={{ padding: 12 }}>
                <strong>Order #{order.orderNumber}</strong>
                <div className="spacer" />
                <span className={`badge ${order.status === "DRAFT" ? "muted" : "ok"}`}>{order.status.replaceAll("_", " ")}</span>
              </div>
              {order.lines.map((l) => (
                <div className="cart-line" key={l.id} style={l.isVoided ? { opacity: 0.5 } : undefined}>
                  <div className="row">
                    <div style={{ flex: 1 }}>
                      <div className="lname">{l.quantity}× {l.itemNameSnapshot}{l.isVoided ? " (voided)" : ""}</div>
                      {l.modifiers.length > 0 && <div className="small muted">+ {l.modifiers.map((m) => m.nameSnapshot).join(", ")}</div>}
                    </div>
                    <div className="mono">{formatMoney(toCents(l.lineTotal), currency)}</div>
                    {!l.isVoided && order.status !== "COMPLETED" && (
                      <button className="btn ghost small" onClick={() => setVoidTarget(l)}>Void</button>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        <div className="cart-footer">
          {!shiftOpen && (
            <div className="row" style={{ marginBottom: 10 }}>
              <span className="badge warn">No open shift</span>
              <div className="spacer" />
              <button className="btn" onClick={openShift}>Open shift</button>
            </div>
          )}
          <div className="totals-row"><span className="muted">Subtotal</span><span className="mono">{formatMoney(totals.subtotal, currency)}</span></div>
          {totals.discountAmount > 0 && <div className="totals-row"><span className="muted">Discount</span><span className="mono">−{formatMoney(totals.discountAmount, currency)}</span></div>}
          {totals.serviceCharge > 0 && <div className="totals-row"><span className="muted">Service</span><span className="mono">{formatMoney(totals.serviceCharge, currency)}</span></div>}
          <div className="totals-row"><span className="muted">Tax</span><span className="mono">{formatMoney(totals.taxAmount, currency)}</span></div>
          <div className="totals-row grand"><span>Total</span><span className="mono">{formatMoney(serverTotal, currency)}</span></div>

          <div className="row" style={{ marginTop: 12, gap: 8 }}>
            <button className="btn" style={{ flex: 1 }} disabled={!cart.lines.length || busy || (cart.channel === "DINE_IN" && !cart.tableId)} onClick={() => sendMut.mutate()}>
              {sendMut.isPending ? "Sending…" : "Send to Kitchen"}
            </button>
            <button className="btn" disabled={!cart.lines.length || busy} onClick={() => setShowDiscount(true)}>Discount</button>
          </div>
          <div className="row" style={{ marginTop: 8, gap: 8 }}>
            <button className="btn" style={{ flex: 1 }} disabled={!cart.lines.length || busy} onClick={holdOrder}>Hold</button>
            {order && <button className="btn" onClick={() => reprint(order.id)}>Reprint</button>}
            {order && (
              <button className="btn ghost" onClick={() => { cart.reset(); setOrder(null); }}>New</button>
            )}
          </div>
          <button
            className="btn primary block"
            style={{ marginTop: 8, padding: "14px" }}
            disabled={!cart.lines.length || busy || !shiftOpen || (cart.channel === "DINE_IN" && !cart.tableId)}
            onClick={() => setShowPay(true)}
          >
            Charge {formatMoney(serverTotal, currency)}
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

      {showPay && <PaymentModal currency={currency} total={serverTotal} onClose={() => setShowPay(false)} onPay={pay} />}

      {showOrders && (
        <OrdersModal
          currency={currency}
          canRefund={can("order.refund")}
          onClose={() => setShowOrders(false)}
          onRecall={(o) => {
            cart.loadFromServer({
              channel: o.channel as never,
              tableId: o.tableId,
              tableLabel: o.tableSession?.table ? `#${o.tableSession.table.number}` : null,
              orderId: o.id,
              orderNumber: o.orderNumber,
              orderDiscount: toCents(o.discountAmount),
              lines: o.lines.map((l) => ({
                key: l.id,
                menuItemId: l.menuItemId,
                name: l.itemNameSnapshot,
                unitPrice: toCents(l.unitPriceSnapshot),
                variantId: null,
                variantName: l.variantSnapshot,
                modifiers: l.modifiers.map((m) => ({ id: m.id, name: m.nameSnapshot, price: toCents(m.priceSnapshot) })),
                quantity: l.quantity,
                notes: l.notes,
              })),
            });
            setOrder(o);
            setShowOrders(false);
            push(`Recalled order #${o.orderNumber}`, "ok");
          }}
        />
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
      push("Receipt sent to printer", "ok");
    } catch (e) {
      push(e instanceof Error ? e.message : "Reprint failed", "error");
    }
  }

  const rows = tab === "OPEN" ? open?.orders ?? [] : recent?.orders ?? [];

  return (
    <Modal title="Orders" onClose={onClose} wide footer={<button className="btn ghost" onClick={onClose}>Close</button>}>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className={`cat-tab ${tab === "OPEN" ? "active" : ""}`} onClick={() => setTab("OPEN")}>Held / open</button>
        <button className={`cat-tab ${tab === "RECENT" ? "active" : ""}`} onClick={() => setTab("RECENT")}>Recent (paid)</button>
      </div>
      <table className="tbl">
        <thead><tr><th>#</th><th>Items</th><th style={{ textAlign: "right" }}>Total</th><th /></tr></thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id}>
              <td>#{o.orderNumber}</td>
              <td className="small muted">{o.lines.filter((l) => !l.isVoided).length} item(s) · {o.channel.replace("_", "-")}</td>
              <td className="mono" style={{ textAlign: "right" }}>{formatMoney(toCents(o.total), currency)}</td>
              <td>
                <div className="row" style={{ justifyContent: "flex-end" }}>
                  {tab === "OPEN" && <button className="btn small primary" onClick={() => onRecall(o)}>Recall</button>}
                  {tab === "RECENT" && <button className="btn small" onClick={() => reprint(o.id)}>Reprint</button>}
                  {tab === "RECENT" && canRefund && <button className="btn small danger" onClick={() => setRefundOrder(o)}>Refund</button>}
                </div>
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={4} className="muted">Nothing here.</td></tr>}
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
      setErr(e instanceof Error ? e.message : "Void failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Void · ${line.itemNameSnapshot}`}
      onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn danger" disabled={!reason || busy} onClick={submit}>{busy ? "…" : "Void line"}</button></>}
    >
      <Field label="Reason"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this being voided?" /></Field>
      <Field label="Manager PIN (if already sent to kitchen)"><input className="input" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="••••" /></Field>
      {err && <p className="badge danger">{err}</p>}
    </Modal>
  );
}

function RefundModal({ order, currency, onClose, onDone }: { order: OrderShape; currency: string; onClose: () => void; onDone: () => void }) {
  const { push } = useToast();
  const [amount, setAmount] = useState(fromCents(toCents(order.total)));
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const [restock, setRestock] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setErr("");
    try {
      await apiPost("/payments/refund", { orderId: order.id, amount: Number(amount), reason, managerPin: pin, restock });
      push("Refund recorded", "ok");
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Refund failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Refund · order #${order.orderNumber}`}
      onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn danger" disabled={busy || !reason || pin.length < 4} onClick={submit}>{busy ? "…" : "Refund"}</button></>}
    >
      <p className="muted small">Order total {formatMoney(toCents(order.total), currency)}</p>
      <Field label={`Refund amount (${currency})`}><input className="input" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      <Field label="Reason"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <Field label="Manager PIN"><input className="input" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="••••" /></Field>
      <label className="row small" style={{ gap: 6 }}>
        <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} /> Restock ingredients
      </label>
      {err && <p className="badge danger">{err}</p>}
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
          <button className="btn ghost" onClick={onClose}>Cancel</button>
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
            Add · {formatMoney((unitPrice + chosen.reduce((s, o) => s + toCents(o.price), 0)) * qty, currency)}
          </button>
        </>
      }
    >
      {item.variants.length > 0 && (
        <div className="field">
          <span className="small muted">Variant</span>
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
            {g.name} {g.required ? "(required)" : ""} {g.maxSelect ? `· max ${g.maxSelect}` : ""}
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
          <span className="small muted">Qty</span>
          <div className="row" style={{ marginTop: 6 }}>
            <button className="qty-btn" onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
            <span className="mono" style={{ minWidth: 24, textAlign: "center" }}>{qty}</span>
            <button className="qty-btn" onClick={() => setQty((q) => q + 1)}>+</button>
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <Field label="Notes">
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="No onions…" />
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
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Apply discount"
      onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={apply}>{busy ? "…" : "Apply"}</button></>}
    >
      <div className="row" style={{ marginBottom: 10 }}>
        <button className={`cat-tab ${type === "PERCENT" ? "active" : ""}`} onClick={() => setType("PERCENT")}>Percent %</button>
        <button className={`cat-tab ${type === "ABSOLUTE" ? "active" : ""}`} onClick={() => setType("ABSOLUTE")}>Amount</button>
      </div>
      <Field label={type === "PERCENT" ? "Percent off" : `Amount (${currency})`}>
        <input className="input" type="number" value={value} onChange={(e) => setValue(Number(e.target.value))} />
      </Field>
      <p className="muted small">Discount: {formatMoney(amount, currency)}</p>
      {needsManager && (
        <Field label="Manager PIN (required above 10%)">
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
}: {
  total: number;
  currency: string;
  onClose: () => void;
  onPay: (tenders: { method: string; amount: number; cashReceived?: number }[]) => Promise<void>;
}) {
  const [tenders, setTenders] = useState<{ method: string; amount: string; cash: string }[]>([
    { method: "CASH", amount: fromCents(total), cash: fromCents(total) },
  ]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const tendered = tenders.reduce((s, t) => s + toCents(t.amount || "0"), 0);
  const remaining = total - tendered;
  const cashChange = tenders.reduce((s, t) => (t.method === "CASH" ? s + (toCents(t.cash || "0") - toCents(t.amount || "0")) : s), 0);

  function update(i: number, patch: Partial<{ method: string; amount: string; cash: string }>) {
    setTenders((ts) => ts.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  }

  async function submit() {
    setBusy(true);
    setErr("");
    try {
      await onPay(
        tenders.map((t) => ({
          method: t.method,
          amount: Number(t.amount),
          cashReceived: t.method === "CASH" ? Number(t.cash) : undefined,
        })),
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Payment failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Charge order"
      onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || tendered < total} onClick={submit}>{busy ? "Processing…" : `Pay ${formatMoney(total, currency)}`}</button></>}
    >
      <div className="totals-row grand" style={{ marginTop: 0 }}>
        <span>Amount due</span>
        <span className="mono">{formatMoney(total, currency)}</span>
      </div>
      <div style={{ marginTop: 12 }}>
        {tenders.map((t, i) => (
          <div key={i} className="card" style={{ marginBottom: 10 }}>
            <div className="row">
              <select className="input" value={t.method} onChange={(e) => update(i, { method: e.target.value })}>
                <option value="CASH">Cash</option>
                <option value="CARD">Card</option>
                <option value="MOBILE">Mobile</option>
              </select>
              <input className="input" type="number" value={t.amount} onChange={(e) => update(i, { amount: e.target.value })} placeholder="Amount" />
            </div>
            {t.method === "CASH" && (
              <div className="row" style={{ marginTop: 8 }}>
                <span className="muted small" style={{ minWidth: 90 }}>Cash received</span>
                <input className="input" type="number" value={t.cash} onChange={(e) => update(i, { cash: e.target.value })} />
              </div>
            )}
            {i > 0 && (
              <button className="btn ghost small" style={{ marginTop: 8 }} onClick={() => setTenders((ts) => ts.filter((_, idx) => idx !== i))}>Remove</button>
            )}
          </div>
        ))}
      </div>
      <div className="row">
        <button className="btn" onClick={() => setTenders((ts) => [...ts, { method: "CARD", amount: fromCents(Math.max(0, remaining)), cash: "0" }])} disabled={remaining <= 0}>
          + Split payment
        </button>
        <div className="spacer" />
        <span className={remaining > 0 ? "badge warn" : "badge ok"}>
          {remaining > 0 ? `Remaining ${formatMoney(remaining, currency)}` : "Fully tendered"}
        </span>
      </div>
      {cashChange > 0 && <p className="muted" style={{ marginTop: 10 }}>Change due: {formatMoney(cashChange, currency)}</p>}
      {err && <p className="badge danger" style={{ marginTop: 10 }}>{err}</p>}
    </Modal>
  );
}
