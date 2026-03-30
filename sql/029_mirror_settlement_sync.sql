-- 029: Mirror Settlement Sync
-- Settlement mirroring is now handled by JS (entries-page.js saveMarkPaid)
-- with double-confirm: mirror settlements are always 'pending' until
-- the other party confirms.

-- 1) Add mirror_of column to settlements (links original ↔ mirror)
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS mirror_of uuid REFERENCES settlements(id);

-- 2) RPC to link two entries bidirectionally (SECURITY DEFINER bypasses RLS)
CREATE OR REPLACE FUNCTION link_mirror_entries(p_entry_id uuid, p_linked_entry_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE entries SET linked_entry_id = p_linked_entry_id WHERE id = p_entry_id;
  UPDATE entries SET linked_entry_id = p_entry_id WHERE id = p_linked_entry_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- 3) Settlement trigger — ONLY recalculates settled_amount from confirmed settlements.
--    Does NOT create mirror settlements (JS handles that with double-confirm logic).
CREATE OR REPLACE FUNCTION update_entry_settled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _entry_id uuid;
  _total_settled bigint;
  _entry_amount bigint;
BEGIN
  _entry_id := COALESCE(NEW.entry_id, OLD.entry_id);

  -- Only count CONFIRMED settlements toward settled_amount
  SELECT COALESCE(SUM(amount), 0) INTO _total_settled
  FROM settlements WHERE entry_id = _entry_id AND status = 'confirmed';

  SELECT amount INTO _entry_amount FROM entries WHERE id = _entry_id;

  UPDATE entries SET
    settled_amount = _total_settled,
    status = CASE
      WHEN _total_settled >= _entry_amount THEN 'settled'
      WHEN _total_settled > 0 THEN 'partially_settled'
      ELSE 'posted'
    END,
    updated_at = now()
  WHERE id = _entry_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;
