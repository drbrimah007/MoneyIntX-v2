-- Money IntX v2 — Migration 008
-- 1. Add is_searchable column to users
-- 2. Create user-logos storage bucket (public) for logo uploads
-- Run in Supabase SQL Editor

-- ── 1. Add is_searchable to users ─────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_searchable boolean NOT NULL DEFAULT true;

-- Allow authenticated users to search for other searchable users
-- (Used in the contact search / share invite flow)
-- Existing SELECT policies on 'users' already allow reads; the app filters by is_searchable in JS.

-- ── 2. Create user-logos storage bucket ───────────────────────────────────────
-- NOTE: You can also create this in Storage → New bucket → name: "user-logos", Public: ON
-- The SQL below does the same thing programmatically:
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'user-logos',
  'user-logos',
  true,
  2097152,  -- 2 MB max
  ARRAY['image/jpeg','image/png','image/gif','image/webp','image/svg+xml']
)
ON CONFLICT (id) DO NOTHING;

-- ── 3. RLS policies for user-logos bucket ─────────────────────────────────────
-- Users can upload to their own folder (path starts with their user_id)
CREATE POLICY IF NOT EXISTS "user logos upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'user-logos' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Users can update/replace their own logos
CREATE POLICY IF NOT EXISTS "user logos update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'user-logos' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Users can delete their own logos
CREATE POLICY IF NOT EXISTS "user logos delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'user-logos' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Anyone can read (bucket is public, but explicit policy for SELECT is good practice)
CREATE POLICY IF NOT EXISTS "user logos public read"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'user-logos');

-- Done!
