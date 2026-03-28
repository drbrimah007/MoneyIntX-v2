-- Money IntX v2 — Migration 009: Transaction Schema V2
-- Implements the Developer Handoff spec:
--   - New category enum (9 values, permanent)
--   - direction_sign (+1 / -1) on every record
--   - due_date, paid_amount, outstanding_amount, status upgrade
--   - payments table for partial settlement tracking
--   - Migrates existing tx_type values → new category + direction_sign
-- Run in Supabase SQL Editor

-- ── 1. Add new columns to entries ─────────────────────────────────────────────

ALTER TABLE entries
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS direction_sign SMALLINT,
  ADD COLUMN IF NOT EXISTS due_date DATE,
  ADD COLUMN IF NOT EXISTS paid_amount INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS outstanding_amount INTEGER;

-- ── 2. Backfill category + direction_sign from existing tx_type ───────────────

UPDATE entries SET
  category = CASE tx_type
    WHEN 'they_owe_you'  THEN 'owed_to_me'
    WHEN 'invoice'       THEN 'invoice_sent'
    WHEN 'bill'          THEN 'bill_sent'
    WHEN 'you_owe_them'  THEN 'i_owe'
    WHEN 'they_paid_you' THEN 'payment_recorded'
    WHEN 'you_paid_them' THEN 'payment_recorded'
    ELSE tx_type
  END,
  direction_sign = CASE tx_type
    WHEN 'they_owe_you'  THEN  1
    WHEN 'invoice'       THEN  1
    WHEN 'bill'          THEN  1
    WHEN 'you_owe_them'  THEN -1
    WHEN 'they_paid_you' THEN -1   -- payment reduces positive balance
    WHEN 'you_paid_them' THEN  1   -- payment reduces negative balance
    ELSE 0
  END
WHERE category IS NULL;

-- ── 3. Set outstanding_amount = amount - paid_amount for open records ─────────

UPDATE entries
  SET outstanding_amount = amount - paid_amount
WHERE outstanding_amount IS NULL;

-- ── 4. Add CHECK constraint on category ───────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'entries_category_check'
  ) THEN
    ALTER TABLE entries ADD CONSTRAINT entries_category_check
      CHECK (category IN (
        'owed_to_me', 'bill_sent', 'invoice_sent',
        'i_owe', 'bill_received', 'invoice_received',
        'advance_paid', 'advance_received', 'payment_recorded'
      ));
  END IF;
END $$;

-- ── 5. Add CHECK constraint on direction_sign ────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'entries_direction_sign_check'
  ) THEN
    ALTER TABLE entries ADD CONSTRAINT entries_direction_sign_check
      CHECK (direction_sign IN (-1, 0, 1));
  END IF;
END $$;

-- ── 6. Ensure status column supports all required values ─────────────────────
-- (The status column already exists but may need 'open' and 'partial' added)
-- Supabase uses TEXT for status, so no enum change needed.

-- ── 7. Create payments table ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id         UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount           INTEGER NOT NULL,      -- cents
  currency         TEXT NOT NULL DEFAULT 'USD',
  payment_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  note             TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_entry ON payments(entry_id);
CREATE INDEX IF NOT EXISTS idx_payments_user  ON payments(user_id);

-- ── 8. RLS for payments table ─────────────────────────────────────────────────

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "payments owner access"
  ON payments FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ── 9. Function: record a payment (updates entry status atomically) ───────────

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
  v_entry        RECORD;
  v_new_paid     INTEGER;
  v_new_outstanding INTEGER;
  v_new_status   TEXT;
  v_payment_id   UUID;
BEGIN
  -- Lock and fetch entry
  SELECT * INTO v_entry FROM entries WHERE id = p_entry_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'Entry not found');
  END IF;

  v_new_paid        := v_entry.paid_amount + p_amount;
  v_new_outstanding := GREATEST(0, v_entry.amount - v_new_paid);

  v_new_status := CASE
    WHEN v_new_outstanding = 0 THEN 'paid'
    WHEN v_new_paid > 0        THEN 'partial'
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

-- Done!
-- After running, verify:
--   SELECT category, direction_sign, COUNT(*) FROM entries GROUP BY 1,2 ORDER BY 1;
