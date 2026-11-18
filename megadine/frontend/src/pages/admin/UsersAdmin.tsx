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
  FormControl,
  IconButton,
  InputLabel,
  Menu,
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
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { useTranslation } from "react-i18next";
import { apiDel, apiGet, apiPost, apiPut } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { useAuth } from "../../store/auth";

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
  lastLoginAt: string | null;
  lastTerminal: string | null;
  mustChangeCredential: boolean;
  locked: boolean;
}

const ROLES = ["OWNER", "ADMIN", "MANAGER", "CASHIER", "WAITER", "KITCHEN"];

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
  const { can, user: me } = useAuth();

  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [lockedOnly, setLockedOnly] = useState(false);
  const [mustChangeOnly, setMustChangeOnly] = useState(false);

  const [menuFor, setMenuFor] = useState<{ el: HTMLElement; user: UserRow } | null>(null);
  const [resetFor, setResetFor] = useState<UserRow | null>(null);
  const [resetType, setResetType] = useState<"PASSWORD" | "PIN">("PIN");
  const [credential, setCredential] = useState<{ username: string; value: string; type: string } | null>(null);
  const [confirm, setConfirm] = useState<{ user: UserRow; action: "deactivate" | "reactivate" | "signout" } | null>(null);
  const [actionError, setActionError] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["users", q, role, status, lockedOnly, mustChangeOnly],
    queryFn: () =>
      apiGet<Envelope<{ users: UserRow[] }>>("/users", {
        q: q || undefined,
        role: role || undefined,
        status: status || undefined,
        locked: lockedOnly ? "true" : undefined,
        mustChange: mustChangeOnly ? "true" : undefined,
      }),
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ["users"] });
  }

  const reset = useMutation({
    mutationFn: (u: UserRow) => apiPost<Envelope<{ credential: string; type: string }>>(`/users/${u.id}/reset-credential`, { type: resetType }),
    onSuccess: (res, u) => {
      setCredential({ username: u.username ?? u.name, value: res.data.credential, type: res.data.type });
      setResetFor(null);
      refresh();
    },
    onError: (e) => setActionError(errorMessage(e, t)),
  });

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => apiPut(`/users/${id}`, body),
    onSuccess: () => {
      setConfirm(null);
      setActionError("");
      refresh();
    },
    onError: (e) => setActionError(errorMessage(e, t)),
  });

  const signOut = useMutation({
    mutationFn: (id: string) => apiDel(`/users/${id}/sessions`),
    onSuccess: () => {
      setConfirm(null);
      setActionError("");
      refresh();
    },
    onError: (e) => setActionError(errorMessage(e, t)),
  });

  const lockToggle = useMutation({
    mutationFn: ({ id, locked }: { id: string; locked: boolean }) =>
      apiPost(`/users/${id}/${locked ? "unlock" : "lock"}`),
    onSuccess: () => {
      setMenuFor(null);
      refresh();
    },
    onError: (e) => setActionError(errorMessage(e, t)),
  });

  const users = data?.data.users ?? [];

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
        <Typography variant="h5">{t("users:title")}</Typography>
        {can("user.create") && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => nav("/admin/users/new")}>
            {t("users:add_user")}
          </Button>
        )}
      </Stack>

      {error && <Alert severity="error">{t("users:failed_to_load_users")}</Alert>}
      {actionError && <Alert severity="error" onClose={() => setActionError("")}>{actionError}</Alert>}

      <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} sx={{ alignItems: { md: "center" } }}>
        <TextField
          size="small"
          label={t("users:search", { defaultValue: "Search name, username or phone" })}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          sx={{ minWidth: 260 }}
        />
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>{t("users:role")}</InputLabel>
          <Select label={t("users:role")} value={role} onChange={(e) => setRole(e.target.value)}>
            <MenuItem value="">{t("users:all_roles", { defaultValue: "All roles" })}</MenuItem>
            {ROLES.map((r) => (
              <MenuItem key={r} value={r}>
                {roleLabel(r)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>{t("users:status")}</InputLabel>
          <Select label={t("users:status")} value={status} onChange={(e) => setStatus(e.target.value)}>
            <MenuItem value="">{t("users:all_statuses", { defaultValue: "All statuses" })}</MenuItem>
            <MenuItem value="active">{t("users:active")}</MenuItem>
            <MenuItem value="inactive">{t("users:inactive")}</MenuItem>
          </Select>
        </FormControl>
        <Button variant={lockedOnly ? "contained" : "outlined"} onClick={() => setLockedOnly((v) => !v)}>
          {t("users:locked", { defaultValue: "Locked" })}
        </Button>
        <Button variant={mustChangeOnly ? "contained" : "outlined"} onClick={() => setMustChangeOnly((v) => !v)}>
          {t("users:must_change", { defaultValue: "Must change credential" })}
        </Button>
      </Stack>

      <TableContainer component={Paper} variant="outlined">
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>{t("users:name")}</TableCell>
              <TableCell>{t("users:username")}</TableCell>
              <TableCell>{t("users:role")}</TableCell>
              <TableCell>{t("users:last_sign_in", { defaultValue: "Last sign-in" })}</TableCell>
              <TableCell>{t("users:terminal", { defaultValue: "Terminal" })}</TableCell>
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
                <TableRow key={u.id} hover>
                  <TableCell sx={{ fontWeight: 600 }}>{u.name}</TableCell>
                  <TableCell>{u.username ?? "—"}</TableCell>
                  <TableCell>
                    <Chip size="small" label={roleLabel(u.role)} color={ROLE_COLOR[u.role] ?? "default"} variant="outlined" />
                  </TableCell>
                  <TableCell>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : t("users:never", { defaultValue: "Never" })}</TableCell>
                  <TableCell>{u.lastTerminal ?? "—"}</TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", gap: 0.5 }}>
                      <Chip size="small" label={u.isActive ? t("users:active") : t("users:inactive")} color={u.isActive ? "success" : "default"} />
                      {u.locked && <Chip size="small" label={t("users:locked", { defaultValue: "Locked" })} color="error" />}
                      {u.mustChangeCredential && (
                        <Chip size="small" label={t("users:must_change_short", { defaultValue: "New credential" })} color="warning" />
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => nav(`/admin/users/${u.id}`)} aria-label={t("users:edit_user")}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                    {can("user.edit") && (
                      <IconButton size="small" onClick={(e) => setMenuFor({ el: e.currentTarget, user: u })} aria-label={t("users:actions")}>
                        <MoreVertIcon fontSize="small" />
                      </IconButton>
                    )}
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

      <Menu anchorEl={menuFor?.el} open={!!menuFor} onClose={() => setMenuFor(null)}>
        {menuFor && [
          <MenuItem
            key="reset"
            disabled={!can("user.reset_credential")}
            onClick={() => {
              setResetType(["OWNER", "ADMIN", "MANAGER"].includes(menuFor.user.role) ? "PASSWORD" : "PIN");
              setResetFor(menuFor.user);
              setMenuFor(null);
            }}
          >
            {t("users:reset_credential", { defaultValue: "Reset password or PIN" })}
          </MenuItem>,
          <MenuItem
            key="lock"
            disabled={menuFor.user.id === me?.id}
            onClick={() => lockToggle.mutate({ id: menuFor.user.id, locked: menuFor.user.locked })}
          >
            {menuFor.user.locked ? t("users:unlock", { defaultValue: "Unlock" }) : t("users:lock", { defaultValue: "Lock for an hour" })}
          </MenuItem>,
          <MenuItem
            key="signout"
            onClick={() => {
              setActionError("");
              setConfirm({ user: menuFor.user, action: "signout" });
              setMenuFor(null);
            }}
          >
            {t("users:sign_out_everywhere", { defaultValue: "Sign out everywhere" })}
          </MenuItem>,
          <MenuItem
            key="active"
            disabled={menuFor.user.id === me?.id}
            onClick={() => {
              setActionError("");
              setConfirm({ user: menuFor.user, action: menuFor.user.isActive ? "deactivate" : "reactivate" });
              setMenuFor(null);
            }}
          >
            {menuFor.user.isActive
              ? t("users:deactivate", { defaultValue: "Deactivate" })
              : t("users:reactivate", { defaultValue: "Reactivate" })}
          </MenuItem>,
        ]}
      </Menu>

      <Dialog open={!!resetFor} onClose={() => setResetFor(null)}>
        <DialogTitle>{t("users:reset_credential", { defaultValue: "Reset password or PIN" })}</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            {t("users:reset_help", {
              defaultValue: "A new credential is shown once. The person must change it at first sign-in, and all their sessions are signed out.",
            })}
          </DialogContentText>
          <FormControl fullWidth size="small">
            <InputLabel>{t("users:credential_type", { defaultValue: "Credential" })}</InputLabel>
            <Select label={t("users:credential_type", { defaultValue: "Credential" })} value={resetType} onChange={(e) => setResetType(e.target.value as "PASSWORD" | "PIN")}>
              <MenuItem value="PASSWORD">{t("users:password")}</MenuItem>
              <MenuItem value="PIN">{t("users:pin", { defaultValue: "PIN" })}</MenuItem>
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResetFor(null)}>{t("users:cancel")}</Button>
          <Button variant="contained" disabled={reset.isPending} onClick={() => resetFor && reset.mutate(resetFor)}>
            {reset.isPending ? <CircularProgress size={18} color="inherit" /> : t("users:reset", { defaultValue: "Reset" })}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!credential} onClose={() => setCredential(null)}>
        <DialogTitle>{t("users:credential_issued", { defaultValue: "Temporary credential" })}</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            {t("users:credential_once", { defaultValue: "Write this down now. It will not be shown again." })}
          </Alert>
          <Typography variant="body2" color="text.secondary">
            {credential?.username} · {credential?.type}
          </Typography>
          <Typography variant="h4" sx={{ fontFamily: "monospace", letterSpacing: 2, my: 2 }}>
            {credential?.value}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={() => setCredential(null)}>
            {t("users:done", { defaultValue: "Done" })}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!confirm} onClose={() => setConfirm(null)}>
        <DialogTitle>
          {confirm?.action === "signout"
            ? t("users:sign_out_everywhere", { defaultValue: "Sign out everywhere" })
            : confirm?.action === "reactivate"
              ? t("users:reactivate", { defaultValue: "Reactivate" })
              : t("users:deactivate", { defaultValue: "Deactivate" })}
        </DialogTitle>
        <DialogContent>
          {actionError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {actionError}
            </Alert>
          )}
          <DialogContentText>
            {confirm?.action === "deactivate"
              ? t("users:deactivate_help", {
                  defaultValue: "The account keeps its history but cannot sign in. Open shifts or orders block this action.",
                })
              : confirm?.user.name}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)}>{t("users:cancel")}</Button>
          <Button
            variant="contained"
            color={confirm?.action === "deactivate" ? "error" : "primary"}
            disabled={patch.isPending || signOut.isPending}
            onClick={() => {
              if (!confirm) return;
              if (confirm.action === "signout") signOut.mutate(confirm.user.id);
              else patch.mutate({ id: confirm.user.id, body: { isActive: confirm.action === "reactivate" } });
            }}
          >
            {patch.isPending || signOut.isPending ? <CircularProgress size={18} color="inherit" /> : t("users:confirm", { defaultValue: "Confirm" })}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
