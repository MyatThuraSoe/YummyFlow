import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

// ── Toasts ──────────────────────────────────────────────
interface Toast { id: number; message: string; kind: "ok" | "error" | "info"; action?: { label: string; onClick: () => void } }
interface ToastCtx { push: (message: string, kind?: Toast["kind"], action?: Toast["action"]) => void; }
const ToastContext = createContext<ToastCtx>({ push: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, kind: Toast["kind"] = "info", action?: Toast["action"]) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, kind, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);
  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="toast">
        {toasts.map((t) => (
          <div key={t.id} className={`toast-item ${t.kind}`}>
            {t.message}
            {t.action && (
              <button className="btn ghost small" style={{ marginLeft: 12 }} onClick={() => { t.action!.onClick(); setToasts((xs) => xs.filter((x) => x.id !== t.id)); }}>
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ── Modal ───────────────────────────────────────────────
export function Modal({
  title,
  children,
  onClose,
  footer,
  wide,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={wide ? { maxWidth: 760 } : undefined} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3 style={{ margin: 0, flex: 1 }}>{title}</h3>
          <button className="btn ghost" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Badge({ kind, children }: { kind: string; children: ReactNode }) {
  return <span className={`badge ${kind}`}>{children}</span>;
}
