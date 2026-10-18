import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { Button, CircularProgress, Grid, Paper, Stack, Typography } from "@mui/material";
import { ArrowBack as BackIcon, Print as PrintIcon } from "@mui/icons-material";
import { useTranslation } from "react-i18next";
import { useToast } from "../../components/ui";
import { errorMessage } from "../../lib/errors";
import ReceiptPreview from "../../components/ReceiptPreview";
import {
  fetchOrderReceiptHtml,
  fetchOrderReceiptText,
  fetchReceiptConfig,
  printOrderReceipt,
} from "../../lib/receipts";

export default function ReceiptOrderAdmin() {
  const { orderId = "" } = useParams();
  const nav = useNavigate();
  const { push } = useToast();
  const { t } = useTranslation(["settings", "common"]);

  const { data: config } = useQuery({ queryKey: ["receipt", "config"], queryFn: fetchReceiptConfig });
  const { data: html, isLoading } = useQuery({
    queryKey: ["receipt", "order", orderId, "html"],
    queryFn: () => fetchOrderReceiptHtml(orderId),
    enabled: !!orderId,
  });
  const { data: text } = useQuery({
    queryKey: ["receipt", "order", orderId, "text"],
    queryFn: () => fetchOrderReceiptText(orderId),
    enabled: !!orderId,
  });

  const printMut = useMutation({
    mutationFn: () => printOrderReceipt(orderId),
    onSuccess: (r) =>
      push(r.ok ? t("settings:print_sent", { mode: r.mode }) : t("settings:print_failed"), r.ok ? "ok" : "error"),
    onError: (e) => push(errorMessage(e, t), "error"),
  });

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { sm: "center" } }}>
        <Typography variant="h5" sx={{ flex: 1 }}>
          {t("settings:receipt_for_order")}
        </Typography>
        <Button startIcon={<BackIcon />} onClick={() => nav("/admin/orders")}>
          {t("settings:back_to_orders")}
        </Button>
        <Button
          startIcon={<PrintIcon />}
          variant="contained"
          disabled={printMut.isPending || !html}
          onClick={() => printMut.mutate()}
        >
          {printMut.isPending ? <CircularProgress size={18} color="inherit" /> : t("settings:print_receipt")}
        </Button>
      </Stack>

      {isLoading ? (
        <Stack sx={{ py: 6, alignItems: "center" }}>
          <CircularProgress />
        </Stack>
      ) : (
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 5 }}>
            <ReceiptPreview html={html ?? ""} paperWidth={config?.paperWidth} fontSize={config?.fontSize} />
          </Grid>
          <Grid size={{ xs: 12, md: 7 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {t("settings:plain_text")}
            </Typography>
            <Paper variant="outlined" sx={{ p: 1.5, maxHeight: 520, overflow: "auto" }}>
              <Typography
                component="pre"
                variant="caption"
                sx={{ fontFamily: "ui-monospace, monospace", whiteSpace: "pre-wrap", m: 0 }}
              >
                {text ?? t("common:loading")}
              </Typography>
            </Paper>
          </Grid>
        </Grid>
      )}
    </Stack>
  );
}
