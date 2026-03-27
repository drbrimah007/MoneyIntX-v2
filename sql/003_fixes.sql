-- Money IntX v2 — Fix scripts
-- Run in Supabase SQL Editor for moneyintx project

-- 1. Add currency column to templates (missing from initial schema)
ALTER TABLE templates ADD COLUMN IF NOT EXISTS currency text DEFAULT '';

-- 2. Fix the auth trigger (same fix we applied manually)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS handle_new_user();

CREATE OR REPLACE FUNCTION handle_new_user() RETURNS trigger AS $$
BEGIN
  INSERT INTO public.users (id, email, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(COALESCE(NEW.email, ''), '@', 1))
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- 3. Ensure archived_at column exists on entries (for soft delete)
ALTER TABLE entries ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- 4. Ensure RLS allows insert for notifications (self-notification)
DROP POLICY IF EXISTS notifs_insert ON notifications;
CREATE POLICY notifs_insert ON notifications FOR INSERT TO authenticated WITH CHECK (true);
