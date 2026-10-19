import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, Box, Button, CircularProgress, Paper, Stack, TextField, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost } from "../lib/api";
import { errorMessage } from "../lib/errors";

interface Envelope<T> {
  success: boolean;
  message: string;
  data: T;
}

interface FirstAdminBody {
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  password: string;
}

export default function SetupFirstAdmin() {
  const nav = useNavigate();
  const { t } = useTranslation(["auth", "common"]);
  const [form, setForm] = useState({ firstName: "", lastName: "", username: "", email: "", password: "", confirm: "" });
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const { data: setup } = useQuery({
    queryKey: ["setup-status"],
    queryFn: () => apiGet<Envelope<{ needsSetup: boolean }>>("/auth/setup-status"),
    staleTime: 30_000,
    retry: 0,
  });

  useEffect(() => {
    if (setup && !setup.data.needsSetup) nav("/login", { replace: true });
  }, [setup, nav]);

  const register = useMutation({
    mutationFn: (body: FirstAdminBody) => apiPost<Envelope<{ user: unknown }>>("/auth/register-first-admin", body),
    onSuccess: () => {
      setError("");
      setDone(true);
      setTimeout(() => nav("/login", { replace: true }), 1500);
    },
    onError: (e) => setError(errorMessage(e, t)),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const { firstName, lastName, username, email, password, confirm } = form;
    if (!firstName || !lastName || !username || !email || !password) return setError(t("common:error"));
    if (password.length < 8) return setError(t("common:password_min"));
    if (password !== confirm) return setError(t("auth:passwords_not_match"));
    register.mutate({ firstName, lastName, username, email, password });
  }

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "background.default",
        backgroundImage: "radial-gradient(rgba(111,78,55,.18) 1px, transparent 1px)",
        backgroundSize: "18px 18px",
        p: 2,
      }}
    >
      <Paper elevation={3} sx={{ width: "100%", maxWidth: 470, p: { xs: 3, sm: 4 } }}>
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
              }}
            >
              MD
            </Box>
            <Box>
              <Typography variant="h5" sx={{ lineHeight: 1.2 }}>
                {t("auth:setup_title")}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t("auth:setup_subtitle")}
              </Typography>
            </Box>
          </Stack>

          {error && <Alert severity="error">{error}</Alert>}
          {done && <Alert severity="success">{t("auth:first_admin_registered")}</Alert>}

          <Box component="form" onSubmit={submit}>
            <Stack spacing={2}>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField label={t("auth:first_name")} value={form.firstName} onChange={set("firstName")} required fullWidth autoFocus />
                <TextField label={t("auth:last_name")} value={form.lastName} onChange={set("lastName")} required fullWidth />
              </Stack>
              <TextField label={t("auth:username")} value={form.username} onChange={set("username")} required fullWidth autoComplete="username" />
              <TextField label={t("auth:email")} type="email" value={form.email} onChange={set("email")} required fullWidth autoComplete="email" />
              <TextField
                label={t("auth:password")}
                type="password"
                value={form.password}
                onChange={set("password")}
                required
                fullWidth
                autoComplete="new-password"
                helperText={t("common:password_min")}
              />
              <TextField
                label={t("auth:confirm_password")}
                type="password"
                value={form.confirm}
                onChange={set("confirm")}
                required
                fullWidth
                autoComplete="new-password"
              />
              <Button type="submit" variant="contained" size="large" disabled={register.isPending || done}>
                {register.isPending ? <CircularProgress size={22} color="inherit" /> : t("auth:create_admin_account")}
              </Button>
            </Stack>
          </Box>
        </Stack>
      </Paper>
    </Box>
  );
}
