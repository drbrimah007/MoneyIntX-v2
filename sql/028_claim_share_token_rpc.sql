-- ============================================================
-- claim_share_by_token  — lets a newly-signed-up user claim
-- a shared record they received via URL (no email match needed).
--
-- Runs as SECURITY DEFINER so it bypasses RLS (the user can't
-- SELECT share_tokens they don't own yet).
--
-- Authorization: possession of the token IS the authorization.
-- The token can only be claimed once (recipient_id must be NULL).
-- ============================================================

CREATE OR REPLACE FUNCTION claim_share_by_token(p_token text, p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_share record;
BEGIN
  -- Find the share token
  SELECT id, recipient_id, sender_id, status
    INTO v_share
    FROM share_tokens
   WHERE token = p_token;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'reason', 'not_found');
  END IF;

  -- Don't let sender claim their own share
  IF v_share.sender_id = p_user_id THEN
    RETURN json_build_object('ok', false, 'reason', 'own_share');
  END IF;

  -- Check if already claimed by someone
  IF v_share.recipient_id IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'already_claimed');
  END IF;

  -- Claim it — set recipient and advance status so it shows in "Shared With Me"
  UPDATE share_tokens
     SET recipient_id = p_user_id,
         status = 'sent'
   WHERE id = v_share.id;

  RETURN json_build_object('ok', true, 'share_id', v_share.id);
END;
$$;
