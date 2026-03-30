// ── Entries Page Module ──────────────────────────────────────────

import { getCurrentUser, getCurrentProfile, contactColor, contactAvatar, renderPagination, PAGE_SIZE, _invalidateEntries, _fmtAmt } from './state.js';
import { listEntries, getEntry, createEntry, updateEntry, deleteEntry, archiveEntry, unarchiveEntry, restoreEntry, voidEntry, fmtMoney, toCents, getDashboardTotals, invalidateEntryCache } from '../entries.js';
import { bulkArchive, bulkNoLedger, bulkDelete } from '../bulk.js';
import { listContacts, createContact } from '../contacts.js';
import { createShareToken, getShareUrl, listReceivedShares, dismissShare } from '../sharing.js';
import { listTemplates } from '../templates.js';
import { createScheduledReminder } from '../reminders.js';
import { esc, statusBadge, TX_LABELS, TX_COLORS, DIRECTION_SIGN, fmtDate, toast, openModal, closeModal } from '../ui.js';
import { supabase } from '../supabase.js';
import { createSettlement, reviewSettlement, deleteSettlement } from '../settlements.js';
import { sendNotificationEmail } from '../email.js';
import { renderDash } from './dashboard.js';

let _entriesAll = [];
let _pendingSharesAll = null; // null = not yet loaded; [] = loaded but empty
let _entriesPage = 1;
let _entriesFilter = '';

// Helper: navigate back after entry action — stays in BS if inside Business Suite
function _navAfterAction() {
  _invalidateEntries();
  const insideBS = document.getElementById('bs-content') && window._bsNavigate;
  if (insideBS) {
    const section = localStorage.getItem('mxi_bs_section') || 'bs-invoices';
    window._bsNavigate(section);
  } else {
    navTo('entries');
  }
}

// Reset cache — called from navTo before renderEntries
export function resetEntriesCache() { _entriesAll = []; _pendingSharesAll = null; }

export async function renderEntries(el, page, forceRefresh) {
  if (page) _entriesPage = page;
  const isFirstLoad = !page || page === 1;
  if (isFirstLoad && _entriesAll.length === 0) el.innerHTML = '<p style="color:var(--muted);padding:20px;">Loading…</p>';
  if (!window._selectedEntries) window._selectedEntries = new Set();

  // Re-fetch only when: first nav to page with empty cache, or explicitly forced
  // Parallelise entries + pending shares to avoid sequential waterfall
  {
    const needEntries = _entriesAll.length === 0 || forceRefresh;
    const needShares  = _pendingSharesAll === null || forceRefresh;
    if (needEntries || needShares) {
      if (window._impersonatedData) {
        if (needEntries) _entriesAll = window._impersonatedData.entries || [];
        if (needShares)  _pendingSharesAll = [];
      } else {
        const promises = [];
        promises.push(needEntries ? listEntries(getCurrentUser().id) : Promise.resolve(null));
        promises.push(needShares  ? listReceivedShares(getCurrentUser().id).catch(() => []) : Promise.resolve(null));
        const [entriesResult, sharesResult] = await Promise.all(promises);
        if (entriesResult !== null) _entriesAll = entriesResult;
        if (sharesResult !== null) _pendingSharesAll = (sharesResult || []).filter(s => s.status !== 'confirmed' && s.status !== 'dismissed');
      }
    }
  }

  const _sm = window._selectMode || false;
  const query = (_entriesFilter || '').toLowerCase();
  const filtered = query
    ? _entriesAll.filter(e => {
        const cName = e.contact?.name || e.from_name || '';
        const lbl = TX_LABELS[e.tx_type] || e.tx_type;
        return (cName + ' ' + lbl + ' ' + (e.invoice_number||'') + ' ' + e.status).toLowerCase().includes(query);
      })
    : _entriesAll;

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  if (_entriesPage > totalPages && totalPages > 0) _entriesPage = totalPages;
  const pageEntries = filtered.slice((_entriesPage - 1) * PAGE_SIZE, _entriesPage * PAGE_SIZE);

  let html = `<div class="page-header" style="flex-wrap:wrap;gap:8px;">
    <h2 style="margin:0;">Entries <span style="font-size:13px;font-weight:400;color:var(--muted);">(${filtered.length})</span></h2>
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;flex:1;min-width:200px;">
      <input type="search" id="entries-search" placeholder="Search…" value="${esc(_entriesFilter)}" oninput="filterEntriesNow(this.value)" style="flex:1;min-width:120px;max-width:220px;padding:6px 10px;border-radius:8px;border:1px solid var(--border);background:var(--bg3);color:var(--text);font-size:13px;">
      <button class="btn sm" onclick="openNewEntryModal()">+ Add</button>
      <button class="bs sm${_sm?' on':''}" onclick="toggleSelectMode()" title="Select mode">☑</button>
      <button class="bs sm" onclick="doExportEntries()" title="Export CSV">📥</button>
    </div>
  </div>`;

  // ── Pending Shared Records banner (from other users, awaiting confirm/reject) ──
  if (_pendingSharesAll && _pendingSharesAll.length > 0) {
    html += `<div class="card" style="padding:0;overflow:hidden;border:2px solid rgba(213,186,120,.5);margin-bottom:14px;">
      <div style="background:rgba(213,186,120,.1);padding:10px 16px;border-bottom:1px solid rgba(213,186,120,.2);display:flex;align-items:center;gap:8px;">
        <span style="font-size:15px;">⏳</span>
        <span style="font-weight:700;font-size:13px;color:var(--gold, #D5BA78);">Pending — Records Shared With You (${_pendingSharesAll.length})</span>
        <span style="color:var(--muted);font-size:12px;">Confirm to add to your ledger, or reject to dismiss</span>
      </div>
      <div class="tbl-wrap"><table><thead><tr>
        <th>From</th><th>Amount</th><th class="hide-mobile">Type</th><th class="hide-mobile">Date</th><th>Action</th>
      </tr></thead><tbody>`;
    _pendingSharesAll.forEach(s => {
      const snap = s.entry_snapshot || {};
      const fromName = snap.from_name || s.sender_name || 'Someone';
      const amt = snap.amount || 0;
      const amtCents = snap.amount !== undefined ? snap.amount : toCents(amt);
      const cur = snap.currency || 'USD';
      // Flip tx_type to show recipient's perspective
      const SNAP_FLIP = { 'they_owe_you':'you_owe_them','you_owe_them':'they_owe_you','owed_to_me':'i_owe','i_owe':'owed_to_me','they_paid_you':'you_paid_them','you_paid_them':'they_paid_you','invoice_sent':'invoice_received','invoice_received':'invoice_sent','bill_sent':'bill_received','bill_received':'bill_sent','invoice':'bill','bill':'invoice' };
      const flippedCat = SNAP_FLIP[snap.tx_type] || snap.tx_type;
      const txLabel = TX_LABELS[flippedCat] || snap.tx_type || '—';
      // Color: green-ish if they owe you, purple-ish if you owe them
      const isOwedToMe = ['you_owe_them','owed_to_me','bill_received','invoice_received','advance_received'].includes(flippedCat);
      const txColor = isOwedToMe ? 'var(--green, #5FD39A)' : 'var(--owe-color, #8D8CFF)';
      const note = snap.note ? `<div style="font-size:11px;color:var(--muted);margin-top:2px;">${esc(snap.note)}</div>` : '';
      html += `<tr data-pending-id="${s.id}">
        <td style="font-weight:700;">${esc(fromName)}</td>
        <td><div style="font-size:11px;font-weight:700;color:${txColor};margin-bottom:2px;">${esc(txLabel)}</div><span style="font-weight:700;color:var(--gold, #D5BA78);">${fmtMoney(amtCents, cur)}</span>${note}</td>
        <td class="hide-mobile" style="font-size:12px;color:var(--muted);">${esc(txLabel)}</td>
        <td class="hide-mobile" style="font-size:12px;color:var(--muted);">${fmtDate(snap.date)}</td>
        <td style="white-space:nowrap;">
          <button class="btn btn-primary btn-sm" onclick="doPendingConfirm('${s.id}')" style="padding:5px 14px;font-size:12px;font-weight:700;">✓ Confirm</button>
          <button class="bs sm" onclick="doPendingReject('${s.id}')" style="margin-left:4px;padding:5px 10px;font-size:12px;color:var(--red);border-color:var(--red);">✕ Reject</button>
        </td>
      </tr>`;
    });
    html += `</tbody></table></div></div>`;
  }

  // Bulk action bar
  if (_sm && window._selectedEntries.size > 0) {
    html += `<div style="background:var(--bg2);border:2px solid var(--accent);border-radius:10px;padding:10px 16px;margin-bottom:12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
      <span style="font-weight:700;font-size:13px;color:var(--accent);">${window._selectedEntries.size} selected</span>
      <button class="bs sm" onclick="bulkAction('archive')">Archive</button>
      <button class="bs sm" onclick="bulkAction('noledger')">Rm Ledger</button>
      <button class="bs sm" onclick="bulkAction('restore')">Restore</button>
      <button class="bs sm" style="color:var(--red);" onclick="bulkAction('delete')">Delete</button>
      <button class="bs sm" style="margin-left:auto;" onclick="window._selectedEntries.clear();navTo('entries');">Cancel</button>
    </div>`;
  }

  if (filtered.length === 0) {
    html += `<div class="card" style="text-align:center;padding:40px;"><p style="color:var(--muted);">${query ? 'No entries match your search.' : 'No entries yet. Record your first transaction.'}</p></div>`;
  } else {
    html += `<div class="card" style="padding:0;overflow:hidden;"><div class="tbl-wrap"><table><thead><tr>
      ${_sm ? `<th style="width:36px;"><input type="checkbox" onclick="selectAllEntries(this.checked)" style="width:16px;height:16px;cursor:pointer;accent-color:var(--accent);"></th>` : ''}
      <th>Contact</th><th>Amount</th><th class="hide-mobile" style="max-width:90px;">Doc #</th><th class="hide-mobile">Type</th><th>Date</th><th>Status</th><th style="width:44px;"></th>
    </tr></thead><tbody>`;
    pageEntries.forEach(e => {
      const cName = e.contact?.name || e.from_name || '—';
      const cId = e.contact?.id || '';
      const _txKey = e.category || e.tx_type;
      const txLabel = TX_LABELS[_txKey] || _txKey;
      const txColor = TX_COLORS[_txKey] || 'var(--text)';
      const settled = e.settled_amount > 0;
      const remaining = e.amount - e.settled_amount;
      const typeMobileEnt = `<div class="show-mobile" style="font-size:11px;font-weight:700;color:${txColor};margin-bottom:2px;">${esc(txLabel)}</div>`;
      const amtHtml = settled
        ? `${typeMobileEnt}${fmtMoney(e.amount, e.currency)}<div style="font-size:11px;color:var(--muted);">Pd ${fmtMoney(e.settled_amount, e.currency)}</div><div style="font-size:11px;font-weight:700;color:${remaining <= 0 ? 'var(--green)' : 'var(--amber)'};">Bal ${fmtMoney(remaining, e.currency)}</div>`
        : `${typeMobileEnt}${fmtMoney(e.amount, e.currency)}`;
      const isTerminal = ['settled','voided','cancelled','fulfilled'].includes(e.status);
      const _ecat = e.category || e.tx_type;
      const canSettle = ['owed_to_me','bill_sent','invoice_sent','i_owe','bill_received','invoice_received',
        'they_owe_you','you_owe_them','invoice','bill','advance_paid','advance_received'].includes(_ecat) && !isTerminal;
      const reminderHtml = e.reminder_count > 0 ? `<span class="badge badge-red" style="margin-left:4px;cursor:pointer;" onclick="openEntryDetail('${e.id}')">🚩${e.reminder_count}</span>` : '';
      const noLedgerHtml = e.no_ledger ? `<span class="badge badge-gray" style="margin-left:4px;" title="Not in ledger">⊘</span>` : '';
      const col = cId ? contactColor(cId) : 'var(--bg3)';
      const _isSel = _sm && window._selectedEntries.has(e.id);

      html += `<tr class="entry-row${_isSel?' row-selected':''}" data-eid="${e.id}">
        ${_sm ? `<td style="width:36px;text-align:center;"><input type="checkbox" ${_isSel?'checked':''} onchange="toggleEntrySelect('${e.id}',this.checked)" style="width:16px;height:16px;cursor:pointer;accent-color:var(--accent);"></td>` : ''}
        <td style="min-width:80px;">
          ${cId ? `<span style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;" onclick="openContactDetail('${cId}')">
            <span style="width:24px;height:24px;border-radius:50%;background:${col};display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0;color:#fff;">${esc(cName.charAt(0).toUpperCase())}</span>
            <span style="font-weight:600;color:${col};">${esc(cName)}</span>
          </span>` : `<span style="color:var(--muted);">${esc(cName)}</span>`}
        </td>
        <td style="font-weight:700;cursor:pointer;" onclick="openEntryDetail('${e.id}')">${amtHtml}</td>
        <td class="hide-mobile" style="max-width:90px;">${e.invoice_number ? `<span style="font-size:11px;font-family:monospace;color:var(--accent);font-weight:700;">${esc(e.invoice_number)}</span>` : e.entry_number ? `<span style="font-size:11px;font-family:monospace;color:var(--muted);font-weight:700;">#${String(e.entry_number).padStart(4,'0')}</span>` : '<span style="color:var(--muted-2);">—</span>'}</td>
        <td class="hide-mobile"><span style="font-weight:600;font-size:12px;color:${txColor};">${esc(txLabel)}</span></td>
        <td style="color:var(--muted);font-size:12px;">${fmtDate(e.date)}</td>
        <td>${statusBadge(e.status)}${reminderHtml}${noLedgerHtml}</td>
        <td>
          <button class="action-menu-btn" onclick="openEntryDetail('${e.id}')" title="View / Actions" style="font-size:18px;padding:4px 8px;">⋮</button>
        </td>
      </tr>`;
    });
    html += `</tbody></table></div>`;
    html += renderPagination(filtered.length, _entriesPage, 'renderEntriesPage');
    html += `</div>`;
  }
  el.innerHTML = html;
}

window.renderEntriesPage = function(p) {
  _entriesPage = p;
  renderEntries(document.getElementById('content'), p);
};

window.filterEntriesNow = function(q) {
  _entriesFilter = q;
  _entriesPage = 1;
  renderEntries(document.getElementById('content'), 1);
};

// ── Search filter (legacy, kept for compatibility) ─────────────────
window.filterEntryRows = function(q) {
  filterEntriesNow(q);
};

// ── Entry Detail ──────────────────────────────────────────────────
window.openEntryDetail = async function(id, options) {
  options = options || {};
  const reviewMode = options.reviewMode || false;
  let entry = await getEntry(id);
  // Fallback: if entry not found (e.g. notification has sender's entry_id which recipient can't access),
  // try finding the recipient's own mirror entry linked to this one
  if (!entry && id) {
    const { data: mirror } = await supabase
      .from('entries')
      .select('id')
      .eq('linked_entry_id', id)
      .eq('user_id', getCurrentUser()?.id)
      .maybeSingle();
    if (mirror?.id) {
      entry = await getEntry(mirror.id);
    }
  }
  if (!entry) return toast('Entry not found.', 'error');
  const cName = entry.contact?.name || '—';
  const _ecat    = entry.category || entry.tx_type;
  const txLabel  = TX_LABELS[_ecat] || _ecat;
  const txColor  = TX_COLORS[_ecat] || 'var(--text)';
  const settlements = entry.settlements || [];
  const paidAmt  = entry.settled_amount || entry.paid_amount || 0;
  const remaining = Math.max(0, (entry.amount || 0) - paidAmt);
  const isTerminal = ['settled','voided','cancelled','fulfilled','closed'].includes(entry.status);
  const canMarkPaid = ['owed_to_me','bill_sent','invoice_sent','i_owe','bill_received','invoice_received',
    'they_owe_you','you_owe_them','invoice','bill','advance_paid','advance_received'].includes(_ecat) && !isTerminal;
  const canFulfill  = ['advance_paid','advance_received'].includes(_ecat) && !isTerminal;
  const pendingSettlements = settlements.filter(s => s.status === 'pending');

  let settleHtml = '';
  if (settlements.length > 0) {
    settleHtml = `<div style="margin-top:16px;"><h4 style="font-size:14px;margin-bottom:8px;">Settlements</h4>`;
    settlements.forEach(s => {
      const isPending = s.status === 'pending';
      const statusBadgeHtml = isPending
        ? `<span style="background:rgba(213,186,120,.15);color:var(--gold, #D5BA78);padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">⏳ Pending Review</span>`
        : s.status === 'confirmed'
          ? `<span style="background:rgba(95,211,154,.15);color:var(--green);padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">✓ Confirmed</span>`
          : '';
      const pendingActions = isPending
        ? `<div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;">
            <button class="btn btn-primary btn-sm" onclick="confirmSettlement('${s.id}','${entry.id}',${reviewMode})" style="padding:6px 12px;font-size:11px;font-weight:700;background:var(--green);border-color:var(--green);">✓ Confirm Payment</button>
            <button class="bs sm" onclick="rejectSettlement('${s.id}','${entry.id}',${reviewMode})" style="padding:6px 10px;font-size:11px;color:var(--red);border-color:var(--red);">✕ Reject Payment</button>
            <button class="bs sm" onclick="openAdjustSettlementModal('${s.id}','${entry.id}','${fmtMoney(s.amount, entry.currency)}',${reviewMode})" style="padding:6px 10px;font-size:11px;background:var(--amber,#D5BA78);color:#000;border-color:var(--amber,#D5BA78);font-weight:600;">⚙ Edit &amp; Adjust</button>
          </div>`
        : '';
      settleHtml += `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;${isPending ? 'background:rgba(213,186,120,.05);margin:0 -12px;padding:8px 12px;border-radius:8px;border:1px solid rgba(213,186,120,.2);margin-bottom:6px;' : ''}">
        <div>
          <strong>${fmtMoney(s.amount, entry.currency)}</strong>
          ${s.method ? `<span style="color:var(--muted);margin-left:8px;">${esc(s.method)}</span>` : ''}
          ${statusBadgeHtml ? `<span style="margin-left:8px;">${statusBadgeHtml}</span>` : ''}
          ${s.note ? `<div style="color:var(--muted);font-size:12px;margin-top:2px;">${esc(s.note)}</div>` : ''}
          ${s.proof_url ? `<div style="margin-top:4px;">
            ${s.proof_url.match(/\.(jpg|jpeg|png|gif|webp)$/i)
              ? `<img src="${esc(s.proof_url)}" style="max-width:100px;max-height:80px;border-radius:4px;border:1px solid var(--border);cursor:pointer;margin-top:2px;" onclick="window.open('${esc(s.proof_url)}','_blank')" title="Click to view full size">`
              : `<a href="${esc(s.proof_url)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent);font-size:12px;text-decoration:underline;">📎 View Proof</a>`}
          </div>` : ''}
          ${pendingActions}
        </div>
        <div style="color:var(--muted);font-size:12px;">${fmtDate(s.created_at)}</div>
      </div>`;
    });
    settleHtml += `</div>`;
  }

  // Build modal content based on review mode
  let modalContent = '';

  if (reviewMode && pendingSettlements.length > 0) {
    // PAYMENT REVIEW MODE: Settlements at top with prominent actions
    modalContent = `
      <div style="background:linear-gradient(135deg, rgba(213,186,120,.15), rgba(213,186,120,.08));border:1px solid rgba(213,186,120,.3);border-radius:10px;padding:14px 16px;margin-bottom:16px;">
        <div style="font-size:12px;font-weight:700;color:var(--amber,#D5BA78);text-transform:uppercase;letter-spacing:.05em;">🔍 Payment Review Mode</div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;">
        <h3 style="margin:0;color:var(--text);">Pending Settlement</h3>
        <button class="btn btn-secondary btn-sm" onclick="closeModal()">✕</button>
      </div>
      ${settleHtml}
      <div style="border-top:1px solid var(--border);margin-top:20px;padding-top:14px;">
        <h4 style="font-size:13px;margin:0 0 12px 0;color:var(--muted);">Entry Details</h4>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
          <div style="background:var(--bg3);border-radius:10px;padding:12px;">
            <div style="font-size:11px;color:var(--muted);text-transform:uppercase;">Contact</div>
            <div style="font-weight:700;margin-top:4px;">${esc(cName)}</div>
          </div>
          <div style="background:var(--bg3);border-radius:10px;padding:12px;">
            <div style="font-size:11px;color:var(--muted);text-transform:uppercase;">Type</div>
            <div style="font-weight:700;color:${txColor};margin-top:4px;">${esc(txLabel)}</div>
          </div>
          <div style="background:var(--bg3);border-radius:10px;padding:12px;">
            <div style="font-size:11px;color:var(--muted);text-transform:uppercase;">Amount</div>
            <div style="font-weight:800;font-size:20px;margin-top:4px;">${fmtMoney(entry.amount, entry.currency)}</div>
          </div>
          <div style="background:var(--bg3);border-radius:10px;padding:12px;">
            <div style="font-size:11px;color:var(--muted);text-transform:uppercase;">Date</div>
            <div style="font-weight:600;margin-top:4px;">${fmtDate(entry.date)}</div>
          </div>
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:14px;padding-top:14px;border-top:1px solid var(--border);">
        <button class="bs sm" onclick="openEditEntryModal('${entry.id}')">Edit</button>
        <button class="bs sm" onclick="printInvoice('${entry.id}')">Print</button>
      </div>
    `;
  } else {
    // STANDARD VIEW: Settlements at bottom, all options available
    modalContent = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;">
        <h3 style="margin:0;">Entry Detail</h3>
        <button class="btn btn-secondary btn-sm" onclick="closeModal()">✕</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
        <div style="background:var(--bg3);border-radius:10px;padding:12px;">
          <div style="font-size:11px;color:var(--muted);text-transform:uppercase;">Contact</div>
          <div style="font-weight:700;margin-top:4px;">${esc(cName)}</div>
        </div>
        <div style="background:var(--bg3);border-radius:10px;padding:12px;">
          <div style="font-size:11px;color:var(--muted);text-transform:uppercase;">Type</div>
          <div style="font-weight:700;color:${txColor};margin-top:4px;">${esc(txLabel)}</div>
        </div>
        <div style="background:var(--bg3);border-radius:10px;padding:12px;">
          <div style="font-size:11px;color:var(--muted);text-transform:uppercase;">Amount</div>
          <div style="font-weight:800;font-size:20px;margin-top:4px;">${fmtMoney(entry.amount, entry.currency)}</div>
        </div>
        <div style="background:var(--bg3);border-radius:10px;padding:12px;">
          <div style="font-size:11px;color:var(--muted);text-transform:uppercase;">Status</div>
          <div style="margin-top:4px;">${statusBadge(entry.status)}</div>
        </div>
        <div style="background:var(--bg3);border-radius:10px;padding:12px;">
          <div style="font-size:11px;color:var(--muted);text-transform:uppercase;">Date</div>
          <div style="font-weight:600;margin-top:4px;">${fmtDate(entry.date)}</div>
        </div>
        ${entry.invoice_number ? `<div style="background:var(--bg3);border-radius:10px;padding:12px;">
          <div style="font-size:11px;color:var(--muted);text-transform:uppercase;">Invoice #</div>
          <div style="font-weight:600;margin-top:4px;">${esc(entry.invoice_number)}</div>
        </div>` : ''}
      </div>
      ${entry.settled_amount > 0 ? `
        <div style="border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:16px;">
          <div style="display:flex;justify-content:space-between;padding:10px 14px;background:var(--bg3);border-bottom:1px solid var(--border);">
            <span style="font-size:12px;color:var(--muted);text-transform:uppercase;">Settled</span>
            <span style="font-weight:700;color:var(--green);">${fmtMoney(entry.settled_amount, entry.currency)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;padding:10px 14px;">
            <span style="font-size:12px;color:var(--muted);text-transform:uppercase;">Balance</span>
            <span style="font-weight:800;color:${remaining <= 0 ? 'var(--green)' : 'var(--amber)'};">${fmtMoney(remaining, entry.currency)}</span>
          </div>
        </div>
      ` : ''}
      ${entry.note ? `<div style="background:var(--bg3);border-radius:10px;padding:10px 12px;margin-bottom:16px;">
        <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">🔒 Note to self</div>
        <div style="font-size:13px;">${esc(entry.note)}</div>
      </div>` : ''}
      ${settleHtml}
      ${canMarkPaid ? `
      <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border);display:flex;gap:8px;flex-wrap:wrap;">
        <button class="bs sm" style="background:var(--accent);color:#fff;border-color:var(--accent);font-weight:600;" onclick="closeModal();openMarkPaidModal('${entry.id}')">💳 Record Payment${remaining > 0 ? ` (${fmtMoney(remaining, entry.currency || 'USD')})` : ''}</button>
        ${canFulfill ? `<button class="bs sm" style="border-color:var(--green);color:var(--green);font-weight:600;" onclick="closeModal();openRecordFulfillmentModal('${entry.id}')">✅ Record Fulfillment</button>` : ''}
      </div>` : ''}
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;padding-top:${canMarkPaid ? '10' : '14'}px;${canMarkPaid ? '' : 'border-top:1px solid var(--border);margin-top:16px;'}">
        <button class="bs sm" onclick="openEditEntryModal('${entry.id}')">Edit</button>
        <button class="bs sm" onclick="closeModal();openShareModal('${entry.id}')">Share</button>
        ${!isTerminal ? `<button class="bs sm" onclick="closeModal();openSendReminderModal('${entry.id}')">Remind</button>` : ''}
        ${['invoice_sent','bill_sent','invoice','bill'].includes(_ecat) && !isTerminal ? `<button class="bs sm" onclick="closeModal();openNotifyInvoiceModal('${entry.id}')" style="color:#60a5fa;">✉️ Email</button>` : ''}
        <button class="bs sm" onclick="printInvoice('${entry.id}')">Print</button>
        <button class="bs sm" onclick="duplicateEntry('${entry.id}');closeModal();">Duplicate</button>
        <button class="bs sm" onclick="toggleNoLedger('${entry.id}',${!entry.no_ledger});closeModal();">${entry.no_ledger ? 'Restore Ledger' : 'Rm Ledger'}</button>
        <button class="bs sm" onclick="handleVoidEntry('${entry.id}');closeModal();" style="color:var(--amber);">Void</button>
        <button class="bs sm" onclick="confirmDeleteEntry('${entry.id}');closeModal();" style="color:var(--red);">Delete</button>
      </div>
    `;
  }

  openModal(modalContent, { maxWidth: '560px' });
};

// ── Confirm / Reject Settlement ──────────────────────────────────
window.confirmSettlement = async function(settlementId, entryId, reviewMode) {
  try {
    const result = await reviewSettlement(settlementId, {
      status: 'confirmed',
      reviewedBy: getCurrentUser().id
    });
    if (!result) {
      toast('Failed to confirm settlement.', 'error');
      return;
    }
    toast('Settlement confirmed.', 'success');
    invalidateEntryCache(getCurrentUser().id);
    closeModal();
    // Re-open the entry detail, staying in review mode if applicable
    await window.openEntryDetail(entryId, { reviewMode: reviewMode || false });
  } catch (err) {
    console.error('[confirmSettlement]', err);
    toast('Error confirming settlement: ' + (err?.message || err), 'error');
  }
};

window.rejectSettlement = async function(settlementId, entryId, reviewMode) {
  if (!confirm('Reject this settlement? It will be removed.')) return;
  try {
    const ok = await deleteSettlement(settlementId);
    if (!ok) {
      toast('Failed to reject settlement.', 'error');
      return;
    }
    toast('Settlement rejected and removed.', 'success');
    invalidateEntryCache(getCurrentUser().id);
    closeModal();
    await window.openEntryDetail(entryId, { reviewMode: reviewMode || false });
  } catch (err) {
    console.error('[rejectSettlement]', err);
    toast('Error rejecting settlement: ' + (err?.message || err), 'error');
  }
};

// ── Edit & Adjust Settlement Amount ────────────────────────────────
window.openAdjustSettlementModal = async function(settlementId, entryId, currentAmount, reviewMode) {
  // Parse the amount from the formatted string (remove currency symbols and format)
  const parsedAmount = parseFloat(currentAmount.replace(/[^0-9.-]/g, ''));
  const settlement = await supabase.from('settlements').select('*').eq('id', settlementId).single().then(r => r.data);

  if (!settlement) return toast('Settlement not found.', 'error');

  openModal(`
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;">
      <h3 style="margin:0;">Edit & Adjust Amount</h3>
      <button class="btn btn-secondary btn-sm" onclick="closeModal();openEntryDetail('${entryId}', { reviewMode: ${reviewMode} })">✕</button>
    </div>
    <p style="color:var(--muted);margin-bottom:16px;font-size:13px;">Modify the settlement amount before confirming.</p>
    <div class="form-group">
      <label>Settlement Amount</label>
      <input type="number" id="adjust-amount" step="0.01" min="0" value="${settlement.amount / 100}" style="font-size:16px;font-weight:600;">
    </div>
    <div style="margin-top:20px;display:flex;gap:8px;justify-content:flex-end;">
      <button class="btn btn-secondary btn-sm" onclick="closeModal();openEntryDetail('${entryId}', { reviewMode: ${reviewMode} })">Cancel</button>
      <button class="btn btn-primary btn-sm" onclick="confirmAdjustedSettlement('${settlementId}','${entryId}',${reviewMode})">Confirm Adjusted Amount</button>
    </div>
  `, { maxWidth: '400px' });
};

// ── Confirm Adjusted Settlement ────────────────────────────────────
window.confirmAdjustedSettlement = async function(settlementId, entryId, reviewMode) {
  const newAmount = parseFloat(document.getElementById('adjust-amount').value);
  if (isNaN(newAmount) || newAmount < 0) {
    toast('Please enter a valid amount.', 'error');
    return;
  }

  try {
    // Update settlement with new amount (convert to cents)
    const result = await supabase
      .from('settlements')
      .update({ amount: Math.round(newAmount * 100) })
      .eq('id', settlementId);

    if (result.error) {
      toast('Failed to update amount: ' + result.error.message, 'error');
      return;
    }

    // Now confirm the settlement
    const reviewResult = await reviewSettlement(settlementId, {
      status: 'confirmed',
      reviewedBy: getCurrentUser().id
    });

    if (!reviewResult) {
      toast('Failed to confirm settlement.', 'error');
      return;
    }

    toast('Settlement amount adjusted and confirmed.', 'success');
    invalidateEntryCache(getCurrentUser().id);
    closeModal();
    await window.openEntryDetail(entryId, { reviewMode: reviewMode || false });
  } catch (err) {
    console.error('[confirmAdjustedSettlement]', err);
    toast('Error: ' + (err?.message || err), 'error');
  }
};

// ── Edit Entry Modal ──────────────────────────────────────────────
window.openEditEntryModal = async function(id) {
  const entry = await getEntry(id);
  if (!entry) return toast('Entry not found.', 'error');
  const contacts = await listContacts(getCurrentUser().id);
  const contactOpts = contacts.map(c => `<option value="${c.id}" ${c.id === entry.contact_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const statusOpts = ['draft','posted','sent','viewed','accepted','partially_settled','settled','fulfilled','overdue','disputed','voided','cancelled']
    .map(s => `<option value="${s}" ${s === entry.status ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1).replace('_',' ')}</option>`).join('');
  const typeOpts = Object.entries(TX_LABELS).map(([k,v]) => `<option value="${k}" ${k === entry.tx_type ? 'selected' : ''}>${v}</option>`).join('');

  // ── Template entry: full field editing ───────────────────────────
  if (entry.template_id) {
    const tplRes = await supabase.from('templates').select('*').eq('id', entry.template_id).single();
    const tpl = tplRes.data;
    if (!tpl) return toast('Template not found.', 'error');

    window._activeTpl = tpl;
    window._activeTplCurrency = entry.currency || tpl.currency || getCurrentProfile()?.default_currency || 'USD';
    window._tplFields = tpl.fields || [];
    const fields = tpl.fields || [];
    const saved = entry.template_data || {};
    const hasFinalTotal = fields.some(f => f.isFinalTotal);

    const fieldsHtml = fields.map(f => {
      const sv = saved[f.id];
      if (f.type === 'text') {
        const val = sv?.value || '';
        return `<div class="form-group"><label>${esc(f.label)}${f.required?' *':''}</label><input type="text" id="tf-${f.id}" class="tpl-field" value="${esc(val)}"></div>`;
      }
      if (f.type === 'number' || f.type === 'currency') {
        const _hasCalcs = (f.calculators||[]).length > 0;
        if (_hasCalcs) {
          const _isFinal = f.isFinalTotal;
          const savedVal = sv?.value || 0;
          return `<div class="form-group"><label>${esc(f.label)} <span style="font-size:10px;color:${_isFinal?'var(--green, #5FD39A)':'var(--blue, #7B92B0)'};font-weight:600;">${_isFinal?'✓ TOTAL':'⚡ auto'}</span></label><div id="tf-${f.id}" class="tpl-field" style="padding:12px 16px;background:${_isFinal?'rgba(95,211,154,.08)':'rgba(123,146,176,.08)'};border:2px solid ${_isFinal?'var(--green, #5FD39A)':'var(--blue, #7B92B0)'};border-radius:10px;font-weight:800;font-size:${_isFinal?'22':'16'}px;color:${_isFinal?'var(--green, #5FD39A)':'var(--blue, #7B92B0)'};" data-computed="${savedVal}">${_tplFmt(savedVal, window._activeTplCurrency)}</div></div>`;
        }
        const val = sv?.value || f.defaultValue || '';
        return `<div class="form-group"><label>${esc(f.label)}${f.required?' *':''}</label><input type="number" id="tf-${f.id}" step="0.01" class="tpl-field" value="${esc(String(val))}" oninput="recalcTemplateFields()"></div>`;
      }
      if (f.type === 'date') {
        const val = sv?.value || new Date().toISOString().slice(0,10);
        return `<div class="form-group"><label>${esc(f.label)}</label><input type="date" id="tf-${f.id}" class="tpl-field" value="${esc(val)}"></div>`;
      }
      if (f.type === 'textarea') {
        const val = sv?.value || '';
        return `<div class="form-group"><label>${esc(f.label)}</label><textarea id="tf-${f.id}" rows="2" class="tpl-field">${esc(val)}</textarea></div>`;
      }
      if (f.type === 'select') {
        const val = sv?.value || '';
        return `<div class="form-group"><label>${esc(f.label)}</label><select id="tf-${f.id}" class="tpl-field" onchange="recalcTemplateFields()">${(f.options||[]).map(o => `<option ${o===val?'selected':''}>${esc(o)}</option>`).join('')}</select></div>`;
      }
      if (f.type === 'computed') {
        const savedVal = sv?.value || 0;
        return `<div class="form-group"><label>${esc(f.label)}</label><div id="tf-${f.id}" class="tpl-field" style="padding:10px 14px;background:var(--bg3);border-radius:10px;font-weight:700;font-size:16px;" data-computed="${savedVal}">${_tplFmt(savedVal, window._activeTplCurrency)}</div></div>`;
      }
      if (f.type === 'paired') {
        return `<div class="form-group"><label>${esc(f.label)} (${esc(f.textLabel||'Item')} + ${esc(f.numericLabel||'Amount')})</label>
          <div id="tf-${f.id}-rows" class="paired-rows"></div>
          <button class="btn btn-secondary btn-sm" style="margin-top:6px;" onclick="addPairedRow('${f.id}')">+ Add Row</button>
        </div>`;
      }
      return '';
    }).join('');

    closeModal();
    openModal(`
      <h3 style="margin-bottom:4px;">Edit Entry</h3>
      <p style="color:var(--muted);font-size:13px;margin-bottom:16px;">${esc(tpl.name)}${entry.invoice_number ? ' · ' + esc(entry.invoice_number) : ''}</p>
      <div class="form-group"><label>Contact *</label><select id="ee-contact">${contactOpts}</select></div>
      <div class="form-group"><label>Type</label><select id="ee-type">${typeOpts}</select></div>
      <div class="form-row">
        <div class="form-group"><label>Date</label><input type="date" id="ee-date" value="${entry.date}"></div>
        <div class="form-group">
          <label>Currency${hasFinalTotal?'':' &amp; Amount'}</label>
          <div style="display:flex;gap:6px;">
            <select id="ee-currency" style="flex:0 0 86px;padding:10px 4px;" onchange="window._activeTplCurrency=this.value;recalcTemplateFields()">${currencySelectHtml(window._activeTplCurrency)}</select>
            <input type="number" id="ee-amount" step="0.01" placeholder="Set by Final Total" style="flex:1;${hasFinalTotal?'display:none;':''}" value="${hasFinalTotal?'':toDollars(entry.amount)}" oninput="this._userEdited=this.value!==''">
          </div>
        </div>
      </div>
      <div class="form-group"><label>Status</label><select id="ee-status">${statusOpts}</select></div>
      ${fieldsHtml}
      <div class="form-group"><label>Note</label><textarea id="ee-note" rows="2">${esc(entry.note || '')}</textarea></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
        <button class="btn btn-secondary btn-sm" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary btn-sm" onclick="saveEditTemplateEntry('${id}','${entry.template_id}')">Save Changes</button>
      </div>
    `, { maxWidth: '560px' });

    // Restore paired row data
    fields.filter(f => f.type === 'paired').forEach(f => {
      const sv = saved[f.id];
      const rows = sv?.rows || [];
      if (rows.length > 0) {
        rows.forEach(r => {
          const container = document.getElementById('tf-' + f.id + '-rows');
          if (!container) return;
          const row = document.createElement('div');
          row.className = 'paired-row';
          row.style.cssText = 'display:flex;gap:6px;margin-bottom:4px;';
          row.innerHTML = `
            <input type="text" placeholder="Item" class="pr-text" style="flex:2;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;" value="${esc(r.text||'')}">
            <input type="number" placeholder="Qty" class="pr-qty" step="1" style="width:60px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;" value="${r.qty||1}" oninput="recalcTemplateFields()">
            <input type="number" placeholder="Amount" class="pr-num" step="0.01" style="flex:1;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;" value="${r.numeric||''}" oninput="recalcTemplateFields()">
            <button onclick="this.parentElement.remove();recalcTemplateFields();" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:14px;">✕</button>
          `;
          container.appendChild(row);
        });
      } else {
        addPairedRow(f.id);
      }
    });

    // Trigger recalc to populate computed fields
    recalcTemplateFields();
    return;
  }

  // ── Basic (non-template) entry editing ───────────────────────────
  closeModal();
  openModal(`
    <h3 style="margin-bottom:16px;">Edit Entry</h3>
    <div class="form-group"><label>Contact</label><select id="ee-contact">${contactOpts}</select></div>
    <div class="form-group"><label>Type</label><select id="ee-type">${typeOpts}</select></div>
    <div class="form-row">
      <div class="form-group"><label>Amount</label><input type="number" id="ee-amount" min="0" step="0.01" value="${toDollars(entry.amount)}"></div>
      <div class="form-group"><label>Date</label><input type="date" id="ee-date" value="${entry.date}"></div>
    </div>
    <div class="form-group"><label>Status</label><select id="ee-status">${statusOpts}</select></div>
    <div class="form-group"><label>Note</label><textarea id="ee-note" rows="2">${esc(entry.note || '')}</textarea></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
      <button class="btn btn-secondary btn-sm" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary btn-sm" onclick="saveEditEntry('${id}')">Save</button>
    </div>
  `, { maxWidth: '480px' });
};

window.saveEditEntry = async function(id) {
  await updateEntry(id, {
    contact_id: document.getElementById('ee-contact').value,
    tx_type: document.getElementById('ee-type').value,
    amount: parseFloat(document.getElementById('ee-amount').value),
    date: document.getElementById('ee-date').value,
    status: document.getElementById('ee-status').value,
    note: document.getElementById('ee-note').value.trim()
  });
  closeModal();
  toast('Entry updated.', 'success');
  _navAfterAction();
};

window.saveEditTemplateEntry = async function(entryId, templateId) {
  const contactId = document.getElementById('ee-contact').value;
  const txType = document.getElementById('ee-type').value;
  const status = document.getElementById('ee-status').value;
  const date = document.getElementById('ee-date').value;
  const note = document.getElementById('ee-note').value.trim();
  const currency = document.getElementById('ee-currency')?.value || window._activeTplCurrency || 'USD';
  if (!contactId) return toast('Select a contact.', 'error');

  // Collect template field values
  const tplData = {};
  const fields = window._activeTpl?.fields || [];
  fields.forEach(f => {
    const el = document.getElementById('tf-' + f.id);
    if (el) {
      if (el.dataset.computed !== undefined) {
        tplData[f.id] = { label: f.label, value: parseFloat(el.dataset.computed) || 0, type: f.type };
      } else {
        tplData[f.id] = { label: f.label, value: el.value, type: f.type };
      }
    }
    const rowsEl = document.getElementById('tf-' + f.id + '-rows');
    if (rowsEl) {
      const items = [];
      rowsEl.querySelectorAll('.paired-row').forEach(row => {
        const text = row.querySelector('.pr-text')?.value || '';
        const qty = parseFloat(row.querySelector('.pr-qty')?.value) || 1;
        const num = parseFloat(row.querySelector('.pr-num')?.value) || 0;
        if (text || num) items.push({ text, qty, numeric: num });
      });
      tplData[f.id] = { label: f.label, type: 'paired', rows: items, value: items.reduce((s, r) => s + (r.qty * r.numeric), 0) };
    }
  });

  // Determine amount: from Final Total field or the amount input
  let amount = parseFloat(document.getElementById('ee-amount')?.value) || 0;
  const finalTotalField = fields.find(f => f.isFinalTotal);
  if (finalTotalField && tplData[finalTotalField.id]) {
    amount = parseFloat(tplData[finalTotalField.id].value) || amount;
  }
  if (!amount || amount <= 0) return toast('Enter an amount.', 'error');

  await updateEntry(entryId, {
    contact_id: contactId, tx_type: txType, amount, currency,
    date, status, note, template_data: tplData
  });
  closeModal();
  toast('Entry updated.', 'success');
  _navAfterAction();
};

// ── Settle Modal ──────────────────────────────────────────────────
window.openSettleModal = async function(id) {
  const entry = await getEntry(id);
  if (!entry) return;
  const remaining = (entry.amount - entry.settled_amount) / 100;

  openModal(`
    <h3 style="margin-bottom:16px;">Record Settlement</h3>
    <div style="background:var(--bg3);border-radius:10px;padding:12px;margin-bottom:14px;">
      <div style="font-size:12px;color:var(--muted);">Balance remaining</div>
      <div style="font-size:20px;font-weight:800;">${fmtMoney(entry.amount - entry.settled_amount, entry.currency)}</div>
    </div>
    <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <div class="form-group"><label>Amount to settle *</label><input type="number" id="settle-amount" min="0.01" step="0.01" max="${remaining}" value="${remaining}"></div>
      <div class="form-group"><label>Currency</label><select id="settle-currency">
        ${['USD','EUR','GBP','NGN','CAD','AUD','JPY','KES','ZAR','GHS','INR','CNY','BRL','MXN','AED','SAR','QAR','KWD','EGP','MAD','TZS','UGX','ETB','XOF'].map(c => `<option value="${c}" ${(entry.currency || getCurrentProfile()?.default_currency || 'USD')===c?'selected':''}>${c}</option>`).join('')}
      </select></div>
    </div>
    <div class="form-group"><label>Method</label><select id="settle-method">
      <option value="">Select method</option>
      <option value="cash">Cash</option>
      <option value="bank">Bank Transfer</option>
      <option value="card">Card</option>
      <option value="mobile">Mobile Money</option>
      <option value="crypto">Crypto</option>
      <option value="other">Other</option>
    </select></div>
    <div class="form-group"><label>Note</label><textarea id="settle-note" rows="2" placeholder="Optional note..."></textarea></div>
    <div class="form-group">
      <label>Proof of Payment <span style="color:var(--muted);font-weight:400;">(optional — photo, receipt, screenshot)</span></label>
      <div id="settle-file-drop" onclick="document.getElementById('settle-file-input').click()" style="border:2px dashed var(--border);border-radius:10px;padding:14px;text-align:center;cursor:pointer;font-size:13px;color:var(--muted);transition:border-color .2s;" onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border)'">
        <div id="settle-file-label">📎 Click to attach file or image</div>
      </div>
      <input type="file" id="settle-file-input" accept="image/*,.pdf" style="display:none;" onchange="window._settleFileSelected(this)">
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
      <button class="btn btn-secondary btn-sm" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary btn-sm" id="settle-save-btn" onclick="saveSettlement('${id}')">Record Settlement</button>
    </div>
  `, { maxWidth: '420px' });
};

window._settleFileSelected = function(input) {
  const file = input.files[0];
  if (!file) return;
  window._settleFile = file;
  const label = document.getElementById('settle-file-label');
  if (label) label.innerHTML = `✅ ${esc(file.name)} <span style="color:var(--muted);">(${(file.size/1024).toFixed(1)} KB)</span>`;
};

window.saveSettlement = async function(entryId) {
  const amount = parseFloat(document.getElementById('settle-amount').value);
  if (!amount || amount <= 0) return toast('Enter a valid amount.', 'error');
  const btn = document.getElementById('settle-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  let proofUrl = null;
  if (window._settleFile) {
    try {
      const ext = window._settleFile.name.split('.').pop();
      const path = `settlements/${getCurrentUser().id}/${Date.now()}.${ext}`;
      const { data: upData, error: upErr } = await supabase.storage
        .from('attachments')
        .upload(path, window._settleFile, { upsert: false });
      if (!upErr && upData) {
        const { data: urlData } = supabase.storage.from('attachments').getPublicUrl(path);
        proofUrl = urlData?.publicUrl || null;
      }
    } catch(e) { console.warn('[settle file upload]', e); }
    window._settleFile = null;
  }

  await createSettlement(entryId, {
    amount,
    currency: document.getElementById('settle-currency')?.value || 'USD',
    method: document.getElementById('settle-method').value,
    note: document.getElementById('settle-note').value.trim(),
    proof_url: proofUrl,
    recordedBy: getCurrentUser().id
  });
  closeModal();
  toast('Settlement recorded.', 'success');
  _navAfterAction();
};

// ── Mark as Paid Modal (spec section 6) ──────────────────────────
// Trigger: "Mark as Paid" button on a record — not a dropdown creation type.
// Creates a payment_recorded entry + updates paid_amount/outstanding_amount/status.
window.openMarkPaidModal = async function(id) {
  const entry = await getEntry(id);
  if (!entry) return toast('Entry not found.', 'error');

  const cat        = entry.category || entry.tx_type;
  const paidSoFar  = entry.settled_amount || entry.paid_amount || 0;
  const outstanding = Math.max(0, (entry.amount || 0) - paidSoFar);
  const outstandingDollars = (outstanding / 100).toFixed(2);
  const currency   = entry.currency || 'USD';
  const cName      = entry.contact?.name || '—';
  const label      = TX_LABELS[cat] || cat;

  openModal(`
    <h3 style="margin-bottom:4px;">💳 Record Payment</h3>
    <p style="color:var(--muted);font-size:13px;margin-bottom:16px;">${esc(cName)} — ${label}</p>

    <div class="form-row">
      <div class="form-group">
        <label>Amount</label>
        <input type="number" id="mp-amount" value="${outstandingDollars}" min="0.01" step="0.01"
          placeholder="${outstandingDollars}" style="width:100%;">
        <div style="font-size:11px;color:var(--muted);margin-top:4px;">Outstanding: ${fmtMoney(outstanding, currency)}</div>
      </div>
      <div class="form-group"><label>Date</label>
        <input type="date" id="mp-date" value="${new Date().toISOString().slice(0,10)}" style="width:100%;"></div>
    </div>

    <div class="form-row">
      <div class="form-group"><label>Method</label>
        <select id="mp-method" style="width:100%;">
          <option value="">— optional —</option>
          <option value="cash">Cash</option>
          <option value="bank">Bank Transfer</option>
          <option value="card">Card</option>
          <option value="mobile">Mobile Money</option>
          <option value="cheque">Cheque</option>
          <option value="crypto">Crypto</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div class="form-group"><label>Currency</label>
        <input type="text" value="${esc(currency)}" readonly style="width:100%;opacity:.7;">
      </div>
    </div>

    <div class="form-group"><label>Note <span style="font-weight:400;color:var(--muted);">(optional)</span></label>
      <textarea id="mp-note" rows="2" placeholder="e.g. Cash handed over"></textarea></div>

    <div class="form-group">
      <label>Receipt / Proof <span style="font-weight:400;color:var(--muted);">(optional)</span></label>
      <input type="file" id="mp-proof" accept="image/*,.pdf" style="width:100%;font-size:13px;">
      <div id="mp-proof-preview" style="margin-top:6px;display:none;">
        <img id="mp-proof-img" style="max-width:100%;max-height:120px;border-radius:6px;border:1px solid var(--border);">
      </div>
    </div>

    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
      <button class="bs sm" onclick="closeModal()">Cancel</button>
      <button class="bs sm" id="mp-save-btn" onclick="saveMarkPaid('${id}','${currency}')"
        style="background:var(--accent);color:#fff;border-color:var(--accent);">💳 Save</button>
    </div>
  `, { maxWidth: '460px' });

  // Preview uploaded file
  document.getElementById('mp-proof')?.addEventListener('change', function() {
    const file = this.files?.[0];
    const preview = document.getElementById('mp-proof-preview');
    const img = document.getElementById('mp-proof-img');
    if (file && file.type.startsWith('image/') && preview && img) {
      img.src = URL.createObjectURL(file);
      preview.style.display = '';
    } else if (preview) { preview.style.display = 'none'; }
  });
};

window.saveMarkPaid = async function(entryId, currency) {
  const amountDollars = parseFloat(document.getElementById('mp-amount').value);
  if (!amountDollars || amountDollars <= 0) return toast('Enter a valid amount.', 'error');
  const amountCents = Math.round(amountDollars * 100);
  const note      = document.getElementById('mp-note')?.value.trim() || '';
  const method    = document.getElementById('mp-method')?.value || '';
  const proofFile = document.getElementById('mp-proof')?.files?.[0] || null;
  const btn       = document.getElementById('mp-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  try {
    // 0. Fetch entry for contact details
    const entry = await getEntry(entryId);
    const contactName = entry?.contact?.name || 'Contact';
    const contactEmail = entry?.contact?.email || '';
    const linkedUserId = entry?.contact?.linked_user_id || null;

    // 1. Upload proof file if provided
    let proofUrl = '';
    if (proofFile) {
      const ext  = proofFile.name.split('.').pop();
      const path = `settlements/${getCurrentUser().id}/${Date.now()}.${ext}`;
      const { data: upData, error: upErr } = await supabase.storage
        .from('attachments').upload(path, proofFile, { upsert: false });
      if (!upErr && upData) {
        const { data: urlData } = supabase.storage.from('attachments').getPublicUrl(path);
        proofUrl = urlData?.publicUrl || '';
      }
    }

    // 2. Insert into settlements table — DB trigger auto-updates entry.settled_amount + status
    const { data: settlement, error } = await supabase
      .from('settlements')
      .insert({
        entry_id:    entryId,
        amount:      amountCents,
        method:      method,
        note:        note,
        proof_url:   proofUrl,
        recorded_by: getCurrentUser().id,
        status:      'confirmed'
      })
      .select()
      .single();

    if (error) throw error;

    const cur = currency || entry?.currency || 'USD';
    const fmtAmt = fmtMoney(amountCents, cur);
    const fromName = getCurrentProfile()?.display_name || getCurrentProfile()?.full_name || 'Someone';

    // 3. Determine direction — if user who owes records, contact must verify
    const iOwe = ['i_owe','bill_received','invoice_received','you_owe_them','advance_received'].includes(entry.category || entry.tx_type);

    // 4. Self-notification
    await supabase.from('notifications').insert({
      user_id: getCurrentUser().id, type: 'payment_sent',
      message: `Payment of ${fmtAmt} recorded for ${contactName}${note ? ' — ' + note : ''}`,
      amount: amountCents, currency: cur,
      contact_name: contactName, entry_id: entryId, read: false
    });

    // 5. Mirror settlement to linked user's entry FIRST (so we have mirror entry ID for notification)
    let mirrorEntryId = null;
    if (linkedUserId) {
      const { data: mirrorEntry } = await supabase
        .from('entries')
        .select('id')
        .eq('user_id', linkedUserId)
        .eq('linked_entry_id', entryId)
        .maybeSingle();
      if (mirrorEntry?.id) {
        mirrorEntryId = mirrorEntry.id;
        await supabase.from('settlements').insert({
          entry_id:    mirrorEntry.id,
          amount:      amountCents,
          method:      method,
          note:        note,
          proof_url:   proofUrl,
          recorded_by: getCurrentUser().id,
          status:      iOwe ? 'pending' : 'confirmed'
        });
      }
    }

    // 6. In-app notification to linked contact — use THEIR mirror entry ID so they can open it
    if (linkedUserId) {
      const contactType = iOwe ? 'settlement_pending' : 'payment_received';
      await supabase.from('notifications').insert({
        user_id: linkedUserId, type: contactType,
        message: `${fromName} recorded a payment of ${fmtAmt}${note ? ' — ' + note : ''}`,
        amount: amountCents, currency: cur,
        contact_name: fromName, entry_id: mirrorEntryId || null, read: false
      });
    }

    // 5. Email to contact (non-blocking)
    if (contactEmail) {
      try {
        await sendNotificationEmail(getCurrentUser().id, {
          to: contactEmail, fromName,
          txType: 'payment_recorded', amount: amountDollars,
          currency: currency || entry?.currency || 'USD',
          message: note, entryId, isReminder: false,
          logoUrl: getCurrentProfile()?.logo_url, siteUrl: 'https://moneyinteractions.com',
          isSelf: false, contactName
        });
      } catch(e) { /* non-blocking */ }
    }

    closeModal();
    toast('Payment recorded ✓', 'success');
    _navAfterAction();
  } catch (err) {
    toast('Error: ' + (err?.message || err), 'error');
    if (btn) { btn.disabled = false; btn.textContent = '💳 Save'; }
  }
};

// ── Record Fulfillment (Advance) ──────────────────────────────────
window.openRecordFulfillmentModal = async function(entryId) {
  const entry = await getEntry(entryId);
  if (!entry) return;
  const cName = entry.contact?.name || 'Contact';
  const amtLabel = fmtMoney(entry.amount, entry.currency);
  openModal(`
    <h3 style="margin:0 0 16px;">✅ Record Fulfillment</h3>
    <p style="font-size:13px;color:var(--muted);margin-bottom:16px;">Mark this advance as fulfilled — the obligation has been met (goods delivered, service provided, etc.).</p>
    <div style="background:var(--bg3);border-radius:10px;padding:12px;margin-bottom:16px;">
      <div style="font-size:11px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Advance with ${esc(cName)}</div>
      <div style="font-size:18px;font-weight:800;">${amtLabel}</div>
    </div>
    <div class="form-group">
      <label>Note <span style="color:var(--muted);font-weight:400;">(optional)</span></label>
      <textarea id="rf-note" rows="2" placeholder="e.g. Goods delivered on March 15..."></textarea>
    </div>
    <div class="form-group">
      <label>Proof / Evidence <span style="font-weight:400;color:var(--muted);">(optional)</span></label>
      <input type="file" id="rf-proof" accept="image/*,.pdf" style="width:100%;font-size:13px;">
      <div id="rf-proof-preview" style="margin-top:6px;display:none;">
        <img id="rf-proof-img" style="max-width:100%;max-height:120px;border-radius:6px;border:1px solid var(--border);">
      </div>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
      <button class="bs sm" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary btn-sm" id="rf-save-btn" onclick="saveRecordFulfillment('${entryId}')">✅ Mark Fulfilled</button>
    </div>
  `, { maxWidth: '440px' });

  // Preview uploaded file
  document.getElementById('rf-proof')?.addEventListener('change', function() {
    const file = this.files?.[0];
    const preview = document.getElementById('rf-proof-preview');
    const img = document.getElementById('rf-proof-img');
    if (file && file.type.startsWith('image/') && preview && img) {
      img.src = URL.createObjectURL(file);
      preview.style.display = '';
    } else if (preview) { preview.style.display = 'none'; }
  });
};

window.saveRecordFulfillment = async function(entryId) {
  const note = document.getElementById('rf-note')?.value.trim() || null;
  const proofFile = document.getElementById('rf-proof')?.files?.[0] || null;
  const btn = document.getElementById('rf-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    // Upload proof file if provided
    let proofUrl = '';
    if (proofFile) {
      const ext  = proofFile.name.split('.').pop();
      const path = `fulfillments/${getCurrentUser().id}/${Date.now()}.${ext}`;
      const { data: upData, error: upErr } = await supabase.storage
        .from('attachments').upload(path, proofFile, { upsert: false });
      if (!upErr && upData) {
        const { data: urlData } = supabase.storage.from('attachments').getPublicUrl(path);
        proofUrl = urlData?.publicUrl || '';
      }
    }

    const entry = await getEntry(entryId);
    const contactName = entry?.contact?.name || 'Contact';
    const linkedUserId = entry?.contact?.linked_user_id || null;
    const fromName = getCurrentProfile()?.display_name || getCurrentProfile()?.full_name || 'Someone';

    const updateData = { status: 'fulfilled', updated_at: new Date().toISOString() };
    if (note) updateData.note = note;
    if (proofUrl) updateData.proof_url = proofUrl;
    const { error } = await supabase.from('entries').update(updateData).eq('id', entryId);
    if (error) throw error;

    // Self-notification
    await supabase.from('notifications').insert({
      user_id: getCurrentUser().id, type: 'fulfilled',
      message: `Advance marked as fulfilled for ${contactName}${note ? ': ' + note : ''}`,
      contact_name: contactName, entry_id: entryId, read: false
    });

    // Notify linked contact
    if (linkedUserId) {
      await supabase.from('notifications').insert({
        user_id: linkedUserId, type: 'fulfilled',
        message: `${fromName} marked an advance as fulfilled${note ? ': ' + note : ''}`,
        contact_name: fromName, entry_id: entryId, read: false
      });
      // Mirror status to linked entry
      const { data: mirrorEntry } = await supabase
        .from('entries')
        .select('id')
        .eq('user_id', linkedUserId)
        .eq('linked_entry_id', entryId)
        .maybeSingle();
      if (mirrorEntry?.id) {
        await supabase.from('entries').update(updateData).eq('id', mirrorEntry.id);
      }
    }

    closeModal();
    toast('Advance marked as fulfilled ✓', 'success');
    _navAfterAction();
  } catch (err) {
    toast('Error: ' + (err?.message || err), 'error');
    if (btn) { btn.disabled = false; btn.textContent = '✅ Mark Fulfilled'; }
  }
};

// ── Notify Invoice Modal ──────────────────────────────────────────
window.openNotifyInvoiceModal = async function(id) {
  const entry = await getEntry(id);
  if (!entry) return;
  const cName = entry.contact?.name || 'Contact';
  const invLabel = entry.invoice_number ? ` (${entry.invoice_number})` : '';
  const amtLabel = fmtMoney(entry.amount, entry.currency);

  const contactEmail = entry.contact?.email || '';
  openModal(`
    <h3 style="margin-bottom:4px;">✉️ Email Contact</h3>
    <p style="color:var(--muted);font-size:13px;margin-bottom:16px;">${esc(cName)}${invLabel} — ${amtLabel}</p>
    <div class="form-group">
      <label>Message to contact</label>
      <textarea id="notif-msg" rows="4" placeholder="Add a note or message (optional)..."></textarea>
    </div>
    <div class="form-group">
      <label>Mark as</label>
      <select id="notif-status">
        <option value="sent" ${entry.status!=='viewed'?'selected':''}>Sent</option>
        <option value="viewed" ${entry.status==='viewed'?'selected':''}>Viewed</option>
        <option value="">— Keep current status —</option>
      </select>
    </div>
    ${contactEmail ? `<label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;margin-bottom:14px;">
      <input type="checkbox" id="notif-send-email" checked style="accent-color:var(--accent);width:15px;height:15px;">
      Send email to <strong>${esc(contactEmail)}</strong>
    </label>` : `<p style="font-size:12px;color:var(--muted);margin-bottom:14px;">💡 Add an email to this contact to send emails.</p>`}
    <div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap;">
      <button class="bs sm" onclick="copyNotifLink('${id}')" title="Copy share link to clipboard">🔗 Copy Link</button>
      <button class="bs sm" onclick="copyNotifMessage('${id}')" title="Copy message + link to clipboard">📋 Copy Message + Link</button>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
      <button class="btn btn-secondary btn-sm" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary btn-sm" onclick="sendInvoiceNotification('${id}')">Send Email</button>
    </div>
  `, { maxWidth: '440px' });
};

window.copyNotifLink = async function(entryId) {
  const entry = await getEntry(entryId);
  if (!entry) return;
  let shareUrl = '';
  try {
    const { data: existing } = await supabase.from('share_tokens').select('token').eq('entry_id', entryId).maybeSingle();
    if (existing?.token) {
      shareUrl = window.location.origin + '/view?t=' + existing.token;
    } else {
      const snapshot = {
        amount: entry.amount, currency: entry.currency, tx_type: entry.tx_type,
        date: entry.date, note: entry.note, invoice_number: entry.invoice_number,
        status: entry.status, from_name: getCurrentProfile()?.display_name || '',
        from_email: getCurrentUser().email
      };
      const contactEmail = entry.contact?.email || '';
      const res = await createShareToken(getCurrentUser().id, entryId, {
        recipientEmail: contactEmail, entrySnapshot: snapshot
      });
      if (res?.token) shareUrl = window.location.origin + '/view?t=' + res.token;
    }
  } catch(_) {}
  if (!shareUrl) return toast('Could not generate link.', 'error');
  navigator.clipboard.writeText(shareUrl).then(() => toast('Link copied!', 'success')).catch(() => { prompt('Copy this link:', shareUrl); });
};

window.copyNotifMessage = async function(entryId) {
  const entry = await getEntry(entryId);
  if (!entry) return;
  const msg = document.getElementById('notif-msg')?.value?.trim() || '';
  let shareUrl = '';
  try {
    const { data: existing } = await supabase.from('share_tokens').select('token').eq('entry_id', entryId).maybeSingle();
    if (existing?.token) {
      shareUrl = window.location.origin + '/view?t=' + existing.token;
    } else {
      const snapshot = {
        amount: entry.amount, currency: entry.currency, tx_type: entry.tx_type,
        date: entry.date, note: entry.note, invoice_number: entry.invoice_number,
        status: entry.status, from_name: getCurrentProfile()?.display_name || '',
        from_email: getCurrentUser().email
      };
      const contactEmail = entry.contact?.email || '';
      const res = await createShareToken(getCurrentUser().id, entryId, {
        recipientEmail: contactEmail, entrySnapshot: snapshot
      });
      if (res?.token) shareUrl = window.location.origin + '/view?t=' + res.token;
    }
  } catch(_) {}
  const full = msg ? `${msg}\n\n${shareUrl}` : shareUrl;
  navigator.clipboard.writeText(full).then(() => toast('Message + link copied!', 'success')).catch(() => { prompt('Copy this:', full); });
};

window.sendInvoiceNotification = async function(entryId) {
  const message = document.getElementById('notif-msg').value.trim();
  const newStatus = document.getElementById('notif-status').value;
  const sendEmail = document.getElementById('notif-send-email')?.checked !== false;
  if (!message) return toast('Message required.', 'error');

  const entry = await getEntry(entryId);
  const cName = entry?.contact?.name || 'Someone';
  const cEmail = entry?.contact?.email || '';

  // Notify the linked contact (if on the platform)
  if (entry?.contact_id) {
    const { data: contact } = await supabase.from('contacts').select('linked_user_id, email').eq('id', entry.contact_id).single();
    if (contact?.linked_user_id) {
      await supabase.from('notifications').insert({
        user_id: contact.linked_user_id,
        type: 'invoice',
        message: `Invoice notification from ${getCurrentProfile()?.display_name || 'Someone'}: ${message}`,
        entry_id: entryId,
        contact_name: getCurrentProfile()?.display_name || '',
        amount: entry.amount,
        currency: entry.currency,
        read: false
      });
    }
    // Send email if contact has email and checkbox is checked
    const emailTo = contact?.email || cEmail;
    if (sendEmail && emailTo) {
      try {
        const fromName = window._getBsSenderName?.() || getCurrentProfile()?.display_name || getCurrentProfile()?.company_name || 'Money IntX';
        // Generate share link so email CTA points to the actual record
        let _shareLink = '';
        try {
          const { data: _sTok } = await supabase.from('share_tokens').select('token').eq('entry_id', entryId).maybeSingle();
          if (_sTok?.token) {
            _shareLink = window.location.origin + '/view?t=' + _sTok.token;
          } else {
            const _snap = { amount: entry.amount, currency: entry.currency, tx_type: entry.tx_type, date: entry.date, from_name: fromName };
            const _newTok = await createShareToken(getCurrentUser().id, entryId, { recipientEmail: emailTo, entrySnapshot: _snap });
            if (_newTok?.token) _shareLink = window.location.origin + '/view?t=' + _newTok.token;
          }
        } catch(_) {}
        const result = await sendNotificationEmail(getCurrentUser().id, {
          to: emailTo, fromName, txType: entry.category || entry.tx_type,
          amount: entry.amount,
          currency: entry.currency, message, entryId, isReminder: false,
          logoUrl: getCurrentProfile()?.logo_url,
          fromEmail: getCurrentProfile()?.company_email || getCurrentUser()?.email,
          siteUrl: 'https://moneyinteractions.com',
          shareLink: _shareLink || undefined
        });
        if (!result?.ok) toast('Email failed: ' + (result?.error || 'check Settings → Email Diagnostics'), 'info');
      } catch(e) { console.warn('Email send failed:', e); toast('Email failed: ' + e.message, 'error'); }
    }
  }

  // Update status if selected
  const updates = { reminder_count: (entry?.reminder_count || 0) + 1, last_reminder_at: new Date().toISOString() };
  if (newStatus) updates.status = newStatus;
  await updateEntry(entryId, updates);

  // Self notification log
  await supabase.from('notifications').insert({
    user_id: getCurrentUser().id,
    type: 'invoice',
    message: `Invoice notification sent to ${cName}${entry.invoice_number ? ' · ' + entry.invoice_number : ''}: ${message}`,
    entry_id: entryId,
    contact_name: cName,
    amount: entry?.amount,
    currency: entry?.currency,
    read: false
  });

  // Self-email copy
  if (getCurrentUser()?.email) {
    const fromName = getCurrentProfile()?.display_name || getCurrentProfile()?.company_name || 'Money IntX';
    try {
      await sendNotificationEmail(getCurrentUser().id, {
        to: getCurrentUser().email, fromName, txType: entry.category || entry.tx_type,
        amount: entry.amount, currency: entry.currency, message, entryId, isReminder: false,
        logoUrl: getCurrentProfile()?.logo_url, siteUrl: 'https://moneyinteractions.com',
        isSelf: true, contactName: cName
      });
    } catch(e) { console.warn('[self-email invoice notif]', e); }
  }

  closeModal();
  toast('Email sent.' + (sendEmail && cEmail ? ' Queued for delivery.' : ''), 'success');
  _navAfterAction();
};

// ── Void / Archive handlers ───────────────────────────────────────
window.handleVoidEntry = async function(id) {
  if (!confirm('Void this entry? This cannot be undone.')) return;
  await voidEntry(id);
  toast('Entry voided.', 'success');
  _navAfterAction();
};

window.handleArchiveEntry = async function(id, action) {
  if (action === 'archive') await archiveEntry(id);
  else await unarchiveEntry(id);
  toast(action === 'archive' ? 'Entry archived.' : 'Entry unarchived.', 'success');
  _navAfterAction();
};

// ── Share Entry — 1-step flow (generate link + show share options immediately) ──
window.openShareModal = async function(id) {
  const entry = await getEntry(id);
  if (!entry) return;
  const cName = entry.contact?.name || 'Contact';
  const cEmail = entry.contact?.email || '';
  const txLabel = TX_LABELS[entry.tx_type] || entry.tx_type;
  const amtStr = fmtMoney(entry.amount, entry.currency);

  // Show loading state
  openModal(`
    <h3 style="margin-bottom:8px;">Share Record</h3>
    <p style="color:var(--muted);font-size:13px;">Generating share link…</p>
  `, { maxWidth: '460px' });

  // Generate share token immediately
  const _shareSenderName = window._getBsSenderName?.() || getCurrentProfile()?.display_name || '';
  const _shareSenderEmail = window._getBsSenderEmail?.() || getCurrentUser().email;
  const snapshot = {
    amount: entry.amount, currency: entry.currency, tx_type: entry.tx_type,
    date: entry.date, note: entry.note, invoice_number: entry.invoice_number,
    status: entry.status, from_name: _shareSenderName,
    from_email: _shareSenderEmail
  };

  // Re-use existing token if one exists
  let url = '';
  let tokenObj = null;
  try {
    const { data: existing } = await supabase.from('share_tokens').select('id, token').eq('entry_id', id).maybeSingle();
    if (existing?.token) {
      url = window.location.origin + '/view?t=' + existing.token;
      tokenObj = existing;
    } else {
      tokenObj = await createShareToken(getCurrentUser().id, id, {
        recipientEmail: cEmail, entrySnapshot: snapshot
      });
      if (tokenObj?.token) url = getShareUrl(tokenObj.token);
    }
  } catch(_) {}
  if (!url) { closeModal(); return toast('Could not generate share link.', 'error'); }

  // Notify linked recipient if contact has email
  if (cEmail && tokenObj) {
    try {
      const { data: recipientId } = await supabase.rpc('find_user_id_by_email', { p_email: cEmail });
      if (recipientId) {
        await supabase.from('share_tokens').update({ recipient_id: recipientId, status: 'sent' }).eq('id', tokenObj.id);
        await supabase.from('notifications').insert({
          user_id: recipientId, type: 'shared_record',
          message: `${_shareSenderName || 'Someone'} shared a record with you: ${fmtMoney(entry.amount, entry.currency)}`,
          entry_id: id, contact_name: _shareSenderName || '',
          amount: entry.amount, currency: entry.currency, read: false
        });
      }
    } catch(_) {}
  }

  // Build default message — user can edit this in the textarea
  const defaultMsg = `Hi ${cName}, please review this record: ${txLabel} — ${amtStr}.\n${url}`;

  // Store share data globally so button handlers can read the edited message
  window._shareModalData = { url, cEmail, senderName: _shareSenderName || 'Money IntX' };

  // Show single-step share modal with editable message (v1 style)
  openModal(`
    <h3 style="margin-bottom:4px;">Share Record</h3>
    <div style="background:var(--bg3);border-radius:10px;padding:12px;margin:12px 0;display:flex;justify-content:space-between;align-items:center;">
      <div>
        <div style="font-weight:700;">${esc(cName)}</div>
        <div style="font-size:13px;color:var(--muted);">${esc(txLabel)} — ${amtStr}</div>
      </div>
    </div>

    <div style="background:var(--bg3);border-radius:10px;padding:10px 12px;margin-bottom:10px;">
      <div style="font-size:11px;color:var(--muted);margin-bottom:4px;font-weight:600;">SHARE LINK</div>
      <div style="display:flex;align-items:center;gap:8px;">
        <div style="font-size:12px;word-break:break-all;color:var(--accent);flex:1;">${esc(url)}</div>
        <button class="bs sm" onclick="navigator.clipboard.writeText(window._shareModalData.url);toast('Link copied!','success');" style="white-space:nowrap;">🔗 Copy</button>
      </div>
    </div>

    <div style="margin-bottom:14px;">
      <div style="font-size:11px;color:var(--muted);margin-bottom:4px;font-weight:600;">MESSAGE <span style="font-weight:400;">(edit before sharing)</span></div>
      <textarea id="share-message-edit" rows="4" style="width:100%;background:var(--bg3);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:13px;font-family:inherit;resize:vertical;">${esc(defaultMsg)}</textarea>
    </div>

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
      <button class="bs sm" style="flex:1;" onclick="navigator.clipboard.writeText(document.getElementById('share-message-edit').value);toast('Message copied!','success');">
        📋 Copy Message
      </button>
    </div>

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;">
      <button class="btn sm" style="background:#25D366;flex:1;" onclick="(function(){ var msg=encodeURIComponent(document.getElementById('share-message-edit').value); window.open('https://wa.me/?text='+msg,'_blank'); })();">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff" style="vertical-align:middle;margin-right:4px;"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>
        WhatsApp
      </button>
      <button class="btn sm" style="background:#0a66c2;flex:1;" onclick="(function(){ var msg=encodeURIComponent(document.getElementById('share-message-edit').value); var subj=encodeURIComponent('Record from '+window._shareModalData.senderName); window.location.href='mailto:${cEmail || ''}?subject='+subj+'&body='+msg; })();">
        ✉️ Email
      </button>
      ${'share' in navigator ? `<button class="btn sm" style="background:var(--accent);flex:1;" onclick="(function(){ var msg=document.getElementById('share-message-edit').value; navigator.share({title:'Record from '+window._shareModalData.senderName,text:msg,url:window._shareModalData.url}).catch(function(){}); })();">
        📤 Share via…
      </button>` : ''}
    </div>

    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button class="btn btn-primary btn-sm" onclick="closeModal()">Done</button>
    </div>
  `, { maxWidth: '460px' });
};

// ── Shared With Me page ───────────────────────────────────────────
window.openSharedWithMe = async function() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="page-header"><h2>Shared With Me</h2></div><p style="color:var(--muted);">Loading...</p>';
  const shares = await listReceivedShares(getCurrentUser().id);

  let html = `<div class="page-header"><h2>Shared With Me</h2>
    <button class="btn btn-secondary btn-sm" onclick="navTo('entries')">Back to Entries</button>
  </div>`;
  if (shares.length === 0) {
    html += `<div class="card" style="text-align:center;padding:40px;"><p style="color:var(--muted);">No shared records yet.</p></div>`;
  } else {
    html += `<div class="card"><div class="tbl-wrap"><table><thead><tr><th>From</th><th>Amount</th><th>Type</th><th>Date</th><th>Status</th><th>Action</th></tr></thead><tbody>`;
    shares.forEach(s => {
      const snap = s.entry_snapshot || {};
      const fromName = snap.from_name || 'Unknown';
      const amt = snap.amount || s.entry?.amount || 0;
      const amtCents = s.entry?.amount || toCents(amt);
      const cur = snap.currency || 'USD';
      const txLabel = TX_LABELS[snap.tx_type] || snap.tx_type || '—';
      const isConfirmed = s.status === 'confirmed';
      html += `<tr>
        <td style="font-weight:600;">${esc(fromName)}</td>
        <td style="font-weight:700;">${fmtMoney(amtCents, cur)}</td>
        <td>${esc(txLabel)}</td>
        <td style="color:var(--muted);">${fmtDate(snap.date)}</td>
        <td>${statusBadge(s.status)}</td>
        <td>
          ${!isConfirmed && s.status !== 'dismissed' ? `
            <button class="btn btn-primary btn-sm" onclick="doConfirmShare('${s.id}')">Confirm</button>
            <button class="btn btn-secondary btn-sm" onclick="doDismissShare('${s.id}')" style="margin-left:4px;">Dismiss</button>
          ` : isConfirmed ? '<span class="badge badge-green">Tracked</span>' : '<span class="badge badge-gray">Dismissed</span>'}
        </td>
      </tr>`;
    });
    html += `</tbody></table></div></div>`;
  }
  content.innerHTML = html;
};

window.doConfirmShare = async function(tokenId) {
  const { data, error } = await supabase.rpc('confirm_share_for_recipient', {
    p_token_id: tokenId,
    p_recipient_id: getCurrentUser().id
  });
  if (error) {
    console.error('[doConfirmShare]', error.message);
    toast('Failed to confirm: ' + error.message, 'error');
    return;
  }
  if (data?.entry_id) {
    toast('Record confirmed and added to your ledger!', 'success');
    _refreshPendingInPlace(tokenId, true);
  } else {
    toast('Failed to confirm — please try again.', 'error');
  }
};

// Inline confirm/reject from entries list — updates IN PLACE, no page jump
window.doPendingConfirm = async function(tokenId) {
  // Look up share details for the toast message
  const SNAP_FLIP = { 'they_owe_you':'you_owe_them','you_owe_them':'they_owe_you','owed_to_me':'i_owe','i_owe':'owed_to_me','they_paid_you':'you_paid_them','you_paid_them':'they_paid_you','invoice_sent':'invoice_received','invoice_received':'invoice_sent','bill_sent':'bill_received','bill_received':'bill_sent','invoice':'bill','bill':'invoice' };
  const share = (_pendingSharesAll || []).find(s => s.id === tokenId);
  const snap = share?.entry_snapshot || {};
  const fromName = snap.from_name || share?.sender_name || 'Contact';
  const flippedCat = SNAP_FLIP[snap.tx_type] || snap.tx_type || '';
  const txLabel = TX_LABELS[flippedCat] || snap.tx_type || 'Entry';
  const amtCents = snap.amount !== undefined ? snap.amount : 0;
  const cur = snap.currency || 'USD';

  // Disable the row's buttons immediately for feedback
  const row = document.querySelector(`[data-pending-id="${tokenId}"]`);
  if (row) {
    row.querySelectorAll('button').forEach(b => { b.disabled = true; });
    const confirmBtn = row.querySelector('.btn-primary');
    if (confirmBtn) confirmBtn.textContent = '…';
  }
  const { data, error } = await supabase.rpc('confirm_share_for_recipient', {
    p_token_id: tokenId,
    p_recipient_id: getCurrentUser().id
  });
  if (error) {
    console.error('[doPendingConfirm]', error.message);
    toast('Failed to confirm: ' + error.message, 'error');
    if (row) row.querySelectorAll('button').forEach(b => { b.disabled = false; });
    return;
  }
  if (data?.entry_id) {
    toast(`✓ Confirmed: ${txLabel} — ${fmtMoney(amtCents, cur)} from ${fromName}`, 'success');
    _refreshPendingInPlace(tokenId, true);
  } else {
    toast('Could not confirm — please try again.', 'error');
    if (row) row.querySelectorAll('button').forEach(b => { b.disabled = false; });
  }
};

window.doPendingReject = async function(tokenId) {
  const share = (_pendingSharesAll || []).find(s => s.id === tokenId);
  const fromName = share?.entry_snapshot?.from_name || share?.sender_name || 'Contact';
  const row = document.querySelector(`[data-pending-id="${tokenId}"]`);
  if (row) row.querySelectorAll('button').forEach(b => { b.disabled = true; });
  await dismissShare(tokenId);
  toast(`Record from ${fromName} rejected.`, 'success');
  _refreshPendingInPlace(tokenId, false);
};

window.doDismissShare = async function(tokenId) {
  await dismissShare(tokenId);
  toast('Record dismissed.', 'success');
  _refreshPendingInPlace(tokenId, false);
};

// ── In-place refresh after confirm/reject (no page navigation) ────
async function _refreshPendingInPlace(tokenId, wasConfirmed) {
  // 1. Remove from the pending cache immediately
  if (_pendingSharesAll) {
    _pendingSharesAll = _pendingSharesAll.filter(s => s.id !== tokenId);
  }
  // 2. Force re-fetch of the entries list (new confirmed entry is now in DB)
  invalidateEntryCache(getCurrentUser()?.id);
  _entriesAll = [];
  // 3. Re-render current page in-place — no navigation
  const el = document.getElementById('content');
  if (!el) return;
  if (window._currentPage === 'dash') {
    await renderDash(el);
  } else {
    // entries page (or any other page) — re-render entries
    await renderEntries(el, 1, true);
  }
}

// ── Enhanced Send Reminder with scheduling ────────────────────────
window.openSendReminderModal = async function(id) {
  const entry = await getEntry(id);
  if (!entry) return;
  const cName = entry.contact?.name || 'Contact';
  const cEmail = entry.contact?.email || '';
  const remaining = entry.amount - entry.settled_amount;
  const hasEmail = !!cEmail;

  openModal(`
    <h3 style="margin-bottom:16px;">Send Reminder</h3>
    <div style="background:var(--bg3);border-radius:10px;padding:12px;margin-bottom:14px;">
      <div style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;">Record</div>
      <div style="font-weight:700;margin-top:4px;">${esc(cName)} — ${fmtMoney(remaining, entry.currency)}</div>
    </div>
    <div class="form-group"><label>Message</label><textarea id="rem-msg" rows="3" placeholder="Add a message (optional)..."></textarea></div>
    <div class="form-group">
      <label>Email</label>
      <div style="display:inline-flex;border:1px solid var(--border);border-radius:8px;overflow:hidden;">
        <button type="button" id="rem-nwho-them" onclick="setReminderNwho('them')" style="padding:8px 18px;font-size:13px;font-weight:600;background:var(--accent);color:#fff;border:none;cursor:pointer;">Contact</button>
        <button type="button" id="rem-nwho-you" onclick="setReminderNwho('you')" style="padding:8px 18px;font-size:13px;background:var(--bg3);color:var(--text);border:none;border-left:1px solid var(--border);cursor:pointer;">You</button>
        <button type="button" id="rem-nwho-both" onclick="setReminderNwho('both')" style="padding:8px 18px;font-size:13px;background:var(--bg3);color:var(--text);border:none;border-left:1px solid var(--border);cursor:pointer;">Both</button>
      </div>
    </div>
    <div id="rem-no-email-wrap" data-has-email="${hasEmail ? '1' : '0'}" style="${hasEmail ? 'display:none;' : ''}margin-bottom:12px;">
      <div style="background:rgba(213,186,120,.1);border:1px solid rgba(213,186,120,.3);border-radius:8px;padding:10px 14px;">
        <div style="font-size:13px;color:var(--gold, #D5BA78);margin-bottom:8px;">⚠️ <strong>${esc(cName)}</strong> has no email on file.</div>
        <input type="email" id="rem-contact-email" placeholder="Enter email to send reminder"
          style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--bg2);color:var(--text);" />
        <div style="font-size:11px;color:var(--muted);margin-top:4px;">Email will be saved to this contact.</div>
      </div>
    </div>
    <div class="form-group">
      <label>When</label>
      <div style="display:flex;gap:0;border:1px solid var(--border);border-radius:10px;overflow:hidden;">
        <button type="button" class="when-btn" data-when="now" onclick="setReminderWhen('now')" style="flex:1;padding:8px;font-size:13px;font-weight:600;background:var(--accent);color:#fff;border:none;cursor:pointer;">Now</button>
        <button type="button" class="when-btn" data-when="scheduled" onclick="setReminderWhen('scheduled')" style="flex:1;padding:8px;font-size:13px;font-weight:500;background:var(--bg);color:var(--text);border:none;border-left:1px solid var(--border);cursor:pointer;">Scheduled</button>
      </div>
    </div>
    <div id="schedule-fields" style="display:none;">
      <div class="form-group"><label>Send on</label><input type="date" id="rem-date" value="${new Date(Date.now()+86400000).toISOString().slice(0,10)}" min="${new Date().toISOString().slice(0,10)}"></div>
      <div class="form-group"><label>Repeat</label><select id="rem-repeat">
        <option value="0">No repeat</option>
        <option value="1">Every day</option>
        <option value="3">Every 3 days</option>
        <option value="7" selected>Every 7 days</option>
        <option value="14">Every 14 days</option>
        <option value="30">Every 30 days</option>
      </select></div>
      <div class="form-group"><label>Stop after</label><select id="rem-max">
        <option value="1">1 reminder</option>
        <option value="3" selected>3 reminders</option>
        <option value="5">5 reminders</option>
        <option value="10">10 reminders</option>
        <option value="0">Until settled</option>
      </select></div>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
      <button class="btn btn-secondary btn-sm" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary btn-sm" onclick="doSendReminder('${id}')">Send</button>
    </div>
    <div style="border-top:1px solid var(--border);margin-top:16px;padding-top:14px;">
      <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px;">Or share directly</div>
      <div id="rem-share-wrap" style="text-align:center;">
        <div style="font-size:13px;color:var(--muted);">Generating link…</div>
      </div>
    </div>
  `, { maxWidth: '440px' });

  window._reminderWhen = 'now';
  window._reminderNwho = 'them';

  // Async: generate share link
  (async () => {
    try {
      const { data: existing } = await supabase
        .from('share_tokens').select('token').eq('entry_id', id).maybeSingle();
      let token = existing?.token;
      if (!token) {
        const newToken = await createShareToken(getCurrentUser().id, id, { recipientEmail: cEmail });
        token = newToken?.token;
      }
      const wrap = document.getElementById('rem-share-wrap');
      if (!wrap || !token) {
        if (wrap) wrap.innerHTML = `<div style="font-size:12px;color:var(--muted);">Share link unavailable — use Send above.</div>`;
        return;
      }
      const shareUrl = getShareUrl(token);
      window._reminderShareUrl = shareUrl;
      const cat = entry.category || entry.tx_type || '';
      const recipientLabel = ['owed_to_me','bill_sent','invoice_sent','they_owe_you','invoice','bill'].includes(cat)
        ? 'You Owe'
        : ['i_owe','bill_received','invoice_received','you_owe_them'].includes(cat)
          ? 'You Are Owed' : 'Amount';
      const shareMsg = `Hi ${cName},\n\nThis is to inform you that:\n${recipientLabel}: ${fmtMoney(remaining, entry.currency)}\n\nView full details here:\n${shareUrl}\n\nYour kind attention is requested.`;
      window._reminderShareMsg = shareMsg;
      wrap.innerHTML = `
        <div style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:8px 12px;margin-bottom:10px;display:flex;align-items:center;gap:8px;">
          <span style="font-size:12px;color:var(--accent);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;">${esc(shareUrl)}</span>
          <button class="btn btn-primary btn-sm" style="flex-shrink:0;font-size:12px;" onclick="navigator.clipboard.writeText(window._reminderShareUrl);toast('Link copied!','success');">Copy</button>
        </div>
        <textarea id="rem-share-msg" rows="5" style="width:100%;box-sizing:border-box;font-size:12px;border:1px solid var(--border);border-radius:8px;padding:8px;resize:vertical;background:var(--bg2);color:var(--text);margin-bottom:8px;">${esc(shareMsg)}</textarea>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-secondary btn-sm" style="flex:1;" onclick="navigator.clipboard.writeText(document.getElementById('rem-share-msg').value);toast('Message copied!','success');">📋 Copy Message</button>
          ${'share' in navigator ? `<button class="btn btn-secondary btn-sm" style="flex:1;" onclick="navigator.share({title:'Reminder',text:document.getElementById('rem-share-msg').value,url:window._reminderShareUrl}).catch(()=>{});">📤 Share via…</button>` : ''}
        </div>`;
    } catch(_) {
      const wrap = document.getElementById('rem-share-wrap');
      if (wrap) wrap.innerHTML = `<div style="font-size:12px;color:var(--muted);">Share link unavailable — use Send above.</div>`;
    }
  })();
};

window.setReminderNwho = function(val) {
  window._reminderNwho = val;
  ['them','you','both'].forEach(k => {
    const btn = document.getElementById('rem-nwho-' + k);
    if (!btn) return;
    const active = k === val;
    btn.style.background = active ? 'var(--accent)' : 'var(--bg3)';
    btn.style.color = active ? '#fff' : 'var(--text)';
    btn.style.fontWeight = active ? '600' : '400';
  });
  // Show no-email warning only when contact is targeted and the wrap was not initially hidden (has-email case)
  const wrap = document.getElementById('rem-no-email-wrap');
  if (wrap && wrap.dataset.hasEmail !== '1') {
    const targets = val === 'them' || val === 'both';
    wrap.style.display = targets ? '' : 'none';
  }
};

window.setReminderWhen = function(val) {
  window._reminderWhen = val;
  document.querySelectorAll('.when-btn').forEach(b => {
    const active = b.dataset.when === val;
    b.style.background = active ? 'var(--accent)' : 'var(--bg)';
    b.style.color = active ? '#fff' : 'var(--text)';
    b.style.fontWeight = active ? '600' : '500';
  });
  document.getElementById('schedule-fields').style.display = val === 'scheduled' ? '' : 'none';
};

window.doSendReminder = async function(entryId) {
  const message = document.getElementById('rem-msg').value.trim();
  if (!message) return toast('Message required.', 'error');

  const notifyWho = window._reminderNwho || 'them';
  const notifyContact = notifyWho === 'them' || notifyWho === 'both';
  const notifySelf    = notifyWho === 'you'  || notifyWho === 'both';

  if (window._reminderWhen === 'now') {
    // Send immediately
    const entry = await getEntry(entryId);
    const cName = entry?.contact?.name || 'Someone';
    let cEmail = entry?.contact?.email || '';
    const linkedUserId = entry?.contact?.linked_user_id;

    // If contact has no email, check for inline-entered email
    if (!cEmail && notifyContact) {
      const inlineEmail = document.getElementById('rem-contact-email')?.value?.trim();
      if (inlineEmail) {
        cEmail = inlineEmail;
        // Save email to contact
        if (entry?.contact_id) {
          await supabase.from('contacts').update({ email: inlineEmail }).eq('id', entry.contact_id);
        }
      }
    }

    if (notifyContact) {
      if (linkedUserId) {
        await supabase.from('notifications').insert({
          user_id: linkedUserId, type: 'reminder',
          message: `Reminder from ${getCurrentProfile()?.display_name || 'Someone'}: ${message}`,
          entry_id: entryId, contact_name: getCurrentProfile()?.display_name || '',
          amount: entry.amount, currency: entry.currency,
          read: false
        });
      }
      if (cEmail) {
        try {
          const fromName = getCurrentProfile()?.display_name || getCurrentProfile()?.company_name || 'Money IntX';
          const result = await sendNotificationEmail(getCurrentUser().id, {
            to: cEmail, fromName, txType: entry.category || entry.tx_type,
            amount: entry.amount,
            currency: entry.currency, message, entryId, isReminder: true,
            logoUrl: getCurrentProfile()?.logo_url,
            fromEmail: getCurrentProfile()?.company_email || getCurrentUser()?.email,
            siteUrl: 'https://moneyinteractions.com'
          });
          if (!result?.ok) toast('Reminder sent (email failed: ' + (result?.error || 'check Settings → Email Diagnostics') + ')', 'info');
        } catch(e) { console.warn('Email reminder failed:', e); toast('Reminder email failed: ' + e.message, 'error'); }
      }
    }

    // Self-email copy when user wants their own notification
    if (notifySelf && getCurrentUser()?.email) {
      const fromNameSelf = getCurrentProfile()?.display_name || getCurrentProfile()?.company_name || 'Money IntX';
      try {
        await sendNotificationEmail(getCurrentUser().id, {
          to: getCurrentUser().email, fromName: fromNameSelf, txType: entry.category || entry.tx_type,
          amount: entry.amount, currency: entry.currency, message, entryId, isReminder: true,
          logoUrl: getCurrentProfile()?.logo_url, siteUrl: 'https://moneyinteractions.com',
          isSelf: true, contactName: cName
        });
      } catch(e) { console.warn('[self-email reminder]', e); }
    }

    // Log + self-notify in one insert (no double-insert)
    const selfMsg = notifyContact && notifySelf
      ? `Reminder sent to ${cName} (& self): ${message}`
      : notifyContact
        ? `Reminder sent to ${cName}: ${message}`
        : `Reminder noted (self): ${message}`;
    await supabase.from('notifications').insert({
      user_id: getCurrentUser().id, type: 'reminder',
      message: selfMsg,
      entry_id: entryId, contact_name: cName,
      amount: entry?.amount, currency: entry?.currency,
      read: false
    });

    // Direct update — bypass updateEntry to avoid amount conversion
    await supabase.from('entries').update({
      reminder_count: (entry?.reminder_count || 0) + 1,
      last_reminder_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq('id', entryId);
    closeModal();
    if (notifyContact && !cEmail) {
      toast('Reminder logged — no email sent (contact has no email address).', 'info');
    } else {
      const emailNote = notifyContact && cEmail ? ' Email queued.' : '';
      toast('Reminder sent.' + emailNote, 'success');
    }
  } else {
    // Schedule
    const schedDate = document.getElementById('rem-date').value;
    const repeatDays = parseInt(document.getElementById('rem-repeat').value) || 0;
    const maxSends = parseInt(document.getElementById('rem-max').value) || 999;
    if (!schedDate) return toast('Pick a date.', 'error');
    await createScheduledReminder(getCurrentUser().id, entryId, {
      nextSendAt: new Date(schedDate + 'T09:00:00').toISOString(),
      repeatDays, maxSends, notifyWho, message
    });
    closeModal();
    toast(`Reminder scheduled for ${new Date(schedDate).toLocaleDateString()}${repeatDays > 0 ? ', repeating every ' + repeatDays + ' days' : ''}`, 'success');
  }
  _navAfterAction();
};

// ── Tab definitions for new entry modal ───────────────────────────────────────
const NE_TABS = [
  {
    id: 'owe-me', emoji: '+', label: 'They Owe Me', color: 'var(--green)',
    borderActive: 'rgba(95,211,154,.3)', bgActive: 'rgba(95,211,154,.1)',
    actions: [
      { category: 'owed_to_me',    label: 'They owe me',      icon: '💰', extra: [] },
      { category: 'bill_sent',     label: 'Send a bill',      icon: '📄', extra: ['due_date','ref_number'], email: true },
      { category: 'invoice_sent',  label: 'Send an invoice',  icon: '🧾', extra: ['inv_number','due_date'],  email: true }
    ]
  },
  {
    id: 'i-owe', emoji: '+', label: 'I Owe Them', color: 'var(--owe-color, #8D8CFF)',
    borderActive: 'rgba(141,140,255,.3)', bgActive: 'rgba(141,140,255,.1)',
    actions: [
      { category: 'i_owe',             label: 'I owe them',         icon: '💸', extra: [] }
    ]
  },
  {
    id: 'advance', emoji: '+', label: 'Advances', color: 'var(--gold, #D5BA78)',
    borderActive: 'rgba(213,186,120,.3)', bgActive: 'rgba(213,186,120,.1)',
    actions: [
      { category: 'advance_paid',     label: 'Advance Out',  icon: '⬆️', extra: ['advance_note','fulfillment'] },
      { category: 'advance_received', label: 'Advance In',   icon: '⬇️', extra: ['advance_note','fulfillment'] }
    ]
  }
];

window.openNewEntryModal = async function(defaultDirection, preselectedContactId) {
  const [contacts, templates] = await Promise.all([
    listContacts(getCurrentUser().id),
    listTemplates(getCurrentUser().id)
  ]);
  window._neContacts = contacts;
  window._neSelectedContactId = preselectedContactId || (contacts.length === 1 ? contacts[0].id : '');

  // Determine initial tab from legacy defaultDirection arg
  const isInvoice = defaultDirection === 'invoice';
  const isBill = defaultDirection === 'bill';
  const initTabId = (defaultDirection === 'you_owe_them' || defaultDirection === 'i-owe') ? 'i-owe'
                  : defaultDirection === 'advance'      ? 'advance'
                  : 'owe-me';
  window._neTab      = initTabId;
  // If invoice/bill shortcut, pre-select that category; otherwise first action in tab
  window._neCategory = isInvoice ? 'invoice_sent'
                     : isBill    ? 'bill_sent'
                     : NE_TABS.find(t => t.id === initTabId).actions[0].category;

  const selectedContact = window._neSelectedContactId ? contacts.find(c => c.id === window._neSelectedContactId) : null;
  const contactDisplayVal = selectedContact ? selectedContact.name : '';

  // Build tab bar HTML
  const tabBarHtml = NE_TABS.map(tab => `
    <button id="ne-tab-${tab.id}" onclick="neSelectTab('${tab.id}')"
      style="flex:1;padding:9px 4px;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-align:center;
             border:2px solid ${tab.id === initTabId ? tab.borderActive : 'var(--border)'};
             background:${tab.id === initTabId ? tab.bgActive : 'var(--bg3)'};
             color:${tab.id === initTabId ? tab.color : 'var(--muted)'};">
      ${tab.emoji} ${tab.label}
    </button>`).join('');

  const initTab = NE_TABS.find(t => t.id === initTabId);
  const actionRowHtml = _neActionRow(initTab, window._neCategory);

  openModal(`
    <div class="modal-title">New Entry</div>
    <div style="display:flex;gap:6px;margin-bottom:14px;">${tabBarHtml}</div>
    <div id="ne-action-row" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;">${actionRowHtml}</div>
    <div class="form-group" ${templates.length === 0 ? 'style="display:none;"' : ''}>
      <label style="color:var(--muted);">Or use a template</label>
      <select id="ne-template" onchange="if(this.value){closeModal();useTemplateForEntry(this.value);}">
        <option value="">— Select template —</option>
        ${templates.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}
      </select>
    </div>
    <div class="form-group" style="position:relative;">
      <label style="display:flex;justify-content:space-between;align-items:center;">
        <span>Contact *</span>
        <button type="button" onclick="openNewContactFromEntry()" style="font-size:11px;color:var(--accent);background:none;border:none;cursor:pointer;padding:0;font-weight:700;">+ Add New</button>
      </label>
      <div style="position:relative;">
        <input type="text" id="ne-contact-search" placeholder="Search contacts…" autocomplete="off"
          value="${esc(contactDisplayVal)}"
          oninput="filterNeContacts(this.value)"
          onfocus="this.select();showNeContactList();filterNeContacts(this.value)"
          style="width:100%;padding:9px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg3);color:var(--text);font-size:14px;outline:none;box-sizing:border-box;">
        <input type="hidden" id="ne-contact" value="${esc(window._neSelectedContactId)}">
        <div id="ne-contact-list" style="display:none;position:absolute;top:100%;left:0;right:0;background:var(--bg2);border:1px solid var(--border);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.4);z-index:999;max-height:200px;overflow-y:auto;margin-top:2px;">
          ${contacts.map(c => {
            const col = contactColor(c.id);
            return `<div onclick="selectNeContact('${c.id}','${esc(c.name)}')" style="display:flex;align-items:center;gap:10px;padding:10px 12px;cursor:pointer;border-bottom:1px solid var(--border);" onmouseenter="this.style.background='var(--bg3)'" onmouseleave="this.style.background=''">
              <span style="width:28px;height:28px;border-radius:50%;background:${col};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#fff;flex-shrink:0;">${esc(c.name.charAt(0).toUpperCase())}</span>
              <div><div style="font-weight:600;font-size:13px;">${esc(c.name)}</div>${c.email ? `<div style="font-size:11px;color:var(--muted);">${esc(c.email)}</div>` : ''}</div>
            </div>`;
          }).join('')}
          ${contacts.length === 0 ? '<div style="padding:12px;color:var(--muted);font-size:13px;text-align:center;">No contacts — click "+ Add New" above</div>' : ''}
        </div>
      </div>
    </div>
    <div id="ne-items-section" style="display:none;margin-bottom:14px;">
      <label style="font-size:13px;font-weight:600;color:var(--text-2);margin-bottom:6px;display:block;">Line Items</label>
      <div style="display:flex;gap:6px;margin-bottom:4px;">
        <span style="flex:2;font-size:11px;font-weight:600;color:var(--muted);padding-left:4px;">Item</span>
        <span style="width:60px;font-size:11px;font-weight:600;color:var(--muted);text-align:center;">Qty</span>
        <span style="flex:1;font-size:11px;font-weight:600;color:var(--muted);text-align:center;">Price</span>
        <span style="width:28px;"></span>
      </div>
      <div id="ne-items-rows"></div>
      <button type="button" class="bs sm" onclick="addNeItemRow()" style="margin-top:4px;">+ Add Row</button>
    </div>
    <div class="form-group">
      <label>Amount * <span id="ne-amount-hint" style="display:none;font-size:10px;font-weight:400;color:var(--accent);">(auto from items)</span></label>
      <div class="inline-row">
        <input type="number" id="ne-amount" min="0" step="0.01" placeholder="0.00" style="flex:1;min-width:0;">
        <select id="ne-currency" style="flex:0 0 68px;font-size:12px;">
          ${['USD','EUR','GBP','NGN','CAD','AUD','JPY','KES','ZAR','GHS','INR','CNY','BRL','MXN','AED','SAR','QAR','KWD','EGP','MAD','TZS','UGX','ETB','XOF'].map(c => `<option value="${c}" ${(getCurrentProfile()?.default_currency||'USD')===c?'selected':''}>${c}</option>`).join('')}
        </select>
      </div>
    </div>
    <div id="ne-extra-fields"></div>
    <div class="inline-row" style="gap:8px;margin-bottom:16px;">
      <div class="fg" style="flex:0 0 auto;"><label>Issue Date</label><input type="date" id="ne-date" value="${new Date().toISOString().slice(0,10)}"></div>
      <div class="fg" style="flex:0 0 auto;"><label>Due Date <span style="font-weight:400;color:var(--muted);">(optional)</span></label><input type="date" id="ne-due-date"></div>
    </div>
    <!-- EMAIL section with ON/OFF toggle -->
    <div style="margin-bottom:12px;border:1px solid var(--border);border-radius:10px;overflow:hidden;">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--bg3);cursor:pointer;" onclick="toggleNeNotify()">
        <div style="font-size:13px;font-weight:600;">✉️ Email</div>
        <div style="display:flex;align-items:center;gap:7px;">
          <span id="ne-notify-label" style="font-size:12px;color:var(--muted);">Off</span>
          <div style="width:38px;height:21px;border-radius:11px;background:var(--border);position:relative;transition:background .2s;" id="ne-notify-track">
            <div id="ne-notify-knob" style="position:absolute;top:3px;left:3px;width:15px;height:15px;border-radius:50%;background:#fff;transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,.3);"></div>
          </div>
        </div>
      </div>
      <div id="ne-notify-body" style="display:none;padding:12px 14px;border-top:1px solid var(--border);">
        <div style="margin-bottom:10px;">
          <div style="font-size:12px;color:var(--muted);margin-bottom:5px;">Message <span style="font-weight:400;">(sent to recipient)</span></div>
          <textarea id="ne-message" rows="2" placeholder="Add a note for the recipient..." style="width:100%;padding:9px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg3);color:var(--text);font-size:13px;resize:vertical;box-sizing:border-box;"></textarea>
        </div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:6px;">Email who</div>
        <div style="display:flex;border-radius:8px;overflow:hidden;border:1px solid var(--border);margin-bottom:10px;">
          <button id="ne-nw-contact" onclick="setNeNotifyWho('contact')" style="flex:1;padding:7px 4px;font-size:12px;font-weight:600;border:none;background:var(--accent);color:#fff;cursor:pointer;">Contact</button>
          <button id="ne-nw-you" onclick="setNeNotifyWho('you')" style="flex:1;padding:7px 4px;font-size:12px;font-weight:600;border:none;border-left:1px solid var(--border);border-right:1px solid var(--border);background:var(--bg3);color:var(--text);cursor:pointer;">You</button>
          <button id="ne-nw-both" onclick="setNeNotifyWho('both')" style="flex:1;padding:7px 4px;font-size:12px;font-weight:600;border:none;background:var(--bg3);color:var(--text);cursor:pointer;">Both</button>
        </div>
        <div id="ne-notify-email-row" style="background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.3);border-radius:8px;padding:10px 12px;display:none;">
          <div style="font-size:12px;color:#b45309;margin-bottom:6px;">⚠️ Contact has no email — enter one to send:</div>
          <input type="email" id="ne-notify-email-override" placeholder="Enter email" style="width:100%;padding:7px 10px;border-radius:6px;border:1px solid var(--border);background:var(--bg2);color:var(--text);font-size:13px;box-sizing:border-box;">
        </div>
      </div>
    </div>
    <input type="hidden" id="ne-notify-who" value="contact">
    <input type="hidden" id="ne-notify" value="0">

    <!-- NOTE TO SELF — single-line auto-expand, private -->
    <div style="margin-bottom:4px;">
      <label style="font-size:12px;color:var(--muted);">Note to self <span style="font-weight:400;">(optional — private, not shared)</span></label>
    </div>
    <textarea id="ne-note" rows="1" placeholder="Private reminder..." oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px'" style="width:100%;padding:6px 10px;border-radius:8px;border:1px solid var(--border);background:var(--bg3);color:var(--text);font-size:13px;resize:none;overflow:hidden;box-sizing:border-box;line-height:1.5;margin-bottom:12px;"></textarea>

    <input type="hidden" id="ne-category" value="${window._neCategory}">
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
      <button class="bs sm" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary sm" id="ne-save-btn" onclick="saveNewEntry()">Save Entry</button>
    </div>
  `, { maxWidth: '500px' });

  window._entryDirection = initTabId;

  // Render extra fields + toggle items visibility for the initial category
  const _initAction = initTab.actions.find(a => a.category === window._neCategory) || initTab.actions[0];
  _neRenderExtraFields(_initAction); // also calls _neToggleItems()

  setTimeout(() => {
    document.addEventListener('click', function _cls(e) {
      const list = document.getElementById('ne-contact-list');
      const inp  = document.getElementById('ne-contact-search');
      if (list && !list.contains(e.target) && e.target !== inp) list.style.display = 'none';
      if (!document.getElementById('ne-contact-search')) document.removeEventListener('click', _cls);
    });
  }, 100);
};

window.showNeContactList = function() {
  const list = document.getElementById('ne-contact-list');
  if (list) list.style.display = 'block';
};

window.filterNeContacts = function(q) {
  const contacts = window._neContacts || [];
  const list = document.getElementById('ne-contact-list');
  if (!list) return;
  list.style.display = 'block';
  const lower = q.toLowerCase();
  const filtered = q ? contacts.filter(c => (c.name + ' ' + (c.email||'')).toLowerCase().includes(lower)) : contacts;
  list.innerHTML = filtered.map(c => {
    const col = contactColor(c.id);
    return `<div onclick="selectNeContact('${c.id}','${esc(c.name)}')" style="display:flex;align-items:center;gap:10px;padding:10px 12px;cursor:pointer;border-bottom:1px solid var(--border);" onmouseenter="this.style.background='var(--bg3)'" onmouseleave="this.style.background=''">
      <span style="width:28px;height:28px;border-radius:50%;background:${col};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#fff;flex-shrink:0;">${esc(c.name.charAt(0).toUpperCase())}</span>
      <div><div style="font-weight:600;font-size:13px;">${esc(c.name)}</div>${c.email ? `<div style="font-size:11px;color:var(--muted);">${esc(c.email)}</div>` : ''}</div>
    </div>`;
  }).join('') || '<div style="padding:12px;color:var(--muted);font-size:13px;text-align:center;">No match — click "+ Add New" above</div>';
};

window.selectNeContact = function(id, name) {
  window._neSelectedContactId = id;
  const inp = document.getElementById('ne-contact-search');
  const hidden = document.getElementById('ne-contact');
  if (inp) inp.value = name;
  if (hidden) hidden.value = id;
  const list = document.getElementById('ne-contact-list');
  if (list) list.style.display = 'none';
};

window.openNewContactFromEntry = function() {
  openModal(`
    <h3 style="margin-bottom:16px;">Add New Contact</h3>
    <div class="form-group"><label>Name *</label><input type="text" id="nc-name" placeholder="Contact name"></div>
    <div class="form-group"><label>Email</label><input type="email" id="nc-email" placeholder="email@example.com"></div>
    <div class="form-group"><label>Phone</label><input type="tel" id="nc-phone" placeholder="+1 555 000 0000"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
      <button class="btn btn-secondary btn-sm" onclick="closeModal();openNewEntryModal(window._entryDirection)">Cancel</button>
      <button class="btn btn-primary btn-sm" onclick="saveNewContact(function(c){if(c){window._neContacts=(window._neContacts||[]).concat(c);openNewEntryModal(window._entryDirection,c.id);}else{openNewEntryModal(window._entryDirection);}})">Save &amp; Select</button>
    </div>
  `);
};

// ── Notify ON/OFF toggle ───────────────────────────────────────────
window.toggleNeNotify = function() {
  const inp = document.getElementById('ne-notify');
  const body = document.getElementById('ne-notify-body');
  const track = document.getElementById('ne-notify-track');
  const knob = document.getElementById('ne-notify-knob');
  const label = document.getElementById('ne-notify-label');
  if (!inp) return;
  const isOn = inp.value === '1';
  const nowOn = !isOn;
  inp.value = nowOn ? '1' : '0';
  if (body) body.style.display = nowOn ? '' : 'none';
  if (track) track.style.background = nowOn ? 'var(--accent)' : 'var(--border)';
  if (knob) knob.style.left = nowOn ? '20px' : '3px';
  if (label) { label.textContent = nowOn ? 'On' : 'Off'; label.style.color = nowOn ? 'var(--accent)' : 'var(--muted)'; }
};

// ── Notify-who tab switcher ────────────────────────────────────────
window.setNeNotifyWho = function(who) {
  window._neNotifyWho = who;
  document.getElementById('ne-notify-who').value = who;
  ['contact','you','both'].forEach(w => {
    const btn = document.getElementById('ne-nw-' + w);
    if (!btn) return;
    const active = w === who;
    btn.style.background = active ? 'var(--accent)' : 'var(--bg3)';
    btn.style.color = active ? '#fff' : 'var(--text)';
  });
  // Show email warning when contact will receive notification
  const needsEmail = (who === 'contact' || who === 'both');
  const emailRow = document.getElementById('ne-notify-email-row');
  if (emailRow) {
    // Only show if selected contact has no email
    const hasEmail = !!(window._neSelectedContactEmail);
    emailRow.style.display = (needsEmail && !hasEmail) ? '' : 'none';
  }
};

// Update contact email state when a contact is selected
const _origSelectNeContact = window.selectNeContact;
window.selectNeContact = function(id, name) {
  _origSelectNeContact(id, name);
  const contact = (window._neContacts || []).find(c => c.id === id);
  window._neSelectedContactEmail = contact?.email || '';
  // Re-evaluate email warning
  const who = window._neNotifyWho || 'contact';
  setNeNotifyWho(who);
};

// ── Item Lister for Invoices/Bills ─────────────────────────────────────────────

window.addNeItemRow = function() {
  const container = document.getElementById('ne-items-rows');
  if (!container) return;
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:6px;margin-bottom:4px;align-items:center;';
  row.innerHTML = `
    <input type="text" placeholder="Description" style="flex:2;padding:7px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg3);color:var(--text);font-size:13px;">
    <input type="number" placeholder="1" value="1" min="1" step="1" class="ne-item-qty" style="width:60px;padding:7px 6px;border:1px solid var(--border);border-radius:8px;background:var(--bg3);color:var(--text);font-size:13px;text-align:center;" oninput="recalcNeItems()">
    <input type="number" placeholder="0.00" step="0.01" min="0" class="ne-item-price" style="flex:1;padding:7px 8px;border:1px solid var(--border);border-radius:8px;background:var(--bg3);color:var(--text);font-size:13px;" oninput="recalcNeItems()">
    <button type="button" onclick="this.parentElement.remove();recalcNeItems();" style="width:28px;background:none;border:none;color:var(--red);cursor:pointer;font-size:16px;padding:0;">✕</button>
  `;
  container.appendChild(row);
};

window.recalcNeItems = function() {
  const rows = document.querySelectorAll('#ne-items-rows > div');
  let total = 0;
  rows.forEach(row => {
    const qty = parseFloat(row.querySelector('.ne-item-qty')?.value) || 0;
    const price = parseFloat(row.querySelector('.ne-item-price')?.value) || 0;
    total += qty * price;
  });
  const amtField = document.getElementById('ne-amount');
  if (amtField && total > 0) {
    amtField.value = total.toFixed(2);
  }
};

// ── New 3-tab entry modal helpers ─────────────────────────────────────────────

// Build action row HTML for a given tab + selected category
function _neActionRow(tab, selectedCategory) {
  return tab.actions.map(action => {
    const sel = action.category === selectedCategory;
    return `<button onclick="neSelectCategory('${action.category}')"
      style="flex:1;min-width:110px;padding:8px 6px;border-radius:9px;font-size:12px;font-weight:600;cursor:pointer;text-align:center;line-height:1.3;
             border:2px solid ${sel ? tab.borderActive : 'var(--border)'};
             background:${sel ? tab.bgActive : 'var(--bg3)'};
             color:${sel ? tab.color : 'var(--muted)'};">
      ${action.icon}<br>${action.label}
    </button>`;
  }).join('');
}

// Switch tab (They Owe Me / I Owe Them / Advances)
window.neSelectTab = function(tabId) {
  const tab = NE_TABS.find(t => t.id === tabId);
  if (!tab) return;
  window._neTab = tabId;
  window._entryDirection = tabId;

  // Update tab button styles
  NE_TABS.forEach(t => {
    const btn = document.getElementById('ne-tab-' + t.id);
    if (!btn) return;
    const active = t.id === tabId;
    btn.style.borderColor  = active ? t.borderActive : 'var(--border)';
    btn.style.background   = active ? t.bgActive     : 'var(--bg3)';
    btn.style.color        = active ? t.color        : 'var(--muted)';
  });

  // Reset to first action of this tab
  const firstAction = tab.actions[0];
  window._neCategory = firstAction.category;
  document.getElementById('ne-action-row').innerHTML = _neActionRow(tab, firstAction.category);
  document.getElementById('ne-category').value = firstAction.category;
  _neRenderExtraFields(firstAction);
  _neToggleItems(); // ensure items section visibility

  // Update save button label
  const saveBtn = document.getElementById('ne-save-btn');
  if (saveBtn) saveBtn.textContent = firstAction.email ? '📤 Send & Save' : 'Save Entry';
};

// Select an action within the current tab
window.neSelectCategory = function(category) {
  const tab = NE_TABS.find(t => t.id === window._neTab);
  if (!tab) return;
  const action = tab.actions.find(a => a.category === category);
  if (!action) return;
  window._neCategory = category;
  document.getElementById('ne-category').value = category;
  document.getElementById('ne-action-row').innerHTML = _neActionRow(tab, category);
  _neRenderExtraFields(action);
  _neToggleItems(); // ensure items section visibility
  const saveBtn = document.getElementById('ne-save-btn');
  if (saveBtn) saveBtn.textContent = action.email ? '📤 Send & Save' : 'Save Entry';
};

// Toggle Line Items section visibility based on current category
function _neToggleItems() {
  const itemsSection = document.getElementById('ne-items-section');
  const amtHint = document.getElementById('ne-amount-hint');
  if (!itemsSection) return;
  const showItems = ['invoice_sent','bill_sent'].includes(window._neCategory);
  itemsSection.style.display = showItems ? '' : 'none';
  if (amtHint) amtHint.style.display = showItems ? '' : 'none';
  if (showItems && document.querySelectorAll('#ne-items-rows > div').length === 0) {
    addNeItemRow(); // Add first empty row
  }
}

// Render extra fields based on action extras list
function _neRenderExtraFields(action) {
  const el = document.getElementById('ne-extra-fields');
  if (!el) return;
  let html = '';
  if ((action.extra || []).includes('inv_number')) {
    html += `<div class="form-group"><label>Invoice Number</label>
      <input type="text" id="ne-inv-number" placeholder="INV-001" style="width:100%;"></div>`;
  }
  if ((action.extra || []).includes('ref_number')) {
    html += `<div class="form-group"><label>Bill / Ref Number <span style="font-weight:400;color:var(--muted);">(optional)</span></label>
      <input type="text" id="ne-ref-number" placeholder="REF-001" style="width:100%;"></div>`;
  }
  if ((action.extra || []).includes('advance_note')) {
    html += `<div class="form-group"><label>Advance Note <span style="font-weight:400;color:var(--muted);">(optional, visible to contact)</span></label>
      <input type="text" id="ne-advance-note" placeholder="Deposits, loans, for item, for invoice #, etc." style="width:100%;"></div>`;
  }
  if ((action.extra || []).includes('fulfillment')) {
    html += `
    <div style="border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:4px;">
      <div style="background:var(--bg3);padding:10px 14px;display:flex;align-items:center;gap:8px;cursor:pointer;"
           onclick="(function(){var b=document.getElementById('ne-fulfill-body');var i=document.getElementById('ne-fulfill-chevron');if(b.style.display==='none'){b.style.display='block';i.textContent='▾';}else{b.style.display='none';i.textContent='▸';}})()">
        <span style="font-size:14px;">📅</span>
        <span style="font-size:13px;font-weight:600;color:var(--text);flex:1;">Fulfillment Schedule</span>
        <span id="ne-fulfill-chevron" style="color:var(--muted);font-size:12px;">▸</span>
      </div>
      <div id="ne-fulfill-body" style="display:none;padding:14px;border-top:1px solid var(--border);">
        <div class="form-group">
          <label style="font-size:12px;font-weight:600;">Repayment / End Date <span style="font-weight:400;color:var(--muted);">(when this advance should be paid back)</span></label>
          <input type="date" id="ne-adv-end-date" style="width:100%;">
        </div>
        <label style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;padding:8px 0;border-top:1px solid var(--border);margin-top:4px;">
          <span style="font-size:13px;font-weight:500;color:var(--text);">Set Reminder?</span>
          <label style="position:relative;display:inline-block;width:40px;height:22px;flex-shrink:0;">
            <input type="checkbox" id="ne-adv-remind" style="opacity:0;width:0;height:0;"
              onchange="(function(cb){var f=document.getElementById('ne-adv-remind-fields');f.style.display=cb.checked?'block':'none';document.getElementById('ne-adv-remind-track').style.background=cb.checked?'var(--accent)':'var(--border)';})(this)">
            <span id="ne-adv-remind-track" style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background:var(--border);border-radius:22px;transition:.2s;"></span>
          </label>
        </label>
        <div id="ne-adv-remind-fields" style="display:none;margin-top:10px;">
          <div class="form-group">
            <label style="font-size:12px;font-weight:600;">Remind</label>
            <select id="ne-adv-notify-who" style="width:100%;">
              <option value="both">Both me &amp; contact</option>
              <option value="contact">Contact only</option>
              <option value="you">Just me</option>
            </select>
          </div>
          <div style="display:flex;gap:10px;">
            <div class="form-group" style="flex:1;margin-bottom:0;">
              <label style="font-size:12px;font-weight:600;">Days before end date</label>
              <input type="number" id="ne-adv-days" min="1" max="365" value="3" style="width:100%;">
            </div>
            <div class="form-group" style="flex:1;margin-bottom:0;">
              <label style="font-size:12px;font-weight:600;">Repeat every (days)</label>
              <input type="number" id="ne-adv-repeat" min="0" max="365" value="0" style="width:100%;" placeholder="0 = once">
            </div>
            <div class="form-group" style="flex:1;margin-bottom:0;">
              <label style="font-size:12px;font-weight:600;">Max reminders</label>
              <input type="number" id="ne-adv-count" min="1" max="20" value="1" style="width:100%;">
            </div>
          </div>
          <p style="font-size:11px;color:var(--muted);margin-top:8px;">Reminder will fire <strong id="ne-adv-days-preview">3</strong> day(s) before the repayment date.</p>
        </div>
      </div>
    </div>`;
  }
  el.innerHTML = html;

  _neToggleItems(); // Show/hide item lister for invoice/bill types

  // Live preview: update "X day(s) before" label as user types
  const daysInp = document.getElementById('ne-adv-days');
  const preview = document.getElementById('ne-adv-days-preview');
  if (daysInp && preview) {
    daysInp.addEventListener('input', () => { preview.textContent = daysInp.value || '3'; });
  }
}

// Legacy shim — keep callers like dashboard "They Owe Me" buttons working
window.setEntryDirection = function(dir) {
  const tabId = dir === 'you_owe_them' ? 'i-owe' : dir === 'advance' ? 'advance' : 'owe-me';
  neSelectTab(tabId);
};

window.saveNewEntry = async function() {
  try {
  const contactId  = (document.getElementById('ne-contact')?.value || '').trim();
  const category   = document.getElementById('ne-category')?.value || 'owed_to_me';
  const amount     = document.getElementById('ne-amount').value;
  const currency   = document.getElementById('ne-currency')?.value || getCurrentProfile()?.default_currency || 'USD';
  const date       = document.getElementById('ne-date').value;
  const note       = document.getElementById('ne-note').value.trim();
  const notifyOn   = document.getElementById('ne-notify')?.value === '1';
  const notifyWho  = document.getElementById('ne-notify-who')?.value || 'contact'; // 'contact' | 'you' | 'both'
  const notifyMsgExtra = document.getElementById('ne-message')?.value?.trim() || '';
  const notifyEmailOverride = document.getElementById('ne-notify-email-override')?.value?.trim() || '';
  const invNumber  = document.getElementById('ne-inv-number')?.value?.trim() || '';
  const refNumber  = document.getElementById('ne-ref-number')?.value?.trim() || '';
  const dueDate    = document.getElementById('ne-due-date')?.value || null;
  const advNote    = document.getElementById('ne-advance-note')?.value?.trim() || '';
  const advRemind      = document.getElementById('ne-adv-remind')?.checked ?? false;
  const advEndDate     = document.getElementById('ne-adv-end-date')?.value || '';
  const advDays        = parseInt(document.getElementById('ne-adv-days')?.value || '3', 10);
  const advRepeat      = parseInt(document.getElementById('ne-adv-repeat')?.value || '0', 10);
  const advCount       = parseInt(document.getElementById('ne-adv-count')?.value || '1', 10);
  const advNotifyWho   = document.getElementById('ne-adv-notify-who')?.value || 'both';
  const dirSign    = DIRECTION_SIGN[category] ?? 1;

  if (!contactId) return toast('Please select a contact.', 'error');
  if (!amount || parseFloat(amount) <= 0) return toast('Enter a valid amount.', 'error');

  // Map category back to legacy tx_type for backward compat with createEntry
  const TX_CATEGORY_TO_TYPE = {
    owed_to_me: 'they_owe_you', bill_sent: 'bill', invoice_sent: 'invoice',
    i_owe: 'you_owe_them', bill_received: 'bill', invoice_received: 'invoice',
    advance_paid: 'you_owe_them', advance_received: 'they_owe_you',
    payment_recorded: 'they_paid_you'
  };
  const txType = TX_CATEGORY_TO_TYPE[category] || 'they_owe_you';

  // Combine main note + advance note
  const combinedNote = [note, advNote].filter(Boolean).join(' · ');
  // If creating from Business Suite, include business_id + sender identity in metadata
  const _bsMeta = window._bsActiveContext && window._bsActiveBizId
    ? { business_id: window._bsActiveBizId, business_name: window._getBsSenderName?.() || '' } : null;
  let entry;
  try {
    entry = await createEntry(getCurrentUser().id, {
      contactId, txType, amount: parseFloat(amount), currency, date,
      note: combinedNote,
      invoiceNumber: invNumber || refNumber || '',
      metadata: _bsMeta
    });
  } catch (err) {
    console.error('[saveNewEntry] createEntry threw:', err);
    toast('Save failed: ' + (err.sbError?.message || err.message || 'unknown error'), 'error');
    return;
  }

  if (!entry || !entry.id) {
    toast('Failed to save entry — please try again.', 'error');
    console.error('[saveNewEntry] createEntry returned:', entry);
    return;
  }

  // Persist new fields onto the entry row
  const isAdvance = ['advance_paid', 'advance_received'].includes(category);
  if (entry?.id) {
    const contactName = (window._neContacts || []).find(c => c.id === contactId)?.name || entry?.contact?.name || '';
    const updates = { category, direction_sign: dirSign, outstanding_amount: Math.round(parseFloat(amount) * 100) };
    if (contactName) updates.contact_name = contactName;
    if (dueDate) updates.due_date = dueDate;
    // Store business sender name on the entry when created from BS
    if (window._bsActiveContext) {
      updates.from_name = window._getBsSenderName?.() || '';
    }
    // Save repayment date as due_date for advances
    if (isAdvance && advEndDate) updates.due_date = advEndDate;
    await supabase.from('entries').update(updates).eq('id', entry.id);
  }

  // ── Schedule fulfillment reminder (advances only) ─────────────────────────
  if (isAdvance && advRemind && advEndDate && entry?.id) {
    try {
      const endMs   = new Date(advEndDate + 'T09:00:00').getTime();
      const fireMs  = endMs - (advDays * 86400000);
      if (fireMs > Date.now()) {
        const advContactName = window._neContacts?.find(c => c.id === contactId)?.name || 'Contact';
        const remMsg = `Advance repayment reminder with ${advContactName} — ${currency} ${parseFloat(amount).toLocaleString()} due ${new Date(advEndDate).toLocaleDateString()}`;
        await createScheduledReminder(getCurrentUser().id, entry.id, {
          nextSendAt: new Date(fireMs).toISOString(),
          repeatDays: advRepeat,
          maxSends: advCount,
          notifyWho: advNotifyWho,
          message: remMsg
        });
        toast(`Fulfillment reminder set for ${new Date(fireMs).toLocaleDateString()}.`, 'info');
      } else {
        toast('Reminder date is in the past — advance saved without reminder.', 'info');
      }
    } catch(e) { console.warn('[fulfillment reminder]', e); }
  }

  closeModal();
  toast('Entry created.', 'success');

  // If created from Business Suite context, metadata already has business_id — return to BS
  if (window._bsActiveContext && entry?.id) {
    // Ensure metadata has business_id (belt-and-suspenders — already set at creation)
    if (!entry.metadata?.business_id && window._bsActiveBizId) {
      const bizMeta = entry.metadata || {};
      bizMeta.business_id = window._bsActiveBizId;
      await supabase.from('entries').update({ metadata: bizMeta }).eq('id', entry.id);
    }
    window._bsActiveContext = false;
    window._bsActiveBizId = '';
    _invalidateEntries();
    if (window.app?.navigate) window.app.navigate('business-suite');
  } else {
    _invalidateEntries(); navTo('entries');
  }

  // ── Auto-share via SECURITY DEFINER RPC (handles unlinked contacts too) ──
  // Replaces the old client-side approach that:
  //   1. Skipped entirely when linked_user_id was null (new contacts)
  //   2. Silently failed on notifications.insert (RLS blocks cross-user inserts)
  // The RPC runs server-side with table-owner privileges:
  //   - Looks up recipient by email in users table (bypasses users_own RLS)
  //   - Sets contact.linked_user_id if found (bypasses contacts_all RLS)
  //   - Creates share_token + fires notification for recipient (bypasses notifs_all RLS)
  //   - If recipient has no account yet: creates token with recipient_email only;
  //     on_user_login will link it when they register/log in
  if (entry?.id && contactId) {
    try {
      const { data: cRow } = await supabase.from('contacts')
        .select('email').eq('id', contactId).single();
      const recipientEmail = cRow?.email?.trim() || '';
      if (recipientEmail) {
        const fromName = window._getBsSenderName?.() || getCurrentProfile()?.display_name || 'Someone';
        const fromEmail = window._getBsSenderEmail?.() || getCurrentUser().email;
        const autoSnap = {
          amount: Math.round(parseFloat(amount) * 100), // cents — consistent with entries table & fmtMoney
          currency, tx_type: category,
          date, note, invoice_number: invNumber || '',
          from_name: fromName, from_email: fromEmail,
          formatted_amount: fmtMoney(toCents(parseFloat(amount)), currency)
        };
        const { data: shareResult, error: shareErr } = await supabase.rpc('auto_share_entry', {
          p_sender_id:       getCurrentUser().id,
          p_entry_id:        entry.id,
          p_contact_id:      contactId,
          p_recipient_email: recipientEmail,
          p_snapshot:        autoSnap
        });
        if (shareErr) {
          console.warn('[auto-share RPC error]', shareErr.message);
        } else if (shareResult?.ok) {
          console.log('[auto-share] ✓ Share created — recipient_id:', shareResult.recipient_id || '(not registered yet)');
        } else {
          console.log('[auto-share] Skipped:', shareResult?.reason);
        }
      }
    } catch(e) { console.warn('[auto-share]', e); }
  }

  // ── Post-save notifications (only when Notify toggle is ON) ─────
  if (!notifyOn) return;
  try {
    const contactName = window._neContacts?.find(c => c.id === contactId)?.name || 'Contact';
    const fromName    = window._getBsSenderName?.() || getCurrentProfile()?.display_name || 'Someone';
    const txLabel     = TX_LABELS[category] || category;
    const amtLabel    = `${currency} ${parseFloat(amount).toLocaleString()}`;
    const entryId     = entry?.id;

    const notifyContact = (notifyWho === 'contact' || notifyWho === 'both');
    const notifySelf    = (notifyWho === 'you'     || notifyWho === 'both');
    const combinedMsg   = [notifyMsgExtra, combinedNote].filter(Boolean).join(' · ');

    // 1) Self-notification (always if notifyWho includes 'you' or 'both')
    if (notifySelf) {
      await supabase.from('notifications').insert({
        user_id: getCurrentUser().id, type: 'notification',
        message: `${txLabel} with ${contactName} — ${amtLabel}${combinedMsg ? '. ' + combinedMsg : ''}`,
        amount: parseFloat(amount), currency, contact_name: contactName,
        contact_id: contactId, entry_id: entryId, read: false
      });
      // Self-email copy
      if (getCurrentUser()?.email) {
        try {
          await sendNotificationEmail(getCurrentUser().id, {
            to: getCurrentUser().email, fromName,
            txType: category, amount: parseFloat(amount), currency,
            message: combinedMsg || note, entryId, isReminder: false,
            logoUrl: getCurrentProfile()?.logo_url, siteUrl: 'https://moneyinteractions.com',
            isSelf: true, contactName
          });
        } catch(e) { console.warn('[self-email entry]', e); }
      }
    }

    // 2) Fetch contact details for linked account + email
    const { data: contactRow } = await supabase.from('contacts')
      .select('email, linked_user_id').eq('id', contactId).single();
    const contactEmail  = notifyEmailOverride || contactRow?.email || '';
    const linkedUserId  = contactRow?.linked_user_id;

    // Mirror label: owed_to_me → i_owe, bill_sent → bill_received, etc.
    const MIRROR = {
      owed_to_me: 'i_owe', bill_sent: 'bill_received', invoice_sent: 'invoice_received',
      i_owe: 'owed_to_me', bill_received: 'bill_sent', invoice_received: 'invoice_sent',
      advance_paid: 'advance_received', advance_received: 'advance_paid'
    };
    const mirrorLabel = TX_LABELS[MIRROR[category] || category] || txLabel;

    // In-app notification to linked contact account
    if (notifyContact && linkedUserId) {
      await supabase.from('notifications').insert({
        user_id: linkedUserId, type: 'notification',
        message: `${fromName}: ${mirrorLabel} — ${amtLabel}${combinedMsg ? '. ' + combinedMsg : ''}`,
        amount: parseFloat(amount), currency, contact_name: fromName,
        contact_id: contactId, entry_id: entryId, read: false
      });
    }

    // 3) Email — send when contact is selected recipient and email available
    if (notifyContact && contactEmail) {
      let emailResult;
      if (category === 'invoice_sent') {
        // Rich invoice email
        const invoiceNum = invNumber || `INV-${String(entry?.entry_number || '').padStart(4,'0')}`;
        emailResult = await sendInvoiceEmail(getCurrentUser().id, {
          to: contactEmail, fromName,
          invoiceNumber: invoiceNum,
          amount: parseFloat(amount), currency,
          companyName: getCurrentProfile()?.company_name,
          companyEmail: getCurrentProfile()?.company_email,
          companyAddress: getCurrentProfile()?.company_address,
          logoUrl: getCurrentProfile()?.logo_url,
          dueDate, message: combinedMsg || note, entryId
        });
      } else {
        // Standard notification email for all other categories
        emailResult = await sendNotificationEmail(getCurrentUser().id, {
          to: contactEmail, fromName,
          txType: category,
          amount: parseFloat(amount), currency,
          message: combinedMsg || note, entryId,
          logoUrl: getCurrentProfile()?.logo_url,
          fromEmail: getCurrentProfile()?.company_email || getCurrentUser()?.email,
          siteUrl: 'https://moneyinteractions.com'
        });
      }
      if (emailResult?.ok) {
        toast('✉️ Email sent to ' + contactEmail, 'success');
      } else {
        const errDetail = emailResult?.error || 'unknown error';
        toast('Notification saved — email failed: ' + errDetail, 'info');
        console.warn('[email]', errDetail);
      }
    } else if (notifyContact && !contactEmail) {
      toast('⚠️ Contact has no email — add an email to send notifications', 'warning');
    }
  } catch (notifErr) {
    console.warn('Post-entry notify error:', notifErr);
    toast('Notification failed: ' + (notifErr?.message || notifErr), 'error');
  }
  } catch (saveErr) {
    console.error('[saveNewEntry] FATAL:', saveErr);
    toast('Save failed: ' + (saveErr?.message || saveErr), 'error');
  }
};

window.confirmDeleteEntry = async function(id) {
  if (!confirm('Delete this entry?')) return;
  await deleteEntry(id);
  toast('Entry deleted.', 'success');
  _navAfterAction();
};

// ── Selection / Bulk Actions ─────────────────────────────────────
window.toggleSelectMode = function() {
  window._selectMode = !window._selectMode;
  if (!window._selectMode) window._selectedEntries.clear();
  if (document.getElementById('bs-content') && window._bsNavigate) {
    const section = localStorage.getItem('mxi_bs_section') || 'bs-invoices';
    window._bsNavigate(section);
  } else {
    navTo('entries');
  }
};

window.selectAllEntries = function(checked) {
  if (!window._selectedEntries) window._selectedEntries = new Set();
  if (checked) {
    _entriesAll.forEach(e => window._selectedEntries.add(e.id));
  } else {
    window._selectedEntries.clear();
  }
  if (document.getElementById('bs-content') && window._bsNavigate) {
    const section = localStorage.getItem('mxi_bs_section') || 'bs-invoices';
    window._bsNavigate(section);
  } else {
    navTo('entries');
  }
};

window.toggleEntrySelect = function(id, checked) {
  if (!window._selectedEntries) window._selectedEntries = new Set();
  if (checked) window._selectedEntries.add(id);
  else window._selectedEntries.delete(id);
  // Re-render to update count badge without full page nav
  const el = document.getElementById('page-content') || document.getElementById('bs-content');
  if (el) renderEntries(el);
};

window.bulkAction = async function(action) {
  const ids = [...(window._selectedEntries || [])];
  if (!ids.length) { toast('No entries selected.', 'warning'); return; }
  const count = ids.length;

  if (action === 'delete') {
    if (!confirm(`Delete ${count} entries? This cannot be undone.`)) return;
    const ok = await bulkDelete(ids);
    toast(ok ? `${count} entries deleted.` : 'Delete failed.', ok ? 'success' : 'error');
  } else if (action === 'archive') {
    const ok = await bulkArchive(ids);
    toast(ok ? `${count} entries archived.` : 'Archive failed.', ok ? 'success' : 'error');
  } else if (action === 'noledger') {
    const ok = await bulkNoLedger(ids, true);
    toast(ok ? `${count} entries removed from ledger.` : 'Update failed.', ok ? 'success' : 'error');
  } else if (action === 'restore') {
    // Restore = unarchive + add back to ledger
    let ok = true;
    for (const id of ids) {
      const r = await restoreEntry(id);
      if (!r) ok = false;
    }
    toast(ok ? `${count} entries restored.` : 'Some restores failed.', ok ? 'success' : 'error');
  }

  window._selectedEntries.clear();
  window._selectMode = false;
  _invalidateEntries();
  if (document.getElementById('bs-content') && window._bsNavigate) {
    const section = localStorage.getItem('mxi_bs_section') || 'bs-invoices';
    window._bsNavigate(section);
  } else {
    navTo('entries');
  }
};

