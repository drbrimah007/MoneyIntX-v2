// Money IntX — Recurring Page Module
// Extracted from index.html page modules

import { getCurrentUser, getCurrentProfile, contactColor } from './state.js';
import { esc, toast, openModal, closeModal, fmtDate, TX_LABELS } from '../ui.js';
import { supabase } from '../supabase.js';
import { listContacts } from '../contacts.js';
import { fmtMoney } from '../entries.js';
import { listRecurring, createRecurring, updateRecurring, toggleRecurring, deleteRecurring, FREQUENCIES } from '../recurring.js';

// ── Type system: grouped by direction ──────────────────────────────
const RECURRING_TYPES = [
  { group: 'Owed to Me', types: ['owed_to_me', 'invoice_sent', 'bill_sent', 'advance_received'] },
  { group: 'I Owe', types: ['i_owe', 'advance_paid'] },
  { group: 'Other', types: [] }
];

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
      const typeLabel = r.custom_label ? `${r.custom_label} — ${TX_LABELS[r.tx_type] || r.tx_type}` : (TX_LABELS[r.tx_type] || r.tx_type);
      html += `<tr style="cursor:pointer;" onclick="openEditRecurringModal('${r.id}')">
        <td style="font-weight:600;">${esc(r.contact?.name || 'Self')}</td>
        <td>${esc(typeLabel)}</td>
        <td style="font-weight:700;">${fmtMoney(r.amount)}</td>
        <td>${esc(FREQUENCIES[r.frequency] || r.frequency)}</td>
        <td style="color:var(--muted);font-size:13px;">${fmtDate(r.next_run_at)}</td>
        <td><span class="badge ${r.active ? 'badge-green' : 'badge-gray'}">${r.active ? 'Active' : 'Paused'}</span></td>
        <td onclick="event.stopPropagation();">
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

// ── Open New/Edit Modal ───────────────────────────────────────────
window.openNewRecurringModal = async function() {
  await _openRecurringModal(null);
};

window.openEditRecurringModal = async function(ruleId) {
  await _openRecurringModal(ruleId);
};

async function _openRecurringModal(ruleId) {
  const currentUser = getCurrentUser();
  const profile = getCurrentProfile();
  const contacts = await listContacts(currentUser.id);

  // If editing, fetch the rule
  let rule = null;
  if (ruleId) {
    const { data } = await supabase.from('recurring_rules').select('*').eq('id', ruleId).single();
    rule = data;
  }

  // Pre-select contact
  window._recContacts = contacts;
  window._recSelectedContactId = rule?.contact_id || '';
  const selectedContact = window._recSelectedContactId ? contacts.find(c => c.id === window._recSelectedContactId) : null;
  const contactDisplayVal = selectedContact ? selectedContact.name : '';

  // Store state for modal
  window._recEditingRuleId = ruleId || null;
  window._recSelectedCustomLabel = rule?.custom_label || '';

  const modalContent = `
    <div class="modal-title">${ruleId ? 'Edit Recurring Rule' : 'New Recurring Rule'}</div>

    <!-- Description -->
    <div class="form-group">
      <label>Description / Header</label>
      <input type="text" id="rec-description" placeholder="e.g., Monthly Rent"
        value="${esc(rule?.description || '')}"
        style="width:100%;padding:9px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg3);color:var(--text);font-size:14px;outline:none;box-sizing:border-box;">
    </div>

    <!-- Contact Selection with Search -->
    <div class="form-group" style="position:relative;">
      <label style="display:flex;justify-content:space-between;align-items:center;">
        <span>Contact / Recipient *</span>
        <button type="button" onclick="openNewContactFromRecurring()" style="font-size:11px;color:var(--accent);background:none;border:none;cursor:pointer;padding:0;font-weight:700;">+ Add New</button>
      </label>
      <div style="position:relative;">
        <input type="text" id="rec-contact-search" placeholder="Search contacts or select Self…" autocomplete="off"
          value="${esc(contactDisplayVal)}"
          oninput="filterRecContacts(this.value)"
          onfocus="this.select();showRecContactList();filterRecContacts(this.value)"
          style="width:100%;padding:9px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg3);color:var(--text);font-size:14px;outline:none;box-sizing:border-box;">
        <input type="hidden" id="rec-contact" value="${esc(window._recSelectedContactId)}">
        <div id="rec-contact-list" style="display:none;position:absolute;top:100%;left:0;right:0;background:var(--bg2);border:1px solid var(--border);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.4);z-index:999;max-height:200px;overflow-y:auto;margin-top:2px;">
          <!-- Self option -->
          <div onclick="selectRecContact('self','Self')" style="display:flex;align-items:center;gap:10px;padding:10px 12px;cursor:pointer;border-bottom:1px solid var(--border);" onmouseenter="this.style.background='var(--bg3)'" onmouseleave="this.style.background=''">
            <span style="width:28px;height:28px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#fff;flex-shrink:0;">👤</span>
            <div><div style="font-weight:600;font-size:13px;">Self</div><div style="font-size:11px;color:var(--muted);">Personal reminder</div></div>
          </div>
          <!-- Contacts -->
          ${contacts.map(c => {
            const col = contactColor(c.id);
            return `<div onclick="selectRecContact('${c.id}','${esc(c.name)}')" style="display:flex;align-items:center;gap:10px;padding:10px 12px;cursor:pointer;border-bottom:1px solid var(--border);" onmouseenter="this.style.background='var(--bg3)'" onmouseleave="this.style.background=''">
              <span style="width:28px;height:28px;border-radius:50%;background:${col};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#fff;flex-shrink:0;">${esc(c.name.charAt(0).toUpperCase())}</span>
              <div><div style="font-weight:600;font-size:13px;">${esc(c.name)}</div>${c.email ? `<div style="font-size:11px;color:var(--muted);">${esc(c.email)}</div>` : ''}</div>
            </div>`;
          }).join('')}
          ${contacts.length === 0 ? '<div style="padding:12px;color:var(--muted);font-size:13px;text-align:center;">No contacts — click "+ Add New" above</div>' : ''}
        </div>
      </div>
    </div>

    <!-- Type with Custom Label -->
    <div class="form-group">
      <label>Type *</label>
      <select id="rec-type" style="width:100%;padding:9px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg3);color:var(--text);font-size:14px;outline:none;box-sizing:border-box;">
        ${RECURRING_TYPES.map(group => {
          if (group.group === 'Other') {
            return `<optgroup label="${group.group}"><option value="custom">Custom…</option></optgroup>`;
          }
          return `<optgroup label="${group.group}">${group.types.map(t => `<option value="${t}" ${rule?.tx_type === t ? 'selected' : ''}>${TX_LABELS[t]}</option>`).join('')}</optgroup>`;
        }).join('')}
      </select>
    </div>

    <!-- Custom Label (for non-standard types) -->
    <div id="rec-custom-label-group" class="form-group" style="display:none;">
      <label>Custom Label</label>
      <input type="text" id="rec-custom-label" placeholder="e.g., Subscription Fee" value="${esc(window._recSelectedCustomLabel)}"
        style="width:100%;padding:9px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg3);color:var(--text);font-size:14px;outline:none;box-sizing:border-box;">
      <div style="font-size:11px;color:var(--muted);margin-top:4px;">This will display as "Custom Label — Type"</div>
    </div>

    <!-- Amount & Currency -->
    <div class="form-row">
      <div class="form-group"><label>Amount *</label><input type="number" id="rec-amount" min="0" step="0.01" value="${rule ? (rule.amount / 100).toFixed(2) : ''}" placeholder="0.00"></div>
      <div class="form-group"><label>Currency</label><select id="rec-currency">
        ${['USD','EUR','GBP','NGN','CAD','AUD','JPY','KES','ZAR','GHS','INR','CNY','BRL','MXN','AED','SAR','QAR','KWD','EGP','MAD','TZS','UGX','ETB','XOF'].map(c => `<option value="${c}" ${(rule?.currency || profile?.default_currency || 'USD') === c ? 'selected' : ''}>${c}</option>`).join('')}
      </select></div>
    </div>

    <!-- Frequency -->
    <div class="form-group"><label>Frequency</label><select id="rec-frequency" style="width:100%;padding:9px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg3);color:var(--text);font-size:14px;outline:none;box-sizing:border-box;">
      ${Object.entries(FREQUENCIES).map(([k,v]) => `<option value="${k}" ${rule?.frequency === k || k === 'monthly' ? 'selected' : ''}>${v}</option>`).join('')}
    </select></div>

    <!-- Start/Next Run Date -->
    <div class="form-group"><label>${ruleId ? 'Next Run Date' : 'Start Date'}</label><input type="date" id="rec-start" value="${rule ? rule.next_run_at.slice(0,10) : new Date(Date.now()+86400000).toISOString().slice(0,10)}"></div>

    <!-- Reminder: Days before -->
    <div class="form-group">
      <label>Remind me before</label>
      <select id="rec-remind-days" style="width:100%;padding:9px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg3);color:var(--text);font-size:14px;outline:none;box-sizing:border-box;">
        <option value="0" ${rule?.remind_days === 0 ? 'selected' : ''}>Don't remind</option>
        <option value="1" ${rule?.remind_days === 1 ? 'selected' : ''}>1 day before</option>
        <option value="3" ${rule?.remind_days === 3 ? 'selected' : ''}>3 days before</option>
        <option value="7" ${rule?.remind_days === 7 ? 'selected' : ''}>1 week before</option>
        <option value="14" ${rule?.remind_days === 14 ? 'selected' : ''}>2 weeks before</option>
      </select>
    </div>

    <!-- Notification Options -->
    <div style="margin-bottom:12px;border:1px solid var(--border);border-radius:10px;overflow:hidden;">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--bg3);cursor:pointer;" onclick="toggleRecNotify()">
        <div style="font-size:13px;font-weight:600;">✉️ Notify on Run</div>
        <div style="display:flex;align-items:center;gap:7px;">
          <span id="rec-notify-label" style="font-size:12px;color:var(--muted);">${rule?.auto_notify ? 'On' : 'Off'}</span>
          <div style="width:38px;height:21px;border-radius:11px;background:${rule?.auto_notify ? 'var(--accent)' : 'var(--border)'};position:relative;transition:background .2s;" id="rec-notify-track">
            <div id="rec-notify-knob" style="position:absolute;top:3px;${rule?.auto_notify ? 'left:20px' : 'left:3px'};width:15px;height:15px;border-radius:50%;background:#fff;transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,.3);"></div>
          </div>
        </div>
      </div>
      <div id="rec-notify-body" style="display:${rule?.auto_notify ? '' : 'none'};padding:12px 14px;border-top:1px solid var(--border);">
        <div style="font-size:12px;color:var(--muted);margin-bottom:8px;">When rule runs, notify:</div>
        <div style="display:flex;gap:8px;margin-bottom:10px;">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;">
            <input type="checkbox" id="rec-notify-contact" ${rule?.notify_contact ? 'checked' : ''} style="cursor:pointer;">
            Contact
          </label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;">
            <input type="checkbox" id="rec-notify-self" ${rule?.notify_self ? 'checked' : ''} style="cursor:pointer;">
            You
          </label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;">
            <input type="checkbox" id="rec-notify-email" ${rule?.notify_email ? 'checked' : ''} style="cursor:pointer;">
            Email
          </label>
        </div>
        <textarea id="rec-notify-message" rows="2" placeholder="Optional message…" style="width:100%;padding:9px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg3);color:var(--text);font-size:13px;resize:vertical;box-sizing:border-box;">${esc(rule?.notify_message || '')}</textarea>
      </div>
    </div>
    <input type="hidden" id="rec-notify" value="${rule?.auto_notify ? '1' : '0'}">

    <!-- Note to self -->
    <div style="margin-bottom:4px;">
      <label style="font-size:12px;color:var(--muted);">Note to self <span style="font-weight:400;">(optional — private, not shared)</span></label>
    </div>
    <textarea id="rec-note" rows="1" placeholder="Private reminder..." oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px'" style="width:100%;padding:6px 10px;border-radius:8px;border:1px solid var(--border);background:var(--bg3);color:var(--text);font-size:13px;resize:none;overflow:hidden;box-sizing:border-box;line-height:1.5;margin-bottom:12px;">${esc(rule?.note || '')}</textarea>

    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
      <button class="btn btn-secondary btn-sm" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary btn-sm" onclick="doSaveRecurring()">${ruleId ? 'Update' : 'Create'}</button>
    </div>
  `;

  openModal(modalContent, { maxWidth: '500px' });

  // Setup event listeners
  setTimeout(() => {
    const typeSelect = document.getElementById('rec-type');
    if (typeSelect) {
      typeSelect.addEventListener('change', function() {
        const customLabelGroup = document.getElementById('rec-custom-label-group');
        if (this.value === 'custom') {
          if (customLabelGroup) customLabelGroup.style.display = '';
        } else {
          if (customLabelGroup) customLabelGroup.style.display = 'none';
        }
      });
      // Trigger initial display state
      typeSelect.dispatchEvent(new Event('change'));
    }

    // Contact list click handler
    document.addEventListener('click', function _cls(e) {
      const list = document.getElementById('rec-contact-list');
      const inp  = document.getElementById('rec-contact-search');
      if (list && !list.contains(e.target) && e.target !== inp) list.style.display = 'none';
      if (!document.getElementById('rec-contact-search')) document.removeEventListener('click', _cls);
    });
  }, 100);
}

// ── Contact search functions ──────────────────────────────────────
window.showRecContactList = function() {
  const list = document.getElementById('rec-contact-list');
  if (list) list.style.display = 'block';
};

window.filterRecContacts = function(q) {
  const contacts = window._recContacts || [];
  const list = document.getElementById('rec-contact-list');
  if (!list) return;
  list.style.display = 'block';
  const lower = q.toLowerCase();
  const filtered = q ? contacts.filter(c => (c.name + ' ' + (c.email||'')).toLowerCase().includes(lower)) : contacts;

  const html = [];
  // Always show Self first
  html.push(`<div onclick="selectRecContact('self','Self')" style="display:flex;align-items:center;gap:10px;padding:10px 12px;cursor:pointer;border-bottom:1px solid var(--border);" onmouseenter="this.style.background='var(--bg3)'" onmouseleave="this.style.background=''">
    <span style="width:28px;height:28px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#fff;flex-shrink:0;">👤</span>
    <div><div style="font-weight:600;font-size:13px;">Self</div><div style="font-size:11px;color:var(--muted);">Personal reminder</div></div>
  </div>`);

  // Then contacts
  filtered.forEach(c => {
    const col = contactColor(c.id);
    html.push(`<div onclick="selectRecContact('${c.id}','${esc(c.name)}')" style="display:flex;align-items:center;gap:10px;padding:10px 12px;cursor:pointer;border-bottom:1px solid var(--border);" onmouseenter="this.style.background='var(--bg3)'" onmouseleave="this.style.background=''">
      <span style="width:28px;height:28px;border-radius:50%;background:${col};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#fff;flex-shrink:0;">${esc(c.name.charAt(0).toUpperCase())}</span>
      <div><div style="font-weight:600;font-size:13px;">${esc(c.name)}</div>${c.email ? `<div style="font-size:11px;color:var(--muted);">${esc(c.email)}</div>` : ''}</div>
    </div>`);
  });

  if (filtered.length === 0 && q) {
    html.push('<div style="padding:12px;color:var(--muted);font-size:13px;text-align:center;">No match — click "+ Add New" above</div>');
  }

  list.innerHTML = html.join('');
};

window.selectRecContact = function(id, name) {
  window._recSelectedContactId = id;
  const inp = document.getElementById('rec-contact-search');
  const hidden = document.getElementById('rec-contact');
  if (inp) inp.value = name;
  if (hidden) hidden.value = id;
  const list = document.getElementById('rec-contact-list');
  if (list) list.style.display = 'none';
};

window.openNewContactFromRecurring = function() {
  openModal(`
    <h3 style="margin-bottom:16px;">Add New Contact</h3>
    <div class="form-group"><label>Name *</label><input type="text" id="nc-name" placeholder="Contact name"></div>
    <div class="form-group"><label>Email</label><input type="email" id="nc-email" placeholder="email@example.com"></div>
    <div class="form-group"><label>Phone</label><input type="tel" id="nc-phone" placeholder="+1 555 000 0000"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
      <button class="btn btn-secondary btn-sm" onclick="closeModal();openNewRecurringModal()">Cancel</button>
      <button class="btn btn-primary btn-sm" onclick="saveNewContact(function(c){if(c){window._recContacts=(window._recContacts||[]).concat(c);openNewRecurringModal();}else{openNewRecurringModal();}})">Save &amp; Select</button>
    </div>
  `);
};

// ── Notification toggle ───────────────────────────────────────────
window.toggleRecNotify = function() {
  const inp = document.getElementById('rec-notify');
  const body = document.getElementById('rec-notify-body');
  const track = document.getElementById('rec-notify-track');
  const knob = document.getElementById('rec-notify-knob');
  const label = document.getElementById('rec-notify-label');
  if (!inp) return;
  const isOn = inp.value === '1';
  const nowOn = !isOn;
  inp.value = nowOn ? '1' : '0';
  if (body) body.style.display = nowOn ? '' : 'none';
  if (track) track.style.background = nowOn ? 'var(--accent)' : 'var(--border)';
  if (knob) knob.style.left = nowOn ? '20px' : '3px';
  if (label) { label.textContent = nowOn ? 'On' : 'Off'; label.style.color = nowOn ? 'var(--accent)' : 'var(--muted)'; }
};

// ── Save Recurring (Create or Update) ──────────────────────────────
window.doSaveRecurring = async function() {
  const currentUser = getCurrentUser();
  const profile = getCurrentProfile();

  const contactId = (document.getElementById('rec-contact')?.value || '').trim();
  const txType = (document.getElementById('rec-type')?.value || '').trim();
  const customLabel = (document.getElementById('rec-custom-label')?.value || '').trim();
  const amount = parseFloat(document.getElementById('rec-amount')?.value || 0);
  const currency = document.getElementById('rec-currency')?.value || profile?.default_currency || 'USD';
  const frequency = document.getElementById('rec-frequency')?.value || 'monthly';
  const startDate = document.getElementById('rec-start')?.value;
  const description = (document.getElementById('rec-description')?.value || '').trim();
  const remindDays = parseInt(document.getElementById('rec-remind-days')?.value || 0);
  const autoNotify = document.getElementById('rec-notify')?.value === '1';
  const notifyContact = document.getElementById('rec-notify-contact')?.checked || false;
  const notifySelf = document.getElementById('rec-notify-self')?.checked || false;
  const notifyEmail = document.getElementById('rec-notify-email')?.checked || false;
  const notifyMessage = (document.getElementById('rec-notify-message')?.value || '').trim();
  const note = (document.getElementById('rec-note')?.value || '').trim();

  if (!contactId || !txType || !amount) {
    return toast('Contact, type, and amount required.', 'error');
  }
  if (!startDate) {
    return toast('Start date required.', 'error');
  }

  const nextRunAt = new Date(startDate + 'T09:00:00').toISOString();
  const ruleId = window._recEditingRuleId;

  try {
    if (ruleId) {
      // Update existing rule
      await updateRecurring(ruleId, {
        contact_id: contactId === 'self' ? null : contactId,
        tx_type: txType,
        custom_label: customLabel || null,
        amount, currency, frequency,
        next_run_at: nextRunAt,
        description: description || null,
        remind_days: remindDays,
        auto_notify: autoNotify,
        notify_contact: notifyContact,
        notify_self: notifySelf,
        notify_email: notifyEmail,
        notify_message: notifyMessage || null,
        note: note || null
      });
      closeModal();
      toast('Recurring rule updated!', 'success');
    } else {
      // Create new rule
      await createRecurring(currentUser.id, {
        contactId: contactId === 'self' ? null : contactId,
        txType,
        customLabel: customLabel || null,
        amount, currency, frequency,
        nextRunAt,
        description: description || null,
        remindDays,
        autoNotify,
        notifyContact,
        notifySelf,
        notifyEmail,
        notifyMessage: notifyMessage || null,
        note: note || null
      });
      closeModal();
      toast('Recurring rule created!', 'success');
    }
    navTo('recurring');
  } catch (err) {
    console.error('Error saving recurring rule:', err);
    toast('Error saving rule: ' + (err.message || 'Unknown error'), 'error');
  }
};

window.doToggleRecurring = async function(id, active) {
  await toggleRecurring(id, active);
  toast(active ? 'Resumed.' : 'Paused.', 'success'); navTo('recurring');
};

window.confirmDeleteRecurring = async function(id) {
  if (!confirm('Delete this recurring rule permanently?')) return;
  try {
    await deleteRecurring(id);
    toast('Deleted.', 'success');
    navTo('recurring');
  } catch (err) {
    console.error('Error deleting recurring rule:', err);
    toast('Error deleting rule: ' + (err.message || 'Unknown error'), 'error');
  }
};

export { renderRecurringPage };
