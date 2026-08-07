-- New per-user notification channels alongside the existing email/webhook — same pattern as
-- webhook_url: a per-user target the recipient sets themselves, not instance-wide config.
ALTER TABLE user_notification_prefs ADD COLUMN slack_webhook_url TEXT;
ALTER TABLE user_notification_prefs ADD COLUMN teams_webhook_url TEXT;
ALTER TABLE user_notification_prefs ADD COLUMN pagerduty_routing_key TEXT;
