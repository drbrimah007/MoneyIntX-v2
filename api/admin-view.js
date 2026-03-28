// /api/admin-view.js
// Admin-only endpoint: fetch a target user's full data snapshot
// bypassing RLS using the service role key.
// Called by impersonateUser() in the frontend.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://nczneamvffmzdbeuvloo.supabase.co';
const ANON_KEY    = process.env.SUPABASE_ANON_KEY || 'sb_publishable_fzv-ZnSvv6p-Udo8ygJN9g_VekzqguV';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!SERVICE_KEY) {
    return res.status(503).json({ ok: false, error: 'SUPABASE_SERVICE_KEY not configured on server.' });
  }

  // Verify the caller is a platform_admin via their JWT
  const authHeader = req.headers['authorization'] || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  if (!jwt) return res.status(401).json({ ok: false, error: 'Missing Authorization header.' });

  // Use anon client to verify caller's session
  const anonClient = createClient(SUPABASE_URL, ANON_KEY);
  const { data: { user: caller }, error: authErr } = await anonClient.auth.getUser(jwt);
  if (authErr || !caller) return res.status(401).json({ ok: false, error: 'Invalid token.' });

  // Verify caller is platform_admin
  const { data: callerProfile } = await anonClient.from('users').select('role').eq('id', caller.id).single();
  if (callerProfile?.role !== 'platform_admin') {
    return res.status(403).json({ ok: false, error: 'Forbidden: platform_admin role required.' });
  }

  const targetUserId = req.query.userId;
  if (!targetUserId) return res.status(400).json({ ok: false, error: 'Missing userId param.' });

  // Use service role key to bypass RLS entirely
  const svc = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const [userRes, entriesRes, contactsRes, notifsRes, groupsRes, settlementsRes] = await Promise.all([
      svc.from('users').select('*').eq('id', targetUserId).single(),
      svc.from('entries').select('*, contact:contacts(id,name,email)').eq('user_id', targetUserId).order('created_at', { ascending: false }),
      svc.from('contacts').select('*').eq('user_id', targetUserId).order('name'),
      svc.from('notifications').select('*').eq('user_id', targetUserId).order('created_at', { ascending: false }).limit(100),
      svc.from('group_members').select('*, group:groups(*)').eq('user_id', targetUserId),
      svc.from('settlements').select('*').eq('user_id', targetUserId).order('created_at', { ascending: false }),
    ]);

    return res.status(200).json({
      ok: true,
      user:          userRes.data,
      entries:       entriesRes.data      || [],
      contacts:      contactsRes.data     || [],
      notifications: notifsRes.data       || [],
      groups:        groupsRes.data       || [],
      settlements:   settlementsRes.data  || [],
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
