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
  Divider,
  MenuItem,
  Paper,
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
import { useTranslation } from "react-i18next";
import { apiGet, apiPost } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { formatMoney, toCents } from "../../lib/format";
import { useToast } from "../../components/ui";
import { useAuth } from "../../store/auth";

interface OrderLine {
  id: string;
  itemNameSnapshot: string;
  variantSnapshot: string | null;
  quantity: number;
  unitPriceSnapshot: string;
  lineTotal: string;
  isVoided: boolean;
  notes: string | null;
  modifiers: { id: string; nameSnapshot: string; priceSnapshot: string }[];
}

interface Payment {
  id: string;
  method: string;
  amount: string;
  refunds?: { id: string; amount: string }[];
}

interface Order {
  id: string;
  orderNumber: number;
  channel: string;
  status: string;
  subtotal: string;
  taxAmount: string;
  serviceCharge: string;
  discountAmount: string;
  total: string;
  createdAt: string;
  businessDate: string;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  tableSession?: { table: { number: number; name: string | null } } | null;
  lines: OrderLine[];
  payments: Payment[];
}

const STATUSES = ["DRAFT", "SENT_TO_KITCHEN", "IN_PROGRESS", "READY", "COMPLETED", "CANCELLED"];
const CHANNELS = ["DINE_IN", "TAKEAWAY", "PARCEL"];

const STATUS_COLORS: Record<string, "default" | "info" | "warning" | "success" | "error"> = {
  DRAFT: "default",
  SENT_TO_KITCHEN: "info",
  IN_PROGRESS: "warning",
  READY: "success",
  COMPLETED: "success",
  CANCELLED: "error",
};

const CHANNEL_LABELS: Record<string, string> = {
  DINE_IN: "Dine-in",
  TAKEAWAY: "Takeaway",
  PARCEL: "Parcel",
};

const today = () => new Date().toISOString().slice(0, 10);

export default function OrdersAdmin() {
  const qc = useQueryClient();
  const { push } = useToast();
  const { can } = useAuth();
  const { t } = useTranslation(["nav", "common"]);

  const [date, setDate] = useState(today());
  const [status, setStatus] = useState("ALL");
  const [channel, setChannel] = useState("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [managerPin, setManagerPin] = useState("");
  const [receiptOpen, setReceiptOpen] = useState(false);

  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiGet<{ restaurant: { currency: string } }>("/admin/settings"),
    staleTime: 5 * 60_000,
  });
  const currency = settings?.restaurant.currency ?? "USD";

  const { data, isLoading } = useQuery({
    queryKey: ["orders", "admin", date, status, channel],
    queryFn: () =>
      apiGet<{ orders: Order[] }>("/orders", {
        businessDate: date || undefined,
        status: status === "ALL" ? undefined : status,
        channel: channel === "ALL" ? undefined : channel,
        limit: 200,
      }),
    refetchInterval: 30_000,
  });

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ["orders", "admin", "detail", selectedId],
    queryFn: () => apiGet<{ order: Order }>(`/orders/${selectedId}`),
    enabled: !!selectedId,
  });

  const { data: receipt } = useQuery({
    queryKey: ["orders", "admin", "receipt", selectedId],
    queryFn: () => apiGet<{ receipt: string }>(`/orders/${selectedId}/receipt`),
    enabled: !!selectedId && receiptOpen,
  });

  const cancelMut = useMutation({
    mutationFn: () => apiPost(`/orders/${selectedId}/cancel`, { reason: cancelReason, managerPin: managerPin || undefined }),
    onSuccess: () => {
      push("Order cancelled", "ok");
      setCancelOpen(false);
      setCancelReason("");
      setManagerPin("");
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => push(errorMessage(e, t), "error"),
  });

  const reprintMut = useMutation({
    mutationFn: () => apiPost<{ printed: boolean; mode: string }>(`/orders/${selectedId}/reprint`),
    onSuccess: (r) => push(r.printed ? `Receipt sent to printer (${r.mode})` : `Printer unavailable (${r.mode})`, r.printed ? "ok" : "error"),
    onError: (e) => push(errorMessage(e, t), "error"),
  });

  const orders = data?.orders ?? [];
  const order = detail?.order;
  const cancellable = !!order && order.status !== "COMPLETED" && order.status !== "CANCELLED" && can("pos.use");

  function closeDetail() {
    setSelectedId(null);
    setReceiptOpen(false);
  }

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "center" } }}>
        <Typography variant="h5" sx={{ flex: 1 }}>
          {t("nav:orders")}
        </Typography>
        <TextField type="date" label="Business date" value={date} onChange={(e) => setDate(e.target.value)} size="small" slotProps={{ inputLabel: { shrink: true } }} />
        <TextField select label="Status" value={status} onChange={(e) => setStatus(e.target.value)} size="small" sx={{ minWidth: 170 }}>
          <MenuItem value="ALL">All statuses</MenuItem>
          {STATUSES.map((s) => (
            <MenuItem key={s} value={s}>
              {s.replace(/_/g, " ")}
            </MenuItem>
          ))}
        </TextField>
        <TextField select label="Channel" value={channel} onChange={(e) => setChannel(e.target.value)} size="small" sx={{ minWidth: 150 }}>
          <MenuItem value="ALL">All channels</MenuItem>
          {CHANNELS.map((c) => (
            <MenuItem key={c} value={c}>
              {CHANNEL_LABELS[c]}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      <Paper variant="outlined">
        {isLoading ? (
          <Stack sx={{ p: 4, alignItems: "center" }}>
            <CircularProgress />
          </Stack>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Order</TableCell>
                  <TableCell>Time</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Items</TableCell>
                  <TableCell align="right">Total</TableCell>
                  <TableCell align="right" />
                </TableRow>
              </TableHead>
              <TableBody>
                {orders.map((o) => (
                  <TableRow key={o.id} hover sx={{ cursor: "pointer" }} onClick={() => setSelectedId(o.id)}>
                    <TableCell sx={{ fontWeight: 700 }}>#{o.orderNumber}</TableCell>
                    <TableCell>{new Date(o.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</TableCell>
                    <TableCell>
                      {CHANNEL_LABELS[o.channel] ?? o.channel}
                      {o.tableSession?.table ? ` · #${o.tableSession.table.number}` : ""}
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label={o.status.replace(/_/g, " ")} color={STATUS_COLORS[o.status] ?? "default"} variant="outlined" />
                    </TableCell>
                    <TableCell align="right">{o.lines.filter((l) => !l.isVoided).reduce((n, l) => n + l.quantity, 0)}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>
                      {formatMoney(toCents(o.total), currency)}
                    </TableCell>
                    <TableCell align="right">
                      <Button size="small" onClick={(e) => { e.stopPropagation(); setSelectedId(o.id); }}>
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {orders.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} align="center" sx={{ py: 4, color: "text.secondary" }}>
                      No orders for this filter.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      <Dialog open={!!selectedId} onClose={closeDetail} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          {order ? `Order #${order.orderNumber}` : "Order"}
          {order && <Chip size="small" label={order.status.replace(/_/g, " ")} color={STATUS_COLORS[order.status] ?? "default"} variant="outlined" />}
        </DialogTitle>
        <DialogContent dividers>
          {detailLoading || !order ? (
            <Stack sx={{ py: 4, alignItems: "center" }}>
              <CircularProgress />
            </Stack>
          ) : (
            <Stack spacing={1.5}>
              <Typography variant="body2" color="text.secondary">
                {new Date(order.createdAt).toLocaleString()} · {CHANNEL_LABELS[order.channel] ?? order.channel}
                {order.tableSession?.table ? ` · Table #${order.tableSession.table.number}${order.tableSession.table.name ? ` (${order.tableSession.table.name})` : ""}` : ""}
              </Typography>
              {order.cancelReason && <Alert severity="error">Cancelled: {order.cancelReason}</Alert>}
              <Divider />
              {order.lines.map((l) => (
                <Stack key={l.id} direction="row" spacing={1} sx={{ alignItems: "baseline" }}>
                  <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 28 }}>
                    {l.quantity}×
                  </Typography>
                  <Stack sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ textDecoration: l.isVoided ? "line-through" : "none", opacity: l.isVoided ? 0.6 : 1 }}>
                      {l.itemNameSnapshot}
                      {l.variantSnapshot ? ` — ${l.variantSnapshot}` : ""}
                    </Typography>
                    {l.modifiers.length > 0 && (
                      <Typography variant="caption" color="text.secondary">
                        {l.modifiers.map((m) => m.nameSnapshot).join(", ")}
                      </Typography>
                    )}
                    {l.notes && (
                      <Typography variant="caption" color="text.secondary">
                        Note: {l.notes}
                      </Typography>
                    )}
                  </Stack>
                  {l.isVoided && <Chip size="small" label="VOID" color="error" variant="outlined" />}
                  <Typography variant="body2" sx={{ textDecoration: l.isVoided ? "line-through" : "none", opacity: l.isVoided ? 0.6 : 1 }}>
                    {formatMoney(toCents(l.lineTotal), currency)}
                  </Typography>
                </Stack>
              ))}
              <Divider />
              <Stack spacing={0.5}>
                <SummaryRow label="Subtotal" value={formatMoney(toCents(order.subtotal), currency)} />
                {toCents(order.discountAmount) > 0 && <SummaryRow label="Discount" value={`−${formatMoney(toCents(order.discountAmount), currency)}`} />}
                <SummaryRow label="Tax" value={formatMoney(toCents(order.taxAmount), currency)} />
                {toCents(order.serviceCharge) > 0 && <SummaryRow label="Service" value={formatMoney(toCents(order.serviceCharge), currency)} />}
                <SummaryRow label="Total" value={formatMoney(toCents(order.total), currency)} bold />
              </Stack>
              {order.payments.length > 0 && (
                <>
                  <Divider />
                  <Typography variant="subtitle2">Payments</Typography>
                  {order.payments.map((p) => (
                    <Stack key={p.id} direction="row" sx={{ justifyContent: "space-between" }}>
                      <Typography variant="body2">{p.method}</Typography>
                      <Typography variant="body2">{formatMoney(Math.round(Number(p.amount) * 100), currency)}</Typography>
                    </Stack>
                  ))}
                  {order.payments.flatMap((p) => p.refunds ?? []).map((r) => (
                    <Stack key={r.id} direction="row" sx={{ justifyContent: "space-between" }}>
                      <Typography variant="body2" color="error.main">
                        Refund
                      </Typography>
                      <Typography variant="body2" color="error.main">
                        −{formatMoney(Math.round(Number(r.amount) * 100), currency)}
                      </Typography>
                    </Stack>
                  ))}
                </>
              )}
              {receiptOpen && (
                <>
                  <Divider />
                  <Typography variant="subtitle2">Receipt</Typography>
                  <Paper variant="outlined" sx={{ p: 1.5, maxHeight: 260, overflow: "auto" }}>
                    <Typography component="pre" variant="caption" sx={{ fontFamily: "ui-monospace, monospace", whiteSpace: "pre-wrap", m: 0 }}>
                      {receipt?.receipt ?? t("common:loading")}
                    </Typography>
                  </Paper>
                </>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDetail}>{t("common:cancel")}</Button>
          <Button onClick={() => setReceiptOpen((v) => !v)} disabled={!order}>
            {receiptOpen ? "Hide receipt" : "Receipt"}
          </Button>
          {can("pos.use") && (
            <Button onClick={() => reprintMut.mutate()} disabled={!order || reprintMut.isPending}>
              Reprint
            </Button>
          )}
          {cancellable && (
            <Button color="error" onClick={() => setCancelOpen(true)}>
              Cancel order
            </Button>
          )}
        </DialogActions>
      </Dialog>

      <Dialog open={cancelOpen} onClose={() => setCancelOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Cancel order{order ? ` #${order.orderNumber}` : ""}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Reason" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} fullWidth autoFocus />
            <TextField
              label="Manager PIN (optional)"
              value={managerPin}
              onChange={(e) => setManagerPin(e.target.value)}
              fullWidth
              slotProps={{ htmlInput: { inputMode: "numeric", maxLength: 6 } }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCancelOpen(false)}>{t("common:cancel")}</Button>
          <Button color="error" variant="contained" disabled={cancelReason.trim().length < 2 || cancelMut.isPending} onClick={() => cancelMut.mutate()}>
            {cancelMut.isPending ? <CircularProgress size={18} color="inherit" /> : "Cancel order"}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

function SummaryRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <Stack direction="row" sx={{ justifyContent: "space-between" }}>
      <Typography variant="body2" color={bold ? "text.primary" : "text.secondary"} sx={{ fontWeight: bold ? 800 : 400 }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: bold ? 800 : 500 }}>
        {value}
      </Typography>
    </Stack>
  );
}
