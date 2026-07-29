-- First-time-login walkthrough: NULL (every existing user, and every new signup) means the tour
-- hasn't been completed or dismissed yet. Set once, either way, the first time the UI shows it —
-- never reset automatically, so it only ever appears once per account.
ALTER TABLE users ADD COLUMN onboarding_completed_at TIMESTAMPTZ;
