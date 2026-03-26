-- Trash / Soft Delete table — deleted items go here, only admin can see
-- Run in Supabase SQL Editor

CREATE TABLE deleted_entries (
  id              uuid PRIMARY KEY,
  original_id     uuid NOT NULL,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id      uuid,
  tx_type         text,
  amount          bigint,
  currency        text,
  settled_amount  bigint DEFAULT 0,
  note            text DEFAULT '',
  date            date,
  invoice_number  text DEFAULT '',
  entry_number    int,
  status          text,
  template_id     uuid,
  template_data   jsonb DEFAULT '{}',
  is_shared       boolean DEFAULT false,
  share_token     text,
  from_name       text DEFAULT '',
  from_email      text DEFAULT '',
  no_ledger       boolean DEFAULT false,
  is_receipt      boolean DEFAULT false,
  reminder_count  int DEFAULT 0,
  contact_name    text DEFAULT '',
  deleted_at      timestamptz NOT NULL DEFAULT now(),
  deleted_by      uuid REFERENCES users(id),
  original_created_at timestamptz
);

CREATE INDEX idx_deleted_entries_user ON deleted_entries(user_id);
CREATE INDEX idx_deleted_entries_date ON deleted_entries(deleted_at DESC);

ALTER TABLE deleted_entries ENABLE ROW LEVEL SECURITY;

-- Only admin can see deleted entries
CREATE POLICY deleted_admin ON deleted_entries FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'platform_admin'));
CREATE POLICY deleted_insert ON deleted_entries FOR INSERT TO authenticated WITH CHECK (true);
-- Admin can restore (delete from trash)
CREATE POLICY deleted_delete ON deleted_entries FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'platform_admin'));
