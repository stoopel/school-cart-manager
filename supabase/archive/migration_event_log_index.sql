-- ============================================================
-- migration_event_log_index.sql
-- אינדקס מהיר למחיקת לוגים ישנים ב-CRON
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_event_log_created_at ON event_log(created_at);
