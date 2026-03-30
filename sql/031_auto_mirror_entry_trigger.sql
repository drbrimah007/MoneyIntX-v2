-- 031: Auto-mirror entries for linked contacts
-- When a new entry is created for a contact that has linked_user_id,
-- automatically create a mirror entry on the linked user's side with
-- flipped tx_type, bidirectional linking, and a notification.

CREATE OR REPLACE FUNCTION auto_mirror_entry_for_linked_contact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _linked_user_id uuid;
  _sender_name text;
  _flipped_type text;
  _mirror_contact_id uuid;
  _mirror_entry_id uuid;
  _next_num int;
BEGIN
  -- Skip if this entry already has a linked_entry_id (it's itself a mirror)
  IF NEW.linked_entry_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Skip if no contact
  IF NEW.contact_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Check if the contact has a linked_user_id
  SELECT linked_user_id INTO _linked_user_id
  FROM contacts WHERE id = NEW.contact_id;

  IF _linked_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Don't mirror to yourself
  IF _linked_user_id = NEW.user_id THEN
    RETURN NEW;
  END IF;

  -- Get sender's display name
  SELECT COALESCE(display_name, email, 'Someone') INTO _sender_name
  FROM users WHERE id = NEW.user_id;

  -- Flip the tx_type for the recipient's perspective
  _flipped_type := CASE NEW.tx_type
    WHEN 'they_owe_you'     THEN 'you_owe_them'
    WHEN 'you_owe_them'     THEN 'they_owe_you'
    WHEN 'they_paid_you'    THEN 'you_paid_them'
    WHEN 'you_paid_them'    THEN 'they_paid_you'
    WHEN 'owed_to_me'       THEN 'i_owe'
    WHEN 'i_owe'            THEN 'owed_to_me'
    WHEN 'invoice_sent'     THEN 'invoice_received'
    WHEN 'invoice_received' THEN 'invoice_sent'
    WHEN 'bill_sent'        THEN 'bill_received'
    WHEN 'bill_received'    THEN 'bill_sent'
    WHEN 'invoice'          THEN 'bill'
    WHEN 'bill'             THEN 'invoice'
    WHEN 'payment_recorded' THEN 'payment_recorded'
    ELSE NEW.tx_type
  END;

  -- Find the recipient's contact record that points back to the sender
  SELECT id INTO _mirror_contact_id
  FROM contacts
  WHERE user_id = _linked_user_id AND linked_user_id = NEW.user_id
  LIMIT 1;

  -- If no reciprocal contact exists, create one
  IF _mirror_contact_id IS NULL THEN
    INSERT INTO contacts (user_id, name, email, linked_user_id)
    VALUES (_linked_user_id, _sender_name,
            (SELECT COALESCE(email, '') FROM users WHERE id = NEW.user_id),
            NEW.user_id)
    RETURNING id INTO _mirror_contact_id;
  END IF;

  -- Increment entry counter for recipient
  BEGIN
    UPDATE users SET entry_counter = COALESCE(entry_counter, 0) + 1
    WHERE id = _linked_user_id
    RETURNING entry_counter INTO _next_num;
  EXCEPTION WHEN OTHERS THEN
    _next_num := 1;
  END;

  -- Create the mirror entry
  INSERT INTO entries (
    user_id, contact_id, tx_type, sender_tx_type, amount, currency,
    date, note, invoice_number, entry_number, status, settled_amount,
    is_shared, from_name, linked_entry_id, template_id, template_data, metadata
  ) VALUES (
    _linked_user_id, _mirror_contact_id, _flipped_type, NEW.tx_type,
    NEW.amount, NEW.currency, NEW.date, NEW.note, NEW.invoice_number,
    _next_num, 'posted', 0, true, _sender_name, NEW.id,
    NEW.template_id, NEW.template_data, NEW.metadata
  ) RETURNING id INTO _mirror_entry_id;

  -- Link original entry back to mirror
  UPDATE entries SET linked_entry_id = _mirror_entry_id WHERE id = NEW.id;

  -- Notify the linked user
  INSERT INTO notifications (user_id, type, entry_id, contact_name, amount, currency, title, message, read)
  VALUES (
    _linked_user_id,
    'entry_received',
    _mirror_entry_id,
    _sender_name,
    NEW.amount,
    NEW.currency,
    'New entry from ' || _sender_name,
    _sender_name || ' recorded a ' || REPLACE(_flipped_type, '_', ' ') || ' entry for ' ||
      TO_CHAR(NEW.amount / 100.0, 'FM$999,999,990.00'),
    false
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_mirror_entry ON entries;
CREATE TRIGGER trg_auto_mirror_entry
  AFTER INSERT ON entries
  FOR EACH ROW
  EXECUTE FUNCTION auto_mirror_entry_for_linked_contact();
