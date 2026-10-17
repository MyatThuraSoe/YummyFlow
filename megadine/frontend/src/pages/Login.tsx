import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../store/auth";
import { useToast } from "../components/ui";
import { homeForRole } from "../components/ProtectedRoute";

export default function Login() {
  const { loginPin, loginPassword } = useAuth();
  const nav = useNavigate();
  const { push } = useToast();
  const [mode, setMode] = useState<"pin" | "password">("pin");
  const [pin, setPin] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submitPin(value: string) {
    setBusy(true);
    try {
      const user = await loginPin(value);
      nav(homeForRole(user.role), { replace: true });
    } catch (e) {
      push(e instanceof Error ? e.message : "Login failed", "error");
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  function press(d: string) {
    if (busy) return;
    if (d === "clear") return setPin("");
    if (d === "back") return setPin((p) => p.slice(0, -1));
    const next = pin + d;
    setPin(next);
    if (next.length >= 4) {
      // Auto-submit once at least 4 digits; 4-6 digit PINs supported via "Enter".
      if (next.length === 6) submitPin(next);
    }
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const user = await loginPassword(email, password);
      nav(homeForRole(user.role), { replace: true });
    } catch (err) {
      push(err instanceof Error ? err.message : "Login failed", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>
          Mega<span style={{ color: "var(--brand)" }}>Dine</span>
        </h1>
        <p className="muted small">Offline-first restaurant POS</p>

        {mode === "pin" ? (
          <>
            <div className="pin-dots">
              {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
                <div key={i} className={`pin-dot ${i < pin.length ? "filled" : ""}`} />
              ))}
            </div>
            <div className="pin-pad">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "back", "0", "clear"].map((k) => (
                <button key={k} className="pin-key" onClick={() => press(k)} disabled={busy}>
                  {k === "back" ? "⌫" : k === "clear" ? "C" : k}
                </button>
              ))}
              <button
                className="pin-key wide primary"
                style={{ background: "var(--brand)", borderColor: "var(--brand)", color: "#1a1200" }}
                disabled={busy || pin.length < 4}
                onClick={() => submitPin(pin)}
              >
                {busy ? "…" : "Enter"}
              </button>
            </div>
            {import.meta.env.VITE_SHOW_DEMO_PINS === "1" && (
              <p className="muted small" style={{ marginTop: 14 }}>
                Demo PINs: Owner 0000 · Admin 4444 · Cashier 1111 · Waiter 2222 · Kitchen 3333
              </p>
            )}
            <button className="btn ghost small" onClick={() => setMode("password")}>
              Sign in with email instead
            </button>
          </>
        ) : (
          <form onSubmit={submitPassword} style={{ textAlign: "left", marginTop: 12 }}>
            <label className="field">
              <span>Email</span>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label className="field">
              <span>Password</span>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
            <button className="btn primary block" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
            <button type="button" className="btn ghost small block" style={{ marginTop: 8 }} onClick={() => setMode("pin")}>
              Use PIN pad
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
