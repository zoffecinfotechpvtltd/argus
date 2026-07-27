-- Telegram notification support removed. Driver-agnostic SQL (SQLite dialect; Postgres adapter
-- translates at apply-time, same convention as prior migrations) — DROP COLUMN is valid verbatim
-- in both engines, no translation needed.

ALTER TABLE user_notification_prefs DROP COLUMN telegram_chat_id;
