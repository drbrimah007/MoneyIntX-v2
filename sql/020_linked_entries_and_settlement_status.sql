-- Add linked_entry_id to entries for bidirectional entry linking
-- Allows payment sync: when a settlement is recorded on one side,
-- we can find and update the mirror entry.

ALTER TABLE entries ADD COLUMN IF NOT EXISTS linked_entry_id uuid REFERENCES entries(id);
CREATE INDEX IF NOT EXISTS idx_entries_linked ON entries(linked_entry_id);

-- Add status column to settlements for pending/confirmed workflow
-- 'confirmed' = auto-accepted (person owed recorded it)
-- 'pending'   = needs verification (person who owes recorded it)
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'confirmed';

-- Add proof_url to entries for fulfillment proof
ALTER TABLE entries ADD COLUMN IF NOT EXISTS proof_url text;
