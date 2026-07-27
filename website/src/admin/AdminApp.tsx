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

  async function handleLogout() {
    await fetch("/api/admin/logout", { method: "POST" }).catch(() => {});
    setSession("signedOut");
  }

  return (
    <div className="min-h-screen bg-canvas font-sans text-fog">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2.5">
            <ArgusMark className="h-7 w-7" />
            <span className="font-display text-base font-semibold tracking-tight">Argus — License Portal</span>
          </div>
          {session === "signedIn" && (
            <button onClick={handleLogout} className="text-sm text-muted transition-colors hover:text-fog">
              Sign out
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-10">
        {backendError && (
          <div className="mx-auto mb-6 max-w-sm rounded-lg border border-status-critical/30 bg-status-critical/5 p-3 text-xs text-status-critical">
            Backend error: {backendError}
          </div>
        )}
        {session === "checking" && <div className="text-sm text-muted">Checking session…</div>}

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
