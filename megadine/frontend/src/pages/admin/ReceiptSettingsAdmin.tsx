import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, CircularProgress, Paper, Stack, TextField, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { apiGet, apiPatch } from "../../lib/api";
import { errorMessage } from "../../lib/errors";

interface Restaurant {
  name: string;
  receiptHeader: string | null;
  receiptFooter: string | null;
}

export default function ReceiptSettingsAdmin() {
  const qc = useQueryClient();
  const { t } = useTranslation(["settings", "common"]);
  const { data, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiGet<{ restaurant: Restaurant }>("/admin/settings"),
  });
  const [header, setHeader] = useState("");
  const [footer, setFooter] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (data?.restaurant && !loaded) {
      setHeader(data.restaurant.receiptHeader ?? "");
      setFooter(data.restaurant.receiptFooter ?? "");
      setLoaded(true);
    }
  }, [data, loaded]);

  const save = useMutation({
    mutationFn: () => apiPatch("/admin/settings", { receiptHeader: header || null, receiptFooter: footer || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      setSaved(true);
      setError("");
      setTimeout(() => setSaved(false), 2000);
    },
    onError: (e) => setError(errorMessage(e, t)),
  });

  if (isLoading || !loaded) {
    return (
      <Stack spacing={2} sx={{ maxWidth: 620 }}>
        <CircularProgress />
      </Stack>
    );
  }

  const name = data?.restaurant.name ?? "";

  return (
    <Stack spacing={2} sx={{ maxWidth: 620 }}>
      <Typography variant="h5">{t("settings:receipt")}</Typography>
      {saved && <Alert severity="success">{t("common:success")}</Alert>}
      {error && <Alert severity="error">{error}</Alert>}
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack spacing={2}>
          <TextField
            label={t("settings:receipt_header")}
            value={header}
            onChange={(e) => setHeader(e.target.value)}
            fullWidth
            multiline
            minRows={2}
          />
          <TextField
            label={t("settings:receipt_footer")}
            value={footer}
            onChange={(e) => setFooter(e.target.value)}
            fullWidth
            multiline
            minRows={2}
          />
          <Button variant="contained" disabled={save.isPending} onClick={() => save.mutate()} sx={{ alignSelf: "flex-start" }}>
            {save.isPending ? <CircularProgress size={20} color="inherit" /> : t("settings:save_settings")}
          </Button>
        </Stack>
      </Paper>
      <Paper variant="outlined" sx={{ p: 3, width: "100%", maxWidth: 320, mx: "auto" }}>
        <Typography variant="caption" color="text.secondary">
          {t("settings:receipt_preview")}
        </Typography>
        <Stack spacing={0.75} sx={{ mt: 1.5, textAlign: "center" }}>
          <Typography variant="body2" sx={{ fontWeight: 800 }}>
            {name}
          </Typography>
          {header && (
            <Typography variant="body2" sx={{ whiteSpace: "pre-line", color: "text.secondary" }}>
              {header}
            </Typography>
          )}
          <Typography variant="body2" sx={{ color: "text.disabled", letterSpacing: 1 }}>
            --------------------------------
          </Typography>
          {footer && (
            <Typography variant="body2" sx={{ whiteSpace: "pre-line", color: "text.secondary" }}>
              {footer}
            </Typography>
          )}
        </Stack>
      </Paper>
    </Stack>
  );
}
