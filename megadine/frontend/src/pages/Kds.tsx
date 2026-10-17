import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "../lib/api";
import { Badge, Modal, useToast } from "../components/ui";

interface TicketLine { id: string; itemName: string; quantity: number; modifiers: { name: string }[] | null; notes: string | null; status: string }
interface Ticket {
  id: string;
  station: string;
  status: string;
  sentAt: string;
  order: { orderNumber: number; channel: string; tableId: string | null; notes: string | null };
  lines: TicketLine[];
}

const STATIONS = ["ALL", "GRILL", "FRYER", "SALAD", "BAR", "DESSERT", "KITCHEN"];
const COLUMNS: { key: string; label: string; next?: { to: string; label: string } }[] = [
  { key: "QUEUED", label: "Queued", next: { to: "PREPARING", label: "Start" } },
  { key: "PREPARING", label: "Preparing", next: { to: "READY", label: "Ready" } },
  { key: "READY", label: "Ready", next: { to: "SERVED", label: "Served" } },
];

export default function Kds() {
  const qc = useQueryClient();
  const { push } = useToast();
  const [station, setStation] = useState("ALL");
  const [show86, setShow86] = useState(false);
  const { data } = useQuery({
    queryKey: ["tickets", station],
    queryFn: () => apiGet<{ tickets: Ticket[] }>("/kitchen/tickets", { station: station === "ALL" ? undefined : station, active: "true" }),
    refetchInterval: 10000,
  });

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => apiPost(`/kitchen/tickets/${id}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tickets"] }),
    onError: (e) => push(e instanceof Error ? e.message : "Failed", "error"),
  });

  const tickets = data?.tickets ?? [];
  const age = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));

  return (
    <div>
      <div className="row wrap" style={{ marginBottom: 14 }}>
        {STATIONS.map((s) => (
          <button key={s} className={`cat-tab ${station === s ? "active" : ""}`} onClick={() => setStation(s)}>
            {s}
          </button>
        ))}
        <div className="spacer" />
        <button className="btn" onClick={() => setShow86(true)}>86 an item</button>
      </div>

      <div className="kds-grid">
        {COLUMNS.map((col) => {
          const list = tickets.filter((t) => t.status === col.key);
          return (
            <div className="kds-col" key={col.key}>
              <h3>
                {col.label} · {list.length}
              </h3>
              {list.map((t) => {
                const mins = age(t.sentAt);
                const overdue = mins >= 15 && col.key !== "READY";
                return (
                  <div className={`ticket ${overdue ? "overdue" : ""}`} key={t.id}>
                    <div className="row">
                      <span className="tnum">#{t.order.orderNumber}</span>
                      <Badge kind="muted">{t.order.channel.replace("_", " ")}</Badge>
                      <div className="spacer" />
                      <span className={`badge ${overdue ? "danger" : "muted"}`}>{mins}m</span>
                    </div>
                    <div className="small muted" style={{ margin: "4px 0 8px" }}>
                      {t.station}
                    </div>
                    {t.lines.map((l) => (
                      <div key={l.id} style={{ marginBottom: 4 }}>
                        <b>{l.quantity}×</b> {l.itemName}
                        {l.modifiers && l.modifiers.length > 0 && (
                          <div className="small muted">+ {l.modifiers.map((m) => m.name).join(", ")}</div>
                        )}
                        {l.notes && <div className="small" style={{ color: "var(--warn)" }}>note: {l.notes}</div>}
                      </div>
                    ))}
                    {t.order.notes && <div className="small muted" style={{ marginTop: 6 }}>Order note: {t.order.notes}</div>}
                    <div className="row" style={{ marginTop: 10 }}>
                      {col.next && (
                        <button className="btn ok" style={{ flex: 1 }} onClick={() => statusMut.mutate({ id: t.id, status: col.next!.to })}>
                          {col.next.label}
                        </button>
                      )}
                      <button className="btn ghost small" onClick={() => statusMut.mutate({ id: t.id, status: "CANCELLED" })}>
                        Cancel
                      </button>
                    </div>
                  </div>
                );
              })}
              {list.length === 0 && <p className="muted small">Empty</p>}
            </div>
          );
        })}
      </div>

      {show86 && <EightySixModal onClose={() => setShow86(false)} />}
    </div>
  );
}

interface MenuItemFull { id: string; name: string; isAvailable: boolean; categoryId: string }
interface CategoryFull { id: string; name: string; items: MenuItemFull[] }

function EightySixModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { push } = useToast();
  const { data } = useQuery({ queryKey: ["menu", "all"], queryFn: () => apiGet<{ categories: CategoryFull[] }>("/menu", { all: "true" }) });
  const mut = useMutation({
    mutationFn: ({ id, isAvailable }: { id: string; isAvailable: boolean }) =>
      apiPost(`/kitchen/items/${id}/availability`, { isAvailable }),
    onSuccess: () => {
      push("Availability updated", "ok");
      qc.invalidateQueries({ queryKey: ["menu"] });
    },
    onError: (e) => push(e instanceof Error ? e.message : "Failed", "error"),
  });

  return (
    <Modal title="Mark items in / out of stock" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Done</button>} wide>
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
                {i.name} {i.isAvailable ? "" : "(86)"}
              </button>
            ))}
          </div>
        </div>
      ))}
    </Modal>
  );
}
