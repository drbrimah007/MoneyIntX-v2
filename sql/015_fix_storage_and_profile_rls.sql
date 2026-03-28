-- 015_fix_storage_and_profile_rls.sql
-- Fixes:
--   1. Storage bucket RLS — allow authenticated users to upload their own avatars/logos
--   2. Users table — ensure UPDATE policy exists for profile saves

-- ── 1. Storage: avatars bucket ────────────────────────────────────
-- Create bucket if it doesn't exist (idempotent)
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Allow authenticated users to upload their own avatar
DROP POLICY IF EXISTS "avatars_insert" ON storage.objects;
CREATE POLICY "avatars_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "avatars_update" ON storage.objects;
CREATE POLICY "avatars_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "avatars_select" ON storage.objects;
CREATE POLICY "avatars_select" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatars_delete" ON storage.objects;
CREATE POLICY "avatars_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ── 2. Storage: user-logos bucket ────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('user-logos', 'user-logos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "logos_insert" ON storage.objects;
CREATE POLICY "logos_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'user-logos' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "logos_update" ON storage.objects;
CREATE POLICY "logos_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'user-logos' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "logos_select" ON storage.objects;
CREATE POLICY "logos_select" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'user-logos');

DROP POLICY IF EXISTS "logos_delete" ON storage.objects;
CREATE POLICY "logos_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'user-logos' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ── 3. Users table — ensure UPDATE policy ─────────────────────────
-- Drop and recreate to ensure it's correct
DROP POLICY IF EXISTS "users_update_own" ON users;
CREATE POLICY "users_update_own" ON users
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Also ensure SELECT policy exists
DROP POLICY IF EXISTS "users_select_own" ON users;
CREATE POLICY "users_select_own" ON users
  FOR SELECT TO authenticated
  USING (true);  -- users can read any user row (for contact linking)
