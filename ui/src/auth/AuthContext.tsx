import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, setCsrfToken, ApiError } from "../api/client";

export interface CurrentUser {
  id: string;
  email: string;
  role: "admin" | "operator" | "viewer";
  tenantId: string;
  forcePasswordReset?: boolean;
  totpEnabled?: boolean;
  onboardingCompletedAt?: string | null;
}

interface AuthState {
  user: CurrentUser | null;
  loading: boolean;
  setupRequired: boolean;
  /** null until the first /health call resolves. Signup (workspace self-serve) only exists in
   * saas mode — exe mode is one admin per install, seeded once via /setup — so any cross-link
   * between Login and Signup must check this before rendering, or it dead-ends in exe mode. */
  mode: "exe" | "saas" | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);
  const [mode, setMode] = useState<"exe" | "saas" | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // /setup/status only exists in exe mode (one fixed tenant, seeded once — see api/server.ts's
      // saas/exe branch). Checking mode first, not just calling /setup/status and treating its
      // 404 as "not required", matters because the two modes need different fallthrough: in exe
      // mode a 404 would be a real bug worth surfacing, while in saas mode skipping the call
      // entirely (rather than swallowing an expected 404) is what actually lets the next line —
      // fetching /auth/me — run at all. Without this, a saas-mode page refresh with a perfectly
      // valid session cookie would silently never load the user.
      const health = await api.get<{ mode: "exe" | "saas" }>("/health");
      setMode(health.mode);
      if (health.mode === "exe") {
        const status = await api.get<{ setupRequired: boolean }>("/setup/status");
        setSetupRequired(status.setupRequired);
        if (status.setupRequired) {
          setUser(null);
          return;
        }
      }
      const me = await api.get<CurrentUser>("/auth/me");
      setUser(me);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await api.post("/auth/logout");
    setUser(null);
    setCsrfToken("");
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return <AuthContext.Provider value={{ user, loading, setupRequired, mode, refresh, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
