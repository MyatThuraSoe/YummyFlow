import { useState } from "react";
import { useTranslation } from "react-i18next";

export default function LockOverlay({ onUnlock, onSignOut }: { onUnlock: (pin: string) => Promise<void>; onSignOut: () => Promise<void> }) {
  const { t } = useTranslation("nav");
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
      setErr(e instanceof Error ? e.message : t("unlock_failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay" style={{ zIndex: 1300 }}>
      <div className="modal" style={{ maxWidth: 320 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-body" style={{ textAlign: "center" }}>
          <h3>{t("session_locked")}</h3>
          <p className="muted small">{t("enter_pin")}</p>
          <input
            className="input"
            style={{ textAlign: "center", fontSize: 24, letterSpacing: 8 }}
            inputMode="numeric"
            type="password"
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && pin) submit();
            }}
          />
          {err && (
            <p className="badge danger" style={{ marginTop: 8 }}>
              {err}
            </p>
          )}
          <button className="btn primary block" style={{ marginTop: 12 }} disabled={!pin || busy} onClick={submit}>
            {busy ? "…" : t("unlock")}
          </button>
          <button className="btn ghost block" style={{ marginTop: 8 }} onClick={onSignOut}>
            {t("logout")}
          </button>
        </div>
      </div>
    </div>
  );
}
