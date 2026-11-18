import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import RefreshIcon from "@mui/icons-material/Refresh";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { useAuth } from "../../store/auth";

interface Envelope<T> {
  success: boolean;
  message: string;
  data: T;
}

interface ApprovalRequest {
  id: string;
  restaurantId: string;
  requesterId: string;
  action: string;
  amount: number | string | null;
  reason: string | null;
  status: "PENDING" | "APPROVED" | "REFUSED" | "EXPIRED";
  approverId: string | null;
  decidedAt: string | null;
  createdAt: string;
  expiresAt: string | null;
  requester: { id: string; name: string; role: string } | null;
  approver: { id: string; name: string } | null;
}

const STATUS_COLOR: Record<string, "warning" | "success" | "error" | "default"> = {
  PENDING: "warning",
  APPROVED: "success",
  REFUSED: "error",
  EXPIRED: "default",
};

/** The "ask manager" queue: floor devices request an override, approvers decide. */
export default function ApprovalsAdmin() {
  const { t } = useTranslation(["users", "common", "admin"]);
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const [status, setStatus] = useState("PENDING");
  const [error, setError] = useState("");
  const [reasonFor, setReasonFor] = useState<{ id: string; approve: boolean } | null>(null);
  const [reason, setReason] = useState("");

  const { data, isLoading, error: loadError, refetch } = useQuery({
    queryKey: ["approvals", status],
    queryFn: () => apiGet<Envelope<{ requests: ApprovalRequest[] }>>("/approvals", { status }),
  });

  const { data: mineData } = useQuery({
    queryKey: ["approvals", "mine"],
    queryFn: () => apiGet<Envelope<{ requests: ApprovalRequest[] }>>("/approvals/mine"),
  });

  const decide = useMutation({
    mutationFn: ({ id, approve, reason }: { id: string; approve: boolean; reason?: string }) =>
      apiPost(`/approvals/${id}/decide`, { approve, reason: reason || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["approvals"] });
      setReasonFor(null);
      setReason("");
      setError("");
    },
    onError: (e) => setError(errorMessage(e, t)),
  });

  const requests = data?.data.requests ?? [];
  const mine = mineData?.data.requests ?? [];

  function decideRequest(r: ApprovalRequest, approve: boolean) {
    setError("");
    if (r.requesterId === me?.id) {
      setError(t("users:approval_self_block", { defaultValue: "You cannot approve your own request." }));
      return;
    }
    setReason("");
    setReasonFor({ id: r.id, approve });
  }

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
        <Typography variant="h5">{t("users:approvals_title", { defaultValue: "Approval queue" })}</Typography>
        <Stack direction="row" spacing={1}>
          <Button startIcon={<RefreshIcon />} onClick={() => void refetch()}>
            {t("users:refresh", { defaultValue: "Refresh" })}
          </Button>
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>{t("users:status")}</InputLabel>
            <Select label={t("users:status")} value={status} onChange={(e) => setStatus(e.target.value)}>
              {(["PENDING", "APPROVED", "REFUSED", "EXPIRED", "ALL"] as const).map((s) => (
                <MenuItem key={s} value={s}>
                  {t(`users:approval_status_${s.toLowerCase()}`, { defaultValue: s })}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>
      </Stack>

      <Alert severity="info">
        {t("users:approvals_hint", {
          defaultValue: "When floor staff need a discount, void or refund beyond their limit, the request appears here. Approve or refuse it from any device — no shared PIN needed.",
        })}
      </Alert>
      {loadError && <Alert severity="error">{t("users:failed_to_load_users")}</Alert>}
      {error && <Alert severity="error" onClose={() => setError("")}>{error}</Alert>}

      <TableContainer component={Paper} variant="outlined">
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>{t("users:approval_action", { defaultValue: "Action" })}</TableCell>
              <TableCell>{t("users:approval_amount", { defaultValue: "Amount" })}</TableCell>
              <TableCell>{t("users:approval_reason", { defaultValue: "Reason" })}</TableCell>
              <TableCell>{t("users:approval_requested_by", { defaultValue: "Requested by" })}</TableCell>
              <TableCell>{t("users:approval_created", { defaultValue: "When" })}</TableCell>
              <TableCell>{t("users:status")}</TableCell>
              <TableCell align="right">{t("users:actions")}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading &&
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 7 }).map((__, j) => (
                    <TableCell key={j}><Skeleton width="80%" /></TableCell>
                  ))}
                </TableRow>
              ))}
            {!isLoading &&
              requests.map((r) => (
                <TableRow key={r.id} hover>
                  <TableCell sx={{ fontWeight: 600 }}>{t(`users:approval_action_${r.action.toLowerCase()}`, { defaultValue: r.action })}</TableCell>
                  <TableCell>{r.amount == null ? "—" : Number(r.amount).toLocaleString()}</TableCell>
                  <TableCell>{r.reason ?? "—"}</TableCell>
                  <TableCell>
                    {r.requester?.name ?? "—"}
                    {r.requesterId === me?.id && (
                      <Chip size="small" label={t("users:you", { defaultValue: "you" })} sx={{ ml: 0.5 }} />
                    )}
                  </TableCell>
                  <TableCell>{new Date(r.createdAt).toLocaleString()}</TableCell>
                  <TableCell>
                    <Chip size="small" label={t(`users:approval_status_${r.status.toLowerCase()}`, { defaultValue: r.status })} color={STATUS_COLOR[r.status] ?? "default"} />
                  </TableCell>
                  <TableCell align="right">
                    {r.status === "PENDING" && (
                      <>
                        <Button size="small" color="success" startIcon={<CheckIcon />} onClick={() => decideRequest(r, true)} disabled={decide.isPending}>
                          {t("users:approve", { defaultValue: "Approve" })}
                        </Button>
                        <Button size="small" color="error" startIcon={<CloseIcon />} onClick={() => decideRequest(r, false)} disabled={decide.isPending}>
                          {t("users:refuse", { defaultValue: "Refuse" })}
                        </Button>
                      </>
                    )}
                    {r.status !== "PENDING" && r.approver?.name && (
                      <Typography variant="caption" color="text.secondary">
                        {r.approver.name}
                      </Typography>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            {!isLoading && requests.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 4, color: "text.secondary" }}>
                  {t("users:approvals_empty", { defaultValue: "Nothing here" })}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {mine.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            {t("users:my_requests", { defaultValue: "My recent requests" })}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
            {mine.slice(0, 10).map((r) => (
              <Chip
                key={r.id}
                size="small"
                label={`${t(`users:approval_action_${r.action.toLowerCase()}`, { defaultValue: r.action })} · ${t(`users:approval_status_${r.status.toLowerCase()}`, { defaultValue: r.status })}`}
                color={STATUS_COLOR[r.status] ?? "default"}
                variant="outlined"
              />
            ))}
          </Stack>
        </Paper>
      )}

      <Dialog open={!!reasonFor} onClose={() => setReasonFor(null)} fullWidth maxWidth="xs">
        <DialogTitle>
          {reasonFor?.approve ? t("users:approve", { defaultValue: "Approve" }) : t("users:refuse", { defaultValue: "Refuse" })}
        </DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            multiline
            minRows={2}
            label={t("users:approval_decision_reason", { defaultValue: "Note (optional)" })}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReasonFor(null)}>{t("users:cancel")}</Button>
          <Button
            variant="contained"
            color={reasonFor?.approve ? "success" : "error"}
            disabled={decide.isPending}
            onClick={() => reasonFor && decide.mutate({ id: reasonFor.id, approve: reasonFor.approve, reason })}
          >
            {decide.isPending ? <CircularProgress size={18} color="inherit" /> : t("users:confirm", { defaultValue: "Confirm" })}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
