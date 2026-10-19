import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Box,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
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
import { apiGet } from "../../lib/api";
import { useAuth } from "../../store/auth";

interface AuditLog {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  reason: string | null;
  ipAddress: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
  user: { name: string; role: string } | null;
}

interface UserOption {
  id: string;
  name: string;
  username: string | null;
}

export default function AuditAdmin() {
  const { t } = useTranslation(["nav", "admin"]);
  const { can } = useAuth();
  const [action, setAction] = useState("");
  const [userId, setUserId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState<AuditLog | null>(null);

  const { data } = useQuery({
    queryKey: ["audit", action, userId, from, to],
    queryFn: () =>
      apiGet<{ logs: AuditLog[] }>("/admin/audit", {
        action: action || undefined,
        userId: userId || undefined,
        from: from || undefined,
        to: to || undefined,
        limit: 200,
      }),
  });

  const { data: usersData } = useQuery({
    queryKey: ["users", "options"],
    queryFn: () => apiGet<{ data: { users: UserOption[] } }>("/users"),
    enabled: can("staff.manage"),
    staleTime: 5 * 60_000,
  });
  const users = usersData?.data.users ?? [];

  return (
    <Stack spacing={2}>
      <Typography variant="h5">{t("nav:audit_logs")}</Typography>
      <Stack direction={{ xs: "column", md: "row" }} spacing={1.5}>
        <TextField
          size="small"
          label={t("admin:aud_col_action")}
          placeholder="AUTH_LOGIN"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          sx={{ minWidth: 200 }}
        />
        {can("staff.manage") && (
          <TextField size="small" select label={t("admin:aud_col_user")} value={userId} onChange={(e) => setUserId(e.target.value)} sx={{ minWidth: 200 }}>
            <MenuItem value="">{t("admin:aud_all_users")}</MenuItem>
            {users.map((u) => (
              <MenuItem key={u.id} value={u.id}>
                {u.name} {u.username ? `(@${u.username})` : ""}
              </MenuItem>
            ))}
          </TextField>
        )}
        <TextField
          size="small"
          type="date"
          label={t("admin:fld_from")}
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <TextField
          size="small"
          type="date"
          label={t("admin:fld_to")}
          value={to}
          onChange={(e) => setTo(e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
        />
      </Stack>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t("admin:inv_col_when")}</TableCell>
              <TableCell>{t("admin:aud_col_user")}</TableCell>
              <TableCell>{t("admin:aud_col_action")}</TableCell>
              <TableCell>{t("admin:aud_col_entity")}</TableCell>
              <TableCell>{t("admin:col_reason")}</TableCell>
              <TableCell>IP</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(data?.logs ?? []).map((l) => (
              <TableRow key={l.id} hover sx={{ cursor: "pointer" }} onClick={() => setSelected(l)}>
                <TableCell>{new Date(l.createdAt).toLocaleString()}</TableCell>
                <TableCell>{l.user ? `${l.user.name} (${l.user.role})` : t("admin:aud_system")}</TableCell>
                <TableCell>
                  <Chip size="small" label={l.action} variant="outlined" />
                </TableCell>
                <TableCell>{l.entityType ?? "—"}</TableCell>
                <TableCell>{l.reason ?? "—"}</TableCell>
                <TableCell>{l.ipAddress ?? "—"}</TableCell>
              </TableRow>
            ))}
            {(data?.logs ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 4, color: "text.secondary" }}>
                  —
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={!!selected} onClose={() => setSelected(null)} maxWidth="md">
        <DialogTitle>{selected?.action}</DialogTitle>
        <DialogContent dividers>
          {selected && (
            <Stack spacing={1.5}>
              <Typography variant="body2" color="text.secondary">
                {new Date(selected.createdAt).toLocaleString()}
                {selected.user ? ` · ${selected.user.name} (${selected.user.role})` : ` · ${t("admin:aud_system")}`}
                {selected.ipAddress ? ` · ${selected.ipAddress}` : ""}
              </Typography>
              <Box>
                <Typography variant="subtitle2">
                  {t("admin:aud_entity_line", { type: selected.entityType ?? "—", id: selected.entityId ?? "" })}
                </Typography>
                {selected.reason && <Typography variant="body2">{t("admin:aud_reason_line", { reason: selected.reason })}</Typography>}
              </Box>
              <JsonBlock title={t("admin:aud_before")} value={selected.before} />
              <JsonBlock title={t("admin:aud_after")} value={selected.after} />
            </Stack>
          )}
        </DialogContent>
      </Dialog>
    </Stack>
  );
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <Box>
      <Typography variant="subtitle2">{title}</Typography>
      <Box
        component="pre"
        sx={{
          m: 0,
          p: 1.5,
          bgcolor: "action.hover",
          borderRadius: 1.5,
          fontSize: 12,
          overflow: "auto",
          maxHeight: 260,
        }}
      >
        {JSON.stringify(value, null, 2)}
      </Box>
    </Box>
  );
}
