import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
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
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import { useTranslation } from "react-i18next";
import { apiGet, apiPut, apiDel } from "../../lib/api";
import { errorMessage } from "../../lib/errors";

interface Envelope<T> {
  success: boolean;
  message: string;
  data: T;
}

interface RoleRow {
  role: string;
  customised: boolean;
  granted: string[];
  defaults: string[];
}

interface RolesData {
  roles: RoleRow[];
  capabilities: string[];
}

interface ApprovalLimit {
  role: string;
  action: string;
  maxAmount: number | null;
}

const ROLE_COLORS: Record<string, "error" | "warning" | "info" | "success" | "default"> = {
  OWNER: "error",
  ADMIN: "error",
  MANAGER: "warning",
  CASHIER: "info",
  WAITER: "success",
  KITCHEN: "default",
};

const ACTIONS = ["DISCOUNT", "VOID", "REFUND", "COMP", "PRIORITY"] as const;

/** Owner-editable capability matrix and per-role approval money limits. */
export default function RolesAdmin() {
  const { t } = useTranslation(["users", "admin", "common"]);
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const { data, isLoading, error: loadError } = useQuery({
    queryKey: ["admin", "roles"],
    queryFn: () => apiGet<Envelope<RolesData>>("/admin/roles"),
  });

  const { data: limitsData } = useQuery({
    queryKey: ["admin", "approval-limits"],
    queryFn: () => apiGet<Envelope<{ limits: ApprovalLimit[] }>>("/approvals/limits"),
  });

  useEffect(() => {
    if (!data) return;
    const next: Record<string, string[]> = {};
    for (const r of data.data.roles) next[r.role] = [...r.granted];
    setDraft(next);
  }, [data]);

  useEffect(() => {
    if (!limitsData) return;
    const next: Record<string, string> = {};
    for (const l of limitsData.data.limits) next[`${l.role}:${l.action}`] = l.maxAmount == null ? "" : String(l.maxAmount);
    setLimits(next);
  }, [limitsData]);

  const saveRole = useMutation({
    mutationFn: ({ role, capabilities }: { role: string; capabilities: string[] }) => apiPut(`/admin/roles/${role}`, { capabilities }),
    onSuccess: (_res, vars) => {
      setSaved(`${vars.role}`);
      setError("");
      qc.invalidateQueries({ queryKey: ["admin", "roles"] });
    },
    onError: (e) => setError(errorMessage(e, t)),
  });

  const resetRole = useMutation({
    mutationFn: (role: string) => apiDel(`/admin/roles/${role}`),
    onSuccess: (_res, role) => {
      setSaved(role);
      setError("");
      qc.invalidateQueries({ queryKey: ["admin", "roles"] });
    },
    onError: (e) => setError(errorMessage(e, t)),
  });

  const saveLimits = useMutation({
    mutationFn: () => {
      const roles = (data?.data.roles ?? []).map((r) => r.role);
      const payload: ApprovalLimit[] = [];
      for (const role of roles) {
        for (const action of ACTIONS) {
          const raw = limits[`${role}:${action}`];
          if (raw !== undefined) {
            payload.push({ role, action, maxAmount: raw === "" ? null : Number(raw) });
          }
        }
      }
      return apiPut("/admin/approval-limits", { limits: payload });
    },
    onSuccess: () => {
      setSaved("limits");
      setError("");
      qc.invalidateQueries({ queryKey: ["admin", "approval-limits"] });
    },
    onError: (e) => setError(errorMessage(e, t)),
  });

  function toggle(role: string, cap: string) {
    setDraft((cur) => {
      const has = (cur[role] ?? []).includes(cap);
      return {
        ...cur,
        [role]: has ? (cur[role] ?? []).filter((c) => c !== cap) : [...(cur[role] ?? []), cap],
      };
    });
  }

  const roles = data?.data.roles ?? [];
  const capabilities = data?.data.capabilities ?? [];

  return (
    <Stack spacing={2}>
      <Typography variant="h5">{t("users:roles_title", { defaultValue: "Roles & permissions" })}</Typography>
      <Alert severity="info">
        {t("users:roles_hint", {
          defaultValue: "Tick what each role may do. Changes take effect at the next sign-in or permission refresh. Deleting a role's rows restores the built-in defaults.",
        })}
      </Alert>
      {loadError && <Alert severity="error">{t("users:failed_to_load_users")}</Alert>}
      {error && <Alert severity="error" onClose={() => setError("")}>{error}</Alert>}
      {saved && <Alert severity="success" onClose={() => setSaved("")}>{t("users:saved", { defaultValue: "Saved" })}: {saved}</Alert>}

      {isLoading && <SkeletonRows />}

      {!isLoading && (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ minWidth: 180 }}>{t("users:capability", { defaultValue: "Capability" })}</TableCell>
                {roles.map((r) => (
                  <TableCell key={r.role} align="center" sx={{ minWidth: 110 }}>
                    <Stack spacing={0.5} sx={{ alignItems: "center" }}>
                      <Chip size="small" label={t(`admin:role_${r.role.toLowerCase()}`, { defaultValue: r.role })} color={ROLE_COLORS[r.role] ?? "default"} variant="outlined" />
                      {r.customised && (
                        <Button size="small" startIcon={<RestartAltIcon />} onClick={() => resetRole.mutate(r.role)} disabled={resetRole.isPending}>
                          {t("users:reset_default", { defaultValue: "Reset" })}
                        </Button>
                      )}
                    </Stack>
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {capabilities.map((cap) => (
                <TableRow key={cap} hover>
                  <TableCell sx={{ fontFamily: "monospace", fontSize: 13 }}>{cap}</TableCell>
                  {roles.map((r) => {
                    const on = (draft[r.role] ?? []).includes(cap);
                    const isDefault = r.defaults.includes(cap);
                    return (
                      <TableCell key={r.role} align="center">
                        <Button
                          size="small"
                          color={on ? "success" : "inherit"}
                          onClick={() => toggle(r.role, cap)}
                          startIcon={on ? <CheckCircleIcon /> : <RadioButtonUncheckedIcon />}
                          sx={{ textTransform: "none" }}
                        >
                          {on ? t("users:on", { defaultValue: "On" }) : t("users:off", { defaultValue: "Off" })}
                          {!on && isDefault && " *"}
                        </Button>
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {!isLoading && roles.length > 0 && (
        <Stack direction="row" spacing={1.5} sx={{ flexWrap: "wrap", gap: 1 }}>
          {roles.map((r) => (
            <Button
              key={r.role}
              variant="outlined"
              disabled={saveRole.isPending}
              onClick={() => saveRole.mutate({ role: r.role, capabilities: draft[r.role] ?? [] })}
            >
              {t("users:save_role", { defaultValue: "Save" })} {t(`admin:role_${r.role.toLowerCase()}`, { defaultValue: r.role })}
            </Button>
          ))}
        </Stack>
      )}

      <Divider sx={{ my: 2 }} />

      <Typography variant="h6">{t("users:approval_limits_title", { defaultValue: "Approval limits" })}</Typography>
      <Alert severity="info">
        {t("users:approval_limits_hint", {
          defaultValue: "Maximum amount a role may approve without a higher authority. Leave blank for unlimited. Applies to discounts, voids, refunds, comps and priority changes.",
        })}
      </Alert>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>{t("users:role")}</TableCell>
              {ACTIONS.map((a) => (
                <TableCell key={a}>{t(`users:approval_action_${a.toLowerCase()}`, { defaultValue: a })}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {roles.map((r) => (
              <TableRow key={r.role}>
                <TableCell sx={{ fontWeight: 600 }}>{t(`admin:role_${r.role.toLowerCase()}`, { defaultValue: r.role })}</TableCell>
                {ACTIONS.map((a) => {
                  const key = `${r.role}:${a}`;
                  return (
                    <TableCell key={a}>
                      <TextField
                        size="small"
                        type="number"
                        value={limits[key] ?? ""}
                        placeholder={t("users:unlimited", { defaultValue: "∞" })}
                        onChange={(e) => setLimits((cur) => ({ ...cur, [key]: e.target.value }))}
                        sx={{ width: 100 }}
                      />
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Box>
        <Button variant="contained" disabled={saveLimits.isPending} onClick={() => saveLimits.mutate()}>
          {saveLimits.isPending ? <CircularProgress size={18} color="inherit" /> : t("users:save_approval_limits", { defaultValue: "Save limits" })}
        </Button>
      </Box>
    </Stack>
  );
}

function SkeletonRows() {
  return (
    <Stack spacing={1}>
      {Array.from({ length: 6 }).map((_, i) => (
        <Box key={i} sx={{ height: 40, bgcolor: "action.hover", borderRadius: 1 }} />
      ))}
    </Stack>
  );
}
