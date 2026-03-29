// Money IntX — Notifications Page Module
// Extracted from index.html page modules

import { getCurrentUser, contactColor } from './state.js';
import { esc, toast, fmtRelative } from '../ui.js';
import { fmtMoney } from '../entries.js';
import { supabase } from '../supabase.js';
import { listNotifications, markAllRead } from '../notifications.js';

// ── Notifications ─────────────────────────────────────────────────
export async function renderNotifications(el) {
  el.innerHTML = '<div class="page-header"><h2>Notifications</h2></div><p style="color:var(--muted);">Loading...</p>';

  const currentUser = getCurrentUser();
  let notifs;
  if (window._impersonatedData) {
    notifs = window._impersonatedData.notifications || [];
  } else {
    notifs = await listNotifications(currentUser.id);
    await markAllRead(currentUser.id);
    window.updateNotifBadge();
  }

  const typeBadge = (t) => {
    const map = {
      reminder:           { bg:'rgba(248,113,113,.15)', color:'var(--red)',    label:'🚩 Reminder' },
      notification:       { bg:'rgba(96,165,250,.15)',  color:'var(--accent)', label:'📬 Sent' },
      payment_sent:       { bg:'rgba(96,165,250,.15)',  color:'var(--accent)', label:'📤 Sent' },
      payment_received:   { bg:'rgba(74,222,128,.15)',  color:'var(--green)',  label:'📩 Received' },
      settlement_pending: { bg:'rgba(251,191,36,.15)',  color:'var(--amber)',  label:'⏳ Review' },
      viewed:             { bg:'rgba(108,99,255,.12)',  color:'var(--accent)', label:'👁 Viewed' },
      confirmed:          { bg:'rgba(74,222,128,.15)',  color:'var(--green)',  label:'✅ Confirmed' },
      shared_record:      { bg:'rgba(108,99,255,.12)',  color:'var(--accent)', label:'🔗 Shared' },
      fulfilled:          { bg:'rgba(74,222,128,.15)',  color:'var(--green)',  label:'✅ Fulfilled' },
    };
    const m = map[t] || { bg:'var(--bg3)', color:'var(--muted)', label:t||'📤 Sent' };
    return `<span class="badge" style="background:${m.bg};color:${m.color};">${m.label}</span>`;
  };

  let html = `<div class="page-header"><h2>Notifications</h2>
    ${notifs.length > 0 ? `<button class="bs sm" onclick="clearAllNotifs()">Clear All</button>` : ''}
  </div>`;
  if (notifs.length === 0) {
    html += `<div class="card" style="text-align:center;padding:40px;"><p style="color:var(--muted);">No notifications yet.</p></div>`;
  } else {
    html += `<div class="card"><div class="tbl-wrap"><table><thead><tr>
      <th>Contact</th><th>Amount</th><th class="hide-mobile">Message</th><th>Date</th><th>Event</th><th></th>
    </tr></thead><tbody>`;
    notifs.forEach(n => {
      const actionBtn = n.type === 'shared_record'
        ? `<button onclick="navTo('entries')" style="background:var(--accent);color:#fff;border:none;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px;font-weight:600;margin-right:4px;">View</button>`
        : '';
      html += `<tr>
        <td style="font-weight:600;font-size:13px;color:${n.contact_id ? contactColor(n.contact_id) : 'var(--text)'}">${esc(n.contact_name || '—')}</td>
        <td style="font-weight:700;font-size:13px;">${n.amount ? fmtMoney(n.amount, n.currency || 'USD') : '—'}</td>
        <td class="hide-mobile" style="font-size:13px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(n.message)}">${esc(n.message)}</td>
        <td style="font-size:12px;color:var(--muted);">${fmtRelative(n.created_at)}</td>
        <td>${typeBadge(n.type)}</td>
        <td style="white-space:nowrap;">${actionBtn}<button onclick="deleteNotif('${n.id}')" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:14px;">✕</button></td>
      </tr>`;
    });
    html += `</tbody></table></div></div>`;
  }
  el.innerHTML = html;
}

window.deleteNotif = async function(id) {
  await supabase.from('notifications').delete().eq('id', id);
  window.navTo('notifications');
};

window.clearAllNotifs = async function() {
  const currentUser = getCurrentUser();
  if (!confirm('Clear all notifications?')) return;
  await supabase.from('notifications').delete().eq('user_id', currentUser.id);
  toast('Cleared.', 'success');
  window.navTo('notifications');
};
