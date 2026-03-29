// Money IntX v2 — Supabase Client
import { createClient } from './vendor/supabase.min.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    storageKey: 'mxi-v2-auth',
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

// Helper: get current session user
export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// Helper: get current user's profile
export async function getProfile(userId) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) console.error('[getProfile]', error.message);
  return data;
}
