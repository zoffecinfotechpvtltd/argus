-- See sqlite migrations/0018_notify_slack_teams_pagerduty.sql for the rationale.
ALTER TABLE user_notification_prefs ADD COLUMN IF NOT EXISTS slack_webhook_url TEXT;
ALTER TABLE user_notification_prefs ADD COLUMN IF NOT EXISTS teams_webhook_url TEXT;
ALTER TABLE user_notification_prefs ADD COLUMN IF NOT EXISTS pagerduty_routing_key TEXT;
