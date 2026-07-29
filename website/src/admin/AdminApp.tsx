import { useEffect, useState } from "react";
import { ArgusMark } from "../components/ArgusMark";
import { LoginForm } from "./LoginForm";
import { IssueLicenseForm } from "./IssueLicenseForm";
import { LicenseHistory } from "./LicenseHistory";

type SessionState = "checking" | "signedOut" | "signedIn";

/** Root-admin license portal — reachable at /admin, never linked from the public site nav. Issues
 * licenses using the same signing logic as scripts/license-admin.ts, but reachable from anywhere
 * and able to email the result straight to the customer. See ../../GUIDE.md §9.5. */
export function AdminApp() {
  const [session, setSession] = useState<SessionState>("checking");
  const [historyKey, setHistoryKey] = useState(0);
  const [backendError, setBackendError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/session")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setBackendError(d.message ?? d.error);
        setSession(d.authenticated ? "signedIn" : "signedOut");
      })
      .catch(() => setSession("signedOut"));
  }, []);

  // The session cookie itself expires server-side after 15 minutes (see lib/adminAuth.ts's
  // SESSION_TTL_MS) — this just makes that visible in the UI instead of the admin only finding out
  // the hard way when a form submit 401s. Polling (not a client-only timer) so it's driven by the
  // server's actual expiry, not this tab's clock, and also catches a session revoked elsewhere.
  useEffect(() => {
    if (session !== "signedIn") return;
    const id = window.setInterval(() => {
      fetch("/api/admin/session")
        .then((r) => r.json())
        .then((d) => {
          if (!d.authenticated) setSession("signedOut");
        })
        .catch(() => {});
    }, 60_000);
    return () => window.clearInterval(id);
  }, [session]);

  async function handleLogout() {
    await fetch("/api/admin/logout", { method: "POST" }).catch(() => {});
    setSession("signedOut");
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-canvas font-sans text-fog">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] opacity-40 [mask-image:linear-gradient(180deg,black,transparent)]"
        style={{ backgroundImage: "radial-gradient(rgb(var(--color-text-primary) / 0.14) 1px, transparent 1px)", backgroundSize: "28px 28px" }}
        aria-hidden="true"
      />
      <div className="pointer-events-none absolute -top-32 left-1/2 -z-10 h-[420px] w-[720px] -translate-x-1/2 rounded-full bg-accent/10 blur-[110px]" aria-hidden="true" />

      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2.5">
            <ArgusMark className="h-7 w-7" />
            <div>
              <span className="block font-display text-base font-semibold tracking-tight">License Portal</span>
              <span className="block text-[11px] text-dim">Internal — never linked from the public site</span>
            </div>
          </div>
          {session === "signedIn" && (
            <button onClick={handleLogout} className="text-sm text-muted transition-colors hover:text-fog">
              Sign out
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        {backendError && (
          <div className="mx-auto mb-6 max-w-sm rounded-lg border border-status-critical/30 bg-status-critical/5 p-3 text-xs text-status-critical">
            Backend error: {backendError}
          </div>
        )}
        {session === "checking" && <div className="py-20 text-center text-sm text-muted">Checking session…</div>}

        {session === "signedOut" && <LoginForm onSignedIn={() => setSession("signedIn")} />}

        {session === "signedIn" && (
          <div className="space-y-10">
            <IssueLicenseForm onIssued={() => setHistoryKey((k) => k + 1)} />
            <LicenseHistory refreshKey={historyKey} />
          </div>
        )}
      </main>
    </div>
  );
}
