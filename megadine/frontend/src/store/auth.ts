import { create } from "zustand";
import { api, apiGet, setToken } from "../lib/api";
import { connectSocket, disconnectSocket } from "../lib/socket";

export interface AuthUser {
  id: string;
  name: string;
  email: string | null;
  role: string;
  restaurantId: string;
  capabilities: string[];
}

interface AuthState {
  user: AuthUser | null;
  ready: boolean;
  loginPin: (pin: string) => Promise<AuthUser>;
  loginPassword: (email: string, password: string) => Promise<AuthUser>;
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
    set({ user: data.user, ready: true });
    return data.user;
  },
  async loginPassword(email, password) {
    const data = await api<{ user: AuthUser; token: string }>("/auth/login", { method: "POST", body: { email, password } });
    setToken(data.token);
    connectSocket();
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
