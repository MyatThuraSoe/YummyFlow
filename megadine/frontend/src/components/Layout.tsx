import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../store/auth";
import { connectSocket, EVENTS } from "../lib/socket";
import { apiGet } from "../lib/api";
import { flushOutbox, pendingCount } from "../lib/outbox";
import { useToast } from "./ui";

const NAV = [
  { to: "/pos", label: "POS", icon: "🧾", cap: "pos.use" },
  { to: "/floor", label: "Floor", icon: "🪑", cap: "table.manage" },
  { to: "/kds", label: "Kitchen", icon: "👨‍🍳", cap: "kds.view" },
  { to: "/admin", label: "Admin", icon: "📊", cap: "report.view" },
];

const TITLES: Record<string, string> = {
  "/pos": "Point of Sale",
  "/floor": "Table Floor",
  "/kds": "Kitchen Display",
  "/admin": "Admin",
};

const IDLE_MS = 5 * 60 * 1000;

interface HardwareStatus { printerMode: string; receiptPrinter: string; kitchenPrinter: string; simulateMode: boolean }

export function Layout() {
  const { user, can, logout, loginPin } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const qc = useQueryClient();
  const { push } = useToast();
  const [socketUp, setSocketUp] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [queued, setQueued] = useState(pendingCount());
  const [locked, setLocked] = useState(false);
  const idleRef = useRef<number | null>(null);

  const { data: hw } = useQuery({ queryKey: ["hardware"], queryFn: () => apiGet<HardwareStatus>("/admin/hardware/status"), staleTime: 60_000 });

  useEffect(() => {
    const s = connectSocket();
    const invalidate = (keys: string[]) => () => keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    const handlers: [string, () => void][] = [
      [EVENTS.ORDER_CREATED, invalidate(["orders", "tables", "dashboard"])],
      [EVENTS.ORDER_UPDATED, invalidate(["orders", "tables"])],
      [EVENTS.ORDER_COMPLETED, invalidate(["orders", "tables", "shifts", "dashboard"])],
      [EVENTS.KITCHEN_NEW, invalidate(["tickets"])],
      [EVENTS.KITCHEN_UPDATED, invalidate(["tickets"])],
      [EVENTS.TABLE_UPDATED, invalidate(["tables"])],
      [EVENTS.MENU_ITEM_86, invalidate(["menu"])],
      [EVENTS.SHIFT_UPDATED, invalidate(["shift"])],
    ];
    handlers.forEach(([ev, fn]) => s.on(ev, fn));
    s.on(EVENTS.MENU_ITEM_86, (p: { name: string; isAvailable: boolean }) => push(`${p.name} marked ${p.isAvailable ? "available" : "86'd (out of stock)"}`, "info"));
    const onConnect = () => setSocketUp(true);
    const onDisconnect = () => setSocketUp(false);
    s.on("connect", onConnect);
    s.on("disconnect", onDisconnect);
    setSocketUp(s.connected);
    return () => {
      handlers.forEach(([ev, fn]) => s.off(ev, fn));
      s.off("connect", onConnect);
      s.off("disconnect", onDisconnect);
    };
  }, [qc, push]);

  useEffect(() => {
    const update = () => setQueued(pendingCount());
    window.addEventListener("md:outbox", update);
    return () => window.removeEventListener("md:outbox", update);
  }, []);

  useEffect(() => {
    const goOnline = async () => {
      setOnline(true);
      if (pendingCount() > 0) {
        const { sent, failed } = await flushOutbox();
        setQueued(pendingCount());
        if (sent) push(`Synced ${sent} queued order(s)`, "ok");
        if (failed) push(`${failed} queued order(s) still failing`, "error");
        qc.invalidateQueries({ queryKey: ["orders"] });
      }
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [qc, push]);

  useEffect(() => {
    const reset = () => {
      if (idleRef.current) window.clearTimeout(idleRef.current);
      idleRef.current = window.setTimeout(() => setLocked(true), IDLE_MS);
    };
    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"];
    if (!locked) {
      reset();
      events.forEach((e) => window.addEventListener(e, reset));
    }
    return () => {
      events.forEach((e) => window.removeEventListener(e, reset));
      if (idleRef.current) window.clearTimeout(idleRef.current);
    };
  }, [locked]);

  const title = Object.entries(TITLES).find(([k]) => loc.pathname.startsWith(k))?.[1] ?? "MegaDine";

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">Mega<span>Dine</span></div>
        {NAV.filter((n) => can(n.cap)).map((n) => (
          <NavLink key={n.to} to={n.to} className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}>
            <span>{n.icon}</span>
            <span>{n.label}</span>
          </NavLink>
        ))}
        <div className="nav-spacer" />
        <div className="small muted" style={{ padding: "8px 12px" }}>
          {user?.name}
          <br />
          <span className="badge muted">{user?.role}</span>
        </div>
        <button className="nav-item" style={{ border: "none", background: "transparent" }} onClick={() => setLocked(true)}>
          <span>🔒</span>
          <span>Lock</span>
        </button>
        <button className="nav-item" style={{ border: "none", background: "transparent" }} onClick={async () => { await logout(); nav("/login"); }}>
          <span>🚪</span>
          <span>Sign out</span>
        </button>
      </aside>
      <div className="main">
        <header className="topbar">
          <h1>{title}</h1>
          <div className="spacer" />
          {hw && <span className="badge muted" title={`${hw.receiptPrinter} / ${hw.kitchenPrinter}`}>🖨 {hw.simulateMode ? "simulated" : "tcp"}</span>}
          {queued > 0 && <span className="badge warn">{queued} queued</span>}
          <span className={`badge ${socketUp ? "ok" : "warn"}`} title="Realtime connection">{socketUp ? "Live" : "Reconnecting"}</span>
          <span className={`badge ${online ? "ok" : "danger"}`}>{online ? "Online" : "Offline"}</span>
        </header>
        <div className="content">
          <Outlet />
        </div>
      </div>
      {locked && <LockOverlay onUnlock={async (pin) => { await loginPin(pin); setLocked(false); }} onSignOut={async () => { await logout(); nav("/login"); }} />}
    </div>
  );
}

function LockOverlay({ onUnlock, onSignOut }: { onUnlock: (pin: string) => Promise<void>; onSignOut: () => Promise<void> }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setErr("");
    try {
      await onUnlock(pin);
      setPin("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Incorrect PIN");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay" style={{ zIndex: 50 }}>
      <div className="modal" style={{ maxWidth: 320 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-body" style={{ textAlign: "center" }}>
          <h3>Session locked</h3>
          <p className="muted small">Enter your PIN to resume</p>
          <input
            className="input"
            style={{ textAlign: "center", fontSize: 24, letterSpacing: 8 }}
            inputMode="numeric"
            type="password"
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && pin) submit(); }}
          />
          {err && <p className="badge danger" style={{ marginTop: 8 }}>{err}</p>}
          <button className="btn primary block" style={{ marginTop: 12 }} disabled={!pin || busy} onClick={submit}>{busy ? "…" : "Unlock"}</button>
          <button className="btn ghost block" style={{ marginTop: 8 }} onClick={onSignOut}>Sign out</button>
        </div>
      </div>
    </div>
  );
}
