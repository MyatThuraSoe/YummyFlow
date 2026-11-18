import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Button, CircularProgress, Paper, Stack, TextField, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { apiPatch } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { useAuth } from "../store/auth";
import { homeForRole } from "../components/ProtectedRoute";

/**
 * Shown when an admin issued a temporary password or PIN. The person chooses a
 * new secret before the rest of the app opens (roles redesign).
 */
export default function ChangeCredential() {
  const { t } = useTranslation(["users", "common"]);
  const nav = useNavigate();
  const { user, hydrate } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await apiPatch("/users/me/credential", {
        ...(newPassword ? { currentPassword, newPassword } : {}),
        ...(newPin ? { currentPin, newPin } : {}),
      });
      await hydrate();
      nav(user ? homeForRole(user.role) : "/", { replace: true });
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack spacing={2} sx={{ maxWidth: 520 }}>
      <Typography variant="h5">{t("users:change_credential", { defaultValue: "Choose a new password or PIN" })}</Typography>
      <Alert severity="info">
        {t("users:change_credential_help", {
          defaultValue: "Your account was issued a temporary credential. Change it now, then sign in with the new one.",
        })}
      </Alert>
      {error && <Alert severity="error">{error}</Alert>}
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack component="form" spacing={2} onSubmit={submit}>
          <Typography variant="subtitle2">{t("users:password")}</Typography>
          <TextField
            label={t("users:current_password", { defaultValue: "Current password" })}
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
          <TextField
            label={t("users:new_password", { defaultValue: "New password" })}
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            helperText={t("users:password_min_length")}
          />
          <Typography variant="subtitle2">{t("users:pin", { defaultValue: "PIN" })}</Typography>
          <TextField
            label={t("users:current_pin", { defaultValue: "Current PIN" })}
            inputMode="numeric"
            value={currentPin}
            onChange={(e) => setCurrentPin(e.target.value)}
          />
          <TextField
            label={t("users:new_pin", { defaultValue: "New PIN" })}
            inputMode="numeric"
            value={newPin}
            onChange={(e) => setNewPin(e.target.value)}
          />
          <Stack direction="row" spacing={1.5}>
            <Button type="submit" variant="contained" disabled={busy || (!newPassword && !newPin)}>
              {busy ? <CircularProgress size={20} color="inherit" /> : t("users:save", { defaultValue: "Save" })}
            </Button>
            <Button onClick={() => nav(user ? homeForRole(user.role) : "/")}>{t("common:cancel", { defaultValue: "Later" })}</Button>
          </Stack>
        </Stack>
      </Paper>
    </Stack>
  );
}
