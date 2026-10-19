import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost, apiPut } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { formatMoney } from "../../lib/format";

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
}

interface UserStats {
  totalSales: number;
  totalRevenue: number;
  todaySales: number;
  todayRevenue: number;
}

const ROLES = ["OWNER", "ADMIN", "MANAGER", "CASHIER", "WAITER", "KITCHEN"];

export default function UserFormAdmin() {
  const { id } = useParams();
  const editing = !!id;
  const { t } = useTranslation(["users", "common", "admin"]);
  const roleLabel = (r: string) => t(`admin:role_${r.toLowerCase()}`, { defaultValue: r });
  const nav = useNavigate();
  const qc = useQueryClient();

  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
    role: "CASHIER",
    firstName: "",
    lastName: "",
    phone: "",
    isActive: true,
  });
  const [loaded, setLoaded] = useState(!editing);
  const [error, setError] = useState("");

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

  useEffect(() => {
    const u = userData?.data.user;
    if (u && !loaded) {
      setForm({
        username: u.username ?? "",
        email: u.email ?? "",
        password: "",
        role: u.role,
        firstName: u.firstName ?? "",
        lastName: u.lastName ?? "",
        phone: u.phone ?? "",
        isActive: u.isActive,
      });
      setLoaded(true);
    }
  }, [userData, loaded]);

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        email: form.email,
        firstName: form.firstName,
        lastName: form.lastName,
        phone: form.phone || null,
        role: form.role,
        isActive: form.isActive,
        ...(form.password ? { password: form.password } : {}),
        ...(!editing ? { username: form.username } : {}),
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

  function validate(): string | null {
    if (!editing && !form.username.trim()) return t("users:username_required");
    if (!form.email.trim()) return t("users:email_required");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return t("users:email_invalid");
    if (!editing && !form.password) return t("users:password_required");
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

  return (
    <Stack spacing={2} sx={{ maxWidth: 760 }}>
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

      {error && <Alert severity="error">{error}</Alert>}

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
            <TextField label={t("users:email")} type="email" value={form.email} onChange={(e) => set("email")(e.target.value)} margin="normal" required />
            <TextField
              label={t("users:password")}
              type="password"
              value={form.password}
              onChange={(e) => set("password")(e.target.value)}
              margin="normal"
              required={!editing}
              helperText={editing ? t("users:password_keep_current") : t("users:password_min_length")}
            />
            <FormControl margin="normal">
              <InputLabel>{t("users:role")}</InputLabel>
              <Select label={t("users:role")} value={form.role} onChange={(e) => set("role")(e.target.value)}>
                {ROLES.map((r) => (
                  <MenuItem key={r} value={r}>
                    {roleLabel(r)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField label={t("users:first_name")} value={form.firstName} onChange={(e) => set("firstName")(e.target.value)} margin="normal" required />
            <TextField label={t("users:last_name")} value={form.lastName} onChange={(e) => set("lastName")(e.target.value)} margin="normal" required />
            <TextField label={t("users:phone")} value={form.phone} onChange={(e) => set("phone")(e.target.value)} margin="normal" />
            <FormControl margin="normal">
              <InputLabel>{t("users:status")}</InputLabel>
              <Select label={t("users:status")} value={form.isActive ? "active" : "inactive"} onChange={(e) => set("isActive")(e.target.value === "active")}>
                <MenuItem value="active">{t("users:active")}</MenuItem>
                <MenuItem value="inactive">{t("users:inactive")}</MenuItem>
              </Select>
            </FormControl>
          </Box>
          <Stack direction="row" spacing={1.5} sx={{ mt: 3 }}>
            <Button type="submit" variant="contained" disabled={save.isPending}>
              {save.isPending ? <CircularProgress size={20} color="inherit" /> : editing ? t("users:update") : t("users:create")}
            </Button>
            <Button onClick={() => nav("/admin/users")}>{t("users:cancel")}</Button>
          </Stack>
        </Box>
      </Paper>
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
