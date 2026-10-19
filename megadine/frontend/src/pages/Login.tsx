import { useEffect, useState } from "react";
import { useNavigate, Link as RouterLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Alert, Box, Button, CircularProgress, Link, Paper, Stack, Tab, Tabs, TextField, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { apiGet } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { useAuth } from "../store/auth";
import { homeForRole } from "../components/ProtectedRoute";
import LanguageSwitcher from "../components/LanguageSwitcher";

interface Envelope<T> {
  success: boolean;
  message: string;
  data: T;
}

export default function Login() {
  const { loginPin, loginCredentials } = useAuth();
  const nav = useNavigate();
  const { t } = useTranslation(["auth", "common", "errors"]);
  const [tab, setTab] = useState<"password" | "pin">("password");
  const [handle, setHandle] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [expired] = useState(() => {
    const flag = sessionStorage.getItem("md_session_expired_message");
    if (flag) sessionStorage.removeItem("md_session_expired_message");
    return !!flag;
  });

  const { data: setup } = useQuery({
    queryKey: ["setup-status"],
    queryFn: () => apiGet<Envelope<{ needsSetup: boolean }>>("/auth/setup-status"),
    staleTime: 30_000,
    retry: 0,
  });

  useEffect(() => {
    if (setup?.data.needsSetup) nav("/setup", { replace: true });
  }, [setup, nav]);

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const user = await loginCredentials(handle.trim(), password);
      nav(homeForRole(user.role), { replace: true });
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function submitPin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const user = await loginPin(pin);
      nav(homeForRole(user.role), { replace: true });
    } catch (err) {
      setError(errorMessage(err, t));
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "background.default",
        backgroundImage: "radial-gradient(rgba(22,163,74,.16) 1px, transparent 1px)",
        backgroundSize: "18px 18px",
        p: 2,
      }}
    >
      <Box sx={{ position: "fixed", top: 16, right: 16 }}>
        <LanguageSwitcher />
      </Box>
      <Paper elevation={3} sx={{ width: "100%", maxWidth: 430, p: { xs: 3, sm: 4 } }}>
        <Stack spacing={2.5}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
            <Box
              sx={{
                width: 46,
                height: 46,
                borderRadius: 2.5,
                bgcolor: "primary.main",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 800,
                fontSize: 18,
                letterSpacing: -0.5,
              }}
            >
              MD
            </Box>
            <Box>
              <Typography variant="h5" sx={{ lineHeight: 1.2 }}>
                {t("auth:sign_in_title")}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t("auth:enter_credentials")}
              </Typography>
            </Box>
          </Stack>

          {expired && <Alert severity="warning">{t("errors:session_expired")}</Alert>}
          {error && <Alert severity="error">{error}</Alert>}

          <Tabs value={tab} onChange={(_, v) => { setTab(v); setError(""); }} variant="fullWidth">
            <Tab value="password" label={t("auth:password_tab")} />
            <Tab value="pin" label={t("auth:pin_tab")} />
          </Tabs>

          {tab === "password" ? (
            <Box component="form" onSubmit={submitPassword}>
              <Stack spacing={2}>
                <TextField
                  label={t("auth:username")}
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  autoFocus
                  fullWidth
                  autoComplete="username"
                />
                <TextField
                  label={t("auth:password")}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  fullWidth
                  autoComplete="current-password"
                />
                <Button type="submit" variant="contained" size="large" disabled={busy || !handle.trim() || !password}>
                  {busy ? <CircularProgress size={22} color="inherit" /> : t("auth:sign_in")}
                </Button>
              </Stack>
            </Box>
          ) : (
            <Box component="form" onSubmit={submitPin}>
              <Stack spacing={2}>
                <TextField
                  type="password"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  autoFocus
                  fullWidth
                  placeholder="••••"
                  slotProps={{ htmlInput: { inputMode: "numeric", style: { textAlign: "center", fontSize: 26, letterSpacing: 10 } } }}
                />
                <Button type="submit" variant="contained" size="large" disabled={busy || pin.length < 4}>
                  {busy ? <CircularProgress size={22} color="inherit" /> : t("auth:sign_in")}
                </Button>
              </Stack>
            </Box>
          )}

          {setup?.data.needsSetup && (
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center" }}>
              {t("auth:first_time")}{" "}
              <Link component={RouterLink} to="/setup">
                {t("auth:setup_account")}
              </Link>
            </Typography>
          )}
        </Stack>
      </Paper>
    </Box>
  );
}
