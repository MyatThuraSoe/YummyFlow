import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError, apiGet, apiPost } from "../../lib/api";

interface Envelope<T> {
  success: boolean;
  message: string;
  data: T;
}

interface LicenseStatus {
  machineId: string;
  edition: string;
  licensed: boolean;
  reason: string | null;
  features: string[];
  limits: { maxTerminals: number; maxTables: number; maxMenuItems: number };
  usage: { terminals: number; tables: number; menuItems: number };
  expiresAt: string | null;
  daysLeft: number | null;
}

const REASON_IDS = ["no_license", "wrong_machine", "expired", "invalid"];

const ERROR_REASON: Record<string, string> = {
  LICENSE_INVALID: "invalid",
  LICENSE_EXPIRED: "expired",
  LICENSE_MACHINE_MISMATCH: "wrong_machine",
};

export default function Activate() {
  const { t } = useTranslation(["common", "nav", "admin"]);
  const reasonText = (reason: string | null) =>
    t(`admin:act_reason_${reason && REASON_IDS.includes(reason) ? reason : "no_license"}`);
  const qc = useQueryClient();
  const [key, setKey] = useState("");
  const [copied, setCopied] = useState(false);
  const [result, setResult] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["license", "status"],
    queryFn: () => apiGet<Envelope<LicenseStatus>>("/license/status"),
  });

  const status = data?.data;

  const activate = useMutation({
    mutationFn: () => apiPost<Envelope<LicenseStatus>>("/license/activate", { licenseKey: key.trim() }),
    onSuccess: () => {
      setResult({ kind: "success", message: t("admin:act_activated") });
      setKey("");
      qc.invalidateQueries({ queryKey: ["license"] });
    },
    onError: (e) => {
      const reason = e instanceof ApiError ? ERROR_REASON[e.code] : undefined;
      const msg = reason ? reasonText(reason) : e instanceof Error ? e.message : t("admin:act_failed");
      setResult({ kind: "error", message: msg });
    },
  });

  async function copyMachineId() {
    if (!status) return;
    try {
      await navigator.clipboard.writeText(status.machineId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  if (isLoading || !status) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Stack spacing={2.5} sx={{ maxWidth: 760 }}>
      <Typography variant="h5">{t("nav:license")}</Typography>

      {status.licensed ? (
        <Alert severity="success">{t("admin:act_licensed_banner", { edition: status.edition })}</Alert>
      ) : (
        <Alert severity="warning">{reasonText(status.reason)}</Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
          {t("admin:act_machine_id")}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Box
            sx={{
              flex: 1,
              fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
              fontSize: 13,
              bgcolor: "action.hover",
              borderRadius: 1.5,
              px: 1.5,
              py: 1.25,
              overflowX: "auto",
              whiteSpace: "nowrap",
            }}
          >
            {status.machineId}
          </Box>
          <Button variant="outlined" onClick={copyMachineId} sx={{ whiteSpace: "nowrap" }}>
            {copied ? t("common:copied") : t("common:copy")}
          </Button>
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
          {t("admin:act_license_key")}
        </Typography>
        {result && (
          <Alert severity={result.kind} sx={{ mb: 2 }}>
            {result.message}
          </Alert>
        )}
        <TextField
          multiline
          minRows={4}
          fullWidth
          placeholder={t("admin:act_key_placeholder")}
          value={key}
          onChange={(e) => {
            setKey(e.target.value);
            setResult(null);
          }}
          slotProps={{ htmlInput: { style: { fontFamily: "ui-monospace, Consolas, monospace", fontSize: 12 } } }}
        />
        <Button          variant="contained"
          sx={{ mt: 2 }}
          disabled={key.trim().length < 16 || activate.isPending}
          onClick={() => activate.mutate()}
        >
          {activate.isPending ? <CircularProgress size={20} color="inherit" /> : t("admin:act_activate")}
        </Button>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
          {t("admin:act_current_plan")}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ alignItems: "baseline", mb: 1 }}>
          <Typography variant="h6" sx={{ fontSize: 20 }}>
            {status.edition}
          </Typography>
          {status.expiresAt && (
            <Typography variant="body2" color="text.secondary">
              {t("admin:act_expires", { date: new Date(status.expiresAt).toLocaleDateString() })}
              {status.daysLeft !== null ? ` · ${t("admin:act_days_left", { num: status.daysLeft })}` : ""}
            </Typography>
          )}
        </Stack>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t("admin:act_col_resource")}</TableCell>
              <TableCell align="right">{t("admin:act_col_used")}</TableCell>
              <TableCell align="right">{t("admin:act_col_limit")}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            <UsageRow label={t("admin:act_terminals")} used={status.usage.terminals} max={status.limits.maxTerminals} />
            <UsageRow label={t("admin:act_tables")} used={status.usage.tables} max={status.limits.maxTables} />
            <UsageRow label={t("admin:act_menu_items")} used={status.usage.menuItems} max={status.limits.maxMenuItems} />
          </TableBody>
        </Table>
      </Paper>
    </Stack>
  );
}

function UsageRow({ label, used, max }: { label: string; used: number; max: number }) {
  return (
    <TableRow>
      <TableCell>{label}</TableCell>
      <TableCell align="right">{used}</TableCell>
      <TableCell align="right">{max === Number.MAX_SAFE_INTEGER ? "∞" : max}</TableCell>
    </TableRow>
  );
}
