-- Money IntX v2 — Fix groups and investments RLS policies
-- Run in Supabase SQL Editor
-- Fixes: group owners / investment owners can add contact members (user_id may be null for contacts)

-- ── 1. Fix group_members insert: allow group owners to add any member ─────
DROP POLICY IF EXISTS gmembers_insert ON group_members;
CREATE POLICY gmembers_insert ON group_members FOR INSERT TO authenticated WITH CHECK (
  -- The inserting user is adding themselves (user_id = their uid)
  auth.uid() = user_id
  OR
  -- OR the group owner is adding anyone (including contacts with null user_id)
  group_id IN (SELECT id FROM groups WHERE user_id = auth.uid())
  OR
  -- OR user_id is null (contact without account) and requester owns the group
  (user_id IS NULL AND group_id IN (SELECT id FROM groups WHERE user_id = auth.uid()))
);

-- ── 2. Fix investment_members: allow owner to add partners with null user_id ─
DROP POLICY IF EXISTS imembers_modify ON investment_members;
CREATE POLICY imembers_modify ON investment_members FOR ALL TO authenticated USING (
  investment_id IN (SELECT id FROM investments WHERE user_id = auth.uid())
  OR user_id = auth.uid()
) WITH CHECK (
  investment_id IN (SELECT id FROM investments WHERE user_id = auth.uid())
  OR auth.uid() = user_id
);

-- ── 3. Ensure investments has status column (may be missing in older schemas) ─
ALTER TABLE investments ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
  CHECK (status IN ('active','matured','closed','lost'));

-- ── 4. Ensure groups has currency column ─────────────────────────────────────
ALTER TABLE groups ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USD';

-- ── 5. Grant group_rounds insert to authenticated (owner can create rounds) ──
DROP POLICY IF EXISTS grounds_insert ON group_rounds;
CREATE POLICY grounds_insert ON group_rounds FOR INSERT TO authenticated WITH CHECK (
  group_id IN (SELECT id FROM groups WHERE user_id = auth.uid())
);

-- ── 6. Fix group_contributions: allow group owners to manage contributions ──
DROP POLICY IF EXISTS gcontrib_modify ON group_contributions;
CREATE POLICY gcontrib_modify ON group_contributions FOR ALL TO authenticated USING (
  round_id IN (SELECT id FROM group_rounds WHERE group_id IN
    (SELECT id FROM groups WHERE user_id = auth.uid()))
) WITH CHECK (
  round_id IN (SELECT id FROM group_rounds WHERE group_id IN
    (SELECT id FROM groups WHERE user_id = auth.uid()))
);

-- ── 7. Ensure notice_board has an INSERT policy ───────────────────────────────
DROP POLICY IF EXISTS notices_insert ON notice_board;
CREATE POLICY notices_insert ON notice_board FOR INSERT TO authenticated WITH CHECK (
  auth.uid() = user_id
  OR group_id IN (SELECT id FROM groups WHERE user_id = auth.uid())
);
DROP POLICY IF EXISTS notices_select ON notice_board;
CREATE POLICY notices_select ON notice_board FOR SELECT TO authenticated USING (
  group_id IN (SELECT id FROM groups WHERE user_id = auth.uid())
  OR group_id IN (SELECT group_id FROM group_members WHERE user_id = auth.uid() AND status = 'active')
);
