-- Fix record_payment() to use valid entries_status_check values
-- 'paid'    → 'settled'           (fully paid)
-- 'partial' → 'partially_settled' (partially paid)
-- Run this in Supabase SQL Editor

CREATE OR REPLACE FUNCTION record_payment(
  p_entry_id    UUID,
  p_user_id     UUID,
  p_amount      INTEGER,    -- cents
  p_currency    TEXT,
  p_date        DATE,
  p_note        TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_entry           RECORD;
  v_new_paid        INTEGER;
  v_new_outstanding INTEGER;
  v_new_status      TEXT;
  v_payment_id      UUID;
BEGIN
  -- Lock and fetch entry
  SELECT * INTO v_entry FROM entries WHERE id = p_entry_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'Entry not found');
  END IF;

  v_new_paid        := COALESCE(v_entry.paid_amount, 0) + p_amount;
  v_new_outstanding := GREATEST(0, COALESCE(v_entry.amount, 0) - v_new_paid);

  -- Use values allowed by entries_status_check constraint
  v_new_status := CASE
    WHEN v_new_outstanding = 0 THEN 'settled'
    WHEN v_new_paid > 0        THEN 'partially_settled'
    ELSE v_entry.status
  END;

  -- Insert payment record
  INSERT INTO payments (entry_id, user_id, amount, currency, payment_date, note)
    VALUES (p_entry_id, p_user_id, p_amount, p_currency, p_date, p_note)
    RETURNING id INTO v_payment_id;

  -- Update entry
  UPDATE entries SET
    paid_amount        = v_new_paid,
    outstanding_amount = v_new_outstanding,
    status             = v_new_status,
    updated_at         = NOW()
  WHERE id = p_entry_id;

  RETURN json_build_object(
    'ok', true,
    'payment_id', v_payment_id,
    'paid_amount', v_new_paid,
    'outstanding_amount', v_new_outstanding,
    'status', v_new_status
  );
END;
$$;
