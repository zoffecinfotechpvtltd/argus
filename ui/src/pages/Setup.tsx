import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { api, setCsrfToken, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Button, FieldGroup, Input } from "../components/ui";
import { AuthEyebrow, AuthShell, fieldVariants, staggerContainer } from "../components/AuthShell";
import { TermsModal } from "../components/TermsModal";

export function Setup() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [instanceName, setInstanceName] = useState("Argus");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [terms, setTerms] = useState<{ version: string; text: string } | null>(null);
  const [termsOpen, setTermsOpen] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const navigate = useNavigate();
  const { refresh } = useAuth();

  useEffect(() => {
    api.get<{ version: string; text: string }>("/setup/terms").then(setTerms).catch(() => {});
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!acceptedTerms) {
      setError("You must accept the Terms and Conditions to continue.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.post<{ csrfToken: string }>("/setup", { email, password, instanceName, acceptedTerms });
      setCsrfToken(res.csrfToken);
      await refresh();
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? describeError(err) : "Setup failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell>
      <AuthEyebrow>Initial setup</AuthEyebrow>
      <h1 className="font-display text-2xl font-bold tracking-tightest text-text-primary">Welcome to Argus</h1>
      <p className="mb-6 mt-1 text-sm text-text-secondary">
        One admin account, one instance — no cloud dependency. Create the admin account to get started; you can add more users later.
      </p>

      <motion.form variants={staggerContainer} initial="hidden" animate="visible" onSubmit={handleSubmit} className="space-y-4">
        <motion.div variants={fieldVariants}>
          <FieldGroup label="Instance name">{(ids) => <Input {...ids} className="w-full" value={instanceName} onChange={(e) => setInstanceName(e.target.value)} />}</FieldGroup>
        </motion.div>
        <motion.div variants={fieldVariants}>
          <FieldGroup label="Admin email">
            {(ids) => (
              <Input {...ids} className="w-full" type="email" required autoFocus autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            )}
          </FieldGroup>
        </motion.div>
        <motion.div variants={fieldVariants}>
          <FieldGroup label="Password" hint="At least 10 characters.">
            {(ids) => (
              <Input
                {...ids}
                className="w-full"
                type="password"
                required
                minLength={10}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </FieldGroup>
        </motion.div>

        <motion.label variants={fieldVariants} className="flex cursor-pointer items-start gap-2.5 py-1 text-sm text-text-secondary">
          <span className="relative mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
            <input
              type="checkbox"
              checked={acceptedTerms}
              onChange={(e) => setAcceptedTerms(e.target.checked)}
              className="peer absolute h-5 w-5 cursor-pointer appearance-none rounded-sm border-[1.5px] border-border bg-bg-surface transition-colors duration-micro hover:border-accent/50 checked:border-accent checked:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-surface"
            />
            <Check size={13} strokeWidth={3} className="pointer-events-none absolute scale-0 text-accent-text-on transition-transform peer-checked:scale-100" aria-hidden="true" />
          </span>
          <span className="leading-relaxed">
            I have authorization to scan and monitor these networks, and I accept the{" "}
            <button type="button" onClick={() => setTermsOpen(true)} className="cursor-pointer font-medium text-accent underline underline-offset-2 hover:text-accent/80">
              Terms and Conditions
            </button>
            {terms ? ` (v${terms.version})` : ""}.
          </span>
        </motion.label>

        {error && (
          <motion.p variants={fieldVariants} role="alert" className="text-sm text-critical">
            {error}
          </motion.p>
        )}
        <motion.div variants={fieldVariants}>
          <Button type="submit" disabled={submitting || !acceptedTerms} className="w-full">
            {submitting ? "Creating…" : "Create admin account"}
          </Button>
        </motion.div>
      </motion.form>

      <TermsModal
        open={termsOpen}
        onClose={() => setTermsOpen(false)}
        onAccept={() => setAcceptedTerms(true)}
        version={terms?.version}
        text={terms?.text ?? null}
      />
    </AuthShell>
  );
}

function describeError(err: ApiError): string {
  if (err.code === "VALIDATION_ERROR") return "Please check your input.";
  if (err.code === "ALREADY_SET_UP") return "Setup already completed — please log in.";
  if (err.code === "RATE_LIMITED") return "Too many attempts, please wait a moment.";
  return "Setup failed.";
}
