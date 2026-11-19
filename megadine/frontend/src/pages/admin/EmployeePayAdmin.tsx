import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Box,
  Button,
  Chip,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost, apiDel } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { formatMoney } from "../../lib/format";
import { useAuth } from "../../store/auth";

type Shift = "MORNING" | "EVENING" | "NIGHT";
type TipRule = "EQUAL" | "HOURS" | "POINTS";

interface EmployeeRef {
  id: string;
  firstName: string;
  lastName: string | null;
  position?: string | null;
}
interface EmployeesData { employees: EmployeeRef[] }
interface Settings { restaurant: { currency: string } | null }

interface RosterRow {
  id: string;
  employeeId: string;
  dayOfWeek: number;
  shift: Shift;
  position: string | null;
  employee: EmployeeRef;
}
interface AttendanceRow {
  id: string;
  employeeId: string;
  businessDate: string;
  clockIn: string;
  clockOut: string | null;
  breakMinutes: number;
  lateMinutes: number;
  earlyMinutes: number;
  method: string;
  editReason: string | null;
  employee: EmployeeRef;
}
interface MoneyRow {
  id: string;
  employeeId: string;
  businessDate: string;
  amount: string;
  reason: string | null;
  acknowledged?: boolean;
  employee: EmployeeRef;
}
interface MealRow {
  id: string;
  employeeId: string;
  businessDate: string;
  count: number;
  cost: string | null;
  note: string | null;
  employee: EmployeeRef;
}
interface TipRow {
  id: string;
  businessDate: string;
  tipAmount: string;
  serviceCharge: string;
  rule: TipRule;
  allocations: { employeeId: string; amount: number }[] | null;
}
interface NoteRow {
  id: string;
  employeeId: string;
  note: string;
  createdAt: string;
  employee: EmployeeRef;
}
interface SummaryRow {
  employeeId: string;
  name: string;
  position: string | null;
  payType: string | null;
  rate: number;
  daysWorked: number;
  hours: number;
  lateMinutes: number;
  base: number;
  advance: number;
  deduction: number;
  mealCost: number;
  tip: number;
  totalOwed: number;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => `${today().slice(0, 7)}-01`;

/**
 * Owner payroll area. Managers see only roster + attendance; pay records and
 * notes are gated on payroll.view. Admins have neither and never see the page.
 */
export default function EmployeePayAdmin() {
  const { t } = useTranslation(["admin", "common"]);
  const { can } = useAuth();
  const qc = useQueryClient();
  const [error, setError] = useState("");

  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [tab, setTab] = useState(0);

  const canPay = can("payroll.view");
  const canManage = can("employee.manage");
  const canAttendance = can("attendance.edit") || canPay;
  const canRoster = can("employee.view") || canPay;

  const tabs: { key: string; label: string }[] = [];
  if (canPay) tabs.push({ key: "summary", label: t("admin:pay_tab_summary") });
  if (canRoster) tabs.push({ key: "roster", label: t("admin:pay_tab_roster") });
  if (canAttendance) tabs.push({ key: "attendance", label: t("admin:pay_tab_attendance") });
  if (canPay) {
    tabs.push({ key: "advances", label: t("admin:pay_tab_advances") });
    tabs.push({ key: "deductions", label: t("admin:pay_tab_deductions") });
    tabs.push({ key: "tips", label: t("admin:pay_tab_tips") });
    tabs.push({ key: "meals", label: t("admin:pay_tab_meals") });
    tabs.push({ key: "notes", label: t("admin:pay_tab_notes") });
  }
  const active = tabs[Math.min(tab, Math.max(0, tabs.length - 1))]?.key ?? "summary";

  const currency = useQuery({ queryKey: ["settings"], queryFn: () => apiGet<Settings>("/admin/settings") }).data?.restaurant?.currency ?? "USD";
  const money = (major: number | string) => formatMoney(Math.round(Number(major) * 100), currency);
  const range = { from, to };

  const employeesQ = useQuery({ queryKey: ["employees"], queryFn: () => apiGet<{ data: EmployeesData }>("/employees"), enabled: canRoster });
  const employees = employeesQ.data?.data.employees ?? [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["payroll"] });
    setError("");
  };
  const onError = (e: unknown) => setError(errorMessage(e, t));

  const rosterQ = useQuery({
    queryKey: ["payroll", "roster"],
    queryFn: () => apiGet<{ rows: RosterRow[] }>("/payroll/roster"),
    enabled: canRoster,
  });
  const attendanceQ = useQuery({
    queryKey: ["payroll", "attendance", from, to],
    queryFn: () => apiGet<{ rows: AttendanceRow[] }>("/payroll/attendance", range),
    enabled: canAttendance,
  });
  const advancesQ = useQuery({
    queryKey: ["payroll", "advances", from, to],
    queryFn: () => apiGet<{ rows: MoneyRow[] }>("/payroll/advances", range),
    enabled: canPay,
  });
  const deductionsQ = useQuery({
    queryKey: ["payroll", "deductions", from, to],
    queryFn: () => apiGet<{ rows: MoneyRow[] }>("/payroll/deductions", range),
    enabled: canPay,
  });
  const mealsQ = useQuery({
    queryKey: ["payroll", "meals", from, to],
    queryFn: () => apiGet<{ rows: MealRow[] }>("/payroll/meals", range),
    enabled: canPay,
  });
  const tipsQ = useQuery({
    queryKey: ["payroll", "tips", from, to],
    queryFn: () => apiGet<{ rows: TipRow[] }>("/payroll/tips", range),
    enabled: canPay,
  });
  const notesQ = useQuery({
    queryKey: ["payroll", "notes"],
    queryFn: () => apiGet<{ rows: NoteRow[] }>("/payroll/notes"),
    enabled: canPay,
  });
  const summaryQ = useQuery({
    queryKey: ["payroll", "summary", from, to],
    queryFn: () => apiGet<SummaryRow[]>("/payroll/summary", range),
    enabled: canPay,
  });

  const deleteRow = useMutation({
    mutationFn: ({ path, id }: { path: string; id: string }) => apiDel(`/payroll/${path}/${id}`),
    onSuccess: invalidate,
    onError,
  });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t("admin:pay_title")}</h1>
          <p className="muted">{t("admin:pay_hint")}</p>
        </div>
      </div>

      <Paper sx={{ p: 2 }}>
        <Stack direction="row" spacing={2} sx={{ mb: 2, alignItems: "center", flexWrap: "wrap" }}>
          <TextField label={t("admin:pay_from")} type="date" size="small" value={from} onChange={(e) => setFrom(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          <TextField label={t("admin:pay_to")} type="date" size="small" value={to} onChange={(e) => setTo(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
        </Stack>

        {error && <Typography color="error" variant="body2" sx={{ mb: 2 }}>{error}</Typography>}

        <Tabs value={Math.min(tab, Math.max(0, tabs.length - 1))} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto" sx={{ mb: 2 }}>
          {tabs.map((tb) => <Tab key={tb.key} label={tb.label} />)}
        </Tabs>

        {active === "summary" && canPay && (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t("admin:pay_col_name")}</TableCell>
                  <TableCell align="right">{t("admin:pay_col_days")}</TableCell>
                  <TableCell align="right">{t("admin:pay_col_hours")}</TableCell>
                  <TableCell align="right">{t("admin:pay_col_base")}</TableCell>
                  <TableCell align="right">{t("admin:pay_col_tips")}</TableCell>
                  <TableCell align="right">{t("admin:pay_col_advance")}</TableCell>
                  <TableCell align="right">{t("admin:pay_col_deduction")}</TableCell>
                  <TableCell align="right">{t("admin:pay_col_total")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(summaryQ.data ?? []).map((r) => (
                  <TableRow key={r.employeeId}>
                    <TableCell>{r.name}<div className="muted small">{r.payType ?? "—"} · {money(r.rate)}</div></TableCell>
                    <TableCell align="right">{r.daysWorked}</TableCell>
                    <TableCell align="right">{r.hours}</TableCell>
                    <TableCell align="right">{money(r.base)}</TableCell>
                    <TableCell align="right">{money(r.tip)}</TableCell>
                    <TableCell align="right">-{money(r.advance)}</TableCell>
                    <TableCell align="right">-{money(r.deduction + r.mealCost)}</TableCell>
                    <TableCell align="right"><strong>{money(r.totalOwed)}</strong></TableCell>
                  </TableRow>
                ))}
                {(summaryQ.data ?? []).length === 0 && (
                  <TableRow><TableCell colSpan={8} className="muted">{t("admin:pay_none")}</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {active === "roster" && canRoster && (
          <RosterPanel rows={rosterQ.data?.rows ?? []} employees={employees} canManage={canManage} invalidate={invalidate} onError={onError} t={t} del={(id) => deleteRow.mutate({ path: "roster", id })} />
        )}

        {active === "attendance" && canAttendance && (
          <AttendancePanel rows={attendanceQ.data?.rows ?? []} canEdit={can("attendance.edit")} invalidate={invalidate} onError={onError} t={t} />
        )}

        {active === "advances" && canPay && (
          <MoneyPanel path="advances" title={t("admin:pay_tab_advances")} rows={advancesQ.data?.rows ?? []} employees={employees} canManage={canManage} from={from} invalidate={invalidate} onError={onError} t={t} del={(id) => deleteRow.mutate({ path: "advances", id })} />
        )}

        {active === "deductions" && canPay && (
          <MoneyPanel path="deductions" title={t("admin:pay_tab_deductions")} rows={deductionsQ.data?.rows ?? []} employees={employees} canManage={canManage} from={from} invalidate={invalidate} onError={onError} t={t} del={(id) => deleteRow.mutate({ path: "deductions", id })} />
        )}

        {active === "tips" && canPay && (
          <TipsPanel rows={tipsQ.data?.rows ?? []} employees={employees} canManage={canManage} from={from} money={money} invalidate={invalidate} onError={onError} t={t} />
        )}

        {active === "meals" && canPay && (
          <MealsPanel rows={mealsQ.data?.rows ?? []} employees={employees} canManage={canManage} from={from} money={money} invalidate={invalidate} onError={onError} t={t} del={(id) => deleteRow.mutate({ path: "meals", id })} />
        )}

        {active === "notes" && canPay && (
          <NotesPanel rows={notesQ.data?.rows ?? []} employees={employees} canManage={canManage} invalidate={invalidate} onError={onError} t={t} />
        )}
      </Paper>
    </div>
  );
}

type TFunc = (key: string) => string;

function RosterPanel({ rows, employees, canManage, invalidate, onError, t, del }: {
  rows: RosterRow[]; employees: EmployeeRef[]; canManage: boolean;
  invalidate: () => void; onError: (e: unknown) => void; t: TFunc; del: (id: string) => void;
}) {
  const [employeeId, setEmployeeId] = useState("");
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [shift, setShift] = useState<Shift>("MORNING");
  const save = useMutation({
    mutationFn: () => apiPost("/payroll/roster", { employeeId, dayOfWeek, shift }),
    onSuccess: invalidate, onError,
  });
  const copy = useMutation({ mutationFn: () => apiPost("/payroll/roster/copy"), onSuccess: invalidate, onError });

  return (
    <div>
      {canManage && (
        <Stack direction="row" spacing={1} sx={{ mb: 2, alignItems: "center", flexWrap: "wrap" }}>
          <TextField select label={t("admin:pay_employee")} size="small" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} sx={{ minWidth: 160 }}>
            {employees.map((e) => <MenuItem key={e.id} value={e.id}>{e.firstName} {e.lastName ?? ""}</MenuItem>)}
          </TextField>
          <TextField select label={t("admin:pay_day")} size="small" value={dayOfWeek} onChange={(e) => setDayOfWeek(Number(e.target.value))} sx={{ minWidth: 110 }}>
            {DAYS.map((d, i) => <MenuItem key={d} value={i}>{d}</MenuItem>)}
          </TextField>
          <TextField select label={t("admin:pay_shift")} size="small" value={shift} onChange={(e) => setShift(e.target.value as Shift)} sx={{ minWidth: 130 }}>
            {(["MORNING", "EVENING", "NIGHT"] as Shift[]).map((s) => <MenuItem key={s} value={s}>{t(`admin:pay_shift_${s.toLowerCase()}`)}</MenuItem>)}
          </TextField>
          <Button variant="contained" disabled={!employeeId} onClick={() => save.mutate()}>{t("admin:pay_add")}</Button>
          <Button variant="outlined" onClick={() => copy.mutate()}>{t("admin:pay_copy_week")}</Button>
        </Stack>
      )}
      <TableContainer>
        <Table size="small">
          <TableHead><TableRow>
            <TableCell>{t("admin:pay_employee")}</TableCell><TableCell>{t("admin:pay_day")}</TableCell><TableCell>{t("admin:pay_shift")}</TableCell><TableCell>{t("admin:pay_position")}</TableCell><TableCell />
          </TableRow></TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{nameOfLocal(employees, r.employeeId)}</TableCell>
                <TableCell>{DAYS[r.dayOfWeek]}</TableCell>
                <TableCell><Chip size="small" label={t(`admin:pay_shift_${r.shift.toLowerCase()}`)} /></TableCell>
                <TableCell>{r.position ?? "—"}</TableCell>
                <TableCell align="right">{canManage && <Button size="small" color="error" onClick={() => del(r.id)}>{t("admin:pay_delete")}</Button>}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={5} className="muted">{t("admin:pay_none")}</TableCell></TableRow>}
          </TableBody>
        </Table>
      </TableContainer>
    </div>
  );
}

function AttendancePanel({ rows, canEdit, invalidate, onError, t }: {
  rows: AttendanceRow[]; canEdit: boolean; invalidate: () => void; onError: (e: unknown) => void; t: TFunc;
}) {
  const [pin, setPin] = useState("");
  const clock = useMutation({
    mutationFn: (action: "in" | "out") => apiPost(`/payroll/attendance/clock-${action}`, { pin }),
    onSuccess: () => { setPin(""); invalidate(); }, onError,
  });
  return (
    <div>
      {canEdit && (
        <Stack direction="row" spacing={1} sx={{ mb: 2, alignItems: "center" }}>
          <TextField label={t("admin:pay_pin")} size="small" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} type="password" sx={{ maxWidth: 160 }} />
          <Button variant="contained" disabled={!/^\d{4,6}$/.test(pin)} onClick={() => clock.mutate("in")}>{t("admin:pay_clock_in")}</Button>
          <Button variant="outlined" disabled={!/^\d{4,6}$/.test(pin)} onClick={() => clock.mutate("out")}>{t("admin:pay_clock_out")}</Button>
        </Stack>
      )}
      <TableContainer>
        <Table size="small">
          <TableHead><TableRow>
            <TableCell>{t("admin:pay_employee")}</TableCell><TableCell>{t("admin:pay_day")}</TableCell>
            <TableCell>{t("admin:pay_clock_in")}</TableCell><TableCell>{t("admin:pay_clock_out")}</TableCell>
            <TableCell align="right">{t("admin:pay_late")}</TableCell><TableCell align="right">{t("admin:pay_early")}</TableCell>
            <TableCell>{t("admin:pay_source")}</TableCell>
          </TableRow></TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{name(r)}</TableCell>
                <TableCell className="small muted">{new Date(r.businessDate).toLocaleDateString()}</TableCell>
                <TableCell className="small">{new Date(r.clockIn).toLocaleString()}</TableCell>
                <TableCell className="small">{r.clockOut ? new Date(r.clockOut).toLocaleTimeString() : "—"}</TableCell>
                <TableCell align="right">{r.lateMinutes}</TableCell>
                <TableCell align="right">{r.earlyMinutes}</TableCell>
                <TableCell>{r.method === "MANUAL" ? <Chip size="small" color="warning" label={t("admin:pay_corrected")} /> : "PIN"}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={7} className="muted">{t("admin:pay_none")}</TableCell></TableRow>}
          </TableBody>
        </Table>
      </TableContainer>
    </div>
  );
}

function MoneyPanel({ path, title, rows, employees, canManage, from, invalidate, onError, t, del }: {
  path: "advances" | "deductions"; title: string; rows: MoneyRow[]; employees: EmployeeRef[]; canManage: boolean;
  from: string; invalidate: () => void; onError: (e: unknown) => void; t: TFunc; del: (id: string) => void;
}) {
  const [employeeId, setEmployeeId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const save = useMutation({
    mutationFn: () => apiPost(`/payroll/${path}`, { employeeId, date: from, amount: Number(amount), reason: reason || undefined }),
    onSuccess: () => { setAmount(""); setReason(""); invalidate(); }, onError,
  });
  return (
    <div>
      {canManage && (
        <Stack direction="row" spacing={1} sx={{ mb: 2, alignItems: "center", flexWrap: "wrap" }}>
          <TextField select label={t("admin:pay_employee")} size="small" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} sx={{ minWidth: 150 }}>
            {employees.map((e) => <MenuItem key={e.id} value={e.id}>{e.firstName} {e.lastName ?? ""}</MenuItem>)}
          </TextField>
          <TextField label={t("admin:pay_amount")} type="number" size="small" value={amount} onChange={(e) => setAmount(e.target.value)} sx={{ width: 120 }} />
          <TextField label={t("admin:pay_reason")} size="small" value={reason} onChange={(e) => setReason(e.target.value)} sx={{ minWidth: 180 }} />
          <Button variant="contained" disabled={!employeeId || !(Number(amount) > 0)} onClick={() => save.mutate()}>{t("admin:pay_add")}</Button>
        </Stack>
      )}
      <Typography variant="subtitle2" sx={{ mb: 1 }}>{title}</Typography>
      <TableContainer>
        <Table size="small">
          <TableHead><TableRow>
            <TableCell>{t("admin:pay_day")}</TableCell><TableCell>{t("admin:pay_employee")}</TableCell>
            <TableCell align="right">{t("admin:pay_amount")}</TableCell><TableCell>{t("admin:pay_reason")}</TableCell>
            <TableCell>{t("admin:pay_acknowledged")}</TableCell><TableCell />
          </TableRow></TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="small">{new Date(r.businessDate).toLocaleDateString()}</TableCell>
                <TableCell>{r.employee?.firstName} {r.employee?.lastName ?? ""}</TableCell>
                <TableCell align="right">{Number(r.amount).toFixed(2)}</TableCell>
                <TableCell className="small muted">{r.reason ?? "—"}</TableCell>
                <TableCell>{r.acknowledged ? <Chip size="small" color="success" label={t("admin:pay_yes")} /> : "—"}</TableCell>
                <TableCell align="right">{canManage && <Button size="small" color="error" onClick={() => del(r.id)}>{t("admin:pay_delete")}</Button>}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={6} className="muted">{t("admin:pay_none")}</TableCell></TableRow>}
          </TableBody>
        </Table>
      </TableContainer>
    </div>
  );
}

function TipsPanel({ rows, employees, canManage, from, money, invalidate, onError, t }: {
  rows: TipRow[]; employees: EmployeeRef[]; canManage: boolean; from: string;
  money: (v: number | string) => string; invalidate: () => void; onError: (e: unknown) => void; t: TFunc;
}) {
  const [date, setDate] = useState(from);
  const [tipAmount, setTipAmount] = useState("");
  const [serviceCharge, setServiceCharge] = useState("");
  const [rule, setRule] = useState<TipRule>("EQUAL");
  const save = useMutation({
    mutationFn: () => apiPost("/payroll/tips", { date, tipAmount: Number(tipAmount), serviceCharge: Number(serviceCharge || 0), rule }),
    onSuccess: () => { setTipAmount(""); setServiceCharge(""); invalidate(); }, onError,
  });
  return (
    <div>
      {canManage && (
        <Stack direction="row" spacing={1} sx={{ mb: 2, alignItems: "center", flexWrap: "wrap" }}>
          <TextField label={t("admin:pay_day")} type="date" size="small" value={date} onChange={(e) => setDate(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          <TextField label={t("admin:pay_tips_amount")} type="number" size="small" value={tipAmount} onChange={(e) => setTipAmount(e.target.value)} sx={{ width: 130 }} />
          <TextField label={t("admin:pay_service_charge")} type="number" size="small" value={serviceCharge} onChange={(e) => setServiceCharge(e.target.value)} sx={{ width: 150 }} />
          <TextField select label={t("admin:pay_rule")} size="small" value={rule} onChange={(e) => setRule(e.target.value as TipRule)} sx={{ minWidth: 140 }}>
            {(["EQUAL", "HOURS", "POINTS"] as TipRule[]).map((r) => <MenuItem key={r} value={r}>{t(`admin:pay_rule_${r.toLowerCase()}`)}</MenuItem>)}
          </TextField>
          <Button variant="contained" disabled={!(Number(tipAmount) > 0)} onClick={() => save.mutate()}>{t("admin:pay_save_tips")}</Button>
        </Stack>
      )}
      <TableContainer>
        <Table size="small">
          <TableHead><TableRow>
            <TableCell>{t("admin:pay_day")}</TableCell><TableCell align="right">{t("admin:pay_tips_amount")}</TableCell>
            <TableCell align="right">{t("admin:pay_service_charge")}</TableCell><TableCell>{t("admin:pay_rule")}</TableCell><TableCell>{t("admin:pay_split")}</TableCell>
          </TableRow></TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="small">{new Date(r.businessDate).toLocaleDateString()}</TableCell>
                <TableCell align="right">{money(r.tipAmount)}</TableCell>
                <TableCell align="right">{money(r.serviceCharge)}</TableCell>
                <TableCell>{t(`admin:pay_rule_${r.rule.toLowerCase()}`)}</TableCell>
                <TableCell className="small muted">
                  {(r.allocations ?? []).map((a) => `${nameOfLocal(employees, a.employeeId)}: ${money(a.amount)}`).join(" · ")}
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={5} className="muted">{t("admin:pay_none")}</TableCell></TableRow>}
          </TableBody>
        </Table>
      </TableContainer>
    </div>
  );
}

function MealsPanel({ rows, employees, canManage, from, money, invalidate, onError, t, del }: {
  rows: MealRow[]; employees: EmployeeRef[]; canManage: boolean; from: string;
  money: (v: number | string) => string; invalidate: () => void; onError: (e: unknown) => void; t: TFunc; del: (id: string) => void;
}) {
  const [employeeId, setEmployeeId] = useState("");
  const [count, setCount] = useState("1");
  const [cost, setCost] = useState("");
  const save = useMutation({
    mutationFn: () => apiPost("/payroll/meals", { employeeId, date: from, count: Number(count), cost: cost ? Number(cost) : undefined }),
    onSuccess: () => { setCount("1"); setCost(""); invalidate(); }, onError,
  });
  return (
    <div>
      {canManage && (
        <Stack direction="row" spacing={1} sx={{ mb: 2, alignItems: "center", flexWrap: "wrap" }}>
          <TextField select label={t("admin:pay_employee")} size="small" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} sx={{ minWidth: 150 }}>
            {employees.map((e) => <MenuItem key={e.id} value={e.id}>{e.firstName} {e.lastName ?? ""}</MenuItem>)}
          </TextField>
          <TextField label={t("admin:pay_count")} type="number" size="small" value={count} onChange={(e) => setCount(e.target.value)} sx={{ width: 100 }} />
          <TextField label={t("admin:pay_cost")} type="number" size="small" value={cost} onChange={(e) => setCost(e.target.value)} sx={{ width: 120 }} />
          <Button variant="contained" disabled={!employeeId} onClick={() => save.mutate()}>{t("admin:pay_add")}</Button>
        </Stack>
      )}
      <TableContainer>
        <Table size="small">
          <TableHead><TableRow>
            <TableCell>{t("admin:pay_day")}</TableCell><TableCell>{t("admin:pay_employee")}</TableCell>
            <TableCell align="right">{t("admin:pay_count")}</TableCell><TableCell align="right">{t("admin:pay_cost")}</TableCell>
            <TableCell>{t("admin:pay_reason")}</TableCell><TableCell />
          </TableRow></TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="small">{new Date(r.businessDate).toLocaleDateString()}</TableCell>
                <TableCell>{r.employee?.firstName} {r.employee?.lastName ?? ""}</TableCell>
                <TableCell align="right">{r.count}</TableCell>
                <TableCell align="right">{r.cost == null ? "—" : money(r.cost)}</TableCell>
                <TableCell className="small muted">{r.note ?? "—"}</TableCell>
                <TableCell align="right">{canManage && <Button size="small" color="error" onClick={() => del(r.id)}>{t("admin:pay_delete")}</Button>}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={6} className="muted">{t("admin:pay_none")}</TableCell></TableRow>}
          </TableBody>
        </Table>
      </TableContainer>
    </div>
  );
}

function NotesPanel({ rows, employees, canManage, invalidate, onError, t }: {
  rows: NoteRow[]; employees: EmployeeRef[]; canManage: boolean;
  invalidate: () => void; onError: (e: unknown) => void; t: TFunc;
}) {
  const [employeeId, setEmployeeId] = useState("");
  const [note, setNote] = useState("");
  const save = useMutation({
    mutationFn: () => apiPost("/payroll/notes", { employeeId, note }),
    onSuccess: () => { setNote(""); invalidate(); }, onError,
  });
  return (
    <div>
      {canManage && (
        <Box sx={{ mb: 2 }}>
          <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: "center", flexWrap: "wrap" }}>
            <TextField select label={t("admin:pay_employee")} size="small" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} sx={{ minWidth: 160 }}>
              {employees.map((e) => <MenuItem key={e.id} value={e.id}>{e.firstName} {e.lastName ?? ""}</MenuItem>)}
            </TextField>
            <Button variant="contained" disabled={!employeeId || note.trim().length < 2} onClick={() => save.mutate()}>{t("admin:pay_add")}</Button>
          </Stack>
          <TextField label={t("admin:pay_note")} multiline minRows={2} fullWidth value={note} onChange={(e) => setNote(e.target.value)} />
        </Box>
      )}
      <TableContainer>
        <Table size="small">
          <TableHead><TableRow>
            <TableCell>{t("admin:pay_day")}</TableCell><TableCell>{t("admin:pay_employee")}</TableCell><TableCell>{t("admin:pay_note")}</TableCell>
          </TableRow></TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="small">{new Date(r.createdAt).toLocaleString()}</TableCell>
                <TableCell>{nameOfLocal(employees, r.employeeId)}</TableCell>
                <TableCell className="small">{r.note}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={3} className="muted">{t("admin:pay_none")}</TableCell></TableRow>}
          </TableBody>
        </Table>
      </TableContainer>
    </div>
  );
}

function nameOfLocal(employees: EmployeeRef[], id: string) {
  const e = employees.find((x) => x.id === id);
  return e ? `${e.firstName} ${e.lastName ?? ""}`.trim() : id.slice(0, 8);
}
function name(r: AttendanceRow) {
  return `${r.employee.firstName} ${r.employee.lastName ?? ""}`.trim();
}
