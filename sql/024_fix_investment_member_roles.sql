-- ──────────────────────────────────────────────────────────────────
-- 024. Fix Investment Member Roles — expand allowed roles
-- ──────────────────────────────────────────────────────────────────
-- Expands the role CHECK constraint to allow partner, investor, advisor, observer
-- which are used in the investment partner modal

ALTER TABLE investment_members DROP CONSTRAINT IF EXISTS investment_members_role_check;
ALTER TABLE investment_members ADD CONSTRAINT investment_members_role_check CHECK (role IN ('owner','admin','member','partner','investor','advisor','observer'));
