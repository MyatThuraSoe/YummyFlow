import { useState } from "react";
import { Box, Button, Paper, Stack, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiGet } from "../../lib/api";
import { version } from "../../../package.json";

interface Envelope<T> {
  success: boolean;
  message: string;
  data: T;
}

interface LicenseStatus {
  machineId: string;
  edition: string;
  licensed: boolean;
}

export default function About() {
  const { t } = useTranslation(["nav", "common", "admin"]);
  const [copied, setCopied] = useState(false);
  const lanUrl = window.location.origin;

  const { data } = useQuery({
    queryKey: ["license", "status"],
    queryFn: () => apiGet<Envelope<LicenseStatus>>("/license/status"),
    staleTime: 60_000,
  });

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(lanUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Stack spacing={2.5} sx={{ maxWidth: 620 }}>
      <Typography variant="h5">{t("nav:about")}</Typography>
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
            <Box
              sx={{
                width: 46,
                height: 46,
                borderRadius: 2.5,
                bgcolor: "primary.main",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 800,
              }}
            >
              MD
            </Box>
            <Box>
              <Typography variant="h6">MegaDine</Typography>
              <Typography variant="body2" color="text.secondary">
                v{version}
              </Typography>
            </Box>
          </Stack>
          <InfoRow label={t("admin:abt_edition")} value={data?.data.edition ?? "—"} />
          <InfoRow label={t("admin:abt_machine_id")} value={data?.data.machineId ?? "—"} mono />
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Box sx={{ minWidth: 110 }}>
              <Typography variant="body2" color="text.secondary">
                LAN URL
              </Typography>
            </Box>
            <Typography variant="body2" sx={{ fontFamily: "monospace", wordBreak: "break-all" }}>
              {lanUrl}
            </Typography>
            <Button size="small" onClick={copyUrl}>
              {copied ? t("common:copied") : t("common:copy")}
            </Button>
          </Stack>
        </Stack>
      </Paper>
    </Stack>
  );
}

function InfoRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <Stack direction="row" spacing={1}>
      <Box sx={{ minWidth: 110 }}>
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
      </Box>
      <Typography variant="body2" sx={{ fontFamily: mono ? "monospace" : undefined, wordBreak: "break-all" }}>
        {value}
      </Typography>
    </Stack>
  );
}
