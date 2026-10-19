import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, CircularProgress, MenuItem, Paper, Stack, TextField, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { apiGet, apiPatch } from "../../lib/api";
import { errorMessage } from "../../lib/errors";

interface Restaurant {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  taxId: string | null;
  currency: string;
  logo: string | null;
}

const CURRENCIES = ["USD", "MMK", "THB", "JPY", "EUR", "GBP", "SGD", "MYR"];

export default function ShopInfoAdmin() {
  const qc = useQueryClient();
  const { t } = useTranslation(["settings", "common", "admin"]);
  const { data, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiGet<{ restaurant: Restaurant }>("/admin/settings"),
  });
  const [form, setForm] = useState({
    name: "",
    address: "",
    phone: "",
    email: "",
    taxId: "",
    currency: "USD",
    logo: "",
  });
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (data?.restaurant && !loaded) {
      const r = data.restaurant;
      setForm({
        name: r.name,
        address: r.address ?? "",
        phone: r.phone ?? "",
        email: r.email ?? "",
        taxId: r.taxId ?? "",
        currency: r.currency,
        logo: r.logo ?? "",
      });
      setLoaded(true);
    }
  }, [data, loaded]);

  const save = useMutation({
    mutationFn: () =>
      apiPatch("/admin/settings", {
        name: form.name,
        address: form.address || null,
        phone: form.phone || null,
        email: form.email || null,
        taxId: form.taxId || null,
        currency: form.currency,
        logo: form.logo || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      setSaved(true);
      setError("");
      setTimeout(() => setSaved(false), 2000);
    },
    onError: (e) => setError(errorMessage(e, t)),
  });

  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  if (isLoading || !loaded) {
    return (
      <Stack spacing={2} sx={{ maxWidth: 620 }}>
        <CircularProgress />
      </Stack>
    );
  }

  return (
    <Stack spacing={2} sx={{ maxWidth: 620 }}>
      <Typography variant="h5">{t("settings:shop_info")}</Typography>
      {saved && <Alert severity="success">{t("common:success")}</Alert>}
      {error && <Alert severity="error">{error}</Alert>}
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack spacing={2}>
          <TextField label={t("admin:col_name")} value={form.name} onChange={(e) => set("name")(e.target.value)} required fullWidth />
          <TextField label={t("settings:address")} value={form.address} onChange={(e) => set("address")(e.target.value)} fullWidth />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField label={t("settings:phone")} value={form.phone} onChange={(e) => set("phone")(e.target.value)} fullWidth />
            <TextField label={t("admin:set_fld_email")} type="email" value={form.email} onChange={(e) => set("email")(e.target.value)} fullWidth />
          </Stack>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField label={t("settings:tax_id")} value={form.taxId} onChange={(e) => set("taxId")(e.target.value)} fullWidth />
            <TextField select label={t("settings:currency")} value={form.currency} onChange={(e) => set("currency")(e.target.value)} fullWidth>
              {[...new Set([form.currency, ...CURRENCIES])].map((c) => (
                <MenuItem key={c} value={c}>
                  {c}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          <TextField
            label={t("admin:set_fld_logo_url")}
            value={form.logo}
            onChange={(e) => set("logo")(e.target.value)}
            helperText={t("admin:set_logo_hint")}
            fullWidth
          />
          <Button variant="contained" disabled={save.isPending || !form.name} onClick={() => save.mutate()} sx={{ alignSelf: "flex-start" }}>
            {save.isPending ? <CircularProgress size={20} color="inherit" /> : t("settings:save_settings")}
          </Button>
        </Stack>
      </Paper>
    </Stack>
  );
}
