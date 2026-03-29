-- ──────────────────────────────────────────────────────────────────
-- 015_backfill_shared_contacts.sql
-- Backfill: auto-create contacts for existing shared entries that
-- have no contact_id but DO have a share_token linking to a sender.
--
-- RUN AFTER deploying 014_confirm_share_rpc.sql (updated version).
--
-- What it does:
--   1. Finds all entries where is_shared=true AND contact_id IS NULL
--   2. Joins share_tokens to get the sender_id
--   3. Checks if recipient already has a contact linked to that sender
--   4. If not, creates a new contact with from_name, from_email, linked_user_id
--   5. Updates the entry's contact_id to the new (or found) contact
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

    -- If not, check by email
    IF v_contact_id IS NULL AND rec.from_email IS NOT NULL AND rec.from_email <> '' THEN
      SELECT id INTO v_contact_id
      FROM contacts
      WHERE user_id = rec.recipient_id
        AND lower(email) = lower(rec.from_email)
      LIMIT 1;

      -- If found by email but not linked, link it
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

    -- Update the entry's contact_id
    UPDATE entries SET contact_id = v_contact_id WHERE id = rec.entry_id;
    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'Backfill complete: % entries updated', v_count;
END;
$$;
