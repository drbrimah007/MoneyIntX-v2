-- Migration: Asset Lockers (v1-style schema) + settlement proof_url
-- Run in Supabase SQL Editor

-- ── Asset Lockers table (matches v1 field structure) ──────────────
CREATE TABLE IF NOT EXISTS asset_lockers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type             text NOT NULL DEFAULT 'physical',   -- physical|personal|digital|financial|legal|other
  title            text NOT NULL,
  asset_key        text,                                -- optional structured ref e.g. "physical:room:north:001"
  location         text,                                -- where to find it
  access           text,                                -- how to get in / use it
  notes            text,                                -- extra context
  primary_trustee  jsonb,                               -- {name, email, phone}
  other_trustees   jsonb NOT NULL DEFAULT '[]',         -- [{name, email, phone}, ...]
  is_released      boolean NOT NULL DEFAULT false,
  released_to      uuid REFERENCES users(id),
  released_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asset_lockers_user ON asset_lockers(user_id);

ALTER TABLE asset_lockers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own lockers" ON asset_lockers;
CREATE POLICY "Users manage own lockers"
  ON asset_lockers FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins read lockers" ON asset_lockers;
CREATE POLICY "Admins read lockers"
  ON asset_lockers FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'platform_admin')
  );

CREATE OR REPLACE FUNCTION update_asset_locker_ts()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS asset_locker_updated_at ON asset_lockers;
CREATE TRIGGER asset_locker_updated_at
  BEFORE UPDATE ON asset_lockers
  FOR EACH ROW EXECUTE FUNCTION update_asset_locker_ts();


-- ── Add proof_url to settlements ──────────────────────────────────
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS proof_url text;


-- ── Supabase Storage: 'attachments' bucket for settlement proofs ──
-- Run in Supabase Dashboard > Storage > New Bucket
-- Name: attachments  |  Private  |  Max size: 10 MB
-- Allowed types: image/jpeg, image/png, image/webp, application/pdf
--
-- Then add RLS policies:
-- INSERT: (storage.foldername(name))[1] = auth.uid()::text
-- SELECT: (storage.foldername(name))[1] = auth.uid()::text
