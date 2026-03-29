// ── Contacts Page Module ──────────────────────────────────────────

import { getCurrentUser, getCurrentProfile, contactColor, renderPagination, PAGE_SIZE, _invalidateEntries } from './state.js';
import { fmtMoney, getLedgerSummary } from '../entries.js';
import { listContacts, createContact, deleteContact } from '../contacts.js';
import { esc, statusBadge, TX_LABELS, TX_COLORS, fmtDate, toast, openModal, closeModal } from '../ui.js';
import { supabase } from '../supabase.js';

let _contactsPage = 1;

export async function renderContacts(el, page = 1) {
  _contactsPage = page;
  const currentUser = getCurrentUser();

  if (page === 1) el.innerHTML = '<p style="color:var(--muted);padding:20px;">Loading…</p>';
  let contacts, ledger;
  if (window._impersonatedData) {
    contacts = window._impersonatedData.contacts || [];
    ledger   = window._impersonatedData.ledger   || [];
  } else {
    [contacts, ledger] = await Promise.all([
      listContacts(currentUser.id),
      getLedgerSummary(currentUser.id)
    ]);
  }
  const ledgerMap = {};
  (ledger || []).forEach(l => { ledgerMap[l.contact_id] = l; });

  // Expose contacts globally for re-renders
  window._allContacts = contacts;
  window._allLedgerMap = ledgerMap;

  let html = `<div class="page-header" style="margin-bottom:10px;">
    <h2 style="margin:0;">Contacts <span style="font-size:14px;font-weight:500;color:var(--muted);">(${contacts.length})</span></h2>
    <div style="display:flex;gap:6px;align-items:center;">
      <input type="search" id="contacts-search" placeholder="Search…" oninput="filterAndRenderContacts(this.value)" style="width:160px;padding:6px 10px;font-size:13px;">
      <button class="btn btn-primary btn-sm" onclick="openNewContactModal()">+ Add</button>
      <button class="bs sm" onclick="doExportContacts()" title="Export Contacts CSV">📥</button>
    </div>
  </div>`;

  const filtered = window._contactsFilter
    ? contacts.filter(c => (c.name + ' ' + (c.email||'')).toLowerCase().includes(window._contactsFilter))
    : contacts;

  if (filtered.length === 0) {
    html += `<div class="card" style="text-align:center;padding:40px;"><p style="color:var(--muted);">No contacts found.</p></div>`;
  } else {
    const start = (page - 1) * PAGE_SIZE;
    const pageItems = filtered.slice(start, start + PAGE_SIZE);

    html += `<div class="card" style="padding:0;overflow:hidden;"><div class="tbl-wrap"><table><thead><tr>
      <th style="width:36px;"></th><th>Name</th><th>Owed to Me</th><th class="hide-mobile">I Owe</th><th>Net</th><th style="width:42px;"></th>
    </tr></thead><tbody>`;

    pageItems.forEach(c => {
      const l = ledgerMap[c.id] || {};
      const toy = l.they_owe_me || 0;
      const yot = l.i_owe_them || 0;
      const net = toy - yot;
      const col = contactColor(c.id);
      html += `<tr class="contact-row" data-search="${esc(c.name + ' ' + (c.email||'')).toLowerCase()}" style="cursor:pointer;" onclick="openContactDetail('${c.id}')">
        <td style="padding:8px 6px 8px 12px;"><span class="contact-avatar" style="width:30px;height:30px;font-size:13px;background:${col};">${esc(c.name.charAt(0).toUpperCase())}</span></td>
        <td>
          <div style="font-weight:600;font-size:14px;">${esc(c.name)}</div>
        </td>
        <td style="color:var(--green);font-weight:600;font-size:13px;">${toy > 0 ? fmtMoney(toy) : '<span style="color:var(--muted);">—</span>'}</td>
        <td class="hide-mobile" style="color:var(--owe-color, var(--red));font-size:13px;">${yot > 0 ? fmtMoney(yot) : '<span style="color:var(--muted);">—</span>'}</td>
        <td style="font-weight:700;color:${net > 0 ? 'var(--green)' : net < 0 ? 'var(--owe-color, var(--red))' : 'var(--muted)'};">${net !== 0 ? fmtMoney(Math.abs(net)) : '—'}</td>
        <td onclick="event.stopPropagation();">
          <div class="action-menu">
            <button class="action-menu-btn" onclick="toggleActionMenu(this)">⋮</button>
            <div class="action-dropdown">
              <button onclick="openContactDetail('${c.id}')">👁 View</button>
              <button onclick="openEditContactModal('${c.id}')">✏️ Edit</button>
              <button onclick="closeModal();openNewEntryModal()">+ Entry</button>
              <button onclick="confirmDeleteContact('${c.id}','${esc(c.name)}')" style="color:var(--red);">🗑 Delete</button>
            </div>
          </div>
        </td>
      </tr>`;
    });
    html += `</tbody></table></div>`;
    html += renderPagination(filtered.length, page, 'renderContactsPage');
    html += `</div>`;
  }
  el.innerHTML = html;
  // Restore search text
  const si = document.getElementById('contacts-search');
  if (si && window._contactsFilter) si.value = window._contactsFilter;
}

window.renderContactsPage = function(p) { renderContacts(document.getElementById('content'), p); };
window.filterAndRenderContacts = function(q) {
  window._contactsFilter = q.toLowerCase().trim() || null;
  renderContacts(document.getElementById('content'), 1);
};

window.filterContactRows = function(q) {
  const query = q.toLowerCase();
  document.querySelectorAll('.contact-row').forEach(row => {
    row.style.display = row.dataset.search.includes(query) ? '' : 'none';
  });
};

// ── Contact Detail ────────────────────────────────────────────────
// ── Helper: entries table rows (same format as main list) ──────────
function _cpEntriesTable(entries, page) {
  if (!entries || entries.length === 0) return '<p style="color:var(--muted);font-size:13px;text-align:center;padding:24px 0;">No entries with this contact.</p>';
  const p = page || 1;
  const total = entries.length;
  const CP_PS = 10;
  const pageItems = entries.slice((p-1)*CP_PS, p*CP_PS);
  const totalPages = Math.ceil(total / CP_PS);

  let rows = pageItems.map(e => {
    const _txKey = e.category || e.tx_type;
    const txLabel = TX_LABELS[_txKey] || _txKey;
    const txColor = TX_COLORS[_txKey] || 'var(--text)';
    const settled = e.settled_amount > 0;
    const remaining = e.amount - (e.settled_amount || 0);
    const typeMobileCp = `<div class="show-mobile" style="font-size:11px;font-weight:700;color:${txColor};margin-bottom:2px;">${esc(txLabel)}</div>`;
    const amtHtml = settled
      ? `${typeMobileCp}${fmtMoney(e.amount, e.currency)}<div style="font-size:11px;color:var(--muted);">Pd ${fmtMoney(e.settled_amount, e.currency)}</div><div style="font-size:11px;font-weight:700;color:${remaining<=0?'var(--green)':'var(--amber)'};">Bal ${fmtMoney(remaining, e.currency)}</div>`
      : `${typeMobileCp}${fmtMoney(e.amount, e.currency)}`;
    const reminderHtml = e.reminder_count > 0 ? `<span class="badge badge-red" style="margin-left:4px;cursor:pointer;" onclick="openEntryDetail('${e.id}')">🚩${e.reminder_count}</span>` : '';
    const noLedgerHtml = e.no_ledger ? `<span class="badge badge-gray" style="margin-left:4px;" title="Not in ledger">⊘</span>` : '';
    return `<tr>
      <td style="font-weight:700;cursor:pointer;" onclick="openEntryDetail('${e.id}')">${amtHtml}</td>
      <td style="max-width:90px;">${e.invoice_number ? `<span style="font-size:11px;font-family:monospace;color:var(--accent);font-weight:700;">${esc(e.invoice_number)}</span>` : e.entry_number ? `<span style="font-size:11px;font-family:monospace;color:var(--muted);font-weight:700;">#${String(e.entry_number).padStart(4,'0')}</span>` : '<span style="color:var(--muted-2);">—</span>'}</td>
      <td style="color:var(--muted);font-size:12px;">${fmtDate(e.date)}</td>
      <td>${statusBadge(e.status)}${reminderHtml}${noLedgerHtml}</td>
      <td style="width:44px;">
        <button class="action-menu-btn" onclick="openEntryDetail('${e.id}')" title="View / Actions" style="font-size:18px;padding:4px 8px;">⋮</button>
      </td>
    </tr>`;
  }).join('');

  let pgHtml = '';
  if (totalPages > 1) {
    pgHtml = `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0 0;font-size:12px;color:var(--muted);">
      <button class="bs sm" ${p===1?'disabled':''} onclick="window._cpPage=${p-1};window._cpRenderEntriesTab()">‹ Prev</button>
      <span>Page ${p} of ${totalPages} · ${total} entries</span>
      <button class="bs sm" ${p===totalPages?'disabled':''} onclick="window._cpPage=${p+1};window._cpRenderEntriesTab()">Next ›</button>
    </div>`;
  }

  return `<div class="tbl-wrap" style="margin-top:0;">
    <table style="font-size:13px;">
      <thead><tr><th>Amount</th><th>Doc #</th><th>Date</th><th>Status</th><th style="width:44px;"></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>${pgHtml}`;
}

window.openContactDetail = async function(id) {
  const currentUser = getCurrentUser();

  // Clear any stale data from a previous contact panel immediately
  window._cpData = null;
  window._cpPage = 1;

  // Always fetch fresh from DB — never use the global entries cache for a specific contact
  const [contactResp, entriesResp] = await Promise.all([
    supabase.from('contacts').select('*').eq('id', id).single(),
    supabase.from('entries')
      .select('*, contact:contacts(id, name, email), settlements(*)')
      .eq('user_id', currentUser.id)
      .eq('contact_id', id)
      .is('archived_at', null)
      .order('created_at', { ascending: false })
  ]);
  if (!contactResp.data) return;
  const c = contactResp.data;
  const entries = entriesResp.data || [];

  // ── Balance calculation (v2: direction_sign with legacy fallback) ───────────
  // direction_sign is +1 (they owe / receivable) or -1 (I owe / payable)
  // Advances are isolated per spec section 4 rule 5
  const ACTIVE = e => !['voided','cancelled'].includes(e.status) && !e.no_ledger;
  const ADVANCE_CATS = ['advance_paid','advance_received'];
  const LEGACY_TOY   = ['they_owe_you','invoice','bill'];
  const LEGACY_YOT   = ['you_owe_them'];
  const LEGACY_TPAY  = ['they_paid_you'];
  const LEGACY_YPAY  = ['you_paid_them'];

  // Net main balance (excludes advances)
  let mainBalance = 0;
  entries.filter(e => ACTIVE(e)).forEach(e => {
    const cat = e.category || e.tx_type;
    if (ADVANCE_CATS.includes(cat)) return; // advances isolated
    if (e.direction_sign != null) {
      mainBalance += e.amount * e.direction_sign;
    } else {
      // Legacy fallback
      if (LEGACY_TOY.includes(cat))  mainBalance += e.amount;
      if (LEGACY_TPAY.includes(cat)) mainBalance -= e.amount;
      if (LEGACY_YOT.includes(cat))  mainBalance -= e.amount;
      if (LEGACY_YPAY.includes(cat)) mainBalance += e.amount;
    }
  });
  mainBalance += (c.start_toy || 0) - (c.start_yot || 0);

  // Advance balance (isolated)
  const advBalance = entries.filter(e => ACTIVE(e) && ADVANCE_CATS.includes(e.category || e.tx_type))
    .reduce((s, e) => s + (e.direction_sign != null ? e.amount * e.direction_sign : 0), 0);

  // Legacy-compat aliases
  const toy = Math.max(0,  mainBalance);
  const yot = Math.max(0, -mainBalance);
  const net = mainBalance;
  const col = contactColor(id);

  // Entry group filters for display (use category when available, fall back to tx_type)
  const _cat = e => e.category || e.tx_type;
  const toyEntries  = entries.filter(e => [...LEGACY_TOY,  'owed_to_me','invoice_sent','bill_sent'].includes(_cat(e)) && !e.no_ledger);
  const yotEntries  = entries.filter(e => [...LEGACY_YOT,  'i_owe','bill_received','invoice_received'].includes(_cat(e)) && !e.no_ledger);
  const toyCredits  = entries.filter(e => [...LEGACY_TPAY, 'payment_recorded'].includes(_cat(e)) && e.direction_sign !== 1 && !e.no_ledger);
  const yotCredits  = entries.filter(e => [...LEGACY_YPAY, 'payment_recorded'].includes(_cat(e)) && e.direction_sign !== -1 && !e.no_ledger);
  const advEntries  = entries.filter(e => ADVANCE_CATS.includes(_cat(e)) && !e.no_ledger);

  window._cpData = { id, c, entries, toy, yot, net, mainBalance, advBalance, toyEntries, yotEntries, toyCredits, yotCredits, advEntries };
  window._cpPage = 1;
  window._cpRenderEntriesTab = function() {
    const el = document.getElementById('cp-entries-wrap');
    if (el) el.innerHTML = _cpEntriesTable(window._cpData.entries, window._cpPage);
  };

  const netGrad = net > 0 ? 'linear-gradient(135deg,#064e3b,#065f46)' : net < 0 ? 'linear-gradient(135deg,#7f1d1d,#991b1b)' : 'linear-gradient(135deg,#1e293b,#334155)';

  openModal(`
    <!-- ── Contact Header ── -->
    <div style="background:${netGrad};border-radius:16px;padding:18px;color:#fff;margin-bottom:0;">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;">
        <span style="width:48px;height:48px;border-radius:50%;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:900;color:#fff;flex-shrink:0;border:2px solid rgba(255,255,255,.3);">${esc(c.name.charAt(0).toUpperCase())}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:18px;font-weight:800;line-height:1.2;">${esc(c.name)}</div>
          ${c.email ? `<div style="font-size:12px;opacity:.8;margin-top:1px;">${esc(c.email)}</div>` : ''}
          ${c.phone ? `<div style="font-size:12px;opacity:.7;">${esc(c.phone)}</div>` : ''}
        </div>
        <button onclick="closeModal()" style="background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.25);border-radius:8px;color:#fff;padding:5px 10px;cursor:pointer;font-size:16px;">✕</button>
      </div>
      <!-- Balance row -->
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;background:rgba(0,0,0,.2);border-radius:12px;padding:12px;">
        <div style="text-align:center;">
          <div style="font-size:10px;opacity:.7;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;">Net</div>
          <div style="font-size:18px;font-weight:900;">${net >= 0 ? '+' : ''}${fmtMoney(net)}</div>
        </div>
        <div style="text-align:center;border-left:1px solid rgba(255,255,255,.2);border-right:1px solid rgba(255,255,255,.2);">
          <div style="font-size:10px;opacity:.7;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;">Owed to Me</div>
          <div style="font-size:15px;font-weight:700;">${fmtMoney(toy)}</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:10px;opacity:.7;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;">I Owe</div>
          <div style="font-size:15px;font-weight:700;">${fmtMoney(yot)}</div>
        </div>
      </div>
    </div>

    <!-- ── Action buttons ── -->
    <div style="display:flex;gap:6px;margin:10px 0;">
      <button class="btn sm" onclick="closeModal();openNewEntryModal(null,'${id}')" style="flex:1;background:linear-gradient(135deg,var(--accent),#6c63ff);">+ Entry</button>
      <button class="bs sm" onclick="openEditContactModal('${c.id}')" style="flex:1;">✏️ Edit</button>
      <button class="bs sm" style="flex:1;color:var(--red);" onclick="confirmDeleteContact('${c.id}','${esc(c.name)}');closeModal();">🗑 Delete</button>
    </div>

    <!-- ── Tabs ── -->
    <div style="display:flex;gap:0;border-bottom:2px solid var(--border);margin-bottom:12px;">
      <button id="cptab-entries" onclick="showCPTab('entries','${id}')" style="flex:1;padding:9px 4px;font-size:13px;font-weight:700;border:none;border-bottom:3px solid var(--accent);background:none;color:var(--accent);cursor:pointer;">📋 Entries (${entries.length})</button>
      <button id="cptab-ledger" onclick="showCPTab('ledger','${id}')" style="flex:1;padding:9px 4px;font-size:13px;font-weight:600;border:none;border-bottom:3px solid transparent;background:none;color:var(--muted);cursor:pointer;">📊 Ledger</button>
      <button id="cptab-info" onclick="showCPTab('info','${id}')" style="flex:1;padding:9px 4px;font-size:13px;font-weight:600;border:none;border-bottom:3px solid transparent;background:none;color:var(--muted);cursor:pointer;">ℹ️ Info</button>
    </div>

    <div id="cp-tab-content">
      <div id="cp-entries-wrap">${_cpEntriesTable(entries, 1)}</div>
    </div>
  `, { maxWidth: '580px' });
};

window.showCPTab = function(tab, contactId) {
  const d = window._cpData;
  // Guard: only respond if data is loaded AND matches the contact whose panel is open
  if (!d || (contactId && d.id !== contactId)) return;
  const el = document.getElementById('cp-tab-content');
  if (!el) return;

  // Update tab styles
  ['entries','ledger','info'].forEach(t => {
    const btn = document.getElementById('cptab-' + t);
    if (!btn) return;
    const active = t === tab;
    btn.style.borderBottomColor = active ? 'var(--accent)' : 'transparent';
    btn.style.color = active ? 'var(--accent)' : 'var(--muted)';
    btn.style.fontWeight = active ? '700' : '600';
  });

  if (tab === 'entries') {
    el.innerHTML = `<div id="cp-entries-wrap">${_cpEntriesTable(d.entries, window._cpPage || 1)}</div>`;
  } else if (tab === 'ledger') {
    el.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
        <div style="background:linear-gradient(135deg,#064e3b,#065f46);border-radius:12px;padding:14px;color:#fff;text-align:center;">
          <div style="font-size:10px;opacity:.7;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px;">Owed to Me</div>
          <div style="font-size:22px;font-weight:900;">${fmtMoney(d.toy)}</div>
        </div>
        <div style="background:linear-gradient(135deg,#7f1d1d,#991b1b);border-radius:12px;padding:14px;color:#fff;text-align:center;">
          <div style="font-size:10px;opacity:.7;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px;">I Owe</div>
          <div style="font-size:22px;font-weight:900;">${fmtMoney(d.yot)}</div>
        </div>
      </div>
      <div style="background:var(--bg2);border-radius:12px;overflow:hidden;">
        ${[
          ['Charges / Loans to them', d.toyEntries.length, 'var(--green)'],
          ['Amounts I owe them', d.yotEntries.length, 'var(--owe-color, var(--red))'],
          ['Payments received', d.toyCredits.length, 'var(--blue)'],
          ['Payments I made', d.yotCredits.length, 'var(--muted)'],
        ].map(([label, count, color]) => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:11px 16px;border-bottom:1px solid var(--border);">
            <span style="font-size:13px;color:var(--text);">${label}</span>
            <span style="font-weight:700;color:${color};font-size:14px;">${count}</span>
          </div>`).join('')}
      </div>`;
  } else if (tab === 'info') {
    const c = d.c;
    el.innerHTML = `
      <div style="background:var(--bg2);border-radius:12px;overflow:hidden;">
        ${[['Name',c.name],['Email',c.email||'—'],['Phone',c.phone||'—'],['Address',c.address||'—'],['Notes',c.notes||'—']].map(([k,v])=>`
          <div style="display:flex;justify-content:space-between;padding:11px 16px;border-bottom:1px solid var(--border);gap:12px;">
            <span style="font-size:12px;color:var(--muted);font-weight:700;text-transform:uppercase;min-width:60px;">${k}</span>
            <span style="font-size:13px;text-align:right;">${esc(v)}</span>
          </div>`).join('')}
        ${c.tags?.length ? `<div style="padding:11px 16px;border-bottom:1px solid var(--border);">
          <span style="font-size:12px;color:var(--muted);font-weight:700;text-transform:uppercase;">Tags</span>
          <div style="margin-top:6px;">${c.tags.map(t=>`<span class="badge badge-blue">${esc(t)}</span>`).join(' ')}</div></div>` : ''}
        <div style="padding:10px 16px;font-size:12px;color:var(--muted);">Added ${fmtDate(c.created_at)}</div>
      </div>
      <div style="margin-top:10px;display:flex;gap:8px;">
        <button class="bs sm" onclick="openEditContactModal('${c.id}')" style="flex:1;">✏️ Edit Contact</button>
      </div>`;
  }
};

// ── Edit Contact Modal ────────────────────────────────────────────
window.openEditContactModal = async function(id) {
  const { data: c } = await supabase.from('contacts').select('*').eq('id', id).single();
  if (!c) return;
  closeModal();
  openModal(`
    <h3 style="margin-bottom:16px;">Edit Contact</h3>
    <div class="form-group"><label>Name *</label><input type="text" id="ec-name" value="${esc(c.name)}"></div>
    <div class="form-group"><label>Email</label><input type="email" id="ec-email" value="${esc(c.email || '')}"></div>
    <div class="form-group"><label>Phone</label><input type="tel" id="ec-phone" value="${esc(c.phone || '')}"></div>
    <div class="form-group"><label>Address</label><input type="text" id="ec-address" value="${esc(c.address || '')}"></div>
    <div class="form-group"><label>Notes</label><textarea id="ec-notes" rows="2">${esc(c.notes || '')}</textarea></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
      <button class="btn btn-secondary btn-sm" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary btn-sm" onclick="saveEditContact('${id}')">Save</button>
    </div>
  `);
};

window.saveEditContact = async function(id) {
  const { error } = await supabase.from('contacts').update({
    name: document.getElementById('ec-name').value.trim(),
    email: document.getElementById('ec-email').value.trim(),
    phone: document.getElementById('ec-phone').value.trim(),
    address: document.getElementById('ec-address').value.trim(),
    notes: document.getElementById('ec-notes').value.trim(),
    updated_at: new Date().toISOString()
  }).eq('id', id);
  if (error) return toast(error.message, 'error');
  closeModal(); toast('Contact updated.', 'success'); navTo('contacts');
};

window.openNewContactModal = function() {
  openModal(`
    <h3 style="margin-bottom:16px;">New Contact</h3>
    <div class="form-group"><label>Name *</label><input type="text" id="nc-name" placeholder="Contact name"></div>
    <div class="form-group"><label>Email</label><input type="email" id="nc-email" placeholder="email@example.com"></div>
    <div class="form-group"><label>Phone</label><input type="tel" id="nc-phone" placeholder="+1 555 000 0000"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
      <button class="btn btn-secondary btn-sm" onclick="document.getElementById('modal')?.remove()">Cancel</button>
      <button class="btn btn-primary btn-sm" onclick="saveNewContact()">Save</button>
    </div>
  `);
};

window.saveNewContact = async function(returnCallback) {
  const currentUser = getCurrentUser();

  const name = document.getElementById('nc-name').value.trim();
  const email = document.getElementById('nc-email').value.trim().toLowerCase();
  if (!name) return toast('Name is required.', 'error');
  // Block duplicate emails
  if (email) {
    const existing = (window._allContacts || []).find(c => (c.email||'').toLowerCase() === email);
    if (existing) return toast(`Email already used by "${existing.name}".`, 'error');
    // Also check DB in case contacts list is stale
    const { data: dup } = await supabase.from('contacts')
      .select('id,name').eq('user_id', currentUser.id).eq('email', email).maybeSingle();
    if (dup) return toast(`Email already used by "${dup.name}".`, 'error');
  }
  const newContact = await createContact(currentUser.id, {
    name, email,
    phone: document.getElementById('nc-phone').value.trim()
  });
  closeModal();
  toast('Contact added.', 'success');
  if (typeof returnCallback === 'function') { returnCallback(newContact); return; }
  navTo('contacts');
};

window.confirmDeleteContact = async function(id, name) {
  if (!confirm('Delete ' + name + '?')) return;
  await deleteContact(id);
  toast('Contact deleted.', 'success');
  navTo('contacts');
};
