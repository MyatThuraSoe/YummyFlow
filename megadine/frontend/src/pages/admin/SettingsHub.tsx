import type { ReactElement } from "react";
import { Box, Card, CardActionArea, Grid, Stack, Typography } from "@mui/material";
import {
  Backup as BackupIcon,
  Info as InfoIcon,
  Language as LanguageIcon,
  ReceiptLong as ReceiptIcon,
  Storefront as StoreIcon,
  Tune as TuneIcon,
  VpnKey as VpnKeyIcon,
} from "@mui/icons-material";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

interface HubCard {
  to?: string;
  icon: ReactElement;
  title: string;
  description: string;
  extra?: ReactElement;
}

export default function SettingsHub() {
  const { t } = useTranslation(["settings", "nav", "admin"]);
  const nav = useNavigate();

  const cards: HubCard[] = [
    { to: "/admin/shop-info", icon: <StoreIcon color="primary" />, title: t("settings:shop_info"), description: t("admin:hub_shop_desc") },
    { to: "/admin/settings/system", icon: <TuneIcon color="primary" />, title: t("settings:system"), description: t("admin:hub_system_desc") },
    { to: "/admin/receipt-customization", icon: <ReceiptIcon color="primary" />, title: t("settings:receipt"), description: t("admin:hub_receipt_desc") },
    { to: "/admin/backup", icon: <BackupIcon color="primary" />, title: t("settings:backup"), description: t("admin:hub_backup_desc") },
    { to: "/admin/license", icon: <VpnKeyIcon color="primary" />, title: t("settings:license"), description: t("admin:hub_license_desc") },
    { to: "/admin/settings/language", icon: <LanguageIcon color="primary" />, title: t("settings:language"), description: t("admin:hub_language_desc") },
    { to: "/admin/about", icon: <InfoIcon color="primary" />, title: t("nav:about"), description: t("admin:hub_about_desc") },
  ];

  return (
    <Stack spacing={2}>
      <Typography variant="h5">{t("settings:title")}</Typography>
      <Grid container spacing={2}>
        {cards.map((card) => (
          <Grid key={card.title} size={{ xs: 12, sm: 6, md: 4 }}>
            <Card variant="outlined" sx={{ height: "100%" }}>
              <CardActionArea
                onClick={() => card.to && nav(card.to)}
                disabled={!card.to}
                sx={{ p: 2.5, height: "100%", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1 }}
              >
                <Box>{card.icon}</Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                  {card.title}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {card.description}
                </Typography>
                {card.extra}
              </CardActionArea>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Stack>
  );
}
