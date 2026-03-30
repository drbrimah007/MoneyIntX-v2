-- Money IntX — Migration 023: Add metadata + contact_name to entries for Business Suite
-- Also expand tx_type CHECK to allow 'invoice_sent' and 'bill_sent'
-- Run in Supabase SQL Editor

-- ── 1. Add metadata JSONB column (used for business_id, due_date, expense_category, etc.) ──
ALTER TABLE entries ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- ── 2. Add contact_name TEXT column (denormalized for fast display) ──
ALTER TABLE entries ADD COLUMN IF NOT EXISTS contact_name TEXT DEFAULT '';

-- ── 3. Create GIN index on metadata for fast .contains() queries ──
CREATE INDEX IF NOT EXISTS idx_entries_metadata ON entries USING GIN (metadata);

-- ── 4. Expand tx_type CHECK to include 'invoice_sent' and 'bill_sent' ──
-- Drop old constraint first, then add expanded version
ALTER TABLE entries DROP CONSTRAINT IF EXISTS entries_tx_type_check;
ALTER TABLE entries ADD CONSTRAINT entries_tx_type_check CHECK (tx_type IN (
  'they_owe_you', 'you_owe_them',
  'they_paid_you', 'you_paid_them',
  'invoice', 'bill',
  'invoice_sent', 'bill_sent'
));

-- ── 5. Backfill contact_name from contacts table for existing entries ──
UPDATE entries e
  SET contact_name = c.name
FROM contacts c
WHERE e.contact_id = c.id
  AND (e.contact_name IS NULL OR e.contact_name = '');
