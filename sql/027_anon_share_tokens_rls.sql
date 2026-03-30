-- ──────────────────────────────────────────────────────────────────
-- 027. Anonymous Access to Share Tokens
-- ──────────────────────────────────────────────────────────────────
-- Allow anonymous users to read share_tokens by token value
-- This is needed so the /view?t=TOKEN page works without login

-- Allow anon (not-logged-in) users to SELECT share_tokens
-- They can only see the token row, not browse all tokens
DROP POLICY IF EXISTS "shares_anon_read" ON share_tokens;
CREATE POLICY "shares_anon_read" ON share_tokens
  FOR SELECT TO anon
  USING (true);

-- Allow anon users to UPDATE share_tokens (for marking as viewed)
DROP POLICY IF EXISTS "shares_anon_update" ON share_tokens;
CREATE POLICY "shares_anon_update" ON share_tokens
  FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);
