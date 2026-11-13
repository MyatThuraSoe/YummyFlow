import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
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
import { useTranslation } from "react-i18next";
import { apiDel, apiGet, apiPatch, apiPost } from "../../lib/api";
import { useToast } from "../../components/ui";

const STATIONS = ["GRILL", "FRYER", "SALAD", "BAR", "DESSERT", "KITCHEN"];

interface StationPrinter {
  id: string;
  station: string;
  name: string;
  ip: string;
  port: number;
  isActive: boolean;
}

interface PrintJob {
  id: string;
  kind: string;
  station: string | null;
  status: string;
  attempts: number;
  lastError: string | null;
  printerIp: string | null;
  createdAt: string;
  sentAt: string | null;
}

type Draft = { id?: string; station: string; name: string; ip: string; port: string; isActive: boolean };

const emptyDraft: Draft = { station: "KITCHEN", name: "Kitchen printer", ip: "", port: "9100", isActive: true };

/** Per-station printer configuration and the print retry queue (F-14). */
export default function PrintersAdmin() {
  const { t } = useTranslation(["admin", "common", "settings"]);
  const { push } = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [queueFilter, setQueueFilter] = useState("FAILED");

  const printers = useQuery({
    queryKey: ["station-printers"],
    queryFn: () => apiGet<{ printers: StationPrinter[] }>("/admin/printers"),
  });
  const jobs = useQuery({
    queryKey: ["print-jobs", queueFilter],
    queryFn: () => apiGet<{ jobs: PrintJob[] }>("/admin/print-jobs", { status: queueFilter || undefined }),
    refetchInterval: 30_000,
  });

  const save = useMutation({
    mutationFn: (d: Draft) => {
      const body = {
        station: d.station,
        name: d.name,
        ip: d.ip,
        port: Number(d.port) || 9100,
        isActive: d.isActive,
      };
      return d.id ? apiPatch(`/admin/printers/${d.id}`, body) : apiPost("/admin/printers", body);
    },
    onSuccess: () => {
      push(t("admin:printer_saved", { defaultValue: "Printer saved" }), "ok");
      setDraft(null);
      qc.invalidateQueries({ queryKey: ["station-printers"] });
      qc.invalidateQueries({ queryKey: ["hardware-status"] });
    },
    onError: (e) => push(e instanceof Error ? e.message : t("common:error"), "error"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiDel(`/admin/printers/${id}`),
    onSuccess: () => {
      push(t("admin:printer_deleted", { defaultValue: "Printer removed" }), "ok");
      qc.invalidateQueries({ queryKey: ["station-printers"] });
    },
    onError: (e) => push(e instanceof Error ? e.message : t("common:error"), "error"),
  });

  const test = useMutation({
    mutationFn: (station: string) => apiPost(`/admin/hardware/test-print?station=${station}`),
    onSuccess: () => push(t("admin:printer_test_sent", { defaultValue: "Test page sent" }), "ok"),
    onError: (e) => push(e instanceof Error ? e.message : t("common:error"), "error"),
  });

  const resend = useMutation({
    mutationFn: (id: string) => apiPost(`/admin/print-jobs/${id}/reprint`),
    onSuccess: () => {
      push(t("admin:printer_job_resent", { defaultValue: "Job queued again" }), "ok");
      qc.invalidateQueries({ queryKey: ["print-jobs"] });
    },
    onError: (e) => push(e instanceof Error ? e.message : t("common:error"), "error"),
  });

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ alignItems: "center" }}>
        <Typography variant="h5">{t("admin:printers_title", { defaultValue: "Kitchen printers" })}</Typography>
        <Box sx={{ flex: 1 }} />
        <Button variant="contained" onClick={() => setDraft({ ...emptyDraft })}>
          {t("admin:printer_add", { defaultValue: "Add printer" })}
        </Button>
      </Stack>

      <Alert severity="info">
        {t("admin:printers_hint", {
          defaultValue:
            "Each station prints to its own printer. Unconfigured stations fall back to KITCHEN_PRINTER_IP. Failed jobs retry automatically.",
        })}
      </Alert>

      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t("admin:printer_station", { defaultValue: "Station" })}</TableCell>
              <TableCell>{t("admin:printer_name", { defaultValue: "Name" })}</TableCell>
              <TableCell>IP</TableCell>
              <TableCell>{t("admin:printer_port", { defaultValue: "Port" })}</TableCell>
              <TableCell>{t("admin:printer_active", { defaultValue: "Active" })}</TableCell>
              <TableCell align="right">{t("admin:actions", { defaultValue: "Actions" })}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(printers.data?.printers ?? []).map((p) => (
              <TableRow key={p.id}>
                <TableCell>{p.station}</TableCell>
                <TableCell>{p.name}</TableCell>
                <TableCell className="mono">{p.ip}</TableCell>
                <TableCell>{p.port}</TableCell>
                <TableCell>
                  <Chip size="small" label={p.isActive ? "Yes" : "No"} color={p.isActive ? "success" : "default"} />
                </TableCell>
                <TableCell align="right">
                  <Button size="small" onClick={() => test.mutate(p.station)}>
                    {t("admin:printer_test", { defaultValue: "Test" })}
                  </Button>
                  <Button
                    size="small"
                    onClick={() => setDraft({ id: p.id, station: p.station, name: p.name, ip: p.ip, port: String(p.port), isActive: p.isActive })}
                  >
                    {t("common:edit", { defaultValue: "Edit" })}
                  </Button>
                  <Button size="small" color="error" onClick={() => remove.mutate(p.id)}>
                    {t("common:delete", { defaultValue: "Delete" })}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {!printers.data?.printers.length && (
              <TableRow>
                <TableCell colSpan={6}>
                  <Typography variant="body2" color="text.secondary">
                    {t("admin:printers_empty", { defaultValue: "No station printers yet. Add one per kitchen station." })}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
        <Typography variant="h6">{t("admin:print_queue", { defaultValue: "Print queue" })}</Typography>
        <TextField
          select
          size="small"
          value={queueFilter}
          onChange={(e) => setQueueFilter(e.target.value)}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="">{t("admin:print_queue_all", { defaultValue: "All" })}</MenuItem>
          <MenuItem value="FAILED">{t("admin:print_queue_failed", { defaultValue: "Failed" })}</MenuItem>
          <MenuItem value="PENDING">{t("admin:print_queue_pending", { defaultValue: "Pending" })}</MenuItem>
          <MenuItem value="SENT">{t("admin:print_queue_sent", { defaultValue: "Sent" })}</MenuItem>
        </TextField>
      </Stack>

      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t("admin:print_job_created", { defaultValue: "Created" })}</TableCell>
              <TableCell>{t("admin:printer_station", { defaultValue: "Station" })}</TableCell>
              <TableCell>{t("admin:print_job_kind", { defaultValue: "Kind" })}</TableCell>
              <TableCell>{t("admin:print_job_status", { defaultValue: "Status" })}</TableCell>
              <TableCell>{t("admin:print_job_attempts", { defaultValue: "Attempts" })}</TableCell>
              <TableCell>{t("admin:print_job_error", { defaultValue: "Last error" })}</TableCell>
              <TableCell align="right">{t("admin:actions", { defaultValue: "Actions" })}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(jobs.data?.jobs ?? []).map((job) => (
              <TableRow key={job.id}>
                <TableCell>{new Date(job.createdAt).toLocaleString()}</TableCell>
                <TableCell>{job.station ?? "—"}</TableCell>
                <TableCell>{job.kind}</TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={job.status}
                    color={job.status === "SENT" ? "success" : job.status === "FAILED" ? "error" : "warning"}
                  />
                </TableCell>
                <TableCell>{job.attempts}</TableCell>
                <TableCell>{job.lastError ?? "—"}</TableCell>
                <TableCell align="right">
                  <Button size="small" onClick={() => resend.mutate(job.id)}>
                    {t("admin:print_job_resend", { defaultValue: "Resend" })}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {!jobs.data?.jobs.length && (
              <TableRow>
                <TableCell colSpan={7}>
                  <Typography variant="body2" color="text.secondary">
                    {t("admin:print_queue_empty", { defaultValue: "Nothing in this queue." })}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      <Dialog open={!!draft} onClose={() => setDraft(null)} fullWidth maxWidth="sm">
        <DialogTitle>{draft?.id ? t("admin:printer_edit", { defaultValue: "Edit printer" }) : t("admin:printer_add", { defaultValue: "Add printer" })}</DialogTitle>
        <DialogContent>
          {draft && (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField select label={t("admin:printer_station", { defaultValue: "Station" })} value={draft.station} onChange={(e) => setDraft({ ...draft, station: e.target.value })}>
                {STATIONS.map((s) => (
                  <MenuItem key={s} value={s}>
                    {s}
                  </MenuItem>
                ))}
              </TextField>
              <TextField label={t("admin:printer_name", { defaultValue: "Name" })} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              <TextField label="IP" value={draft.ip} onChange={(e) => setDraft({ ...draft, ip: e.target.value })} placeholder="192.168.1.50" />
              <TextField label={t("admin:printer_port", { defaultValue: "Port" })} value={draft.port} onChange={(e) => setDraft({ ...draft, port: e.target.value })} />
              <TextField select label={t("admin:printer_active", { defaultValue: "Active" })} value={draft.isActive ? "yes" : "no"} onChange={(e) => setDraft({ ...draft, isActive: e.target.value === "yes" })}>
                <MenuItem value="yes">{t("common:yes", { defaultValue: "Yes" })}</MenuItem>
                <MenuItem value="no">{t("common:no", { defaultValue: "No" })}</MenuItem>
              </TextField>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDraft(null)}>{t("common:cancel", { defaultValue: "Cancel" })}</Button>
          <Button variant="contained" disabled={!draft?.ip || !draft?.name || save.isPending} onClick={() => draft && save.mutate(draft)}>
            {t("common:save", { defaultValue: "Save" })}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
