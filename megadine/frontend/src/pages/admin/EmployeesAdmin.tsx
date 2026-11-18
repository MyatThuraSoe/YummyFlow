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
  IconButton,
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
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import PersonOffIcon from "@mui/icons-material/PersonOff";
import { useTranslation } from "react-i18next";
import { apiDel, apiGet, apiPost, apiPut } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { useAuth } from "../../store/auth";

interface Envelope<T> {
  success: boolean;
  message: string;
  data: T;
}

interface Employee {
  id: string;
  firstName: string;
  lastName: string | null;
  phone: string | null;
  emergencyContact: string | null;
  address: string | null;
  idNumber: string | null;
  position: string | null;
  status: "ACTIVE" | "ON_LEAVE" | "LEFT";
  startDate: string | null;
  endDate: string | null;
  payType: "MONTHLY" | "DAILY" | "HOURLY" | null;
  payRate: number | null;
  notes: string | null;
  userId: string | null;
}

type EmployeeForm = Omit<Employee, "id" | "endDate">;

const EMPTY: EmployeeForm = {
  firstName: "",
  lastName: "",
  phone: "",
  emergencyContact: "",
  address: "",
  idNumber: "",
  position: "",
  status: "ACTIVE",
  startDate: new Date().toISOString().slice(0, 10),
  payType: null,
  payRate: null,
  notes: "",
  userId: null,
};

const STATUS_COLOR: Record<string, "success" | "warning" | "default"> = {
  ACTIVE: "success",
  ON_LEAVE: "warning",
  LEFT: "default",
};

/** HR-style staff records, separate from the login accounts (roles redesign). */
export default function EmployeesAdmin() {
  const { t } = useTranslation(["users", "common", "admin"]);
  const qc = useQueryClient();
  const { can } = useAuth();
  const canManage = can("employee.manage");

  const [editing, setEditing] = useState<{ id?: string; form: EmployeeForm } | null>(null);
  const [error, setError] = useState("");

  const { data, isLoading, error: loadError } = useQuery({
    queryKey: ["employees"],
    queryFn: () => apiGet<Envelope<{ employees: Employee[] }>>("/employees"),
  });

  const { data: usersData } = useQuery({
    queryKey: ["users", "all"],
    queryFn: () => apiGet<Envelope<{ users: { id: string; name: string; username: string | null }[] }>>("/users"),
    enabled: canManage,
  });

  const save = useMutation({
    mutationFn: ({ id, form }: { id?: string; form: EmployeeForm }) => {
      const body = {
        ...form,
        startDate: form.startDate ? new Date(form.startDate).toISOString() : null,
        payRate: form.payRate == null ? null : Number(form.payRate),
      };
      return id ? apiPut(`/employees/${id}`, body) : apiPost("/employees", body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employees"] });
      setEditing(null);
      setError("");
    },
    onError: (e) => setError(errorMessage(e, t)),
  });

  const deactivate = useMutation({
    mutationFn: (id: string) => apiDel(`/employees/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["employees"] }),
    onError: (e) => setError(errorMessage(e, t)),
  });

  function openEdit(e?: Employee) {
    setError("");
    if (!e) return setEditing({ form: { ...EMPTY } });
    setEditing({
      id: e.id,
      form: {
        firstName: e.firstName,
        lastName: e.lastName ?? "",
        phone: e.phone ?? "",
        emergencyContact: e.emergencyContact ?? "",
        address: e.address ?? "",
        idNumber: e.idNumber ?? "",
        position: e.position ?? "",
        status: e.status,
        startDate: e.startDate ? e.startDate.slice(0, 10) : "",
        payType: e.payType,
        payRate: e.payRate,
        notes: e.notes ?? "",
        userId: e.userId,
      },
    });
  }

  const employees = data?.data.employees ?? [];
  const setField = (key: keyof EmployeeForm) => (value: string) =>
    setEditing((cur) => (cur ? { ...cur, form: { ...cur.form, [key]: value } } : cur));

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
        <Typography variant="h5">{t("users:employees_title", { defaultValue: "Employees" })}</Typography>
        {canManage && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => openEdit()}>
            {t("users:add_employee", { defaultValue: "Add employee" })}
          </Button>
        )}
      </Stack>

      <Alert severity="info">
        {t("users:employees_hint", {
          defaultValue: "Staff records are separate from sign-in accounts. Link an account to tie sales and shifts to a person.",
        })}
      </Alert>
      {loadError && <Alert severity="error">{t("users:failed_to_load_users")}</Alert>}
      {error && <Alert severity="error" onClose={() => setError("")}>{error}</Alert>}

      <TableContainer component={Paper} variant="outlined">
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>{t("users:name")}</TableCell>
              <TableCell>{t("users:position", { defaultValue: "Position" })}</TableCell>
              <TableCell>{t("users:phone")}</TableCell>
              <TableCell>{t("users:start_date", { defaultValue: "Start date" })}</TableCell>
              <TableCell>{t("users:status")}</TableCell>
              <TableCell>{t("users:account", { defaultValue: "Account" })}</TableCell>
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
              employees.map((e) => (
                <TableRow key={e.id} hover>
                  <TableCell sx={{ fontWeight: 600 }}>{`${e.firstName}${e.lastName ? ` ${e.lastName}` : ""}`}</TableCell>
                  <TableCell>{e.position ?? "—"}</TableCell>
                  <TableCell>{e.phone ?? "—"}</TableCell>
                  <TableCell>{e.startDate ? new Date(e.startDate).toLocaleDateString() : "—"}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={t(`users:employee_status_${e.status.toLowerCase()}`, { defaultValue: e.status })}
                      color={STATUS_COLOR[e.status] ?? "default"}
                    />
                  </TableCell>
                  <TableCell>{e.userId ? "✓" : "—"}</TableCell>
                  <TableCell align="right">
                    {canManage && (
                      <>
                        <IconButton size="small" onClick={() => openEdit(e)} aria-label={t("users:edit_user")}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                        {e.status !== "LEFT" && (
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => deactivate.mutate(e.id)}
                            aria-label={t("users:deactivate", { defaultValue: "Mark as left" })}
                          >
                            <PersonOffIcon fontSize="small" />
                          </IconButton>
                        )}
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            {!isLoading && employees.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 4, color: "text.secondary" }}>—</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={!!editing} onClose={() => setEditing(null)} fullWidth maxWidth="sm">
        <DialogTitle>
          {editing?.id ? t("users:edit_employee", { defaultValue: "Edit employee" }) : t("users:add_employee", { defaultValue: "Add employee" })}
        </DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField fullWidth label={t("users:first_name")} value={editing?.form.firstName ?? ""} onChange={(e) => setField("firstName")(e.target.value)} required />
              <TextField fullWidth label={t("users:last_name")} value={editing?.form.lastName ?? ""} onChange={(e) => setField("lastName")(e.target.value)} />
            </Stack>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField fullWidth label={t("users:phone")} value={editing?.form.phone ?? ""} onChange={(e) => setField("phone")(e.target.value)} />
              <TextField fullWidth label={t("users:position", { defaultValue: "Position" })} value={editing?.form.position ?? ""} onChange={(e) => setField("position")(e.target.value)} />
            </Stack>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField fullWidth label={t("users:emergency_contact", { defaultValue: "Emergency contact" })} value={editing?.form.emergencyContact ?? ""} onChange={(e) => setField("emergencyContact")(e.target.value)} />
              <TextField fullWidth label={t("users:id_number", { defaultValue: "ID number" })} value={editing?.form.idNumber ?? ""} onChange={(e) => setField("idNumber")(e.target.value)} />
            </Stack>
            <TextField fullWidth label={t("users:address", { defaultValue: "Address" })} value={editing?.form.address ?? ""} onChange={(e) => setField("address")(e.target.value)} />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <FormControl fullWidth size="small">
                <InputLabel>{t("users:status")}</InputLabel>
                <Select label={t("users:status")} value={editing?.form.status ?? "ACTIVE"} onChange={(e) => setField("status")(e.target.value)}>
                  {(["ACTIVE", "ON_LEAVE", "LEFT"] as const).map((s) => (
                    <MenuItem key={s} value={s}>{t(`users:employee_status_${s.toLowerCase()}`, { defaultValue: s })}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField fullWidth type="date" label={t("users:start_date", { defaultValue: "Start date" })} slotProps={{ inputLabel: { shrink: true } }} value={editing?.form.startDate ?? ""} onChange={(e) => setField("startDate")(e.target.value)} />
            </Stack>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <FormControl fullWidth size="small">
                <InputLabel>{t("users:pay_type", { defaultValue: "Pay type" })}</InputLabel>
                <Select label={t("users:pay_type", { defaultValue: "Pay type" })} value={editing?.form.payType ?? ""} onChange={(e) => setField("payType")(e.target.value)}>
                  <MenuItem value="">—</MenuItem>
                  {(["MONTHLY", "DAILY", "HOURLY"] as const).map((p) => (
                    <MenuItem key={p} value={p}>{t(`users:pay_type_${p.toLowerCase()}`, { defaultValue: p })}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField fullWidth type="number" label={t("users:pay_rate", { defaultValue: "Pay rate" })} value={editing?.form.payRate ?? ""} onChange={(e) => setField("payRate")(e.target.value)} />
            </Stack>
            <FormControl fullWidth size="small">
              <InputLabel>{t("users:account", { defaultValue: "Linked account" })}</InputLabel>
              <Select label={t("users:account", { defaultValue: "Linked account" })} value={editing?.form.userId ?? ""} onChange={(e) => setField("userId")(e.target.value)}>
                <MenuItem value="">—</MenuItem>
                {(usersData?.data.users ?? []).map((u) => (
                  <MenuItem key={u.id} value={u.id}>{u.name}{u.username ? ` (${u.username})` : ""}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField fullWidth multiline minRows={2} label={t("users:notes", { defaultValue: "Notes" })} value={editing?.form.notes ?? ""} onChange={(e) => setField("notes")(e.target.value)} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditing(null)}>{t("users:cancel")}</Button>
          <Button
            variant="contained"
            disabled={save.isPending || !editing?.form.firstName.trim()}
            onClick={() => editing && save.mutate({ id: editing.id, form: editing.form })}
          >
            {save.isPending ? <CircularProgress size={18} color="inherit" /> : t("users:save", { defaultValue: "Save" })}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
