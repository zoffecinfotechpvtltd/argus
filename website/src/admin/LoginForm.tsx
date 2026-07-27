import { useState } from "react";
import { Lock } from "lucide-react";

export function LoginForm({ onSignedIn }: { onSignedIn: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Sign-in failed.");
        return;
      }
      onSignedIn();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto mt-16 max-w-sm rounded-2xl border border-border bg-surface p-8">
      <div className="mb-6 flex items-center gap-2 text-muted">
        <Lock size={18} />
        <span className="text-sm">Root admin only</span>
      </div>
      <label className="mb-1.5 block text-sm text-muted">Password</label>
      <input
        type="password"
        autoFocus
        className="input"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="••••••••••"
      />
      {error && <p className="mt-3 text-sm text-status-critical">{error}</p>}
      <button
        type="submit"
        disabled={busy || !password}
        className="mt-5 w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-text-on transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
