import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { MailCheck } from "lucide-react";
import { api } from "../api/client";
import { Button, FieldGroup, Input } from "../components/ui";
import { AuthEyebrow, AuthShell, fieldVariants, staggerContainer } from "../components/AuthShell";

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post("/auth/forgot-password", { email });
    } catch {
      // Deliberately swallowed — the endpoint always returns { ok: true } regardless of whether the
      // email exists, so the only realistic failure here is a network/rate-limit blip; either way
      // showing the same "check your email" message avoids leaking account existence.
    } finally {
      setSent(true);
      setSubmitting(false);
    }
  }

  return (
    <AuthShell>
      <AuthEyebrow>Password reset</AuthEyebrow>
      <h1 className="font-display text-2xl font-bold tracking-tightest text-text-primary">Reset your password</h1>
      <p className="mb-6 mt-1 text-sm text-text-secondary">Enter your email and we'll send you a reset link. It expires in 1 hour.</p>

      {sent ? (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}>
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-accent-subtle text-accent">
            <MailCheck size={18} aria-hidden="true" />
          </div>
          <p className="text-sm text-text-secondary">
            If an account exists for <span className="font-medium text-text-primary">{email}</span>, a reset link is on its way — check your inbox
            (it expires in 1 hour).
          </p>
          <Link to="/login" className="mt-4 inline-block text-xs text-accent underline underline-offset-2 hover:text-accent/80">
            Back to sign in
          </Link>
        </motion.div>
      ) : (
        <motion.form variants={staggerContainer} initial="hidden" animate="visible" onSubmit={handleSubmit} className="space-y-4">
          <motion.div variants={fieldVariants}>
            <FieldGroup label="Email">
              {(ids) => <Input {...ids} className="w-full" type="email" required autoFocus autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
            </FieldGroup>
          </motion.div>
          <motion.div variants={fieldVariants}>
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? "Sending…" : "Send reset link"}
            </Button>
          </motion.div>
          <motion.p variants={fieldVariants} className="text-center text-xs text-text-secondary">
            <Link to="/login" className="text-accent underline underline-offset-2 hover:text-accent/80">Back to sign in</Link>
          </motion.p>
        </motion.form>
      )}
    </AuthShell>
  );
}
