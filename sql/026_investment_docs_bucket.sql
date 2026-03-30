-- ═══════════════════════════════════════════════════════════════
-- Migration 026: Investment Documents storage bucket
-- Enables file uploads for investment pools (receipts, contracts, etc.)
-- ═══════════════════════════════════════════════════════════════

-- ── Create bucket for investment documents ──
INSERT INTO storage.buckets (id, name, public)
VALUES ('investment-docs', 'investment-docs', false)
ON CONFLICT (id) DO NOTHING;

-- RLS: authenticated users can upload to their own folder
DROP POLICY IF EXISTS "invdocs_insert" ON storage.objects;
CREATE POLICY "invdocs_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'investment-docs' AND (storage.foldername(name))[1] = auth.uid()::text);

-- RLS: users can read their own files
DROP POLICY IF EXISTS "invdocs_select" ON storage.objects;
CREATE POLICY "invdocs_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'investment-docs' AND (storage.foldername(name))[1] = auth.uid()::text);

-- RLS: users can delete their own files
DROP POLICY IF EXISTS "invdocs_delete" ON storage.objects;
CREATE POLICY "invdocs_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'investment-docs' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ── Table to track file metadata per investment ──
CREATE TABLE IF NOT EXISTS investment_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investment_id   uuid NOT NULL REFERENCES investments(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_name       text NOT NULL,
  file_path       text NOT NULL,
  file_size       bigint DEFAULT 0,
  mime_type       text DEFAULT '',
  note            text DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invdocs_investment ON investment_documents(investment_id);

-- RLS for investment_documents
ALTER TABLE investment_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invdocs_owner" ON investment_documents
  FOR ALL TO authenticated
  USING (user_id = auth.uid());
