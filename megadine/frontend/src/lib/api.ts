const BASE = (import.meta.env.VITE_API_URL ?? "") + "/api/v1";

/** Session tokens live in the httpOnly `md_session` cookie; JavaScript never sees them. */
export function clearLegacyToken() {
  try {
    localStorage.removeItem("md_token");
  } catch {
    /* ignore */
  }
}

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface ApiOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | undefined | null>;
}

export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const url = new URL(BASE + path, window.location.origin);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString().replace(window.location.origin, ""), {
    method: opts.method ?? "GET",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/auth/")) {
      window.dispatchEvent(new Event("md:unauthorized"));
    }
    const err = data?.error ?? {};
    throw new ApiError(res.status, err.code ?? "ERROR", err.message ?? "Request failed", err.details);
  }
  return data as T;
}

export const apiGet = <T>(path: string, query?: ApiOptions["query"]) => api<T>(path, { query });
export const apiPost = <T>(path: string, body?: unknown) => api<T>(path, { method: "POST", body });
export const apiPatch = <T>(path: string, body?: unknown) => api<T>(path, { method: "PATCH", body });
export const apiPut = <T>(path: string, body?: unknown) => api<T>(path, { method: "PUT", body });
export const apiDel = <T>(path: string) => api<T>(path, { method: "DELETE" });
