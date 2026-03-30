-- ══════════════════════════════════════════════════════════════════
-- 016_deploy_auto_create_contacts.sql
-- DEPLOY SCRIPT: Run this in Supabase SQL Editor.
-- Contains:
--   1. Updated confirm_share_for_recipient RPC (with auto-create contact)
--   2. Backfill for existing shared entries with null contact_id
-- ══════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────
-- PART 1: Updated RPC — now auto-creates contacts
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
  v_token           record;
  v_entry           record;
  v_from_name       text;
  v_from_email      text;
  v_contact_id      uuid;
  v_new_entry_id    uuid;
  v_flipped_type    text;
  v_entry_number    bigint;
  v_recipient_name  text;

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

  -- 3. Resolve from_name
  v_from_name := COALESCE(
    NULLIF(v_token.entry_snapshot->>'from_name', ''),
    (SELECT display_name FROM users WHERE id = v_token.sender_id LIMIT 1),
    'Someone'
  );

  -- 3b. Resolve recipient's display name for contact_name in notification
  v_recipient_name := COALESCE(
    (SELECT display_name FROM users WHERE id = p_recipient_id LIMIT 1),
    'Contact'
  );

  -- 4. Resolve from_email
  v_from_email := COALESCE(
    NULLIF(v_token.entry_snapshot->>'from_email', ''),
    v_token.recipient_email,
    ''
  );

  -- 5. Flip tx_type
  v_flipped_type := COALESCE(v_flip->>v_entry.tx_type, v_entry.tx_type);

  -- 6. Find or AUTO-CREATE contact in recipient's contacts
  SELECT id INTO v_contact_id
  FROM contacts
  WHERE user_id = p_recipient_id
    AND linked_user_id = v_token.sender_id
  LIMIT 1;

  IF v_contact_id IS NULL AND v_from_email <> '' THEN
    SELECT id INTO v_contact_id
    FROM contacts
    WHERE user_id = p_recipient_id
      AND lower(email) = lower(v_from_email)
    LIMIT 1;
  END IF;

  -- AUTO-CREATE: if no contact found, create one linked to the sender
  IF v_contact_id IS NULL AND v_token.sender_id IS NOT NULL THEN
    INSERT INTO contacts (user_id, name, email, linked_user_id, tags)
    VALUES (
      p_recipient_id,
      COALESCE(NULLIF(v_from_name, ''), 'Unknown'),
      COALESCE(NULLIF(v_from_email, ''), ''),
      v_token.sender_id,
      ARRAY['shared']::text[]
    )
    RETURNING id INTO v_contact_id;
  END IF;

  -- 7a. Increment recipient's entry counter
  UPDATE users SET entry_counter = COALESCE(entry_counter, 0) + 1
  WHERE id = p_recipient_id
  RETURNING entry_counter INTO v_entry_number;

  -- 7b. Insert mirrored entry
  INSERT INTO entries (
    user_id, contact_id, tx_type, sender_tx_type,
    amount, currency, date, note, invoice_number, entry_number,
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
    v_entry_number,
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
    INSERT INTO notifications (user_id, type, message, entry_id, amount, currency, contact_name, read)
    VALUES (
      v_token.sender_id,
      'shared_record',
      v_recipient_name || '''s shared record was confirmed.',
      v_token.entry_id,
      v_entry.amount,
      v_entry.currency,
      v_recipient_name,
      false
    );
  END IF;

  RETURN jsonb_build_object('entry_id', v_new_entry_id);
END;
$$;

REVOKE ALL ON FUNCTION confirm_share_for_recipient(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION confirm_share_for_recipient(uuid, uuid) TO authenticated;

-- ──────────────────────────────────────────────────────────────────
-- PART 2: Backfill existing shared entries with missing contact_id
-- ──────────────────────────────────────────────────────────────────

DO $$
DECLARE
  rec record;
  v_contact_id uuid;
  v_sender_id  uuid;
  v_count      int := 0;
BEGIN
  FOR rec IN
    SELECT e.id AS entry_id,
           e.user_id AS recipient_id,
           e.from_name,
           e.from_email,
           e.share_token,
           st.sender_id
    FROM entries e
    JOIN share_tokens st ON st.token = e.share_token
    WHERE e.is_shared = true
      AND e.contact_id IS NULL
      AND st.sender_id IS NOT NULL
  LOOP
    v_sender_id := rec.sender_id;
    v_contact_id := NULL;

    -- Check if contact already exists (by linked_user_id)
    SELECT id INTO v_contact_id
    FROM contacts
    WHERE user_id = rec.recipient_id
      AND linked_user_id = v_sender_id
    LIMIT 1;

    -- Check by email
    IF v_contact_id IS NULL AND rec.from_email IS NOT NULL AND rec.from_email <> '' THEN
      SELECT id INTO v_contact_id
      FROM contacts
      WHERE user_id = rec.recipient_id
        AND lower(email) = lower(rec.from_email)
      LIMIT 1;

      -- Link existing contact if found by email
      IF v_contact_id IS NOT NULL THEN
        UPDATE contacts SET linked_user_id = v_sender_id WHERE id = v_contact_id;
      END IF;
    END IF;

    -- Still no contact? Create one.
    IF v_contact_id IS NULL THEN
      INSERT INTO contacts (user_id, name, email, linked_user_id, tags)
      VALUES (
        rec.recipient_id,
        COALESCE(NULLIF(rec.from_name, ''), 'Unknown'),
        COALESCE(NULLIF(rec.from_email, ''), ''),
        v_sender_id,
        ARRAY['shared']::text[]
      )
      RETURNING id INTO v_contact_id;
    END IF;

    -- Update the entry
    UPDATE entries SET contact_id = v_contact_id WHERE id = rec.entry_id;
    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'Backfill complete: % entries updated', v_count;
END;
$$;
