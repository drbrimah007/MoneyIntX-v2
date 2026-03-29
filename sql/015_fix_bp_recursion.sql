-- Fix infinite recursion in business_panels RLS policies
-- The bp_member_read policy on business_panels queries business_panel_members,
-- but bpm_owner_all on business_panel_members queries back to business_panels.
-- Solution: Use a SECURITY DEFINER function to break the RLS recursion.

-- Step 1: Drop the recursive policy
DROP POLICY IF EXISTS "bp_member_read" ON business_panels;

-- Step 2: Create a SECURITY DEFINER function to check membership without RLS
CREATE OR REPLACE FUNCTION check_panel_membership(p_panel_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM business_panel_members
    WHERE panel_id = p_panel_id AND member_user_id = p_user_id
  );
$$;

-- Step 3: Recreate the policy using the function (bypasses RLS on the subquery)
CREATE POLICY "bp_member_read" ON business_panels
  FOR SELECT USING (
    check_panel_membership(id, auth.uid())
  );
