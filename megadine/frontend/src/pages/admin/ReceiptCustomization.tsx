import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  CircularProgress,
  Grid,
  Paper,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { Print as PrintIcon, RestartAlt as ResetIcon, Save as SaveIcon } from "@mui/icons-material";
import { useTranslation } from "react-i18next";
import { useToast } from "../../components/ui";
import { errorMessage } from "../../lib/errors";
import ReceiptPreview from "../../components/ReceiptPreview";
import {
  fetchReceiptConfig,
  fetchReceiptDefaults,
  logoError,
  previewReceiptHtml,
  saveReceiptConfig,
  testPrintReceipt,
  type ReceiptConfig,
} from "../../lib/receipts";

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", py: 0.25 }}>
      <Typography variant="body2">{label}</Typography>
      <Switch size="small" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </Stack>
  );
}

export default function ReceiptCustomization() {
  const { t } = useTranslation(["settings", "common"]);
  const { push } = useToast();
  const qc = useQueryClient();

  const { data: config } = useQuery({ queryKey: ["receipt", "config"], queryFn: fetchReceiptConfig });
  const { data: defaults } = useQuery({ queryKey: ["receipt", "defaults"], queryFn: fetchReceiptDefaults });

  const [form, setForm] = useState<ReceiptConfig | null>(null);
  const [previewHtml, setPreviewHtml] = useState("");
  const previewSeq = useRef(0);

  useEffect(() => {
    if (config && form === null) setForm(config);
  }, [config, form]);

  const patch = (p: Partial<ReceiptConfig>) => setForm((f) => (f ? { ...f, ...p } : f));

  useEffect(() => {
    if (!form) return;
    const timer = setTimeout(() => {
      const seq = ++previewSeq.current;
      previewReceiptHtml(form)
        .then((html) => {
          if (seq === previewSeq.current) setPreviewHtml(html);
        })
        .catch(() => undefined);
    }, 350);
    return () => clearTimeout(timer);
  }, [form]);

  const saveMut = useMutation({
    mutationFn: () => saveReceiptConfig(form!),
    onSuccess: (cfg) => {
      setForm(cfg);
      push(t("settings:receipt_saved"), "ok");
      qc.invalidateQueries({ queryKey: ["receipt", "config"] });
    },
    onError: (e) => push(errorMessage(e, t), "error"),
  });

  const testMut = useMutation({
    mutationFn: testPrintReceipt,
    onSuccess: (r) =>
      push(
        r.ok ? t("settings:test_print_ok", { mode: r.mode }) : t("settings:test_print_failed"),
        r.ok ? "ok" : "error",
      ),
    onError: (e) => push(errorMessage(e, t), "error"),
  });

  function onLogoFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const err = logoError(dataUrl, file.type, file.size);
      if (err === "type") return push(t("settings:logo_bad_type"), "error");
      if (err === "size") return push(t("settings:logo_too_large"), "error");
      patch({ logo: dataUrl, showLogo: true });
    };
    reader.readAsDataURL(file);
  }

  if (!form) {
    return (
      <Stack sx={{ py: 6, alignItems: "center" }}>
        <CircularProgress />
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { sm: "center" } }}>
        <Typography variant="h5" sx={{ flex: 1 }}>
          {t("settings:receipt_customization")}
        </Typography>
        <Button startIcon={<ResetIcon />} disabled={!defaults} onClick={() => defaults && setForm({ ...defaults })}>
          {t("settings:reset_defaults")}
        </Button>
        <Button startIcon={<PrintIcon />} variant="outlined" disabled={testMut.isPending} onClick={() => testMut.mutate()}>
          {t("settings:test_print")}
        </Button>
        <Button startIcon={<SaveIcon />} variant="contained" disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>
          {saveMut.isPending ? <CircularProgress size={18} color="inherit" /> : t("common:save")}
        </Button>
      </Stack>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Stack spacing={2}>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {t("settings:identity")}
              </Typography>
              <Toggle label={t("settings:show_shop_name")} value={form.showShopName} onChange={(v) => patch({ showShopName: v })} />
              <Toggle label={t("settings:show_logo")} value={form.showLogo} onChange={(v) => patch({ showLogo: v })} />
              <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", py: 0.5 }}>
                {form.logo && (
                  <img src={form.logo} alt="logo" style={{ height: 40, borderRadius: 4, border: "1px solid #dfe3dd" }} />
                )}
                <Button component="label" size="small" variant="outlined">
                  {t("settings:upload_logo")}
                  <input
                    type="file"
                    hidden
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) onLogoFile(file);
                      e.target.value = "";
                    }}
                  />
                </Button>
                {form.logo && (
                  <Button size="small" color="error" onClick={() => patch({ logo: null })}>
                    {t("settings:remove_logo")}
                  </Button>
                )}
                <Typography variant="caption" color="text.secondary">
                  {t("settings:logo_hint")}
                </Typography>
              </Stack>
              <Toggle label={t("settings:show_address")} value={form.showAddress} onChange={(v) => patch({ showAddress: v })} />
              <Toggle label={t("settings:show_phone")} value={form.showPhone} onChange={(v) => patch({ showPhone: v })} />
            </Paper>

            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {t("settings:messages")}
              </Typography>
              <Stack spacing={1.5}>
                <TextField
                  label={t("settings:header_text")}
                  size="small"
                  multiline
                  minRows={2}
                  value={form.headerText ?? ""}
                  onChange={(e) => patch({ headerText: e.target.value })}
                />
                <TextField
                  label={t("settings:footer_text")}
                  size="small"
                  multiline
                  minRows={2}
                  value={form.footerText ?? ""}
                  onChange={(e) => patch({ footerText: e.target.value })}
                />
                <TextField
                  label={t("settings:thank_you_text")}
                  size="small"
                  value={form.thankYouText ?? ""}
                  onChange={(e) => patch({ thankYouText: e.target.value })}
                />
              </Stack>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {t("settings:fields")}
              </Typography>
              <Grid container spacing={1}>
                <Grid size={6}>
                  <Toggle label={t("settings:show_order_number")} value={form.showOrderNumber} onChange={(v) => patch({ showOrderNumber: v })} />
                  <Toggle label={t("settings:show_table")} value={form.showTable} onChange={(v) => patch({ showTable: v })} />
                  <Toggle label={t("settings:show_datetime")} value={form.showDateTime} onChange={(v) => patch({ showDateTime: v })} />
                  <Toggle label={t("settings:show_cashier")} value={form.showCashier} onChange={(v) => patch({ showCashier: v })} />
                  <Toggle label={t("settings:show_subtotal")} value={form.showSubtotal} onChange={(v) => patch({ showSubtotal: v })} />
                  <Toggle label={t("settings:show_service")} value={form.showServiceCharge} onChange={(v) => patch({ showServiceCharge: v })} />
                  <Toggle label={t("settings:show_tax")} value={form.showTax} onChange={(v) => patch({ showTax: v })} />
                </Grid>
                <Grid size={6}>
                  <Toggle label={t("settings:show_discount")} value={form.showDiscount} onChange={(v) => patch({ showDiscount: v })} />
                  <Toggle label={t("settings:show_total")} value={form.showTotal} onChange={(v) => patch({ showTotal: v })} />
                  <Toggle label={t("settings:show_payment_method")} value={form.showPaymentMethod} onChange={(v) => patch({ showPaymentMethod: v })} />
                  <Toggle label={t("settings:show_amount_paid")} value={form.showAmountPaid} onChange={(v) => patch({ showAmountPaid: v })} />
                  <Toggle label={t("settings:show_change")} value={form.showChange} onChange={(v) => patch({ showChange: v })} />
                  <Toggle label={t("settings:show_modifiers")} value={form.showModifiers} onChange={(v) => patch({ showModifiers: v })} />
                </Grid>
              </Grid>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
                {t("settings:layout")}
              </Typography>
              <Stack spacing={1.5}>
                <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
                  <Typography variant="body2" sx={{ width: 110 }}>
                    {t("settings:paper_width")}
                  </Typography>
                  <ToggleButtonGroup
                    size="small"
                    exclusive
                    value={form.paperWidth}
                    onChange={(_e, v) => v && patch({ paperWidth: v })}
                  >
                    <ToggleButton value={58}>58 mm</ToggleButton>
                    <ToggleButton value={80}>80 mm</ToggleButton>
                  </ToggleButtonGroup>
                </Stack>
                <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
                  <Typography variant="body2" sx={{ width: 110 }}>
                    {t("settings:font_size")}
                  </Typography>
                  <ToggleButtonGroup
                    size="small"
                    exclusive
                    value={form.fontSize}
                    onChange={(_e, v) => v && patch({ fontSize: v })}
                  >
                    <ToggleButton value="small">{t("settings:small")}</ToggleButton>
                    <ToggleButton value="medium">{t("settings:medium")}</ToggleButton>
                    <ToggleButton value="large">{t("settings:large")}</ToggleButton>
                  </ToggleButtonGroup>
                </Stack>
                <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
                  <Typography variant="body2" sx={{ width: 110 }}>
                    {t("settings:alignment")}
                  </Typography>
                  <ToggleButtonGroup
                    size="small"
                    exclusive
                    value={form.alignment}
                    onChange={(_e, v) => v && patch({ alignment: v })}
                  >
                    <ToggleButton value="left">{t("settings:left")}</ToggleButton>
                    <ToggleButton value="center">{t("settings:center")}</ToggleButton>
                  </ToggleButtonGroup>
                </Stack>
              </Stack>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {t("settings:extras")}
              </Typography>
              <Toggle label={t("settings:show_qr")} value={form.showQrCode} onChange={(v) => patch({ showQrCode: v })} />
              <TextField
                label={t("settings:qr_content")}
                size="small"
                fullWidth
                disabled={!form.showQrCode}
                value={form.qrContent ?? ""}
                onChange={(e) => patch({ qrContent: e.target.value })}
                helperText={t("settings:qr_hint")}
                sx={{ mt: 1 }}
              />
            </Paper>
          </Stack>
        </Grid>

        <Grid size={{ xs: 12, md: 5 }}>
          <Stack sx={{ position: { md: "sticky" }, top: { md: 16 }, spacing: 1 }}>
            <Typography variant="subtitle2">{t("settings:receipt_preview")}</Typography>
            <Typography variant="caption" color="text.secondary">
              {t("settings:preview_hint")}
            </Typography>
            {previewHtml ? (
              <ReceiptPreview html={previewHtml} paperWidth={form.paperWidth} fontSize={form.fontSize} />
            ) : (
              <Stack sx={{ py: 6, alignItems: "center" }}>
                <CircularProgress size={28} />
              </Stack>
            )}
          </Stack>
        </Grid>
      </Grid>
    </Stack>
  );
}
