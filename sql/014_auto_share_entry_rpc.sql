-- ──────────────────────────────────────────────────────────────────
-- 014_auto_share_entry_rpc.sql
-- SECURITY DEFINER RPC: auto-share an entry to another platform user.
--
-- WHY THIS EXISTS:
--   Three RLS policies block client-side auto-sharing:
--     1. users_own: only allows SELECT on your OWN users row →
--        client cannot look up a recipient by their email
--     2. notifs_all: only allows ALL where user_id = auth.uid() →
--        client cannot INSERT a notification for the recipient
--     3. contacts_all: only for your own contacts →
--        client cannot update linked_user_id on contacts you don't own
--
--   Additionally, a contact may not yet have linked_user_id set
--   (e.g. the sender just added them, and the recipient last logged
--   in before the contact was created). This RPC handles that case
--   by doing an email lookup into users.
--
-- WHAT IT DOES (runs with table-owner privileges):
--   1. Looks up recipient by email in the users table
--   2. If found: updates contact.linked_user_id (if not already set)
--   3. Checks for existing share_token on this entry (idempotent)
--   4. Creates share_token with recipient_id + status='sent' (if known)
--      or status='created' (email-only, no account yet)
--   5. Fires in-app notification for recipient (if found)
--
-- Returns jsonb: { ok, token_id, recipient_id, reason? }
-- ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION auto_share_entry(
  p_sender_id       uuid,
  p_entry_id        uuid,
  p_contact_id      uuid,
  p_recipient_email text,
  p_snapshot        jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipient_id  uuid;
  v_tok_id        uuid;
  v_existing_tok  uuid;
  v_from_name     text;
  v_amount        numeric;
  v_currency      text;
BEGIN
  -- Guard: skip if no email provided
  IF p_recipient_email IS NULL OR trim(p_recipient_email) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_email');
  END IF;

  -- 1. Look up recipient by email (bypasses users_own RLS)
  SELECT id INTO v_recipient_id
  FROM users
  WHERE lower(email) = lower(trim(p_recipient_email))
  LIMIT 1;

  -- 2. Update contact's linked_user_id if found and not yet set
  IF v_recipient_id IS NOT NULL AND p_contact_id IS NOT NULL THEN
    UPDATE contacts
      SET linked_user_id = v_recipient_id
    WHERE id = p_contact_id
      AND linked_user_id IS NULL;
  END IF;

  -- 3. Check if share token already exists for this entry (idempotent)
  SELECT id INTO v_existing_tok
  FROM share_tokens
  WHERE entry_id = p_entry_id
  LIMIT 1;

  IF v_existing_tok IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok',           false,
      'reason',       'share_exists',
      'token_id',     v_existing_tok,
      'recipient_id', v_recipient_id
    );
  END IF;

  -- 4. Create share token
  INSERT INTO share_tokens (
    sender_id,
    entry_id,
    recipient_email,
    recipient_id,
    status,
    entry_snapshot
  ) VALUES (
    p_sender_id,
    p_entry_id,
    lower(trim(p_recipient_email)),
    v_recipient_id,
    CASE WHEN v_recipient_id IS NOT NULL THEN 'sent' ELSE 'created' END,
    p_snapshot
  )
  RETURNING id INTO v_tok_id;

  -- 5. Fire in-app notification for recipient (if they have an account)
  IF v_recipient_id IS NOT NULL THEN
    v_from_name  := COALESCE(p_snapshot->>'from_name', 'Someone');
    v_amount     := COALESCE((p_snapshot->>'amount')::numeric, 0);
    v_currency   := COALESCE(p_snapshot->>'currency', 'USD');

    INSERT INTO notifications (
      user_id,
      type,
      message,
      entry_id,
      share_token_id,
      amount,
      currency,
      contact_name,
      read
    ) VALUES (
      v_recipient_id,
      'shared_record',
      v_from_name || ' shared a record with you: '
        || v_currency || ' ' || v_amount::text,
      p_entry_id,
      v_tok_id,
      v_amount,
      v_currency,
      v_from_name,
      false
    );
  END IF;

  RETURN jsonb_build_object(
    'ok',           true,
    'token_id',     v_tok_id,
    'recipient_id', v_recipient_id
  );
END;
$$;

-- Only authenticated users may call this (not anon/public)
REVOKE ALL ON FUNCTION auto_share_entry(uuid, uuid, uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auto_share_entry(uuid, uuid, uuid, text, jsonb) TO authenticated;
