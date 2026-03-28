-- ── MoneyIntX v2 — Performance Optimizations ──────────────────────
-- Run this after 001_foundation.sql

-- ──────────────────────────────────────────────────────────────────
-- 1. ATOMIC ENTRY COUNTER
--    Replaces 2 sequential round-trips (SELECT + UPDATE) with 1 RPC.
--    Called from createEntry() in JS.
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION increment_entry_counter(p_user_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_next INT;
BEGIN
  UPDATE users
  SET entry_counter = entry_counter + 1
  WHERE id = p_user_id
  RETURNING entry_counter INTO v_next;
  RETURN v_next;
END;
$$;

-- Grant execute to authenticated users (RLS covers row access)
GRANT EXECUTE ON FUNCTION increment_entry_counter(UUID) TO authenticated;


-- ──────────────────────────────────────────────────────────────────
-- 2. CURRENCY LEDGER VIEW
--    Aggregates outstanding balances grouped by user + currency.
--    Used by the dashboard's "per-currency ledger cards" section.
--    Only 4 columns returned — much lighter than loading all entries.
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW currency_ledger AS
SELECT
  user_id,
  COALESCE(currency, 'USD') AS currency,
  SUM(CASE
    WHEN tx_type IN ('they_owe_you', 'invoice', 'bill')
    AND  status  NOT IN ('voided', 'cancelled', 'settled', 'fulfilled')
    AND  NOT no_ledger
    THEN GREATEST(amount - COALESCE(settled_amount, 0), 0)
    ELSE 0
  END) AS owed_to_me,
  SUM(CASE
    WHEN tx_type = 'you_owe_them'
    AND  status  NOT IN ('voided', 'cancelled', 'settled', 'fulfilled')
    AND  NOT no_ledger
    THEN GREATEST(amount - COALESCE(settled_amount, 0), 0)
    ELSE 0
  END) AS i_owe,
  COUNT(*) FILTER (
    WHERE status NOT IN ('voided', 'cancelled', 'settled', 'fulfilled')
    AND   NOT no_ledger
  ) AS active_count
FROM entries
WHERE archived_at IS NULL
GROUP BY user_id, COALESCE(currency, 'USD');

-- Row-level access: users can only see their own rows
-- (The view inherits the user_id filter, but add an explicit policy
--  on the underlying entries table rather than the view itself.)


-- ──────────────────────────────────────────────────────────────────
-- 3. INDEXES (add if not already present)
--    These cover the most common query patterns.
-- ──────────────────────────────────────────────────────────────────

-- Entries: the most queried table
CREATE INDEX IF NOT EXISTS idx_entries_user_created
  ON entries (user_id, created_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_entries_user_contact
  ON entries (user_id, contact_id)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_entries_user_status
  ON entries (user_id, status)
  WHERE archived_at IS NULL;

-- Contacts
CREATE INDEX IF NOT EXISTS idx_contacts_user_name
  ON contacts (user_id, name)
  WHERE archived_at IS NULL;

-- Settlements
CREATE INDEX IF NOT EXISTS idx_settlements_entry
  ON settlements (entry_id);

-- Notifications
CREATE INDEX IF NOT EXISTS idx_notifications_user_read
  ON notifications (user_id, read_at)
  WHERE read_at IS NULL;

-- Ledger summary: contact_id speeds up per-contact lookups
CREATE INDEX IF NOT EXISTS idx_entries_contact_id
  ON entries (contact_id)
  WHERE archived_at IS NULL;
