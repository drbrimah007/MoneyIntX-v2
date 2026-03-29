// Money IntX — Recurring Page Module
// Extracted from index.html page modules

import { getCurrentUser, getCurrentProfile } from './state.js';
import { esc, toast, openModal, closeModal, fmtDate, TX_LABELS } from '../ui.js';
import { supabase } from '../supabase.js';
import { listContacts } from '../contacts.js';
import { fmtMoney } from '../entries.js';
import { listRecurring, createRecurring, toggleRecurring, deleteRecurring, FREQUENCIES } from '../recurring.js';

// Functions should be available on window or imported as needed

// ── Recurring ─────────────────────────────────────────────────────
async function renderRecurringPage(el) {
  const currentUser = getCurrentUser();
  el.innerHTML = '<div class="page-header"><h2>Recurring</h2></div><p style="color:var(--muted);">Loading...</p>';
  const rules = await listRecurring(currentUser.id);
  let html = `<div class="page-header"><h2>Recurring Rules</h2>
    <button class="btn btn-primary btn-sm" onclick="openNewRecurringModal()">+ New Rule</button>
  </div>`;
  if (rules.length === 0) {
    html += `<div class="card" style="text-align:center;padding:40px;"><p style="color:var(--muted);">No recurring rules yet.</p></div>`;
  } else {
    html += `<div class="card"><div class="tbl-wrap"><table><thead><tr><th>Contact</th><th>Type</th><th>Amount</th><th>Frequency</th><th>Next Run</th><th>Status</th><th></th></tr></thead><tbody>`;
    rules.forEach(r => {
      html += `<tr>
        <td style="font-weight:600;">${esc(r.contact?.name || '—')}</td>
        <td>${esc(TX_LABELS[r.tx_type] || r.tx_type)}</td>
        <td style="font-weight:700;">${fmtMoney(r.amount)}</td>
        <td>${esc(FREQUENCIES[r.frequency] || r.frequency)}</td>
        <td style="color:var(--muted);font-size:13px;">${fmtDate(r.next_run_at)}</td>
        <td><span class="badge ${r.active ? 'badge-green' : 'badge-gray'}">${r.active ? 'Active' : 'Paused'}</span></td>
        <td>
          <div class="action-menu">
            <button class="action-menu-btn" onclick="toggleActionMenu(this)">⋮</button>
            <div class="action-dropdown">
              <button onclick="doToggleRecurring('${r.id}',${!r.active})">${r.active ? 'Pause' : 'Resume'}</button>
              <button onclick="confirmDeleteRecurring('${r.id}')" style="color:var(--red);">Delete</button>
            </div>
          </div>
        </td>
      </tr>`;
    });
    html += `</tbody></table></div></div>`;
  }
  el.innerHTML = html;
}

window.openNewRecurringModal = async function() {
  const currentUser = getCurrentUser();
  const contacts = await listContacts(currentUser.id);
  const contactOpts = contacts.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  openModal(`
    <h3 style="margin-bottom:16px;">New Recurring Rule</h3>
    <div class="form-group"><label>Contact *</label><select id="nr-contact">${contactOpts || '<option value="">No contacts</option>'}</select></div>
    <div class="form-group"><label>Type *</label><select id="nr-type">${Object.entries(TX_LABELS).map(([k,v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
    <div class="form-row">
      <div class="form-group"><label>Amount *</label><input type="number" id="nr-amount" min="0" step="0.01"></div>
      <div class="form-group"><label>Frequency</label><select id="nr-freq">${Object.entries(FREQUENCIES).map(([k,v]) => `<option value="${k}" ${k==='monthly'?'selected':''}>${v}</option>`).join('')}</select></div>
    </div>
    <div class="form-group"><label>Start Date</label><input type="date" id="nr-start" value="${new Date(Date.now()+86400000).toISOString().slice(0,10)}"></div>
    <div class="form-group"><label>Note</label><input type="text" id="nr-note" placeholder="Optional"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
      <button class="btn btn-secondary btn-sm" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary btn-sm" onclick="doCreateRecurring()">Create</button>
    </div>
  `, { maxWidth: '440px' });
};

window.doCreateRecurring = async function() {
  const currentUser = getCurrentUser();
  const contactId = document.getElementById('nr-contact').value;
  const amount = parseFloat(document.getElementById('nr-amount').value);
  if (!contactId || !amount) return toast('Contact and amount required.', 'error');
  await createRecurring(currentUser.id, {
    contactId, txType: document.getElementById('nr-type').value,
    amount, frequency: document.getElementById('nr-freq').value,
    nextRunAt: new Date(document.getElementById('nr-start').value + 'T09:00:00').toISOString(),
    note: document.getElementById('nr-note').value.trim()
  });
  closeModal(); toast('Recurring rule created!', 'success'); navTo('recurring');
};

window.doToggleRecurring = async function(id, active) {
  await toggleRecurring(id, active);
  toast(active ? 'Resumed.' : 'Paused.', 'success'); navTo('recurring');
};
window.confirmDeleteRecurring = async function(id) {
  if (!confirm('Delete this rule?')) return;
  await deleteRecurring(id); toast('Deleted.', 'success'); navTo('recurring');
};



export { renderRecurringPage };
