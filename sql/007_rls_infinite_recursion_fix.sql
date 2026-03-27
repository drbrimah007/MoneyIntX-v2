-- Money IntX v2 — Fix RLS infinite recursion on group_members and investment_members
-- Run this in Supabase SQL Editor (Settings → SQL Editor)
--
-- THE PROBLEM:
--   Supabase RLS policies on group_members and investment_members reference the
--   groups/investments tables, whose own SELECT policies reference back to
--   group_members/investment_members → circular dependency → infinite recursion.
--
-- THE FIX:
--   1. Create SECURITY DEFINER helper functions that bypass RLS to check ownership.
--   2. Rewrite all policies to use these functions instead of sub-queries that
--      go through the RLS stack again.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── STEP 1: Helper functions (SECURITY DEFINER = bypass RLS) ─────────────────

-- Check if auth.uid() owns a group (bypasses RLS)
CREATE OR REPLACE FUNCTION is_group_owner(gid uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM groups WHERE id = gid AND user_id = auth.uid());
$$;

-- Check if auth.uid() is an active member of a group (bypasses RLS)
CREATE OR REPLACE FUNCTION is_group_member(gid uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM group_members
    WHERE group_id = gid AND user_id = auth.uid() AND status = 'active'
  );
$$;

-- Check if auth.uid() owns an investment (bypasses RLS)
CREATE OR REPLACE FUNCTION is_investment_owner(iid uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM investments WHERE id = iid AND user_id = auth.uid());
$$;

-- Check if auth.uid() is a member of an investment (bypasses RLS)
CREATE OR REPLACE FUNCTION is_investment_member(iid uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM investment_members
    WHERE investment_id = iid AND user_id = auth.uid()
  );
$$;

-- ── STEP 2: Fix group_members policies ───────────────────────────────────────

-- Drop all existing policies on group_members
DROP POLICY IF EXISTS gmembers_select ON group_members;
DROP POLICY IF EXISTS gmembers_insert ON group_members;
DROP POLICY IF EXISTS gmembers_update ON group_members;
DROP POLICY IF EXISTS gmembers_delete ON group_members;
DROP POLICY IF EXISTS group_members_select ON group_members;
DROP POLICY IF EXISTS group_members_insert ON group_members;
DROP POLICY IF EXISTS group_members_update ON group_members;
DROP POLICY IF EXISTS group_members_delete ON group_members;

-- SELECT: group owner OR active member can see members
CREATE POLICY gmembers_select ON group_members
  FOR SELECT TO authenticated
  USING (
    is_group_owner(group_id) OR is_group_member(group_id) OR user_id = auth.uid()
  );

-- INSERT: group owner can add anyone; user can add themselves
CREATE POLICY gmembers_insert ON group_members
  FOR INSERT TO authenticated
  WITH CHECK (
    is_group_owner(group_id) OR auth.uid() = user_id
  );

-- UPDATE: group owner can update any member; member can update themselves
CREATE POLICY gmembers_update ON group_members
  FOR UPDATE TO authenticated
  USING (
    is_group_owner(group_id) OR user_id = auth.uid()
  )
  WITH CHECK (
    is_group_owner(group_id) OR user_id = auth.uid()
  );

-- DELETE: group owner can remove any member; member can remove themselves
CREATE POLICY gmembers_delete ON group_members
  FOR DELETE TO authenticated
  USING (
    is_group_owner(group_id) OR user_id = auth.uid()
  );

-- ── STEP 3: Fix groups policies (to avoid recursion into group_members) ──────

DROP POLICY IF EXISTS groups_select ON groups;
DROP POLICY IF EXISTS groups_insert ON groups;
DROP POLICY IF EXISTS groups_update ON groups;
DROP POLICY IF EXISTS groups_delete ON groups;

-- SELECT: owner OR active member (use helper to avoid recursion)
CREATE POLICY groups_select ON groups
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid() OR is_group_member(id)
  );

-- INSERT: any authenticated user can create a group
CREATE POLICY groups_insert ON groups
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- UPDATE/DELETE: owner only
CREATE POLICY groups_update ON groups
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY groups_delete ON groups
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ── STEP 4: Fix investment_members policies ───────────────────────────────────

DROP POLICY IF EXISTS imembers_select ON investment_members;
DROP POLICY IF EXISTS imembers_insert ON investment_members;
DROP POLICY IF EXISTS imembers_update ON investment_members;
DROP POLICY IF EXISTS imembers_delete ON investment_members;
DROP POLICY IF EXISTS imembers_modify ON investment_members;
DROP POLICY IF EXISTS investment_members_select ON investment_members;
DROP POLICY IF EXISTS investment_members_insert ON investment_members;

CREATE POLICY imembers_select ON investment_members
  FOR SELECT TO authenticated
  USING (
    is_investment_owner(investment_id) OR user_id = auth.uid()
  );

CREATE POLICY imembers_insert ON investment_members
  FOR INSERT TO authenticated
  WITH CHECK (
    is_investment_owner(investment_id) OR auth.uid() = user_id
  );

CREATE POLICY imembers_update ON investment_members
  FOR UPDATE TO authenticated
  USING (is_investment_owner(investment_id) OR user_id = auth.uid())
  WITH CHECK (is_investment_owner(investment_id) OR user_id = auth.uid());

CREATE POLICY imembers_delete ON investment_members
  FOR DELETE TO authenticated
  USING (is_investment_owner(investment_id) OR user_id = auth.uid());

-- ── STEP 5: Fix investments policies ─────────────────────────────────────────

DROP POLICY IF EXISTS investments_select ON investments;
DROP POLICY IF EXISTS investments_insert ON investments;
DROP POLICY IF EXISTS investments_update ON investments;
DROP POLICY IF EXISTS investments_delete ON investments;

CREATE POLICY investments_select ON investments
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid() OR is_investment_member(id)
  );

CREATE POLICY investments_insert ON investments
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY investments_update ON investments
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY investments_delete ON investments
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ── STEP 6: Fix group_rounds and group_contributions (same pattern) ───────────

DROP POLICY IF EXISTS grounds_select ON group_rounds;
DROP POLICY IF EXISTS grounds_insert ON group_rounds;
DROP POLICY IF EXISTS grounds_update ON group_rounds;
DROP POLICY IF EXISTS grounds_delete ON group_rounds;

CREATE POLICY grounds_select ON group_rounds
  FOR SELECT TO authenticated
  USING (is_group_owner(group_id) OR is_group_member(group_id));

CREATE POLICY grounds_insert ON group_rounds
  FOR INSERT TO authenticated
  WITH CHECK (is_group_owner(group_id));

CREATE POLICY grounds_update ON group_rounds
  FOR UPDATE TO authenticated
  USING (is_group_owner(group_id)) WITH CHECK (is_group_owner(group_id));

CREATE POLICY grounds_delete ON group_rounds
  FOR DELETE TO authenticated
  USING (is_group_owner(group_id));

-- ── STEP 7: Fix notice_board policies ────────────────────────────────────────

DROP POLICY IF EXISTS notices_select ON notice_board;
DROP POLICY IF EXISTS notices_insert ON notice_board;
DROP POLICY IF EXISTS notices_update ON notice_board;
DROP POLICY IF EXISTS notices_delete ON notice_board;

CREATE POLICY notices_select ON notice_board
  FOR SELECT TO authenticated
  USING (is_group_owner(group_id) OR is_group_member(group_id));

CREATE POLICY notices_insert ON notice_board
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id AND (is_group_owner(group_id) OR is_group_member(group_id))
  );

CREATE POLICY notices_update ON notice_board
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY notices_delete ON notice_board
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id OR is_group_owner(group_id));

-- ── STEP 8: Fix investment_transactions if they exist ────────────────────────

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'investment_transactions') THEN
    EXECUTE 'DROP POLICY IF EXISTS inv_tx_select ON investment_transactions';
    EXECUTE 'DROP POLICY IF EXISTS inv_tx_insert ON investment_transactions';
    EXECUTE 'DROP POLICY IF EXISTS inv_tx_delete ON investment_transactions';
    EXECUTE $pol$
      CREATE POLICY inv_tx_select ON investment_transactions
        FOR SELECT TO authenticated
        USING (is_investment_owner(investment_id) OR is_investment_member(investment_id));
    $pol$;
    EXECUTE $pol$
      CREATE POLICY inv_tx_insert ON investment_transactions
        FOR INSERT TO authenticated
        WITH CHECK (is_investment_owner(investment_id));
    $pol$;
    EXECUTE $pol$
      CREATE POLICY inv_tx_delete ON investment_transactions
        FOR DELETE TO authenticated
        USING (is_investment_owner(investment_id));
    $pol$;
  END IF;
END $$;

-- Done! Run this once in Supabase SQL Editor.
-- After running, Groups and Investments pages should load without recursion errors.
