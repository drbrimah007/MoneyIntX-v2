-- ──────────────────────────────────────────────────────────────────
-- 014_confirm_share_rpc.sql
-- SECURITY DEFINER RPC: confirm a shared record for a recipient.
--
-- WHY THIS EXISTS:
--   When a recipient clicks "Confirm" on a share token, the app needs to:
--     1. Read the original entry (blocked by entries RLS — recipient can't
--        read the sender's entries)
--     2. Create a mirrored entry in the recipient's ledger
--     3. Mark the share token as confirmed
--     4. Notify the sender
--
--   All four steps require cross-user data access that RLS prevents.
--   Running SECURITY DEFINER bypasses RLS so all steps succeed atomically.
--
-- WHAT IT DOES:
--   1. Validates the share token (must exist, not expired/dismissed, right recipient)
--   2. Reads the sender's entry (bypasses entries RLS)
--   3. Resolves from_name: entry_snapshot.from_name → users.display_name fallback
--   4. Resolves from_email: snapshot.from_email → share_tokens.recipient_email
--   5. Flips tx_type for recipient perspective
--   6. Finds contact_id in recipient's contacts (by linked_user_id or email)
--   7. Inserts the mirrored entry into recipient's ledger
--   8. Updates share_tokens status → 'confirmed', confirmed_at = now()
--   9. Fires a notification to the sender
--
-- Returns jsonb: { entry_id: uuid } on success, { error: text } on failure
-- ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION confirm_share_for_recipient(
  p_token_id    uuid,
  p_recipient_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token       record;
  v_entry       record;
  v_from_name   text;
  v_from_email  text;
  v_contact_id  uuid;
  v_new_entry_id uuid;
  v_flipped_type text;

  -- tx_type flip map (recipient perspective is mirror of sender's)
  v_flip        jsonb := '{
    "they_owe_you":     "you_owe_them",
    "you_owe_them":     "they_owe_you",
    "they_paid_you":    "you_paid_them",
    "you_paid_them":    "they_paid_you",
    "owed_to_me":       "i_owe",
    "i_owe":            "owed_to_me",
    "invoice_sent":     "invoice_received",
    "invoice_received": "invoice_sent",
    "bill_sent":        "bill_received",
    "bill_received":    "bill_sent",
    "invoice":          "bill",
    "bill":             "invoice"
  }'::jsonb;
BEGIN
  -- 1. Load + validate token
  SELECT * INTO v_token
  FROM share_tokens
  WHERE id = p_token_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Share token not found');
  END IF;
  IF v_token.status IN ('expired', 'dismissed', 'confirmed') THEN
    RETURN jsonb_build_object('error', 'Share is ' || v_token.status);
  END IF;

  -- 2. Read sender's entry (bypasses entries RLS)
  SELECT * INTO v_entry
  FROM entries
  WHERE id = v_token.entry_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Original entry not found');
  END IF;

  -- 3. Resolve from_name (snapshot → sender's display_name → 'Someone')
  v_from_name := COALESCE(
    NULLIF(v_token.entry_snapshot->>'from_name', ''),
    (SELECT display_name FROM users WHERE id = v_token.sender_id LIMIT 1),
    'Someone'
  );

  -- 4. Resolve from_email
  v_from_email := COALESCE(
    NULLIF(v_token.entry_snapshot->>'from_email', ''),
    v_token.recipient_email,
    ''
  );

  -- 5. Flip tx_type
  v_flipped_type := COALESCE(v_flip->>v_entry.tx_type, v_entry.tx_type);

  -- 6. Find contact_id in recipient's contacts
  --    First try: contact whose linked_user_id = sender_id
  SELECT id INTO v_contact_id
  FROM contacts
  WHERE user_id = p_recipient_id
    AND linked_user_id = v_token.sender_id
  LIMIT 1;

  --    Fallback: contact whose email = from_email
  IF v_contact_id IS NULL AND v_from_email <> '' THEN
    SELECT id INTO v_contact_id
    FROM contacts
    WHERE user_id = p_recipient_id
      AND lower(email) = lower(v_from_email)
    LIMIT 1;
  END IF;

  -- 7. Insert mirrored entry in recipient's ledger
  INSERT INTO entries (
    user_id, contact_id, tx_type, sender_tx_type,
    amount, currency, date, note, invoice_number,
    is_shared, share_token, from_name, from_email,
    status, settled_amount
  ) VALUES (
    p_recipient_id,
    v_contact_id,
    v_flipped_type,
    v_entry.tx_type,
    v_entry.amount,
    v_entry.currency,
    v_entry.date,
    COALESCE(v_entry.note, ''),
    COALESCE(v_entry.invoice_number, ''),
    true,
    v_token.token,
    v_from_name,
    v_from_email,
    'posted',
    0
  )
  RETURNING id INTO v_new_entry_id;

  -- 8. Update token status
  UPDATE share_tokens
    SET status       = 'confirmed',
        recipient_id = p_recipient_id,
        confirmed_at = now()
  WHERE id = p_token_id;

  -- 9. Notify sender
  IF v_token.sender_id IS NOT NULL THEN
    INSERT INTO notifications (user_id, type, message, entry_id, amount, currency, read)
    VALUES (
      v_token.sender_id,
      'shared_record',
      v_from_name || '''s shared record was confirmed.',
      v_token.entry_id,
      v_entry.amount,
      v_entry.currency,
      false
    );
  END IF;

  RETURN jsonb_build_object('entry_id', v_new_entry_id);
END;
$$;

REVOKE ALL ON FUNCTION confirm_share_for_recipient(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION confirm_share_for_recipient(uuid, uuid) TO authenticated;
