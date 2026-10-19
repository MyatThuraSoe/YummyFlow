import { useEffect, useRef, useState, type ReactNode } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AppBar,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Skeleton,
  Stack,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
} from "@mui/material";
import {
  AccessTime as AccessTimeIcon,
  Backup as BackupIcon,
  BarChart as BarChartIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  Dashboard as DashboardIcon,
  ExpandMore as ExpandMoreIcon,
  Fullscreen as FullscreenIcon,
  FullscreenExit as FullscreenExitIcon,
  History as HistoryIcon,
  Info as InfoIcon,
  Inventory2 as Inventory2Icon,
  Kitchen as KitchenIcon,
  Lock as LockIcon,
  LockReset as LockResetIcon,
  Logout as LogoutIcon,
  Menu as MenuIcon,
  Payments as PaymentsIcon,
  People as PeopleIcon,
  PointOfSale as PointOfSaleIcon,
  Receipt as ReceiptIcon,
  ReceiptLong as ReceiptLongIcon,
  RestaurantMenu as RestaurantMenuIcon,
  Settings as SettingsIcon,
  TableBar as TableBarIcon,
  TableRestaurant as TableRestaurantIcon,
  VpnKey as VpnKeyIcon,
} from "@mui/icons-material";
import { apiGet, apiPost } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { connectSocket, EVENTS } from "../lib/socket";
import { flushOutbox, pendingCount } from "../lib/outbox";
import LanguageSwitcher from "./LanguageSwitcher";
import LockOverlay from "./LockOverlay";
import { useToast } from "./ui";
import { useAuth } from "../store/auth";
import { useTranslation } from "react-i18next";

const WIDTH_EXPANDED = 240;
const WIDTH_COLLAPSED = 68;
const IDLE_MS = 5 * 60 * 1000;

interface NavItem {
  to: string;
  labelKey: string;
  cap: string | null;
  icon: ReactNode;
  exact?: boolean;
}

interface NavGroup {
  labelKey: string;
  items: NavItem[];
}

const GROUPS: NavGroup[] = [
  {
    labelKey: "group_overview",
    items: [{ to: "/admin", labelKey: "dashboard", cap: "report.view", icon: <DashboardIcon />, exact: true }],
  },
  {
    labelKey: "group_operations",
    items: [
      { to: "/pos", labelKey: "pos", cap: "pos.use", icon: <PointOfSaleIcon /> },
      { to: "/floor", labelKey: "floor", cap: "table.manage", icon: <TableRestaurantIcon /> },
      { to: "/kds", labelKey: "kitchen", cap: "kds.view", icon: <KitchenIcon /> },
    ],
  },
  {
    labelKey: "group_catalog",
    items: [
      { to: "/admin/menu", labelKey: "menu", cap: "menu.manage", icon: <RestaurantMenuIcon /> },
      { to: "/admin/tables", labelKey: "tables", cap: "table.manage", icon: <TableBarIcon /> },
      { to: "/admin/inventory", labelKey: "inventory", cap: "inventory.view", icon: <Inventory2Icon /> },
    ],
  },
  {
    labelKey: "group_sales",
    items: [
      { to: "/admin/orders", labelKey: "orders", cap: "report.view", icon: <ReceiptLongIcon /> },
      { to: "/admin/shifts", labelKey: "shifts", cap: "report.view", icon: <AccessTimeIcon /> },
      { to: "/admin/reports", labelKey: "reports", cap: "report.view", icon: <BarChartIcon /> },
      { to: "/admin/expenses", labelKey: "expenses", cap: "expense.manage", icon: <PaymentsIcon /> },
    ],
  },
  {
    labelKey: "group_administration",
    items: [
      { to: "/admin/users", labelKey: "users", cap: "staff.manage", icon: <PeopleIcon /> },
      { to: "/admin/receipt-customization", labelKey: "receipt", cap: "settings.manage", icon: <ReceiptIcon /> },
      { to: "/admin/settings", labelKey: "settings", cap: "settings.manage", icon: <SettingsIcon /> },
      { to: "/admin/backup", labelKey: "backup", cap: "backup.manage", icon: <BackupIcon /> },
      { to: "/admin/audit", labelKey: "audit_logs", cap: "audit.view", icon: <HistoryIcon /> },
      { to: "/admin/license", labelKey: "license", cap: "settings.manage", icon: <VpnKeyIcon /> },
    ],
  },
  {
    labelKey: "app_info",
    items: [{ to: "/admin/about", labelKey: "about", cap: null, icon: <InfoIcon /> }],
  },
];

const ALL_ITEMS = GROUPS.flatMap((g) => g.items);

interface LicenseStatusData {
  edition: string;
  licensed: boolean;
}

interface Envelope<T> {
  success: boolean;
  message: string;
  data: T;
}

interface ShiftCurrent {
  shift: { id: string; openedAt: string } | null;
}

interface HardwareStatus {
  printerMode: string;
  receiptPrinter: string;
  kitchenPrinter: string;
  simulateMode: boolean;
}

export default function DashboardLayout() {
  const { t } = useTranslation(["nav", "common", "cash"]);
  const { user, can, logout, loginPin } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const qc = useQueryClient();
  const { push } = useToast();
  const isMobile = useMediaQuery((th) => th.breakpoints.down("sm"));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("md_sidebar_collapsed") === "1");
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [pwOpen, setPwOpen] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(() => localStorage.getItem("md_basic_banner_dismissed") === "1");
  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement);
  const [socketUp, setSocketUp] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [queued, setQueued] = useState(pendingCount());
  const [locked, setLocked] = useState(false);
  const idleRef = useRef<number | null>(null);

  const { data: settings } = useQuery({
    queryKey: ["settings", "summary"],
    queryFn: () => apiGet<{ restaurant: { name: string } }>("/admin/settings"),
    staleTime: 5 * 60_000,
  });

  const { data: shiftData } = useQuery({
    queryKey: ["shift", "current"],
    queryFn: () => apiGet<ShiftCurrent>("/shifts/current"),
    refetchInterval: 30_000,
  });

  const { data: license } = useQuery({
    queryKey: ["license", "status"],
    queryFn: () => apiGet<Envelope<LicenseStatusData>>("/license/status"),
    staleTime: 60_000,
  });

  const { data: hw } = useQuery({
    queryKey: ["hardware"],
    queryFn: () => apiGet<HardwareStatus>("/admin/hardware/status"),
    staleTime: 60_000,
  });

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    const s = connectSocket();
    const invalidate = (keys: string[]) => () => keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    const handlers: [string, () => void][] = [
      [EVENTS.ORDER_CREATED, invalidate(["orders", "tables", "dashboard"])],
      [EVENTS.ORDER_UPDATED, invalidate(["orders", "tables"])],
      [EVENTS.ORDER_COMPLETED, invalidate(["orders", "tables", "shifts", "dashboard"])],
      [EVENTS.KITCHEN_NEW, invalidate(["tickets"])],
      [EVENTS.KITCHEN_UPDATED, invalidate(["tickets"])],
      [EVENTS.TABLE_UPDATED, invalidate(["tables"])],
      [EVENTS.MENU_ITEM_86, invalidate(["menu"])],
      [EVENTS.SHIFT_UPDATED, invalidate(["shift"])],
    ];
    handlers.forEach(([ev, fn]) => s.on(ev, fn));
    const on86 = (p: { name: string; isAvailable: boolean }) =>
      push(t(p.isAvailable ? "nav:marked_available" : "nav:marked_86", { name: p.name }), "info");
    s.on(EVENTS.MENU_ITEM_86, on86);
    const onConnect = () => setSocketUp(true);
    const onDisconnect = () => setSocketUp(false);
    s.on("connect", onConnect);
    s.on("disconnect", onDisconnect);
    setSocketUp(s.connected);
    return () => {
      handlers.forEach(([ev, fn]) => s.off(ev, fn));
      s.off(EVENTS.MENU_ITEM_86, on86);
      s.off("connect", onConnect);
      s.off("disconnect", onDisconnect);
    };
  }, [qc, push, t]);

  useEffect(() => {
    const update = () => setQueued(pendingCount());
    window.addEventListener("md:outbox", update);
    return () => window.removeEventListener("md:outbox", update);
  }, []);

  useEffect(() => {
    const goOnline = async () => {
      setOnline(true);
      if (pendingCount() > 0) {
        const { sent, failed } = await flushOutbox();
        setQueued(pendingCount());
        if (sent) push(t("nav:sync_sent", { count: sent }), "ok");
        if (failed) push(t("nav:sync_failed", { count: failed }), "error");
        qc.invalidateQueries({ queryKey: ["orders"] });
      }
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    // Flush anything queued while online (e.g. after a restart) — not only on
    // a fresh connectivity transition.
    if (navigator.onLine && pendingCount() > 0) void goOnline();
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [qc, push, t]);

  useEffect(() => {
    const reset = () => {
      if (idleRef.current) window.clearTimeout(idleRef.current);
      idleRef.current = window.setTimeout(() => setLocked(true), IDLE_MS);
    };
    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"];
    if (!locked) {
      reset();
      events.forEach((e) => window.addEventListener(e, reset));
    }
    return () => {
      events.forEach((e) => window.removeEventListener(e, reset));
      if (idleRef.current) window.clearTimeout(idleRef.current);
    };
  }, [locked]);

  function toggleCollapsed() {
    setCollapsed((c) => {
      localStorage.setItem("md_sidebar_collapsed", c ? "0" : "1");
      return !c;
    });
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  }

  function dismissBanner() {
    localStorage.setItem("md_basic_banner_dismissed", "1");
    setBannerDismissed(true);
  }

  const activeItem = [...ALL_ITEMS].sort((a, b) => b.to.length - a.to.length).find((item) => {
    if (item.exact) return loc.pathname === item.to || loc.pathname === `${item.to}/`;
    return loc.pathname.startsWith(item.to);
  });
  const title = activeItem ? t(`nav:${activeItem.labelKey}`) : t("nav:dashboard");
  const width = collapsed && !isMobile ? WIDTH_COLLAPSED : WIDTH_EXPANDED;
  const showBasicBanner = license?.data.licensed === false && !bannerDismissed;
  const currentShift = shiftData?.shift ?? null;

  const drawerContent = (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", overflowX: "hidden" }}>
      <Toolbar sx={{ justifyContent: collapsed && !isMobile ? "center" : "space-between", px: collapsed ? 1 : 2 }}>
        <Typography variant="h6" noWrap sx={{ color: "primary.main", letterSpacing: -0.5 }}>
          {collapsed && !isMobile ? "MD" : "MegaDine"}
        </Typography>
        {!isMobile && (
          <IconButton size="small" onClick={toggleCollapsed} aria-label={t("common:toggle_sidebar")}>
            {collapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
          </IconButton>
        )}
      </Toolbar>
      <Divider />
      <List sx={{ flex: 1, px: 1, overflowY: "auto", overflowX: "hidden" }}>
        {GROUPS.map((group) => {
          const items = group.items.filter((item) => item.cap === null || can(item.cap));
          if (items.length === 0) return null;
          const groupCollapsed = collapsed && !isMobile;
          return (
            <Box key={group.labelKey} sx={{ mt: 1 }}>
              {!groupCollapsed ? (
                <Typography
                  variant="caption"
                  sx={{
                    px: 2,
                    textTransform: "uppercase",
                    letterSpacing: 1,
                    fontWeight: 600,
                    color: "text.secondary",
                  }}
                >
                  {t(`nav:${group.labelKey}`)}
                </Typography>
              ) : (
                <Divider sx={{ mx: 1, my: 0.5 }} />
              )}
              {items.map((item) => {
                const active = item.exact
                  ? loc.pathname === item.to || loc.pathname === `${item.to}/`
                  : loc.pathname.startsWith(item.to);
                const button = (
                  <ListItemButton
                    key={item.to}
                    selected={active}
                    onClick={() => {
                      nav(item.to);
                      setDrawerOpen(false);
                    }}
                    sx={{
                      borderRadius: 2,
                      mb: 0.25,
                      minHeight: 42,
                      justifyContent: groupCollapsed ? "center" : "flex-start",
                      px: groupCollapsed ? 0 : 2,
                      "& .MuiListItemIcon-root": { minWidth: groupCollapsed ? 0 : 36, justifyContent: "center", color: active ? "primary.main" : "text.secondary" },
                    }}
                  >
                    <ListItemIcon>{item.icon}</ListItemIcon>
                    {!groupCollapsed && (
                      <ListItemText
                        primary={t(`nav:${item.labelKey}`)}
                        slotProps={{ primary: { sx: { fontSize: 14, fontWeight: active ? 700 : 500 } } }}
                      />
                    )}
                  </ListItemButton>
                );
                return groupCollapsed ? (
                  <Tooltip key={item.to} title={t(`nav:${item.labelKey}`)} placement="right">
                    {button}
                  </Tooltip>
                ) : (
                  button
                );
              })}
            </Box>
          );
        })}
      </List>
    </Box>
  );

  return (
    <Box sx={{ display: "flex", minHeight: "100vh", bgcolor: "background.default" }}>
      {isMobile ? (
        <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} sx={{ "& .MuiDrawer-paper": { width: WIDTH_EXPANDED } }}>
          {drawerContent}
        </Drawer>
      ) : (
        <Drawer
          variant="permanent"
          sx={{
            width,
            flexShrink: 0,
            "& .MuiDrawer-paper": {
              width,
              boxSizing: "border-box",
              borderRight: "1px solid",
              borderColor: "divider",
              transition: "width .18s ease",
              overflowX: "hidden",
            },
          }}
        >
          {drawerContent}
        </Drawer>
      )}

      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <AppBar
          position="sticky"
          elevation={0}
          color="transparent"
          sx={{
            bgcolor: "primary.main",
            color: "#fff",
            "& .MuiIconButton-root": { color: "#fff" },
            "& .MuiChip-outlined": { borderColor: "rgba(255,255,255,.35)", color: "rgba(255,255,255,.9)" },
            "& .MuiChip-outlinedWarning": { color: "#FBBF24", borderColor: "rgba(251,191,36,.5)" },
            "& .MuiChip-outlinedSuccess": { color: "#4ADE80", borderColor: "rgba(74,222,128,.5)" },
            "& .MuiChip-outlinedError": { color: "#F87171", borderColor: "rgba(248,113,113,.5)" },
          }}
        >
          <Toolbar sx={{ gap: 1 }}>
            {isMobile && (
              <IconButton edge="start" onClick={() => setDrawerOpen(true)} aria-label={t("common:open_menu")}>
                <MenuIcon />
              </IconButton>
            )}
            <Typography variant="h6" noWrap sx={{ fontSize: 18 }}>
              {title}
            </Typography>
            <Box sx={{ flex: 1 }} />
            <Typography variant="body2" noWrap sx={{ display: { xs: "none", md: "block" }, maxWidth: 200, color: "rgba(255,255,255,.72)" }}>
              {settings?.restaurant.name ?? t("nav:shop_name_fallback")}
            </Typography>
            {hw && (
              <Tooltip title={`${hw.receiptPrinter} / ${hw.kitchenPrinter}`}>
                <Chip
                  size="small"
                  variant="outlined"
                  label={`🖨 ${hw.simulateMode ? "simulated" : "tcp"}`}
                  sx={{ display: { xs: "none", lg: "flex" } }}
                />
              </Tooltip>
            )}
            {queued > 0 && (
              <Chip
                size="small"
                variant="outlined"
                color="warning"
                label={t("nav:queued", { count: queued })}
                sx={{ display: { xs: "none", sm: "flex" } }}
              />
            )}
            <Tooltip title={t("nav:realtime")}>
              <Chip
                size="small"
                variant="outlined"
                color={socketUp ? "success" : "warning"}
                label={socketUp ? t("nav:live") : t("nav:reconnecting")}
                sx={{ display: { xs: "none", sm: "flex" } }}
              />
            </Tooltip>
            <Chip
              size="small"
              variant="outlined"
              color={online ? "success" : "error"}
              label={online ? t("nav:online") : t("nav:offline")}
              sx={{ display: { xs: "none", sm: "flex" } }}
            />
            {currentShift && (
              <Tooltip title={t("cash:opened_at", { time: new Date(currentShift.openedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) })}>
                <Chip
                  size="small"
                  color="success"
                  variant="outlined"
                  label={`${t("cash:shift_open")} · ${new Date(currentShift.openedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
                  onClick={() => nav("/admin/shifts")}
                  sx={{ display: { xs: "none", sm: "flex" } }}
                />
              </Tooltip>
            )}
            <LanguageSwitcher compact />
            <Tooltip title={isFullscreen ? t("nav:exit_fullscreen") : t("nav:fullscreen")}>
              <IconButton onClick={toggleFullscreen} size="small">
                {isFullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
              </IconButton>
            </Tooltip>
            <Button
              onClick={(e) => setMenuAnchor(e.currentTarget)}
              endIcon={<ExpandMoreIcon />}
              sx={{ textTransform: "none", color: "#fff", minWidth: 0 }}
            >
              <Avatar sx={{ width: 30, height: 30, bgcolor: "secondary.main", fontSize: 14 }}>
                {(user?.firstName?.[0] ?? user?.name?.[0] ?? "?").toUpperCase()}
              </Avatar>
            </Button>
            <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={() => setMenuAnchor(null)}>
              <MenuItem disabled>
                <ListItemText primary={user?.name} secondary={`@${user?.username ?? ""} · ${user?.role}`} />
              </MenuItem>
              <Divider />
              <MenuItem
                onClick={() => {
                  setMenuAnchor(null);
                  setLocked(true);
                }}
              >
                <ListItemIcon>
                  <LockIcon fontSize="small" />
                </ListItemIcon>
                {t("nav:lock")}
              </MenuItem>
              <MenuItem
                onClick={() => {
                  setMenuAnchor(null);
                  setPwOpen(true);
                }}
              >
                <ListItemIcon>
                  <LockResetIcon fontSize="small" />
                </ListItemIcon>
                {t("nav:change_password")}
              </MenuItem>
              <MenuItem
                onClick={async () => {
                  setMenuAnchor(null);
                  await logout();
                  nav("/login");
                }}
              >
                <ListItemIcon>
                  <LogoutIcon fontSize="small" />
                </ListItemIcon>
                {t("nav:logout")}
              </MenuItem>
            </Menu>
          </Toolbar>
        </AppBar>

        <Box component="main" sx={{ flex: 1, p: { xs: 2, md: 3 }, minWidth: 0 }}>
          {showBasicBanner && (
            <Alert
              severity="info"
              onClose={dismissBanner}
              action={
                <Button color="inherit" size="small" onClick={() => nav("/admin/license")}>
                  {t("nav:license")}
                </Button>
              }
              sx={{ mb: 2 }}
            >
              {t("common:basic_plan_banner")}
            </Alert>
          )}
          <Outlet />
        </Box>
      </Box>

      <ChangePasswordDialog open={pwOpen} onClose={() => setPwOpen(false)} />
      {locked && (
        <LockOverlay
          onUnlock={async (pin) => {
            await loginPin(pin);
            setLocked(false);
          }}
          onSignOut={async () => {
            await logout();
            nav("/login");
          }}
        />
      )}
    </Box>
  );
}

export function ContentSkeleton() {
  return (
    <Stack spacing={2}>
      <Skeleton variant="rounded" height={48} />
      <Skeleton variant="rounded" height={220} />
      <Skeleton variant="rounded" height={220} />
    </Stack>
  );
}

function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation(["nav", "common", "auth"]);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const save = useMutation({
    mutationFn: () => apiPost("/auth/change-password", { currentPassword: current, newPassword: next }),
    onSuccess: () => {
      setSuccess(t("common:password_changed"));
      setError("");
      setCurrent("");
      setNext("");
      setConfirm("");
    },
    onError: (e) => {
      setSuccess("");
      setError(errorMessage(e, t));
    },
  });

  function reset() {
    setCurrent("");
    setNext("");
    setConfirm("");
    setError("");
    setSuccess("");
    save.reset();
  }

  function submit() {
    setError("");
    setSuccess("");
    if (next.length < 8) return setError(t("common:password_min"));
    if (next !== confirm) return setError(t("common:passwords_not_match"));
    save.mutate();
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        onClose();
        reset();
      }}
    >
      <DialogTitle>{t("nav:change_password")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          {success && <Alert severity="success">{success}</Alert>}
          <TextField type="password" label={t("nav:current_password")} value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus fullWidth />
          <TextField type="password" label={t("nav:new_password")} value={next} onChange={(e) => setNext(e.target.value)} fullWidth helperText={t("common:password_min")} />
          <TextField type="password" label={t("auth:confirm_password")} value={confirm} onChange={(e) => setConfirm(e.target.value)} fullWidth />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button
          onClick={() => {
            onClose();
            reset();
          }}
        >
          {t("common:cancel")}
        </Button>
        <Button variant="contained" onClick={submit} disabled={save.isPending || !current || !next || !confirm}>
          {save.isPending ? <CircularProgress size={18} /> : t("common:save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
