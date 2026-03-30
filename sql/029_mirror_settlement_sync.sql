-- 029: Mirror Settlement Sync
-- Ensures payments recorded on one side of a linked entry pair automatically
-- sync to the other side.

-- 1) Add mirror_of column to settlements (prevents infinite trigger loops)
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

-- 3) Upgrade settlement trigger to auto-create mirror settlements on linked entries
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
  _linked_entry_id uuid;
  _mirror_id uuid;
BEGIN
  _entry_id := COALESCE(NEW.entry_id, OLD.entry_id);

  -- 1) Update the direct entry's settled_amount
  SELECT COALESCE(SUM(amount), 0) INTO _total_settled
  FROM settlements WHERE entry_id = _entry_id AND status = 'confirmed';

  SELECT amount INTO _entry_amount FROM entries WHERE id = _entry_id;

  UPDATE entries SET
    settled_amount = _total_settled,
    status = CASE
      WHEN _total_settled >= _entry_amount THEN 'settled'
      WHEN _total_settled > 0 THEN 'partially_settled'
      ELSE status
    END,
    updated_at = now()
  WHERE id = _entry_id;

  -- 2) Mirror settlement to linked entry (only on INSERT, skip if already a mirror)
  IF TG_OP = 'INSERT' AND NEW.mirror_of IS NULL THEN
    SELECT linked_entry_id INTO _linked_entry_id FROM entries WHERE id = _entry_id;

    IF _linked_entry_id IS NOT NULL THEN
      INSERT INTO settlements (entry_id, amount, method, note, proof_url, recorded_by, status, mirror_of)
      VALUES (_linked_entry_id, NEW.amount, NEW.method, NEW.note, NEW.proof_url, NEW.recorded_by, NEW.status, NEW.id)
      RETURNING id INTO _mirror_id;

      -- Cross-reference: point original back to mirror
      UPDATE settlements SET mirror_of = _mirror_id WHERE id = NEW.id AND mirror_of IS NULL;
    END IF;
  END IF;

  -- 3) Handle DELETE: if deleting original settlement, delete mirror too
  IF TG_OP = 'DELETE' AND OLD.mirror_of IS NULL THEN
    DELETE FROM settlements WHERE mirror_of = OLD.id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;
