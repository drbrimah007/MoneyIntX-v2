-- ──────────────────────────────────────────────────────────────────
-- 012_find_user_rpc.sql
-- Secure RPC to look up a user's ID by their email address.
--
-- WHY THIS EXISTS:
--   The `users` table RLS policy (users_own) only allows a user to
--   SELECT their OWN row. This means doShareEntry() cannot find
--   whether a recipient email belongs to a registered user, so
--   recipient_id on share_tokens is never set and in-app notifications
--   for shared records never fire.
--
-- SECURITY:
--   - SECURITY DEFINER runs with the table owner's privileges (bypasses RLS)
--   - Only returns the UUID (no sensitive profile data)
--   - Returns NULL if no user found (no information leak about unregistered emails)
--   - Requires the caller to be authenticated (TO authenticated)
-- ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION find_user_id_by_email(p_email text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id
  FROM users
  WHERE lower(email) = lower(p_email)
  LIMIT 1;

  RETURN v_user_id;
END;
$$;

-- Only authenticated users can call this function
REVOKE ALL ON FUNCTION find_user_id_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION find_user_id_by_email(text) TO authenticated;
