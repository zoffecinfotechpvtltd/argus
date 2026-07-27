import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { KeyRound, ShieldAlert } from "lucide-react";
import { api, ApiError } from "../api/client";
import { Button, FieldGroup, Input } from "../components/ui";
import { AuthEyebrow, AuthShell, fieldVariants, staggerContainer } from "../components/AuthShell";

export function ResetPassword() {
  const [params] = useSearchParams();
  const uid = params.get("uid") ?? "";
  const token = params.get("token") ?? "";
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post("/auth/reset-password", { userId: uid, token, newPassword });
      navigate("/login");
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "INVALID_OR_EXPIRED_TOKEN"
          ? "This reset link is invalid or has expired — request a new one."
          : "Failed to reset password."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell>
      {uid && token && (
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-accent-subtle text-accent">
          <KeyRound size={18} aria-hidden="true" />
        </div>
      )}
      <AuthEyebrow>New password</AuthEyebrow>
      <h1 className="font-display text-2xl font-bold tracking-tightest text-text-primary">Set a new password</h1>
      <p className="mb-6 mt-1 text-sm text-text-secondary">
        Choose a new password for your account — pick something you haven't used elsewhere.
      </p>

      {!uid || !token ? (
        <div>
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-critical-subtle text-critical">
            <ShieldAlert size={18} aria-hidden="true" />
          </div>
          <p className="text-sm text-text-secondary">
            This link is missing its reset token — it may have been copied incorrectly.{" "}
            <Link to="/forgot-password" className="text-accent underline underline-offset-2 hover:text-accent/80">
              Request a new one
            </Link>
            .
          </p>
        </div>
      ) : (
        <motion.form variants={staggerContainer} initial="hidden" animate="visible" onSubmit={handleSubmit} className="space-y-4">
          <motion.div variants={fieldVariants}>
            <FieldGroup label="New password" hint="At least 10 characters.">
              {(ids) => (
                <Input
                  {...ids}
                  className="w-full"
                  type="password"
                  required
                  minLength={10}
                  autoFocus
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
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
              {submitting ? "Saving…" : "Set new password"}
            </Button>
          </motion.div>
        </motion.form>
      )}
    </AuthShell>
  );
}
