import { createTheme } from "@mui/material";

const SYSTEM_FONTS =
  "'Segoe UI','Noto Sans Myanmar UI','Leelawadee UI','Noto Sans Thai UI','Noto Sans','Meiryo','Yu Gothic UI','Microsoft YaHei','PingFang SC','Helvetica Neue',Arial,sans-serif";
const HEAD = '"Fraunces", Georgia, serif';

export const theme = createTheme({
  palette: {
    primary: { main: "#2B6E4F", light: "#4A8A6C", dark: "#1F5239" },
    secondary: { main: "#B8862E", light: "#CBA054", dark: "#96701F" },
    error: { main: "#B23A2E" },
    background: { default: "#F3F5F1", paper: "#FFFFFF" },
    text: { primary: "#1C2620", secondary: "#5B655D" },
    divider: "#DEDFD6",
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
