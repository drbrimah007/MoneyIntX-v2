// Money IntX v2 — Supabase Configuration
// Public keys only — safe for client code. Security comes from RLS.

export const SUPABASE_URL = 'https://nczneamvffmzdbeuvloo.supabase.co';
// Use the legacy JWT anon key — it embeds "role":"anon" which PostgREST
// needs to apply anon RLS policies (e.g. share_tokens guest reads).
// The modern sb_publishable_ key doesn't carry role info, so anonymous
// (not-logged-in) requests fail to match anon policies.
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5jem5lYW12ZmZtemRiZXV2bG9vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0ODU5MTEsImV4cCI6MjA5MDA2MTkxMX0.IcKmi7Nh9p0xmgmTDcPpmii_DKGQa8W9ox223r9lVqg';
