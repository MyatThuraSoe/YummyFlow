import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiGet, apiPatch, apiPost } from "../lib/api";
import { Badge, Field, Modal, useToast } from "../components/ui";

interface TicketLine { id: string; itemName: string; quantity: number; modifiers: { name: string }[] | null; notes: string | null; status: string }
interface Ticket {
  id: string;
  orderId: string;
  station: string;
  status: string;
  sentAt: string;
  order: { orderNumber: number; channel: string; tableId: string | null; notes: string | null; priority: string };
  lines: TicketLine[];
}

const PRIORITIES = ["NORMAL", "RUSH", "VIP", "CATERING"];
const priorityKind = (p: string) => (p === "RUSH" ? "danger" : p === "VIP" ? "warn" : p === "CATERING" ? "info" : "muted");
const timerUrgency = (mins: number) => (mins < 5 ? "fast" : mins < 15 ? "normal" : mins < 30 ? "slow" : "overdue");

const STATIONS = ["ALL", "GRILL", "FRYER", "SALAD", "BAR", "DESSERT", "KITCHEN"];
const COLUMNS: { key: string; labelKey: string; next?: { to: string; labelKey: string } }[] = [
  { key: "QUEUED", labelKey: "kds_queued", next: { to: "PREPARING", labelKey: "kds_start" } },
  { key: "PREPARING", labelKey: "kds_preparing", next: { to: "READY", labelKey: "kds_mark_ready" } },
  { key: "READY", labelKey: "kds_ready", next: { to: "SERVED", labelKey: "kds_served" } },
];

export default function Kds() {
  const qc = useQueryClient();
  const { push } = useToast();
  const { t } = useTranslation(["ops", "common"]);
  const [station, setStation] = useState(() => localStorage.getItem("kds_station") ?? "ALL");
  const [show86, setShow86] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<Ticket | null>(null);
  const [priorityTarget, setPriorityTarget] = useState<Ticket | null>(null);
  const { data } = useQuery({
    queryKey: ["tickets", station],
    queryFn: () => apiGet<{ tickets: Ticket[] }>("/kitchen/tickets", { station: station === "ALL" ? undefined : station, active: "true" }),
    refetchInterval: 10000,
  });

  useEffect(() => {
    localStorage.setItem("kds_station", station);
  }, [station]);

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => apiPost(`/kitchen/tickets/${id}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tickets"] }),
    onError: (e) => push(e instanceof Error ? e.message : t("ops:failed"), "error"),
  });

  const tickets = data?.tickets ?? [];
  const age = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  const channelLabel = (channel: string) => {
    const key = `channel_${channel.toLowerCase()}`;
    return t(`ops:${key}`, { defaultValue: channel.replace("_", " ") });
  };

  return (
    <div>
      <div className="row wrap" style={{ marginBottom: 14 }}>
        {STATIONS.map((s) => (
          <button key={s} className={`cat-tab ${station === s ? "active" : ""}`} onClick={() => setStation(s)}>
            {s}
          </button>
        ))}
        <div className="spacer" />
        <button className="btn" onClick={() => setShow86(true)}>{t("ops:kds_86_btn")}</button>
      </div>

      <div className="kds-grid">
        {COLUMNS.map((col) => {
          const list = tickets.filter((t) => t.status === col.key);
          return (
            <div className="kds-col" key={col.key}>
              <h3>
                {t(`ops:${col.labelKey}`)} · {list.length}
              </h3>
              {list.map((tk) => {
                const mins = age(tk.sentAt);
                const priority = tk.order.priority ?? "NORMAL";
                const urgency = timerUrgency(mins);
                const veryOverdue = mins >= 30 && col.key !== "READY";
                return (
                  <div
                    className={`ticket ${tk.status.toLowerCase()} ${priority !== "NORMAL" ? priority.toLowerCase() : ""} ${veryOverdue ? "overdue" : ""}`}
                    key={tk.id}
                  >
                    <div className="row">
                      <span className="tnum">#{tk.order.orderNumber}</span>
                      <Badge kind="muted">{channelLabel(tk.order.channel)}</Badge>
                      {priority !== "NORMAL" && (
                        <Badge kind={priorityKind(priority)}>{t(`ops:priority_${priority.toLowerCase()}`)}</Badge>
                      )}
                      <div className="spacer" />
                      <span className={`timer ${urgency}`}>{t("ops:kds_minutes", { count: mins })}</span>
                    </div>
                    <div className="small muted" style={{ margin: "4px 0 8px" }}>
                      {tk.station}
                    </div>
                    {tk.lines.map((l) => (
                      <div key={l.id} style={{ marginBottom: 4 }}>
                        <b>{l.quantity}×</b> {l.itemName}
                        {l.modifiers && l.modifiers.length > 0 && (
                          <div className="small muted">+ {l.modifiers.map((m) => m.name).join(", ")}</div>
                        )}
                        {l.notes && <div className="small" style={{ color: "var(--warn)" }}>{t("ops:kds_note", { note: l.notes })}</div>}
                      </div>
                    ))}
                    {tk.order.notes && <div className="small muted" style={{ marginTop: 6 }}>{t("ops:kds_order_note", { note: tk.order.notes })}</div>}
                    <div className="row" style={{ marginTop: 10 }}>
                      {col.next && (
                        <button className="btn ok" style={{ flex: 1 }} onClick={() => statusMut.mutate({ id: tk.id, status: col.next!.to })}>
                          {t(`ops:${col.next.labelKey}`)}
                        </button>
                      )}
                      <button className="btn ghost small" onClick={() => setPriorityTarget(tk)}>
                        {t("ops:kds_priority_btn")}
                      </button>
                      <button className="btn ghost small" onClick={() => setCancelTarget(tk)}>
                        {t("ops:kds_cancel")}
                      </button>
                    </div>
                  </div>
                );
              })}
              {list.length === 0 && <p className="muted small">{t("ops:kds_empty")}</p>}
            </div>
          );
        })}
      </div>

      {show86 && <EightySixModal onClose={() => setShow86(false)} />}
      {cancelTarget && <CancelTicketModal ticket={cancelTarget} onClose={() => setCancelTarget(null)} />}
      {priorityTarget && <PriorityModal ticket={priorityTarget} onClose={() => setPriorityTarget(null)} />}
    </div>
  );
}

function PriorityModal({ ticket, onClose }: { ticket: Ticket; onClose: () => void }) {
  const qc = useQueryClient();
  const { push } = useToast();
  const { t } = useTranslation(["ops", "common"]);
  const [priority, setPriority] = useState(ticket.order.priority ?? "NORMAL");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setErr("");
    try {
      await apiPatch(`/orders/${ticket.orderId}/priority`, { priority, managerPin: pin || undefined });
      push(t("ops:kds_priority_saved"), "ok");
      qc.invalidateQueries({ queryKey: ["tickets"] });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("ops:failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={t("ops:kds_priority_title", { number: ticket.order.orderNumber })}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            {t("ops:cancel")}
          </button>
          <button className="btn primary" disabled={busy} onClick={submit}>
            {busy ? "…" : t("ops:done")}
          </button>
        </>
      }
    >
      <div className="row wrap" style={{ marginBottom: 12 }}>
        {PRIORITIES.map((p) => (
          <button key={p} className={`cat-tab ${priority === p ? "active" : ""}`} onClick={() => setPriority(p)}>
            {t(`ops:priority_${p.toLowerCase()}`)}
          </button>
        ))}
      </div>
      {priority !== "NORMAL" && (
        <Field label={t("ops:kds_priority_pin")}>
          <input className="input" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="••••" />
        </Field>
      )}
      {err && <p className="badge danger">{err}</p>}
    </Modal>
  );
}

function CancelTicketModal({ ticket, onClose }: { ticket: Ticket; onClose: () => void }) {
  const qc = useQueryClient();
  const { push } = useToast();
  const { t } = useTranslation(["ops", "common"]);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setErr("");
    try {
      await apiPost(`/kitchen/tickets/${ticket.id}/status`, { status: "CANCELLED", reason });
      push(t("ops:kds_cancelled"), "ok");
      qc.invalidateQueries({ queryKey: ["tickets"] });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("ops:failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={t("ops:kds_cancel_title", { number: ticket.order.orderNumber })}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            {t("ops:cancel")}
          </button>
          <button className="btn danger" disabled={reason.trim().length < 2 || busy} onClick={submit}>
            {busy ? "…" : t("ops:kds_cancel_submit")}
          </button>
        </>
      }
    >
      <Field label={t("ops:void_reason")}>
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("ops:void_reason_placeholder")} autoFocus />
      </Field>
      {err && <p className="badge danger">{err}</p>}
    </Modal>
  );
}

interface MenuItemFull { id: string; name: string; isAvailable: boolean; categoryId: string }
interface CategoryFull { id: string; name: string; items: MenuItemFull[] }

function EightySixModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { push } = useToast();
  const { t } = useTranslation(["ops", "common"]);
  const { data } = useQuery({ queryKey: ["menu", "all"], queryFn: () => apiGet<{ categories: CategoryFull[] }>("/menu", { all: "true" }) });
  const mut = useMutation({
    mutationFn: ({ id, isAvailable }: { id: string; isAvailable: boolean }) =>
      apiPost(`/kitchen/items/${id}/availability`, { isAvailable }),
    onSuccess: () => {
      push(t("ops:kds_availability_updated"), "ok");
      qc.invalidateQueries({ queryKey: ["menu"] });
    },
    onError: (e) => push(e instanceof Error ? e.message : t("ops:failed"), "error"),
  });

  return (
    <Modal title={t("ops:kds_86_title")} onClose={onClose} footer={<button className="btn primary" onClick={onClose}>{t("ops:done")}</button>} wide>
      {(data?.categories ?? []).map((c) => (
        <div key={c.id} style={{ marginBottom: 12 }}>
          <div className="small muted" style={{ marginBottom: 6 }}>{c.name}</div>
          <div className="row wrap">
            {c.items.map((i) => (
              <button
                key={i.id}
                className={`btn ${i.isAvailable ? "" : "danger"}`}
                onClick={() => mut.mutate({ id: i.id, isAvailable: !i.isAvailable })}
              >
                {i.name} {i.isAvailable ? "" : t("ops:kds_86_suffix")}
              </button>
            ))}
          </div>
        </div>
      ))}
    </Modal>
  );
}
