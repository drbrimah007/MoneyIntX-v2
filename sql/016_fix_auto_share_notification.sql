-- ──────────────────────────────────────────────────────────────────
-- 016_fix_auto_share_notification.sql
-- Fix: notification message now shows properly formatted amount
--      and includes the sender's name properly.
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
  v_amount        bigint;
  v_currency      text;
  v_formatted_amt text;
  v_tx_type       text;
BEGIN
  IF p_recipient_email IS NULL OR trim(p_recipient_email) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_email');
  END IF;

  SELECT id INTO v_recipient_id
  FROM users
  WHERE lower(email) = lower(trim(p_recipient_email))
  LIMIT 1;

  IF v_recipient_id IS NOT NULL AND p_contact_id IS NOT NULL THEN
    UPDATE contacts
      SET linked_user_id = v_recipient_id
    WHERE id = p_contact_id
      AND linked_user_id IS NULL;
  END IF;

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

  INSERT INTO share_tokens (
    sender_id, entry_id, recipient_email, recipient_id, status, entry_snapshot
  ) VALUES (
    p_sender_id, p_entry_id,
    lower(trim(p_recipient_email)), v_recipient_id,
    CASE WHEN v_recipient_id IS NOT NULL THEN 'sent' ELSE 'created' END,
    p_snapshot
  )
  RETURNING id INTO v_tok_id;

  IF v_recipient_id IS NOT NULL THEN
    v_from_name     := COALESCE(p_snapshot->>'from_name', 'Someone');
    v_amount        := COALESCE((p_snapshot->>'amount')::numeric::bigint, 0);
    v_currency      := COALESCE(p_snapshot->>'currency', 'USD');
    v_formatted_amt := COALESCE(p_snapshot->>'formatted_amount', v_currency || ' ' || (v_amount::numeric / 100)::text);
    v_tx_type       := COALESCE(p_snapshot->>'tx_type', '');

    INSERT INTO notifications (
      user_id, type, message, entry_id, share_token_id, amount, currency, contact_name, read
    ) VALUES (
      v_recipient_id, 'shared_record',
      v_from_name || ' shared a record with you: ' || v_formatted_amt,
      p_entry_id, v_tok_id, v_amount, v_currency, v_from_name, false
    );
  END IF;

  RETURN jsonb_build_object(
    'ok',           true,
    'token_id',     v_tok_id,
    'recipient_id', v_recipient_id
  );
END;
$$;

REVOKE ALL ON FUNCTION auto_share_entry(uuid, uuid, uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auto_share_entry(uuid, uuid, uuid, text, jsonb) TO authenticated;
