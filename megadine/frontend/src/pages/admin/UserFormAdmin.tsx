import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Skeleton,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { apiDel, apiGet, apiPost, apiPut } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { formatMoney } from "../../lib/format";
import { useAuth } from "../../store/auth";

interface Envelope<T> {
  success: boolean;
  message: string;
  data: T;
}

interface UserDetail {
  id: string;
  name: string;
  username: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
  mustChangeCredential: boolean;
}

interface UserStats {
  totalSales: number;
  totalRevenue: number;
  todaySales: number;
  todayRevenue: number;
}

interface SessionRow {
  id: string;
  terminalId: string | null;
  lastSeenAt: string;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}

interface CapabilityMeta {
  capabilities: string[];
  defaults: Record<string, string[]>;
}

interface CapabilityView {
  role: string;
  effective: string[];
  overrides: { id: string; capability: string; granted: boolean; reason: string | null; endsAt: string | null }[];
}

type OverrideChoice = "default" | "grant" | "deny";

const ROLES = ["OWNER", "ADMIN", "MANAGER", "CASHIER", "WAITER", "KITCHEN"];

function randomPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 12 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

function randomPin(): string {
  for (;;) {
    const pin = String(Math.floor(1000 + Math.random() * 9000));
    if (!/^(\d)\1+$/.test(pin) && !["1234", "0123", "0000"].includes(pin)) return pin;
  }
}

export default function UserFormAdmin() {
  const { id } = useParams();
  const editing = !!id;
  const { t } = useTranslation(["users", "common", "admin"]);
  const roleLabel = (r: string) => t(`admin:role_${r.toLowerCase()}`, { defaultValue: r });
  const nav = useNavigate();
  const qc = useQueryClient();
  const { can } = useAuth();

  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
    pin: "",
    role: "CASHIER",
    firstName: "",
    lastName: "",
    phone: "",
    isActive: true,
  });
  const [loaded, setLoaded] = useState(!editing);
  const [error, setError] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const [resetType, setResetType] = useState<"PASSWORD" | "PIN">("PIN");
  const [credential, setCredential] = useState<{ value: string; type: string } | null>(null);
  const [overrides, setOverrides] = useState<Record<string, { choice: OverrideChoice; reason: string }>>({});
  const [overridesLoaded, setOverridesLoaded] = useState(false);
  const [savingOverrides, setSavingOverrides] = useState(false);

  const { data: userData, isLoading } = useQuery({
    queryKey: ["users", id],
    queryFn: () => apiGet<Envelope<{ user: UserDetail }>>(`/users/${id}`),
    enabled: editing,
  });

  const { data: statsData } = useQuery({
    queryKey: ["users", id, "stats"],
    queryFn: () => apiGet<Envelope<UserStats>>(`/users/${id}/stats`),
    enabled: editing,
  });

  const { data: rolesData } = useQuery({
    queryKey: ["users", "assignable-roles"],
    queryFn: () => apiGet<Envelope<{ roles: string[] }>>("/users/roles/assignable"),
    staleTime: 5 * 60_000,
  });

  const { data: sessionsData, refetch: refetchSessions } = useQuery({
    queryKey: ["users", id, "sessions"],
    queryFn: () => apiGet<Envelope<{ sessions: SessionRow[] }>>(`/users/${id}/sessions`),
    enabled: editing && can("user.view"),
  });

  const { data: capsMeta } = useQuery({
    queryKey: ["users", "capabilities-meta"],
    queryFn: () => apiGet<Envelope<CapabilityMeta>>("/users/meta/capabilities"),
    enabled: editing,
    staleTime: 5 * 60_000,
  });

  const { data: capsView } = useQuery({
    queryKey: ["users", id, "capabilities"],
    queryFn: () => apiGet<Envelope<CapabilityView>>(`/users/${id}/capabilities`),
    enabled: editing && can("user.edit"),
  });

  useEffect(() => {
    const u = userData?.data.user;
    if (u && !loaded) {
      setForm({
        username: u.username ?? "",
        email: u.email ?? "",
        password: "",
        pin: "",
        role: u.role,
        firstName: u.firstName ?? "",
        lastName: u.lastName ?? "",
        phone: u.phone ?? "",
        isActive: u.isActive,
      });
      setResetType(["OWNER", "ADMIN", "MANAGER"].includes(u.role) ? "PASSWORD" : "PIN");
      setLoaded(true);
    }
  }, [userData, loaded]);

  useEffect(() => {
    const view = capsView?.data;
    if (!view || overridesLoaded) return;
    const next: Record<string, { choice: OverrideChoice; reason: string }> = {};
    for (const o of view.overrides) {
      next[o.capability] = { choice: o.granted ? "grant" : "deny", reason: o.reason ?? "" };
    }
    setOverrides(next);
    setOverridesLoaded(true);
  }, [capsView, overridesLoaded]);

  const roleOptions = useMemo(() => {
    const assignable = rolesData?.data.roles ?? [];
    const list = editing && form.role && !assignable.includes(form.role) ? [...assignable, form.role] : assignable;
    return list.length ? list : ROLES;
  }, [rolesData, editing, form.role]);

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        ...(form.email ? { email: form.email } : {}),
        firstName: form.firstName,
        lastName: form.lastName,
        phone: form.phone || null,
        role: form.role,
        isActive: form.isActive,
        ...(form.password ? { password: form.password } : {}),
        ...(form.pin ? { pin: form.pin } : {}),
        ...(!editing ? { username: form.username, temporary: true } : {}),
      };
      if (editing) return apiPut(`/users/${id}`, body);
      return apiPost("/users", body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      nav("/admin/users");
    },
    onError: (e) => setError(errorMessage(e, t)),
  });

  const reset = useMutation({
    mutationFn: () => apiPost<Envelope<{ credential: string; type: string }>>(`/users/${id}/reset-credential`, { type: resetType }),
    onSuccess: (res) => {
      setCredential({ value: res.data.credential, type: res.data.type });
      setResetOpen(false);
      void refetchSessions();
    },
    onError: (e) => setError(errorMessage(e, t)),
  });

  const signOutAll = useMutation({
    mutationFn: () => apiDel(`/users/${id}/sessions`),
    onSuccess: () => void refetchSessions(),
    onError: (e) => setError(errorMessage(e, t)),
  });

  function validate(): string | null {
    if (!editing && !form.username.trim()) return t("users:username_required");
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return t("users:email_invalid");
    const needsPassword = ["OWNER", "ADMIN", "MANAGER"].includes(form.role);
    if (!editing && needsPassword && !form.password) return t("users:password_required");
    if (!editing && !needsPassword && !form.password && !form.pin) {
      return t("users:credential_required", { defaultValue: "Provide a password or a PIN" });
    }
    if (form.password && form.password.length < 8) return t("users:password_min_length");
    if (!form.firstName.trim()) return t("users:first_name_required");
    if (!form.lastName.trim()) return t("users:last_name_required");
    if (!form.role) return t("users:role_required");
    return null;
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const problem = validate();
    if (problem) return setError(problem);
    save.mutate();
  }

  async function saveOverrides() {
    if (!id || !capsMeta) return;
    setSavingOverrides(true);
    setError("");
    try {
      const payload = Object.entries(overrides)
        .filter(([, v]) => v.choice !== "default")
        .map(([capability, v]) => ({
          capability,
          granted: v.choice === "grant",
          reason: v.reason || null,
          endsAt: null,
        }));
      await apiPut(`/users/${id}/capabilities`, { overrides: payload });
      qc.invalidateQueries({ queryKey: ["users", id, "capabilities"] });
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setSavingOverrides(false);
    }
  }

  const set = (key: keyof typeof form) => (value: string | boolean) => setForm((f) => ({ ...f, [key]: value }));

  if (editing && (isLoading || !loaded)) {
    return (
      <Stack spacing={2}>
        <Skeleton width={220} height={40} />
        <Skeleton variant="rounded" height={120} />
        <Skeleton variant="rounded" height={320} />
      </Stack>
    );
  }

  const stats = statsData?.data;
  const detail = userData?.data.user;
  const sessions = sessionsData?.data.sessions ?? [];
  const defaults = capsMeta?.data.defaults?.[detail?.role ?? form.role] ?? [];

  return (
    <Stack spacing={2} sx={{ maxWidth: 860 }}>
      <Typography variant="h5">{editing ? t("users:edit_user") : t("users:add_user")}</Typography>

      {editing && stats && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            {t("users:sales_performance")}
          </Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4, 1fr)" }, gap: 1.5 }}>
            <StatTile label={t("users:sales_performance_total_sales")} value={String(stats.totalSales)} />
            <StatTile label={t("users:sales_performance_total_revenue")} value={formatMoney(Math.round(stats.totalRevenue * 100))} />
            <StatTile label={t("users:sales_performance_today_sales")} value={String(stats.todaySales)} />
            <StatTile label={t("users:sales_performance_today_revenue")} value={formatMoney(Math.round(stats.todayRevenue * 100))} />
          </Box>
        </Paper>
      )}

      {error && <Alert severity="error" onClose={() => setError("")}>{error}</Alert>}
      {editing && detail?.mustChangeCredential && (
        <Alert severity="warning">
          {t("users:must_change_notice", { defaultValue: "This person was issued a temporary credential and must change it at next sign-in." })}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 3 }}>
        <Box component="form" onSubmit={submit}>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, columnGap: 2 }}>
            <TextField
              label={t("users:username")}
              value={form.username}
              onChange={(e) => set("username")(e.target.value)}
              disabled={editing}
              margin="normal"
              required={!editing}
            />
            <TextField
              label={t("users:email")}
              type="email"
              value={form.email}
              onChange={(e) => set("email")(e.target.value)}
              margin="normal"
              helperText={t("users:optional", { defaultValue: "Optional" })}
            />
            <FormControl margin="normal">
              <InputLabel>{t("users:role")}</InputLabel>
              <Select label={t("users:role")} value={form.role} onChange={(e) => set("role")(e.target.value)}>
                {roleOptions.map((r) => (
                  <MenuItem key={r} value={r}>
                    {roleLabel(r)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField label={t("users:first_name")} value={form.firstName} onChange={(e) => set("firstName")(e.target.value)} margin="normal" required />
            <TextField label={t("users:last_name")} value={form.lastName} onChange={(e) => set("lastName")(e.target.value)} margin="normal" required />
            <TextField label={t("users:phone")} value={form.phone} onChange={(e) => set("phone")(e.target.value)} margin="normal" />
            {!editing && (
              <>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <TextField
                    label={t("users:password")}
                    type="text"
                    value={form.password}
                    onChange={(e) => set("password")(e.target.value)}
                    margin="normal"
                    fullWidth
                    helperText={t("users:password_min_length")}
                  />
                  <Button sx={{ mt: 1 }} onClick={() => set("password")(randomPassword())}>
                    {t("users:generate", { defaultValue: "Generate" })}
                  </Button>
                </Stack>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <TextField
                    label={t("users:pin", { defaultValue: "PIN (floor staff)" })}
                    inputMode="numeric"
                    value={form.pin}
                    onChange={(e) => set("pin")(e.target.value)}
                    margin="normal"
                    fullWidth
                  />
                  <Button sx={{ mt: 1 }} onClick={() => set("pin")(randomPin())}>
                    {t("users:generate", { defaultValue: "Generate" })}
                  </Button>
                </Stack>
              </>
            )}
            <FormControlLabel
              control={<Switch checked={form.isActive} onChange={(e) => set("isActive")(e.target.checked)} />}
              label={t("users:active")}
              sx={{ mt: 2 }}
            />
          </Box>
          <Stack direction="row" spacing={1.5} sx={{ mt: 3 }}>
            <Button type="submit" variant="contained" disabled={save.isPending}>
              {save.isPending ? <CircularProgress size={20} color="inherit" /> : editing ? t("users:update") : t("users:create")}
            </Button>
            <Button onClick={() => nav("/admin/users")}>{t("users:cancel")}</Button>
          </Stack>
        </Box>
      </Paper>

      {editing && can("user.reset_credential") && (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center" }} spacing={2}>
            <Box>
              <Typography variant="subtitle1">{t("users:reset_credential", { defaultValue: "Reset password or PIN" })}</Typography>
              <Typography variant="body2" color="text.secondary">
                {t("users:reset_help", {
                  defaultValue: "A new credential is shown once, and every session for this person is signed out.",
                })}
              </Typography>
            </Box>
            <Button variant="outlined" color="warning" onClick={() => setResetOpen(true)}>
              {t("users:reset", { defaultValue: "Reset" })}
            </Button>
          </Stack>
          {credential && (
            <Alert severity="warning" sx={{ mt: 2 }} onClose={() => setCredential(null)}>
              {credential.type}: <strong style={{ fontFamily: "monospace", letterSpacing: 2 }}>{credential.value}</strong>
            </Alert>
          )}
        </Paper>
      )}

      {editing && can("user.view") && (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center" }}>
            <Typography variant="subtitle1">{t("users:sessions", { defaultValue: "Sessions and devices" })}</Typography>
            <Button
              variant="outlined"
              color="error"
              disabled={signOutAll.isPending || sessions.length === 0}
              onClick={() => signOutAll.mutate()}
            >
              {t("users:sign_out_everywhere", { defaultValue: "Sign out everywhere" })}
            </Button>
          </Stack>
          <Table size="small" sx={{ mt: 1 }}>
            <TableHead>
              <TableRow>
                <TableCell>{t("users:terminal", { defaultValue: "Terminal" })}</TableCell>
                <TableCell>{t("users:last_seen", { defaultValue: "Last seen" })}</TableCell>
                <TableCell>{t("users:expires", { defaultValue: "Expires" })}</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {sessions.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>{s.terminalId ?? "—"}</TableCell>
                  <TableCell>{new Date(s.lastSeenAt).toLocaleString()}</TableCell>
                  <TableCell>{new Date(s.expiresAt).toLocaleString()}</TableCell>
                  <TableCell>{s.current && <Chip size="small" label={t("users:current", { defaultValue: "This device" })} />}</TableCell>
                </TableRow>
              ))}
              {sessions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} align="center" sx={{ color: "text.secondary" }}>
                    —
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Paper>
      )}

      {editing && can("user.edit") && capsMeta && (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="subtitle1">{t("users:permissions", { defaultValue: "Permissions for this person" })}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t("users:permissions_help", {
              defaultValue: "Role defaults apply unless overridden here. Overrides are logged with your name.",
            })}
          </Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 1.5 }}>
            {capsMeta.data.capabilities.map((cap) => {
              const choice = overrides[cap]?.choice ?? "default";
              return (
                <Box key={cap} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: 1.5 }}>
                  <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center", gap: 1 }}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {cap}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {defaults.includes(cap)
                          ? t("users:role_default_on", { defaultValue: "On by role" })
                          : t("users:role_default_off", { defaultValue: "Off by role" })}
                      </Typography>
                    </Box>
                    <FormControl size="small" sx={{ minWidth: 120 }}>
                      <Select
                        value={choice}
                        onChange={(e) =>
                          setOverrides((prev) => ({
                            ...prev,
                            [cap]: { choice: e.target.value as OverrideChoice, reason: prev[cap]?.reason ?? "" },
                          }))
                        }
                      >
                        <MenuItem value="default">{t("users:default", { defaultValue: "Default" })}</MenuItem>
                        <MenuItem value="grant">{t("users:grant", { defaultValue: "Grant" })}</MenuItem>
                        <MenuItem value="deny">{t("users:deny", { defaultValue: "Deny" })}</MenuItem>
                      </Select>
                    </FormControl>
                  </Stack>
                  {choice !== "default" && (
                    <TextField
                      size="small"
                      fullWidth
                      label={t("users:reason", { defaultValue: "Reason" })}
                      value={overrides[cap]?.reason ?? ""}
                      onChange={(e) =>
                        setOverrides((prev) => ({ ...prev, [cap]: { choice, reason: e.target.value } }))
                      }
                      sx={{ mt: 1 }}
                    />
                  )}
                </Box>
              );
            })}
          </Box>
          <Button variant="contained" sx={{ mt: 2 }} disabled={savingOverrides} onClick={saveOverrides}>
            {savingOverrides ? <CircularProgress size={20} color="inherit" /> : t("users:save_permissions", { defaultValue: "Save permissions" })}
          </Button>
        </Paper>
      )}

      <Dialog open={resetOpen} onClose={() => setResetOpen(false)}>
        <DialogTitle>{t("users:reset_credential", { defaultValue: "Reset password or PIN" })}</DialogTitle>
        <DialogContent>
          <FormControl fullWidth size="small" sx={{ mt: 1 }}>
            <InputLabel>{t("users:credential_type", { defaultValue: "Credential" })}</InputLabel>
            <Select label={t("users:credential_type", { defaultValue: "Credential" })} value={resetType} onChange={(e) => setResetType(e.target.value as "PASSWORD" | "PIN")}>
              <MenuItem value="PASSWORD">{t("users:password")}</MenuItem>
              <MenuItem value="PIN">{t("users:pin", { defaultValue: "PIN" })}</MenuItem>
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResetOpen(false)}>{t("users:cancel")}</Button>
          <Button variant="contained" color="warning" disabled={reset.isPending} onClick={() => reset.mutate()}>
            {reset.isPending ? <CircularProgress size={18} color="inherit" /> : t("users:reset", { defaultValue: "Reset" })}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: 1.5 }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h6" sx={{ fontSize: 20 }}>
        {value}
      </Typography>
    </Box>
  );
}
