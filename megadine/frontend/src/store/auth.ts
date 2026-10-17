import { create } from "zustand";
import { api, apiGet, setToken } from "../lib/api";
import { connectSocket, disconnectSocket } from "../lib/socket";
import i18n, { SUPPORTED_LANGS } from "../lib/i18n";

export interface AuthUser {
  id: string;
  name: string;
  username: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  role: string;
  restaurantId: string;
  preferredLanguage: string | null;
  capabilities: string[];
}

function applyUserLanguage(user: AuthUser) {
  const lang = user.preferredLanguage;
  if (lang && SUPPORTED_LANGS.includes(lang) && i18n.resolvedLanguage !== lang) {
    void i18n.changeLanguage(lang);
  }
}

interface AuthState {
  user: AuthUser | null;
  ready: boolean;
  loginPin: (pin: string) => Promise<AuthUser>;
  loginCredentials: (handle: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  hydrate: () => Promise<void>;
  can: (capability: string) => boolean;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  ready: false,
  async loginPin(pin) {
    const data = await api<{ user: AuthUser; token: string }>("/auth/login", { method: "POST", body: { pin } });
    setToken(data.token);
    connectSocket();
    applyUserLanguage(data.user);
    set({ user: data.user, ready: true });
    return data.user;
  },
  async loginCredentials(handle, password) {
    const body = handle.includes("@") ? { email: handle, password } : { username: handle, password };
    const data = await api<{ user: AuthUser; token: string }>("/auth/login", { method: "POST", body });
    setToken(data.token);
    connectSocket();
    applyUserLanguage(data.user);
    set({ user: data.user, ready: true });
    return data.user;
  },
  async logout() {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    setToken(null);
    disconnectSocket();
    set({ user: null });
  },
  async hydrate() {
    try {
      const data = await apiGet<{ user: AuthUser }>("/auth/me");
      connectSocket();
      applyUserLanguage(data.user);
      set({ user: data.user, ready: true });
    } catch {
      setToken(null);
      set({ user: null, ready: true });
    }
  },
  can(capability) {
    return get().user?.capabilities.includes(capability) ?? false;
  },
}));
