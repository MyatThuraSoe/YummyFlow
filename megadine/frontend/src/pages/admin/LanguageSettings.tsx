import { useState } from "react";
import { Alert, List, ListItemButton, ListItemIcon, ListItemText, Paper, Radio, Stack, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { SUPPORTED_LANGS } from "../../lib/i18n";

const LANG_LABELS: Record<string, string> = {
  en: "English",
  my: "မြန်မာ",
  ja: "日本語",
  th: "ไทย",
  fr: "Français",
};

export default function LanguageSettings() {
  const { t, i18n } = useTranslation(["settings", "common"]);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function pick(code: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    setSaved(false);
    await i18n.changeLanguage(code);
    localStorage.setItem("md_language", code);
    try {
      await api("/users/me/language", { method: "PATCH", query: { lang: code } });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack spacing={2} sx={{ maxWidth: 620 }}>
      <Typography variant="h5">{t("settings:language")}</Typography>
      {saved && <Alert severity="success">{t("common:success")}</Alert>}
      {error && <Alert severity="error">{error}</Alert>}
      <Paper variant="outlined">
        <List disablePadding>
          {SUPPORTED_LANGS.map((code) => (
            <ListItemButton key={code} onClick={() => pick(code)} disabled={busy} selected={i18n.language === code}>
              <ListItemIcon sx={{ minWidth: 40 }}>
                <Radio checked={i18n.language === code} tabIndex={-1} disableRipple />
              </ListItemIcon>
              <ListItemText primary={LANG_LABELS[code] ?? code} slotProps={{ primary: { sx: { fontWeight: 600 } } }} />
            </ListItemButton>
          ))}
        </List>
      </Paper>
      <Typography variant="body2" color="text.secondary">
        {t("settings:language_hint")}
      </Typography>
    </Stack>
  );
}
