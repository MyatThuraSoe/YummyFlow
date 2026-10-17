import { useTranslation } from "react-i18next";
import { FormControl, MenuItem, Select } from "@mui/material";
import { apiPatch } from "../lib/api";
import { SUPPORTED_LANGS } from "../lib/i18n";
import { useAuth } from "../store/auth";

const LABELS: Record<string, string> = {
  en: "English",
  my: "မြန်မာ",
  ja: "日本語",
  th: "ไทย",
  fr: "Français",
};

export default function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { i18n } = useTranslation();
  const user = useAuth((s) => s.user);
  const current = SUPPORTED_LANGS.includes(i18n.resolvedLanguage ?? "") ? i18n.resolvedLanguage! : "en";

  async function change(lang: string) {
    await i18n.changeLanguage(lang);
    if (user) apiPatch(`/users/me/language?lang=${lang}`).catch(() => {});
  }

  return (
    <FormControl size="small" variant="standard" sx={{ minWidth: compact ? 84 : 110 }}>
      <Select
        value={current}
        onChange={(e) => change(e.target.value)}
        disableUnderline
        inputProps={{ "aria-label": "Language" }}
        sx={{ fontSize: 14 }}
      >
        {SUPPORTED_LANGS.map((l) => (
          <MenuItem key={l} value={l}>
            {LABELS[l]}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
