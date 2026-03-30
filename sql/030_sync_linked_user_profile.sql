-- 030: Sync linked user profile to contacts
-- When a user updates their email/display_name, propagate to all contacts
-- that have linked_user_id pointing to them.

-- 1) Trigger function: auto-sync on user profile update
CREATE OR REPLACE FUNCTION sync_user_profile_to_contacts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- When user email changes, update contacts linked to this user
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    UPDATE contacts
    SET email = COALESCE(NEW.email, '')
    WHERE linked_user_id = NEW.id
      AND (email IS NULL OR email = '' OR email = OLD.email);
  END IF;

  -- When display_name changes, update contact name if it matches old name
  IF NEW.display_name IS DISTINCT FROM OLD.display_name AND OLD.display_name IS NOT NULL THEN
    UPDATE contacts
    SET name = NEW.display_name
    WHERE linked_user_id = NEW.id
      AND name = OLD.display_name;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_profile_to_contacts ON users;
CREATE TRIGGER trg_sync_profile_to_contacts
  AFTER UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION sync_user_profile_to_contacts();

-- 2) RPC: one-time sync for a specific contact (called from confirmShare)
CREATE OR REPLACE FUNCTION sync_contact_from_linked_user(p_contact_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _linked_id uuid;
  _email text;
  _name text;
BEGIN
  SELECT linked_user_id INTO _linked_id FROM contacts WHERE id = p_contact_id;
  IF _linked_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no linked user');
  END IF;

  SELECT email, display_name INTO _email, _name FROM users WHERE id = _linked_id;

  UPDATE contacts
  SET email = COALESCE(NULLIF(_email, ''), email),
      name = COALESCE(NULLIF(_name, ''), name)
  WHERE id = p_contact_id
    AND (email IS NULL OR email = '');

  RETURN jsonb_build_object('ok', true, 'synced_email', _email);
END;
$$;
