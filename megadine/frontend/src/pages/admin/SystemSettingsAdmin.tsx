import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, CircularProgress, MenuItem, Paper, Stack, TextField, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { apiGet, apiPatch } from "../../lib/api";
import { errorMessage } from "../../lib/errors";

interface Restaurant {
  name: string;
  currency: string;
  businessDayCutoff: string;
  taxRate: string;
  taxInclusive: boolean;
  serviceChargePct: string;
  cashVarianceTolerance: string;
}

const CURRENCIES = ["USD", "MMK", "THB", "JPY", "EUR", "GBP", "SGD", "MYR"];

export default function SystemSettingsAdmin() {
  const qc = useQueryClient();
  const { t } = useTranslation(["settings", "common", "admin"]);
  const { data, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiGet<{ restaurant: Restaurant }>("/admin/settings"),
  });
  const [form, setForm] = useState({
    name: "",
    currency: "USD",
    businessDayCutoff: "04:00",
    taxPct: "8.5",
    taxInclusive: false,
    servicePct: "0",
    cashVarianceTolerance: "10",
  });
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (data?.restaurant && !loaded) {
      const r = data.restaurant;
      setForm({
        name: r.name,
        currency: r.currency,
        businessDayCutoff: r.businessDayCutoff,
        taxPct: String((Number(r.taxRate) * 100).toFixed(2)),
        taxInclusive: r.taxInclusive,
        servicePct: String((Number(r.serviceChargePct) * 100).toFixed(2)),
        cashVarianceTolerance: String(Number(r.cashVarianceTolerance ?? 10).toFixed(2)),
      });
      setLoaded(true);
    }
  }, [data, loaded]);

  const save = useMutation({
    mutationFn: () =>
      apiPatch("/admin/settings", {
        name: form.name,
        currency: form.currency,
        businessDayCutoff: form.businessDayCutoff,
        taxRate: Number(form.taxPct) / 100,
        taxInclusive: form.taxInclusive,
        serviceChargePct: Number(form.servicePct) / 100,
        cashVarianceTolerance: Number(form.cashVarianceTolerance),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      setSaved(true);
      setError("");
      setTimeout(() => setSaved(false), 2000);
    },
    onError: (e) => setError(errorMessage(e, t)),
  });

  const set = (key: keyof typeof form) => (value: string | boolean) => setForm((f) => ({ ...f, [key]: value }));

  if (isLoading || !loaded) {
    return (
      <Stack spacing={2} sx={{ maxWidth: 620 }}>
        <CircularProgress />
      </Stack>
    );
  }

  return (
    <Stack spacing={2} sx={{ maxWidth: 620 }}>
      <Typography variant="h5">{t("settings:system")}</Typography>
      {saved && <Alert severity="success">{t("common:success")}</Alert>}
      {error && <Alert severity="error">{error}</Alert>}
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack spacing={2}>
          <TextField label={t("admin:col_name")} value={form.name} onChange={(e) => set("name")(e.target.value)} fullWidth />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField select label={t("settings:currency")} value={form.currency} onChange={(e) => set("currency")(e.target.value)} fullWidth>
              {[...new Set([form.currency, ...CURRENCIES])].map((c) => (
                <MenuItem key={c} value={c}>
                  {c}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label={t("settings:business_day_cutoff")}
              value={form.businessDayCutoff}
              onChange={(e) => set("businessDayCutoff")(e.target.value)}
              placeholder="04:00"
              fullWidth
            />
          </Stack>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField label={t("settings:tax_rate")} type="number" value={form.taxPct} onChange={(e) => set("taxPct")(e.target.value)} fullWidth />
            <TextField label={t("settings:service_charge")} type="number" value={form.servicePct} onChange={(e) => set("servicePct")(e.target.value)} fullWidth />
          </Stack>
          <TextField
            label={t("settings:cash_variance_tolerance")}
            type="number"
            value={form.cashVarianceTolerance}
            onChange={(e) => set("cashVarianceTolerance")(e.target.value)}
            fullWidth
          />
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
            <TextField
              select
              label={t("settings:tax_inclusive")}
              value={form.taxInclusive ? "yes" : "no"}
              onChange={(e) => set("taxInclusive")(e.target.value === "yes")}
              sx={{ maxWidth: 280 }}
            >
              <MenuItem value="yes">{t("admin:set_yes")}</MenuItem>
              <MenuItem value="no">{t("admin:set_no")}</MenuItem>
            </TextField>
          </Stack>
          <Button variant="contained" disabled={save.isPending} onClick={() => save.mutate()} sx={{ alignSelf: "flex-start" }}>
            {save.isPending ? <CircularProgress size={20} color="inherit" /> : t("settings:save_settings")}
          </Button>
        </Stack>
      </Paper>
    </Stack>
  );
}
