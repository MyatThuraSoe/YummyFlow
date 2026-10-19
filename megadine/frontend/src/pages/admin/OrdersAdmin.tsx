import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Box,
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
import { useNavigate } from "react-router-dom";
import { apiGet, apiPost } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { formatMoney, toCents } from "../../lib/format";
import { printOrderReceipt } from "../../lib/receipts";
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

interface Refund {
  id: string;
  amount: string;
  reason?: string | null;
  createdAt?: string;
}

interface Payment {
  id: string;
  method: string;
  amount: string;
  refunds?: Refund[];
}

interface KitchenTicketLine {
  id: string;
  itemName: string;
  quantity: number;
  status: string;
}

interface KitchenTicket {
  id: string;
  station: string;
  status: string;
  sentAt: string;
  lines: KitchenTicketLine[];
}

interface Order {
  id: string;
  orderNumber: number;
  channel: string;
  status: string;
  paymentStatus: string;
  amountPaid: string;
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
  kitchenTickets?: KitchenTicket[];
}

interface Envelope<T> {
  success: boolean;
  message: string;
  data: T;
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

const today = () => new Date().toISOString().slice(0, 10);

export default function OrdersAdmin() {
  const qc = useQueryClient();
  const { push } = useToast();
  const { can } = useAuth();
  const { t } = useTranslation(["nav", "common", "admin", "ops"]);
  const nav = useNavigate();

  const statusLabel = (s: string) => t(`ops:order_status_${s.toLowerCase()}`, { defaultValue: s.replace(/_/g, " ") });
  const channelLabel = (c: string) => t(`ops:channel_${c.toLowerCase()}`, { defaultValue: c.replace(/_/g, " ") });
  const paymentStatusLabel = (s: string) => t(`admin:ps_${s.toLowerCase()}`, { defaultValue: s.replace(/_/g, " ") });
  const ticketStatusLabel = (s: string) => {
    const map: Record<string, string> = {
      QUEUED: "ops:kds_queued",
      PREPARING: "ops:kds_preparing",
      READY: "ops:kds_ready",
      SERVED: "ops:kds_served",
      CANCELLED: "ops:order_status_cancelled",
    };
    return map[s] ? t(map[s]) : s.replace(/_/g, " ");
  };

  const [date, setDate] = useState(today());
  const [status, setStatus] = useState("ALL");
  const [channel, setChannel] = useState("ALL");
  const [cashierId, setCashierId] = useState("ALL");
  const [tableId, setTableId] = useState("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [managerPin, setManagerPin] = useState("");
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [refundPin, setRefundPin] = useState("");
  const [refundRestock, setRefundRestock] = useState(false);

  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiGet<{ restaurant: { currency: string } }>("/admin/settings"),
    staleTime: 5 * 60_000,
  });
  const currency = settings?.restaurant.currency ?? "USD";

  const { data: usersData } = useQuery({
    queryKey: ["users"],
    queryFn: () => apiGet<Envelope<{ users: { id: string; name: string; role: string }[] }>>("/users"),
    enabled: can("staff.manage"),
    staleTime: 5 * 60_000,
    retry: 0,
  });

  const { data: tablesData } = useQuery({
    queryKey: ["tables"],
    queryFn: () => apiGet<{ tables: { id: string; number: number; status: string }[] }>("/tables"),
    staleTime: 60_000,
    retry: 0,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["orders", "admin", date, status, channel, cashierId, tableId],
    queryFn: () =>
      apiGet<{ orders: Order[] }>("/orders", {
        businessDate: date || undefined,
        status: status === "ALL" ? undefined : status,
        channel: channel === "ALL" ? undefined : channel,
        cashierId: cashierId === "ALL" ? undefined : cashierId,
        tableId: tableId === "ALL" ? undefined : tableId,
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
      push(t("admin:ord_cancelled_toast"), "ok");
      setCancelOpen(false);
      setCancelReason("");
      setManagerPin("");
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => push(errorMessage(e, t), "error"),
  });

  const reprintMut = useMutation({
    mutationFn: () => printOrderReceipt(selectedId!),
    onSuccess: (r) => push(r.ok ? t("admin:ord_receipt_sent", { mode: r.mode }) : t("admin:ord_printer_unavailable", { mode: r.mode }), r.ok ? "ok" : "error"),
    onError: (e) => push(errorMessage(e, t), "error"),
  });

  const refundMut = useMutation({
    mutationFn: () => apiPost("/payments/refund", { orderId: selectedId, amount: Number(refundAmount), reason: refundReason, managerPin: refundPin, restock: refundRestock }),
    onSuccess: () => {
      push(t("admin:ord_refunded_toast", { amount: formatMoney(Math.round(Number(refundAmount) * 100), currency) }), "ok");
      setRefundOpen(false);
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => push(errorMessage(e, t), "error"),
  });

  const orders = data?.orders ?? [];
  const order = detail?.order;
  const cancellable = !!order && order.status !== "COMPLETED" && order.status !== "CANCELLED" && can("pos.use");
  const paidCents = order ? toCents(order.amountPaid) : 0;
  const refundedCents = order ? order.payments.flatMap((p) => p.refunds ?? []).reduce((s, r) => s + toCents(r.amount), 0) : 0;
  const refundableCents = Math.max(0, paidCents - refundedCents);
  const canRefund = can("order.refund") && refundableCents > 0;
  const refundValid = Number(refundAmount) > 0 && Math.round(Number(refundAmount) * 100) <= refundableCents && refundReason.trim().length >= 2 && /^\d{4,6}$/.test(refundPin);

  function closeDetail() {
    setSelectedId(null);
    setReceiptOpen(false);
    setRefundOpen(false);
  }

  function openRefund() {
    setRefundAmount((refundableCents / 100).toFixed(2));
    setRefundReason("");
    setRefundPin("");
    setRefundRestock(false);
    setRefundOpen(true);
  }

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "center" }, flexWrap: "wrap", rowGap: 2 }}>
        <Typography variant="h5" sx={{ flex: 1 }}>
          {t("nav:orders")}
        </Typography>
        <TextField type="date" label={t("admin:sh_business_date")} value={date} onChange={(e) => setDate(e.target.value)} size="small" slotProps={{ inputLabel: { shrink: true } }} />
        <TextField select label={t("admin:col_status")} value={status} onChange={(e) => setStatus(e.target.value)} size="small" sx={{ minWidth: 170 }}>
          <MenuItem value="ALL">{t("admin:ord_all_statuses")}</MenuItem>
          {STATUSES.map((s) => (
            <MenuItem key={s} value={s}>
              {statusLabel(s)}
            </MenuItem>
          ))}
        </TextField>
        <TextField select label={t("admin:ord_channel")} value={channel} onChange={(e) => setChannel(e.target.value)} size="small" sx={{ minWidth: 150 }}>
          <MenuItem value="ALL">{t("admin:ord_all_channels")}</MenuItem>
          {CHANNELS.map((c) => (
            <MenuItem key={c} value={c}>
              {channelLabel(c)}
            </MenuItem>
          ))}
        </TextField>
        {can("staff.manage") && (
          <TextField select label={t("admin:col_cashier")} value={cashierId} onChange={(e) => setCashierId(e.target.value)} size="small" sx={{ minWidth: 180 }}>
            <MenuItem value="ALL">{t("admin:ord_all_cashiers")}</MenuItem>
            {(usersData?.data.users ?? []).map((u) => (
              <MenuItem key={u.id} value={u.id}>
                {u.name} ({u.role})
              </MenuItem>
            ))}
          </TextField>
        )}
        <TextField select label={t("admin:ord_table")} value={tableId} onChange={(e) => setTableId(e.target.value)} size="small" sx={{ minWidth: 130 }}>
          <MenuItem value="ALL">{t("admin:ord_all_tables")}</MenuItem>
          {(tablesData?.tables ?? []).map((tb) => (
            <MenuItem key={tb.id} value={tb.id}>
              #{tb.number}
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
                  <TableCell>{t("admin:ord_col_order")}</TableCell>
                  <TableCell>{t("admin:col_time")}</TableCell>
                  <TableCell>{t("admin:col_type")}</TableCell>
                  <TableCell>{t("admin:col_status")}</TableCell>
                  <TableCell align="right">{t("admin:ord_col_items")}</TableCell>
                  <TableCell align="right">{t("admin:ord_col_total")}</TableCell>
                  <TableCell align="right" />
                </TableRow>
              </TableHead>
              <TableBody>
                {orders.map((o) => (
                  <TableRow key={o.id} hover sx={{ cursor: "pointer" }} onClick={() => setSelectedId(o.id)}>
                    <TableCell sx={{ fontWeight: 700 }}>#{o.orderNumber}</TableCell>
                    <TableCell>{new Date(o.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</TableCell>
                    <TableCell>
                      {channelLabel(o.channel)}
                      {o.tableSession?.table ? ` · #${o.tableSession.table.number}` : ""}
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label={statusLabel(o.status)} color={STATUS_COLORS[o.status] ?? "default"} variant="outlined" />
                    </TableCell>
                    <TableCell align="right">{o.lines.filter((l) => !l.isVoided).reduce((n, l) => n + l.quantity, 0)}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>
                      {formatMoney(toCents(o.total), currency)}
                    </TableCell>
                    <TableCell align="right">
                      <Button size="small" onClick={(e) => { e.stopPropagation(); setSelectedId(o.id); }}>
                        {t("admin:ord_view")}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {orders.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} align="center" sx={{ py: 4, color: "text.secondary" }}>
                      {t("admin:ord_empty")}
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
          {order ? t("admin:ord_order_title", { number: order.orderNumber }) : t("admin:ord_order")}
          {order && <Chip size="small" label={statusLabel(order.status)} color={STATUS_COLORS[order.status] ?? "default"} variant="outlined" />}
          {order && order.paymentStatus !== "SUCCEEDED" && (
            <Chip
              size="small"
              label={paymentStatusLabel(order.paymentStatus)}
              color={order.paymentStatus === "REFUNDED" ? "error" : order.paymentStatus === "PARTIALLY_REFUNDED" ? "warning" : "default"}
              variant="outlined"
            />
          )}
        </DialogTitle>
        <DialogContent dividers>
          {detailLoading || !order ? (
            <Stack sx={{ py: 4, alignItems: "center" }}>
              <CircularProgress />
            </Stack>
          ) : (
            <Stack spacing={1.5}>
              <Typography variant="body2" color="text.secondary">
                {new Date(order.createdAt).toLocaleString()} · {channelLabel(order.channel)}
                {order.tableSession?.table ? ` · ${t("admin:ord_table")} #${order.tableSession.table.number}${order.tableSession.table.name ? ` (${order.tableSession.table.name})` : ""}` : ""}
              </Typography>
              {order.cancelReason && <Alert severity="error">{t("admin:ord_cancel_reason_alert", { reason: order.cancelReason })}</Alert>}
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
                        {t("admin:ord_line_note", { note: l.notes })}
                      </Typography>
                    )}
                  </Stack>
                  {l.isVoided && <Chip size="small" label={t("admin:ord_void_chip")} color="error" variant="outlined" />}
                  <Typography variant="body2" sx={{ textDecoration: l.isVoided ? "line-through" : "none", opacity: l.isVoided ? 0.6 : 1 }}>
                    {formatMoney(toCents(l.lineTotal), currency)}
                  </Typography>
                </Stack>
              ))}
              <Divider />
              <Stack spacing={0.5}>
                <SummaryRow label={t("admin:col_subtotal")} value={formatMoney(toCents(order.subtotal), currency)} />
                {toCents(order.discountAmount) > 0 && <SummaryRow label={t("admin:ord_sum_discount")} value={`−${formatMoney(toCents(order.discountAmount), currency)}`} />}
                <SummaryRow label={t("admin:dash_tax")} value={formatMoney(toCents(order.taxAmount), currency)} />
                {toCents(order.serviceCharge) > 0 && <SummaryRow label={t("admin:sh_service")} value={formatMoney(toCents(order.serviceCharge), currency)} />}
                <SummaryRow label={t("admin:ord_col_total")} value={formatMoney(toCents(order.total), currency)} bold />
                {paidCents > 0 && <SummaryRow label={t("admin:ord_sum_paid")} value={formatMoney(paidCents, currency)} />}
                {refundedCents > 0 && <SummaryRow label={t("admin:ord_sum_refunded")} value={`−${formatMoney(refundedCents, currency)}`} />}
                {canRefund && <SummaryRow label={t("admin:ord_sum_refundable")} value={formatMoney(refundableCents, currency)} />}
              </Stack>
              {order.payments.length > 0 && (
                <>
                  <Divider />
                  <Typography variant="subtitle2">{t("admin:ord_payments")}</Typography>
                  {order.payments.map((p) => (
                    <Stack key={p.id} direction="row" sx={{ justifyContent: "space-between" }}>
                      <Typography variant="body2">{p.method}</Typography>
                      <Typography variant="body2">{formatMoney(Math.round(Number(p.amount) * 100), currency)}</Typography>
                    </Stack>
                  ))}
                  {order.payments.flatMap((p) => p.refunds ?? []).map((r) => (
                    <Stack key={r.id} direction="row" sx={{ justifyContent: "space-between", alignItems: "baseline" }}>
                      <Typography variant="body2" color="error.main">
                        {t("admin:ord_refund_label")}{r.reason ? ` · ${r.reason}` : ""}
                      </Typography>
                      <Typography variant="body2" color="error.main">
                        −{formatMoney(Math.round(Number(r.amount) * 100), currency)}
                      </Typography>
                    </Stack>
                  ))}
                </>
              )}
              {(order.kitchenTickets ?? []).length > 0 && (
                <>
                  <Divider />
                  <Typography variant="subtitle2">{t("admin:ord_kitchen_tickets")}</Typography>
                  {order.kitchenTickets!.map((tk) => (
                    <Paper key={tk.id} variant="outlined" sx={{ p: 1.25 }}>
                      <Stack spacing={0.5}>
                        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                          <Chip size="small" label={tk.station} variant="outlined" />
                          <Chip
                            size="small"
                            label={ticketStatusLabel(tk.status)}
                            color={tk.status === "READY" ? "success" : tk.status === "PREPARING" ? "warning" : tk.status === "SERVED" ? "default" : "info"}
                            variant="outlined"
                          />
                          <Box sx={{ flex: 1 }} />
                          <Typography variant="caption" color="text.secondary">
                            {new Date(tk.sentAt).toLocaleTimeString()}
                          </Typography>
                        </Stack>
                        {tk.lines.map((tl) => (
                          <Typography key={tl.id} variant="caption" color="text.secondary">
                            {tl.quantity}× {tl.itemName} · {ticketStatusLabel(tl.status)}
                          </Typography>
                        ))}
                      </Stack>
                    </Paper>
                  ))}
                </>
              )}
              {receiptOpen && (
                <>
                  <Divider />
                  <Typography variant="subtitle2">{t("admin:ord_receipt")}</Typography>
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
            {receiptOpen ? t("admin:ord_hide_receipt") : t("admin:ord_receipt")}
          </Button>
          {order && (
            <Button onClick={() => nav(`/admin/receipt/${order.id}`)}>{t("admin:ord_receipt_page")}</Button>
          )}
          {can("pos.use") && (
            <Button onClick={() => reprintMut.mutate()} disabled={!order || reprintMut.isPending}>
              {t("ops:pos_reprint")}
            </Button>
          )}
          {canRefund && (
            <Button color="warning" onClick={openRefund} disabled={!order}>
              {t("ops:orders_refund")}
            </Button>
          )}
          {cancellable && (
            <Button color="error" onClick={() => setCancelOpen(true)}>
              {t("admin:ord_cancel_order")}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      <Dialog open={cancelOpen} onClose={() => setCancelOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{order ? t("admin:ord_cancel_title", { number: order.orderNumber }) : t("admin:ord_cancel_order")}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label={t("admin:col_reason")} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} fullWidth autoFocus />
            <TextField
              label={t("admin:ord_pin_optional")}
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
            {cancelMut.isPending ? <CircularProgress size={18} color="inherit" /> : t("admin:ord_cancel_order")}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={refundOpen} onClose={() => setRefundOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{order ? t("admin:ord_refund_title", { number: order.orderNumber }) : t("ops:orders_refund")}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Alert severity="info">
              {t("admin:ord_refundable_balance", { amount: formatMoney(refundableCents, currency) })}
            </Alert>
            <TextField
              label={t("admin:exp_amount_currency", { currency })}
              type="number"
              value={refundAmount}
              onChange={(e) => setRefundAmount(e.target.value)}
              fullWidth
              autoFocus
              error={Number(refundAmount) > 0 && Math.round(Number(refundAmount) * 100) > refundableCents}
              helperText={Number(refundAmount) > 0 && Math.round(Number(refundAmount) * 100) > refundableCents ? t("admin:ord_exceeds_refundable") : " "}
            />
            <TextField label={t("admin:col_reason")} value={refundReason} onChange={(e) => setRefundReason(e.target.value)} fullWidth multiline minRows={2} />
            <TextField
              label={t("ops:refund_manager_pin")}
              value={refundPin}
              onChange={(e) => setRefundPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              fullWidth
              slotProps={{ htmlInput: { inputMode: "numeric", maxLength: 6 } }}
              helperText={t("admin:ord_approver_hint")}
            />
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <input id="refund-restock" type="checkbox" checked={refundRestock} onChange={(e) => setRefundRestock(e.target.checked)} />
              <Typography component="label" htmlFor="refund-restock" variant="body2">
                {t("admin:ord_restock")}
              </Typography>
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRefundOpen(false)}>{t("common:cancel")}</Button>
          <Button color="warning" variant="contained" disabled={!refundValid || refundMut.isPending} onClick={() => refundMut.mutate()}>
            {refundMut.isPending ? <CircularProgress size={18} color="inherit" /> : t("admin:ord_refund_submit", { amount: refundAmount ? formatMoney(Math.round(Number(refundAmount) * 100), currency) : "" })}
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
