import { createTheme } from "@mui/material";

const SYSTEM_FONTS =
  "'Segoe UI','Noto Sans Myanmar UI','Leelawadee UI','Noto Sans Thai UI','Noto Sans','Meiryo','Yu Gothic UI','Microsoft YaHei','PingFang SC','Helvetica Neue',Arial,sans-serif";
const HEAD = '"Fraunces", Georgia, serif';

export const theme = createTheme({
  palette: {
    primary: { main: "#6F4E37", light: "#9C7B5C", dark: "#4A3228" },
    secondary: { main: "#10B981", light: "#6EE7B7", dark: "#047857" },
    error: { main: "#EF4444", light: "#FEE2E2", dark: "#DC2626" },
    warning: { main: "#F59E0B", light: "#FEF3C7", dark: "#D97706" },
    info: { main: "#3B82F6", light: "#DBEAFE", dark: "#2563EB" },
    success: { main: "#10B981", light: "#D1FAE5", dark: "#047857" },
    background: { default: "#FAFAF5", paper: "#FFFFFF" },
    text: { primary: "#272725", secondary: "#525250", disabled: "#A3A39E" },
    divider: "#E8E8E3",
    action: {
      hover: "rgba(111, 78, 55, 0.08)",
      selected: "rgba(111, 78, 55, 0.12)",
      disabled: "rgba(39, 39, 37, 0.38)",
      disabledBackground: "rgba(39, 39, 37, 0.12)",
    },
  },
  typography: {
    fontFamily: SYSTEM_FONTS,
    h1: { fontFamily: HEAD, fontWeight: 600 },
    h2: { fontFamily: HEAD, fontWeight: 600 },
    h3: { fontFamily: HEAD, fontWeight: 600 },
    h4: { fontFamily: HEAD, fontWeight: 600 },
    h5: { fontFamily: HEAD, fontWeight: 600 },
    h6: { fontFamily: HEAD, fontWeight: 600 },
    button: { fontFamily: SYSTEM_FONTS, fontWeight: 600, textTransform: "none" },
  },
  shape: { borderRadius: 10 },
  components: {
    MuiDialog: { defaultProps: { fullWidth: true, maxWidth: "sm" } },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          paddingTop: 10,
          paddingBottom: 10,
          transition: "all 0.2s",
          "&.MuiButton-containedPrimary:hover": { backgroundColor: "#4A3228" },
        },
        sizeLarge: { paddingTop: 14, paddingBottom: 14, fontSize: "1rem" },
      },
    },
    MuiCard: { styleOverrides: { root: { border: "1px solid #E8E8E3" } } },
    MuiChip: { styleOverrides: { root: { borderRadius: 999, fontWeight: 500 } } },
    MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
  },
});

export default theme;
