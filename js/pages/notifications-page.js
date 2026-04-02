// Money IntX — Notifications Page Module
// Extracted from index.html page modules

import { getCurrentUser, getCurrentProfile, contactColor } from './state.js';
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
      reminder:           { bg:'rgba(208,120,120,.12)', color:'var(--red, #d07878)', label:'🚩 Reminder' },
      notification:       { bg:'rgba(143,168,214,.12)', color:'var(--accent)', label:'📬 Sent' },
      payment_sent:       { bg:'rgba(143,168,214,.12)', color:'var(--accent)', label:'📤 Sent' },
      payment_received:   { bg:'rgba(127,224,208,.12)', color:'var(--green)',  label:'📩 Received' },
      settlement_pending:   { bg:'rgba(214,185,122,.12)', color:'var(--amber)',  label:'⏳ Review' },
      settlement_confirmed: { bg:'rgba(127,224,208,.12)', color:'var(--green)',  label:'✅ Confirmed' },
      settlement_rejected:  { bg:'rgba(208,120,120,.12)', color:'var(--red, #d07878)', label:'❌ Rejected' },
      entry_received:       { bg:'rgba(143,168,214,.12)', color:'var(--accent)', label:'📥 Received' },
      viewed:               { bg:'rgba(143,168,214,.12)', color:'var(--accent)', label:'👁 Viewed' },
      confirmed:            { bg:'rgba(127,224,208,.12)', color:'var(--green)',  label:'✅ Confirmed' },
      shared_record:        { bg:'rgba(143,168,214,.12)', color:'var(--accent)', label:'🔗 Shared' },
      fulfilled:            { bg:'rgba(127,224,208,.12)', color:'var(--green)',  label:'✅ Fulfilled' },
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
    // Sort: actionable items first (but NOT if already resolved), then newest
    const ACTIONABLE = new Set(['settlement_pending','payment_received','payment_sent','shared_record','entry_received']);
    notifs.sort((a, b) => {
      const aResolved = a.status === 'resolved';
      const bResolved = b.status === 'resolved';
      const aAct = (ACTIONABLE.has(a.type) && !aResolved) ? 0 : 1;
      const bAct = (ACTIONABLE.has(b.type) && !bResolved) ? 0 : 1;
      if (aAct !== bAct) return aAct - bAct;
      return new Date(b.created_at) - new Date(a.created_at);
    });

    const myName = getCurrentProfile()?.display_name || getCurrentProfile()?.full_name || '';

    notifs.forEach(n => {
      const nColor = n.contact_id ? contactColor(n.contact_id) : null;
      // Resolve display name — never show '—' or empty
      let displayName = n.contact_name || '';
      if (!displayName && n.message) {
        // Try to extract name from message (e.g. "SomeName shared a record...")
        const nameMatch = n.message.match(/^(\S+)/);
        if (nameMatch) displayName = nameMatch[1];
      }
      if (!displayName) displayName = 'Unknown';

      // Replace self-references: if the notification message mentions our own name
      // talking about our own record, rewrite for clarity
      let displayMessage = n.message || '';
      if (myName && displayMessage.includes(myName + "'s shared record was confirmed")) {
        displayMessage = displayMessage.replace(myName + "'s shared record was confirmed", "Your shared record was confirmed");
      }
      if (myName && displayMessage.includes(myName + "'s shared record")) {
        displayMessage = displayMessage.replace(myName + "'s shared record", "Your shared record");
      }

      // Action button based on notification type + resolution status
      let actionBtn = '';
      const isResolved = n.status === 'resolved';
      if (isResolved && (n.type === 'settlement_pending' || n.type === 'payment_received')) {
        // Already acted upon — show done indicator, not Review button
        actionBtn = `<span style="font-size:12px;color:var(--green,#7fe0d0);font-weight:600;">✓ Done</span>`;
      } else if (n.type === 'shared_record') {
        actionBtn = `<button onclick="navTo('entries')" style="background:var(--accent);color:#fff;border:none;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px;font-weight:600;margin-right:4px;">View</button>`;
      } else if (n.entry_id && (n.type === 'settlement_pending' || n.type === 'payment_received' || n.type === 'entry_received')) {
        const isSettlement = n.type === 'settlement_pending' || n.type === 'payment_received';
        actionBtn = `<button onclick="openEntryDetail('${n.entry_id}', { reviewMode: ${isSettlement ? 'true' : 'false'} })" style="background:var(--amber,#D5BA78);color:#000;border:none;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px;font-weight:700;margin-right:4px;">${isSettlement ? 'Review' : 'View'}</button>`;
      } else if (!n.entry_id && n.type === 'settlement_pending') {
        actionBtn = `<button onclick="navTo('entries')" style="background:var(--amber,#D5BA78);color:#000;border:none;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px;font-weight:600;margin-right:4px;">View Entries</button>`;
      } else if (n.entry_id) {
        actionBtn = `<button onclick="openEntryDetail('${n.entry_id}')" style="background:var(--accent);color:#fff;border:none;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px;font-weight:600;margin-right:4px;">View</button>`;
      }
      html += `<tr>
        <td style="font-weight:600;font-size:13px;"><span style="display:inline-flex;align-items:center;gap:6px;">${nColor ? `<span style="width:22px;height:22px;border-radius:50%;background:${nColor};display:inline-flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff;flex-shrink:0;">${esc(displayName.charAt(0).toUpperCase())}</span>` : ''}<span style="color:${nColor || 'var(--text)'};">${esc(displayName)}</span></span></td>
        <td style="font-weight:700;font-size:13px;">${n.amount ? fmtMoney(n.amount, n.currency || 'USD') : '—'}</td>
        <td class="hide-mobile" style="font-size:13px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(displayMessage)}">${esc(displayMessage)}</td>
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
  // Remove from DOM immediately (no page refresh)
  const btn = event?.target;
  const row = btn?.closest('tr');
  if (row) {
    row.style.transition = 'opacity 0.2s';
    row.style.opacity = '0';
    setTimeout(() => row.remove(), 200);
  }
  await supabase.from('notifications').delete().eq('id', id);
  // Update badge count
  if (window.updateNotifBadge) window.updateNotifBadge();
};

window.clearAllNotifs = async function() {
  const currentUser = getCurrentUser();
  if (!confirm('Clear all notifications?')) return;
  await supabase.from('notifications').delete().eq('user_id', currentUser.id);
  toast('Cleared.', 'success');
  // Re-render in place instead of full navigation
  const el = document.getElementById('content');
  if (el) renderNotifications(el);
  if (window.updateNotifBadge) window.updateNotifBadge();
};
