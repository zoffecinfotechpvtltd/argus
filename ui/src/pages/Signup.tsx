import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { api, setCsrfToken, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Button, FieldGroup, Input } from "../components/ui";
import { AuthEyebrow, AuthShell, fieldVariants, staggerContainer } from "../components/AuthShell";

/** Saas-mode signup — creates a brand-new workspace (tenant) + its first admin user via
 * `POST /api/signup` (src/api/routes/signup.ts). Exe mode's equivalent is Setup.tsx, which seeds
 * the one fixed "local" tenant instead of creating a new one — the two pages intentionally don't
 * share a component, since "create the first and only tenant" and "create one of many tenants"
 * are different enough flows (workspace naming, no terms-acceptance step here yet) to stay separate. */
export function Signup() {
  const [workspaceName, setWorkspaceName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const { refresh } = useAuth();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.post<{ csrfToken: string }>("/signup", { workspaceName, email, password });
      setCsrfToken(res.csrfToken);
      await refresh();
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError && err.code === "RATE_LIMITED" ? "Too many attempts, try again shortly." : "Couldn't create your workspace — check the details and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell>
      <AuthEyebrow>New workspace</AuthEyebrow>
      <h1 className="font-display text-2xl font-bold tracking-tightest text-text-primary">Create your workspace</h1>
      <p className="mb-6 mt-1 text-sm text-text-secondary">Free for up to 50 devices — no card required.</p>

      <motion.form variants={staggerContainer} initial="hidden" animate="visible" onSubmit={handleSubmit} className="space-y-4">
        <motion.div variants={fieldVariants}>
          <FieldGroup label="Workspace name">
            {(ids) => <Input {...ids} className="w-full" required autoFocus value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} placeholder="Acme Networks" />}
          </FieldGroup>
        </motion.div>
        <motion.div variants={fieldVariants}>
          <FieldGroup label="Email">
            {(ids) => <Input {...ids} className="w-full" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
          </FieldGroup>
        </motion.div>
        <motion.div variants={fieldVariants}>
          <FieldGroup label="Password" hint="At least 10 characters.">
            {(ids) => (
              <Input {...ids} className="w-full" type="password" required minLength={10} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            )}
          </FieldGroup>
        </motion.div>
        {error && (
          <motion.p variants={fieldVariants} role="alert" className="text-sm text-critical">
            {error}
          </motion.p>
        )}
        <motion.div variants={fieldVariants}>
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Creating workspace…" : "Create workspace"}
          </Button>
        </motion.div>
        <motion.div variants={fieldVariants}>
          <Link to="/login" className="block">
            <Button type="button" variant="secondary" className="w-full">
              Already have a workspace? Sign in
            </Button>
          </Link>
        </motion.div>
      </motion.form>
    </AuthShell>
  );
}
