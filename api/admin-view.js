// /api/admin-view.js
// Admin-only endpoint: fetch a target user's full data snapshot.
// Uses lib/db (neon SQL) — same stack as every other /api function.
// Called by impersonateUser() in the frontend.

const { sql }            = require('../lib/db');
const { requireAuthV2 }  = require('../lib/auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Authenticate caller (supports both legacy JWT and Supabase tokens)
  const caller = await requireAuthV2(req, res);
  if (!caller) return; // already sent 401

  // Verify caller is platform_admin
  const [callerRow] = await sql`SELECT role FROM users WHERE id = ${caller.id}`;
  if (!callerRow || callerRow.role !== 'platform_admin') {
    return res.status(403).json({ ok: false, error: 'Forbidden: platform_admin role required.' });
  }

  const targetUserId = req.query.userId;
  if (!targetUserId) return res.status(400).json({ ok: false, error: 'Missing userId param.' });

  try {
    // Direct SQL bypasses RLS — no service key needed
    const [user, entries, contacts, notifications, groups, settlements] = await Promise.all([
      sql`SELECT * FROM users WHERE id = ${targetUserId}`,
      sql`SELECT e.*, row_to_json(c.*) AS contact
          FROM entries e
          LEFT JOIN contacts c ON c.id = e.contact_id
          WHERE e.user_id = ${targetUserId}
          ORDER BY e.created_at DESC`,
      sql`SELECT * FROM contacts WHERE user_id = ${targetUserId} ORDER BY name`,
      sql`SELECT * FROM notifications WHERE user_id = ${targetUserId} ORDER BY created_at DESC LIMIT 100`,
      sql`SELECT gm.*, row_to_json(g.*) AS group
          FROM group_members gm
          LEFT JOIN groups g ON g.id = gm.group_id
          WHERE gm.user_id = ${targetUserId}`,
      sql`SELECT * FROM settlements WHERE user_id = ${targetUserId} ORDER BY created_at DESC`,
    ]);

    return res.status(200).json({
      ok: true,
      user:          user[0] || null,
      entries:       entries       || [],
      contacts:      contacts      || [],
      notifications: notifications || [],
      groups:        groups        || [],
      settlements:   settlements   || [],
    });
  } catch (e) {
    console.error('[admin-view] Error:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
};
