// Money IntX — Trash Page Module
// Extracted from index.html page modules

import { getCurrentUser, getCurrentProfile } from './state.js';
import { esc, toast, fmtMoney, fmtDate } from '../ui.js';
import { supabase } from '../supabase.js';
import { listArchivedEntries, restoreEntry } from '../entries.js';

// TX_LABELS should be available on window
// fmtRelative should be available (import or define locally)

// ── Trash ─────────────────────────────────────────────────────────
export async function renderTrash(el) {
  const currentUser = getCurrentUser();
  const currentProfile = getCurrentProfile();

  if (currentProfile?.role !== 'platform_admin') {
    el.innerHTML = '<div class="card" style="text-align:center;padding:40px;"><p style="color:var(--red);">Admin access required.</p></div>';
    return;
  }
  el.innerHTML = '<div class="page-header"><h2>🗑️ Trash</h2></div><p style="color:var(--muted);">Loading...</p>';
  const archived = await listArchivedEntries(currentUser.id);

  let html = `<div class="page-header"><h2>🗑️ Trash</h2>
    <span style="font-size:13px;color:var(--muted);">${archived.length} deleted item${archived.length !== 1 ? 's' : ''}</span>
  </div>`;

  if (archived.length === 0) {
    html += `<div class="card" style="text-align:center;padding:40px;">
      <p style="font-size:32px;margin-bottom:12px;">🗑️</p>
      <p style="color:var(--muted);">Trash is empty. Deleted entries will appear here.</p>
    </div>`;
  } else {
    html += `<div class="card"><div class="tbl-wrap"><table><thead><tr>
      <th>Contact</th><th>Amount</th><th>Type</th><th>Date</th><th>Deleted</th><th></th>
    </tr></thead><tbody>`;
    archived.forEach(e => {
      const cName = e.contact?.name || e.from_name || '—';
      const txLabel = TX_LABELS[e.tx_type] || e.tx_type;
      const deletedDate = e.archived_at ? new Date(e.archived_at).toLocaleDateString() : '—';
      html += `<tr style="opacity:0.7;">
        <td style="font-weight:600;">${esc(cName)}</td>
        <td style="font-weight:700;">${fmtMoney(e.amount, e.currency)}</td>
        <td>${esc(txLabel)}</td>
        <td style="color:var(--muted);">${fmtDate(e.date)}</td>
        <td style="color:var(--muted);font-size:12px;">${deletedDate}</td>
        <td>
          <button class="btn btn-primary btn-sm" onclick="doRestoreEntry('${e.id}')">Restore</button>
        </td>
      </tr>`;
    });
    html += `</tbody></table></div></div>`;
  }
  el.innerHTML = html;
}

window.doRestoreEntry = async function(id) {
  await restoreEntry(id);
  toast('Entry restored!', 'success');
  window.navTo('trash');
};


export { renderTrash };
