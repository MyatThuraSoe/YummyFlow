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

const REASON_MESSAGE: Record<string, string> = {
  no_license: "No license installed. Paste your key to unlock.",
  wrong_machine: "This key is bound to a different machine.",
  expired: "This license has expired. Paste a renewed key.",
  invalid: "The key did not verify. Check you pasted the full key.",
};

const ERROR_MESSAGE: Record<string, string> = {
  LICENSE_INVALID: REASON_MESSAGE.invalid,
  LICENSE_EXPIRED: REASON_MESSAGE.expired,
  LICENSE_MACHINE_MISMATCH: REASON_MESSAGE.wrong_machine,
};

export default function Activate() {
  const { t } = useTranslation(["common", "nav"]);
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
      setResult({ kind: "success", message: "Activated!" });
      setKey("");
      qc.invalidateQueries({ queryKey: ["license"] });
    },
    onError: (e) => {
      const msg = e instanceof ApiError && ERROR_MESSAGE[e.code] ? ERROR_MESSAGE[e.code] : e instanceof Error ? e.message : "Activation failed";
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
        <Alert severity="success">This installation is licensed. Edition: {status.edition}</Alert>
      ) : (
        <Alert severity="warning">{REASON_MESSAGE[status.reason ?? "no_license"] ?? REASON_MESSAGE.no_license}</Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
          Your Machine ID
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
          License key
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
          placeholder="Paste your license key here"
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
          {activate.isPending ? <CircularProgress size={20} color="inherit" /> : "Activate"}
        </Button>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
          Current plan
        </Typography>
        <Stack direction="row" spacing={1} sx={{ alignItems: "baseline", mb: 1 }}>
          <Typography variant="h6" sx={{ fontSize: 20 }}>
            {status.edition}
          </Typography>
          {status.expiresAt && (
            <Typography variant="body2" color="text.secondary">
              expires {new Date(status.expiresAt).toLocaleDateString()}
              {status.daysLeft !== null ? ` · ${status.daysLeft} days left` : ""}
            </Typography>
          )}
        </Stack>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Resource</TableCell>
              <TableCell align="right">Used</TableCell>
              <TableCell align="right">Limit</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            <UsageRow label="Terminals" used={status.usage.terminals} max={status.limits.maxTerminals} />
            <UsageRow label="Tables" used={status.usage.tables} max={status.limits.maxTables} />
            <UsageRow label="Menu items" used={status.usage.menuItems} max={status.limits.maxMenuItems} />
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
