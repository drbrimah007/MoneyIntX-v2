-- ──────────────────────────────────────────────────────────────────
-- 013_on_user_login_rpc.sql
-- SECURITY DEFINER RPC called on every login to do cross-user linking.
--
-- WHY THIS EXISTS:
--   RLS on contacts (user_id = auth.uid()) and share_tokens
--   (sender_id = auth.uid() OR recipient_id = auth.uid()) prevents a user
--   from updating records they don't own — even to set their own user ID
--   on a contact that another user created for them.
--
--   Result without this fix:
--     - contacts.linked_user_id = NULL for everyone
--     - share_tokens.recipient_id = NULL for everyone
--     - Zero cross-user in-app notifications ever fire
--
-- WHAT IT DOES (runs with table-owner privileges):
--   1. Sets linked_user_id on all contacts where email = p_email (any owner)
--   2. Sets recipient_id on pending share_tokens where recipient_email = p_email
--   3. Fires an in-app notification for each newly linked share
--
-- Returns jsonb: { contacts_linked: N, shares_linked: N }
-- ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION on_user_login(p_email text, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_count int;
  v_share_count   int;
  v_share         record;
BEGIN
  -- 1. Link all contacts across ALL users that have this email
  UPDATE contacts
    SET linked_user_id = p_user_id
  WHERE lower(email) = lower(p_email)
    AND linked_user_id IS NULL;
  GET DIAGNOSTICS v_contact_count = ROW_COUNT;

  -- 2. Link share tokens sent to this email that have no recipient yet
  FOR v_share IN
    SELECT id, sender_id, entry_id, entry_snapshot, token
    FROM share_tokens
    WHERE lower(recipient_email) = lower(p_email)
      AND recipient_id IS NULL
      AND status NOT IN ('expired','dismissed','confirmed')
  LOOP
    UPDATE share_tokens
      SET recipient_id = p_user_id,
          status = CASE WHEN status = 'created' THEN 'sent' ELSE status END
    WHERE id = v_share.id;

    -- Fire in-app notification for each newly linked share
    INSERT INTO notifications (user_id, type, message, entry_id, amount, currency, read)
    VALUES (
      p_user_id,
      'shared_record',
      COALESCE(v_share.entry_snapshot->>'from_name', 'Someone') || ' shared a record with you: '
        || COALESCE((v_share.entry_snapshot->>'amount')::text, '') || ' '
        || COALESCE(v_share.entry_snapshot->>'currency', ''),
      v_share.entry_id,
      COALESCE((v_share.entry_snapshot->>'amount')::bigint, 0),
      COALESCE(v_share.entry_snapshot->>'currency', 'USD'),
      false
    );
  END LOOP;

  GET DIAGNOSTICS v_share_count = ROW_COUNT;

  RETURN jsonb_build_object('contacts_linked', v_contact_count, 'shares_linked', v_share_count);
END;
$$;

REVOKE ALL ON FUNCTION on_user_login(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION on_user_login(text, uuid) TO authenticated;
