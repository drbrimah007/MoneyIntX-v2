-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION: Recurring Rules Enhancements
-- Adds new fields for improved recurring entry management
-- ═══════════════════════════════════════════════════════════════════

-- Add new columns to recurring_rules if they don't exist
ALTER TABLE recurring_rules
ADD COLUMN IF NOT EXISTS description text DEFAULT '',
ADD COLUMN IF NOT EXISTS custom_label text,
ADD COLUMN IF NOT EXISTS remind_days int NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS notify_contact boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS notify_self boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS notify_email boolean NOT NULL DEFAULT false;

-- Create index for faster lookups on next_run_at with remind_days offset
CREATE INDEX IF NOT EXISTS idx_recurring_remind_offset
ON recurring_rules(user_id, next_run_at)
WHERE active = true AND remind_days > 0;
