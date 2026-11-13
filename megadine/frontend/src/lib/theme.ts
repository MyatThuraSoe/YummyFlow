import { createTheme } from "@mui/material";
import { HEAD_FONTS, SYSTEM_FONTS, tokens } from "./tokens";

const SYSTEM_FONTS_STACK = SYSTEM_FONTS;
const HEAD = HEAD_FONTS;

export const theme = createTheme({
  palette: {
    primary: { main: tokens.color.primary, light: tokens.color.primaryLight, dark: tokens.color.primaryDark },
    secondary: { main: tokens.color.brand, light: "#6EE7B7", dark: tokens.color.brandDark },
    error: { main: tokens.color.danger, light: tokens.color.errorLight, dark: "#DC2626" },
    warning: { main: tokens.color.warn, light: tokens.color.warningLight, dark: "#D97706" },
    info: { main: tokens.color.info, light: tokens.color.infoLight, dark: "#2563EB" },
    success: { main: tokens.color.ok, light: tokens.color.successLight, dark: tokens.color.brandDark },
    background: { default: tokens.color.bg, paper: tokens.color.panel },
    text: { primary: tokens.color.text, secondary: tokens.color.textSecondary, disabled: tokens.color.disabled },
    divider: tokens.color.line,
    action: {
      hover: "rgba(111, 78, 55, 0.08)",
      selected: "rgba(111, 78, 55, 0.12)",
      disabled: "rgba(39, 39, 37, 0.38)",
      disabledBackground: "rgba(39, 39, 37, 0.12)",
    },
  },
  typography: {
    fontFamily: SYSTEM_FONTS_STACK,
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
