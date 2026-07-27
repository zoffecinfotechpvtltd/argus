const BASE = "/api";

/**
 * The CSRF token used to live in a plain module-level JS variable, set once from the login/setup
 * response body via setCsrfToken() and never refreshed — so it reset to null on every full page
 * reload (F5, opening a new tab, coming back after the tab was asleep), even though the session
 * cookie itself was still valid, breaking every mutating request (e.g. "CSRF_TOKEN_INVALID" when
 * starting a new Discovery scan) until the user logged out and back in. The server issues np_csrf
 * as a non-httpOnly cookie specifically so the client can read it directly instead — the
 * double-submit check only cares that the header matches the cookie, not where the header value
 * came from, so reading it fresh from the cookie on every request removes the whole class of bug.
 */
function readCsrfCookie(): string | null {
  const match = document.cookie.match(/(?:^|; )np_csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/** @deprecated No longer needed — the CSRF token is read directly from its cookie on every request. Kept as a no-op so existing call sites don't need to change. */
export function setCsrfToken(_token: string) {}

export class ApiError extends Error {
  constructor(public status: number, public code: string, public issues?: unknown, message?: string) {
    super(message ?? code);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  const csrfToken = readCsrfCookie();
  if (csrfToken && !["GET", "HEAD", "OPTIONS"].includes(method)) {
    headers.set("X-CSRF-Token", csrfToken);
  }

  const res = await fetch(BASE + path, { ...init, headers, credentials: "same-origin" });

  if (res.status === 401) {
    if (!path.startsWith("/auth/") && window.location.pathname !== "/login") {
      window.location.href = "/login";
    }
  }

  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!res.ok) {
    const b = body as { error?: string; issues?: unknown; message?: string } | null;
    throw new ApiError(res.status, b?.error ?? "UNKNOWN_ERROR", b?.issues, b?.message);
  }

  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) => request<T>(path, { method: "POST", body: data ? JSON.stringify(data) : undefined }),
  patch: <T>(path: string, data?: unknown) => request<T>(path, { method: "PATCH", body: data ? JSON.stringify(data) : undefined }),
  put: <T>(path: string, data?: unknown) => request<T>(path, { method: "PUT", body: data ? JSON.stringify(data) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
