import { createTheme } from "@mui/material";

const SYSTEM_FONTS =
  "'Segoe UI','Noto Sans Myanmar UI','Leelawadee UI','Noto Sans Thai UI','Noto Sans','Meiryo','Yu Gothic UI','Microsoft YaHei','PingFang SC','Helvetica Neue',Arial,sans-serif";
const HEAD = '"Fraunces", Georgia, serif';

export const theme = createTheme({
  palette: {
    primary: { main: "#24292F", light: "#4B5563", dark: "#374151" },
    secondary: { main: "#16A34A", light: "#4ADE80", dark: "#15803D" },
    error: { main: "#B23A2E" },
    background: { default: "#FAFAF5", paper: "#FFFFFF" },
    text: { primary: "#24292F", secondary: "#6B7280" },
    divider: "#E3E4DB",
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
        root: { borderRadius: 8, paddingTop: 10, paddingBottom: 10 },
        sizeLarge: { paddingTop: 14, paddingBottom: 14, fontSize: "1rem" },
      },
    },
    MuiChip: { styleOverrides: { root: { borderRadius: 999, fontWeight: 500 } } },
    MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
  },
});

export default theme;
