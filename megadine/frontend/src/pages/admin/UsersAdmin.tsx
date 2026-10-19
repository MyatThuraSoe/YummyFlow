import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Paper,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import { useTranslation } from "react-i18next";
import { apiDel, apiGet } from "../../lib/api";
import { errorMessage } from "../../lib/errors";

interface Envelope<T> {
  success: boolean;
  message: string;
  data: T;
}

interface UserRow {
  id: string;
  name: string;
  username: string | null;
  email: string | null;
  phone: string | null;
  role: string;
  isActive: boolean;
}

const ROLE_COLOR: Record<string, "error" | "warning" | "info" | "success" | "default"> = {
  OWNER: "error",
  ADMIN: "error",
  MANAGER: "warning",
  CASHIER: "info",
  WAITER: "success",
  KITCHEN: "default",
};

export default function UsersAdmin() {
  const { t } = useTranslation(["users", "common", "admin"]);
  const roleLabel = (r: string) => t(`admin:role_${r.toLowerCase()}`, { defaultValue: r });
  const nav = useNavigate();
  const qc = useQueryClient();
  const [deleting, setDeleting] = useState<UserRow | null>(null);
  const [deleteError, setDeleteError] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["users"],
    queryFn: () => apiGet<Envelope<{ users: UserRow[] }>>("/users"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiDel(`/users/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      setDeleting(null);
      setDeleteError("");
    },
    onError: (e) => setDeleteError(errorMessage(e, t)),
  });

  const users = data?.data.users ?? [];

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
        <Typography variant="h5">{t("users:title")}</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => nav("/admin/users/new")}>
          {t("users:add_user")}
        </Button>
      </Stack>

      {error && <Alert severity="error">{t("users:failed_to_load_users")}</Alert>}

      <TableContainer component={Paper} variant="outlined">
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>{t("users:username")}</TableCell>
              <TableCell>{t("users:email")}</TableCell>
              <TableCell>{t("users:name")}</TableCell>
              <TableCell>{t("users:phone")}</TableCell>
              <TableCell>{t("users:role")}</TableCell>
              <TableCell>{t("users:status")}</TableCell>
              <TableCell align="right">{t("users:actions")}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading &&
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 7 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton width="80%" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            {!isLoading &&
              users.map((u) => (
                <TableRow key={u.id} hover sx={{ cursor: "pointer" }} onClick={() => nav(`/admin/users/${u.id}`)}>
                  <TableCell sx={{ fontWeight: 600 }}>{u.username ?? "—"}</TableCell>
                  <TableCell>{u.email ?? "—"}</TableCell>
                  <TableCell>{u.name}</TableCell>
                  <TableCell>{u.phone ?? "—"}</TableCell>
                  <TableCell>
                    <Chip size="small" label={roleLabel(u.role)} color={ROLE_COLOR[u.role] ?? "default"} variant="outlined" />
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={u.isActive ? t("users:active") : t("users:inactive")}
                      color={u.isActive ? "success" : "default"}
                    />
                  </TableCell>
                  <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                    <IconButton size="small" onClick={() => nav(`/admin/users/${u.id}`)} aria-label={t("admin:tba_edit")}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => {
                        setDeleteError("");
                        setDeleting(u);
                      }}
                       aria-label={t("users:delete")}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            {!isLoading && users.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 4, color: "text.secondary" }}>
                  —
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {!isLoading && users.length > 0 && (
        <Typography variant="caption" color="text.secondary">
          {t("users:showing_users", { count: users.length })}
        </Typography>
      )}

      <Dialog open={!!deleting} onClose={() => setDeleting(null)}>
        <DialogTitle>{t("users:delete_title")}</DialogTitle>
        <DialogContent>
          {deleteError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {deleteError}
            </Alert>
          )}
          <DialogContentText>{t("users:delete_confirm", { username: deleting?.username ?? "" })}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleting(null)}>{t("users:cancel")}</Button>
          <Button
            color="error"
            variant="contained"
            disabled={remove.isPending}
            onClick={() => deleting && remove.mutate(deleting.id)}
          >
            {remove.isPending ? <CircularProgress size={18} color="inherit" /> : t("users:delete")}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
