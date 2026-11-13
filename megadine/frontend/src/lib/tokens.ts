// Single source of truth for colours, spacing, radius and sizes.
// The plain-CSS screens (POS / floor / KDS) read these as CSS variables that
// index.css declares; the MUI back office reads the same values through theme.ts.
export const SYSTEM_FONTS =
  "'Segoe UI','Noto Sans Myanmar UI','Leelawadee UI','Noto Sans Thai UI','Noto Sans','Meiryo','Yu Gothic UI','Microsoft YaHei','PingFang SC','Helvetica Neue',Arial,sans-serif";
export const HEAD_FONTS = '"Fraunces", Georgia, serif';

export const tokens = {
  color: {
    primary: "#6f4e37",
    primaryLight: "#9c7b5c",
    primaryDark: "#4a3228",
    brand: "#10b981",
    brandDark: "#047857",

    ok: "#10b981",
    warn: "#f59e0b",
    danger: "#ef4444",
    info: "#3b82f6",
    successLight: "#d1fae5",
    warningLight: "#fef3c7",
    errorLight: "#fee2e2",
    infoLight: "#dbeafe",

    bg: "#fafaf5",
    panel: "#ffffff",
    panel2: "#f5f1ea",
    line: "#e8e8e3",
    text: "#272725",
    textSecondary: "#525250",
    muted: "#737370",
    disabled: "#a3a39e",

    tableAvailable: "#10b981",
    tableOccupied: "#f59e0b",
    tableNeedsBill: "#ef4444",
    tableNeedsCleaning: "#8b5cf6",
    tableReserved: "#3b82f6",
    tableOutOfService: "#6b7280",

    kdsFast: "#10b981",
    kdsNormal: "#f59e0b",
    kdsSlow: "#f97316",
    kdsOverdue: "#ef4444",
  },
  radius: { sm: 8, md: 10, lg: 12 },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20 },
  size: { tap: 44, sidebar: 240, sidebarCollapsed: 68 },
  font: { body: SYSTEM_FONTS, head: HEAD_FONTS },
} as const;

export const cssVariables: Record<string, string> = {
  "--primary": tokens.color.primary,
  "--primary-light": tokens.color.primaryLight,
  "--primary-2": tokens.color.primaryDark,
  "--brand": tokens.color.brand,
  "--brand-2": tokens.color.brandDark,

  "--ok": tokens.color.ok,
  "--warn": tokens.color.warn,
  "--danger": tokens.color.danger,
  "--info": tokens.color.info,
  "--success-light": tokens.color.successLight,
  "--warning-light": tokens.color.warningLight,
  "--error-light": tokens.color.errorLight,
  "--info-light": tokens.color.infoLight,

  "--bg": tokens.color.bg,
  "--panel": tokens.color.panel,
  "--panel-2": tokens.color.panel2,
  "--line": tokens.color.line,
  "--text": tokens.color.text,
  "--muted": tokens.color.muted,
  "--disabled": tokens.color.disabled,

  "--table-available": tokens.color.tableAvailable,
  "--table-occupied": tokens.color.tableOccupied,
  "--table-needs-bill": tokens.color.tableNeedsBill,
  "--table-needs-cleaning": tokens.color.tableNeedsCleaning,
  "--table-reserved": tokens.color.tableReserved,
  "--table-out-of-service": tokens.color.tableOutOfService,

  "--kds-fast": tokens.color.kdsFast,
  "--kds-normal": tokens.color.kdsNormal,
  "--kds-slow": tokens.color.kdsSlow,
  "--kds-overdue": tokens.color.kdsOverdue,

  "--radius": `${tokens.radius.lg}px`,
  "--radius-sm": `${tokens.radius.sm}px`,
  "--space-xs": `${tokens.space.xs}px`,
  "--space-sm": `${tokens.space.sm}px`,
  "--space-md": `${tokens.space.md}px`,
  "--space-lg": `${tokens.space.lg}px`,
  "--space-xl": `${tokens.space.xl}px`,
  "--tap-size": `${tokens.size.tap}px`,
  "--shadow": "0 1px 2px rgba(39, 39, 37, 0.06), 0 1px 3px rgba(39, 39, 37, 0.04)",
};

/** Publish the tokens as CSS variables for the plain-CSS screens. */
export function applyTokens() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const [name, value] of Object.entries(cssVariables)) root.style.setProperty(name, value);
}
