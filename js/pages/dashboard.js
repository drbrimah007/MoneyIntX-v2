// ────────────────────────────────────────────────────────────────────────────
// Dashboard Page
// ────────────────────────────────────────────────────────────────────────────

import { getCurrentUser, getCurrentProfile } from './state.js';
import { contactColor, _fmtAmt } from './state.js';
import { getDashboardTotals, recentEntries, getLedgerSummary, getCurrencyLedger, fmtMoney, toCents, invalidateEntryCache } from '../entries.js';
import { listContacts } from '../contacts.js';
import { getUnreadCount } from '../notifications.js';
import { listReceivedShares } from '../sharing.js';
import { esc, statusBadge, TX_LABELS, TX_COLORS, fmtDate } from '../ui.js';

export async function renderDash(el) {
  // Allow being called without el (e.g. from setDefaultCurrency)
  if (!el) el = document.getElementById('content');
  if (!el || window._currentPage !== 'dash') return;
  el.innerHTML = '<div class="page-header"><h2>Dashboard</h2></div><p style="color:var(--muted);padding:20px;">Loading…</p>';

  const currentUser = getCurrentUser();
  const currentProfile = getCurrentProfile();

  let totals, recent, contacts, unread, ledger, currencyRows;

  if (window._impersonatedData) {
    const snap = window._impersonatedData;
    const snapEntries = snap.entries || [];
    const snapContacts = snap.contacts || [];
    contacts = snapContacts;
    window._allContacts = snapContacts;
    recent = snapEntries.slice(0, 15);
    unread = (snap.notifications || []).filter(n => !n.read).length;
    const defaultCur2 = snap.user?.default_currency || 'USD';
    const OWE_ME = new Set(['owed_to_me','invoice_sent','advance_paid','loan_given','they_owe_you']);
    const I_OWE  = new Set(['i_owe','invoice_received','advance_received','loan_taken','you_owe_them']);
    let toy2 = 0, yot2 = 0;
    snapEntries.forEach(e => {
      if (e.status === 'voided' || e.status === 'archived') return;
      if ((e.currency || 'USD') !== defaultCur2) return;
      if (OWE_ME.has(e.tx_type)) toy2 += (e.amount || 0);
      if (I_OWE.has(e.tx_type))  yot2 += (e.amount || 0);
    });
    totals = { total_they_owe_me: toy2, total_i_owe_them: yot2, total_net: toy2 - yot2 };
    ledger = snapContacts.map(c => ({ contact_id: c.id, contact_name: c.name, net_balance: 0 }));
    currencyRows = [{ currency: defaultCur2, owed_to_me: toy2, i_owe: yot2 }];
  } else {
    // Run critical queries first (top 4), then non-critical (ledger + currency) in parallel
    // This paints the hero card faster even if ledger is slow
    [totals, recent, contacts, unread] = await Promise.all([
      getDashboardTotals(currentUser.id),
      recentEntries(currentUser.id, 15),
      listContacts(currentUser.id),
      getUnreadCount(currentUser.id)
    ]);
    // Cache contacts for entry modal
    window._allContacts = contacts;
    [ledger, currencyRows] = await Promise.all([
      getLedgerSummary(currentUser.id),
      getCurrencyLedger(currentUser.id)
    ]);
  }

  // Use per-currency ledger row for the primary currency hero — never mix currencies.
  // currencyRows data is in cents (matching fmtMoney's expectation).
  const defaultCur = currentProfile?.default_currency || 'USD';
  const primaryRow = (currencyRows || []).find(r => r.currency === defaultCur);
  // STRICT currency isolation: if no transactions in this currency, show zeros.
  // NEVER fall back to cross-currency totals — each currency is completely separate.
  const toy = primaryRow ? (primaryRow.owed_to_me || 0) : 0;
  const yot = primaryRow ? (primaryRow.i_owe || 0)      : 0;
  const net = toy - yot;

  const userName = currentProfile?.display_name?.split(' ')[0] || 'there';

  // Inject / update the body-level floating currency picker (lives outside hero card
  // so it's never clipped by overflow:hidden — positioned via fixed coords in toggleCurPicker)
  const ALL_CURRENCIES = ['USD','EUR','GBP','NGN','CAD','AUD','JPY','KES','ZAR','GHS','INR','AED','SAR','BRL','EGP','MAD','TZS','UGX','ETB','XOF','QAR','KWD','CNY','MXN'];
  let _picker = document.getElementById('hero-cur-picker');
  if (!_picker) {
    _picker = document.createElement('div');
    _picker.id = 'hero-cur-picker';
    _picker.style.cssText = 'display:none;position:fixed;z-index:9999;background:#1e2035;border:1px solid rgba(255,255,255,.2);border-radius:10px;padding:6px;min-width:110px;box-shadow:0 8px 24px rgba(0,0,0,.5);max-height:240px;overflow-y:auto;';
    document.body.appendChild(_picker);
  }
  _picker.innerHTML = ALL_CURRENCIES.map(c =>
    `<div onclick="pickCurrency('${c}')" ${defaultCur===c?'data-cur-active':''} style="padding:6px 10px;border-radius:7px;cursor:pointer;font-size:13px;font-weight:${defaultCur===c?'800':'500'};color:${defaultCur===c?'#a5b4fc':'#e2e8f0'};background:${defaultCur===c?'rgba(99,102,241,.25)':'transparent'};display:flex;align-items:center;gap:6px;"
      onmouseover="this.style.background='rgba(99,102,241,.18)'" onmouseout="this.style.background='${defaultCur===c?'rgba(99,102,241,.25)':'transparent'}'">
      ${defaultCur===c?'<span style="font-size:9px;color:#a5b4fc;">✓</span>':'<span style="font-size:9px;opacity:0;">·</span>'} ${c}
    </div>`
  ).join('');

  let html = `<div class="page-header">
    <div><h2>Dashboard</h2><p style="font-size:13px;color:var(--muted);margin-top:2px;">Welcome back, ${esc(userName)} 👋</p></div>
    <div style="display:flex;gap:8px;">
      <button class="btn btn-primary btn-sm" onclick="openNewEntryModal()">+ Entry</button>
      <button class="btn btn-secondary btn-sm" onclick="openNewContactModal()">+ Contact</button>
    </div>
  </div>`;

  // ── Primary currency hero card ─────────────────────────────────
  // defaultCur and primaryRow already set above from currencyRows
  const otherRows = (currencyRows || []).filter(r => r.currency !== defaultCur);

  const netAbs = Math.abs(net);
  const netLabel = net > 0 ? 'You are owed' : net < 0 ? 'You owe' : 'All settled up';
  const netIcon = net > 0 ? '📈' : net < 0 ? '📉' : '✅';
  const heroGrad = net > 0 ? 'linear-gradient(135deg,#1d4ed8,#6c63ff)' : net < 0 ? 'linear-gradient(135deg,#b91c1c,#dc2626)' : 'linear-gradient(135deg,#065f46,#047857)';

  const CURRENCY_ICONS = { USD:'🇺🇸', EUR:'🇪🇺', GBP:'🇬🇧', NGN:'🇳🇬', CAD:'🇨🇦', AUD:'🇦🇺', JPY:'🇯🇵', KES:'🇰🇪', ZAR:'🇿🇦', GHS:'🇬🇭', INR:'🇮🇳', AED:'🇦🇪', SAR:'🇸🇦', BRL:'🇧🇷', EGP:'🇪🇬', MAD:'🇲🇦' };
  // Distinct hues for currency sub-boxes (not red/green — purely visual identity)
  const CUR_HUES = { USD:220, EUR:260, GBP:280, NGN:30, CAD:195, AUD:170, JPY:340, KES:135, ZAR:0, GHS:45, INR:15, AED:200, SAR:90, BRL:145, EGP:55, MAD:310 };

  // Other-currency expanded cards — RIGHT of main balance.
  // No truncation: full amounts, owed + owe rows, auto-width.
  const otherCurPanel = otherRows.length > 0 ? `
    <div class="other-cur-panel" style="display:flex;flex-direction:column;gap:6px;min-width:130px;flex-shrink:0;justify-content:center;">
      ${otherRows.map(row => {
        const cur = row.currency;
        const owed = row.owed_to_me || 0;
        const owing = row.i_owe || 0;
        const netCur = owed - owing;
        const hue = CUR_HUES[cur] ?? ((Object.keys(CUR_HUES).indexOf(cur) * 37 + 180) % 360);
        const icon = CURRENCY_ICONS[cur] || '💰';
        const netColor = netCur >= 0 ? 'hsl(142,70%,68%)' : 'hsl(0,80%,68%)';
        return `<div onclick="navTo('entries')"
          style="background:rgba(0,0,0,.30);border:1px solid hsla(${hue},65%,55%,.4);border-radius:10px;padding:8px 11px;cursor:pointer;white-space:nowrap;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:5px;">
            <span style="font-size:11px;font-weight:800;opacity:.9;">${icon} ${esc(cur)}</span>
            <span style="font-size:13px;font-weight:900;color:${netColor};">${netCur >= 0 ? '+' : ''}${_fmtAmt(netCur/100, cur)}</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:2px;">
            <div style="display:flex;justify-content:space-between;gap:10px;font-size:10px;opacity:.75;">
              <span>Owed to me</span><span style="font-weight:700;">${_fmtAmt(owed/100, cur)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;gap:10px;font-size:10px;opacity:.75;">
              <span>I owe</span><span style="font-weight:700;">${_fmtAmt(owing/100, cur)}</span>
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>` : '';

  html += `
  <div style="background:${heroGrad};border-radius:18px;padding:22px;color:#fff;margin-bottom:14px;position:relative;overflow:hidden;">
    <div style="position:absolute;right:-16px;top:-16px;font-size:110px;opacity:0.07;pointer-events:none;">${netIcon}</div>
    <!-- Hero inner: primary currency LEFT, other currencies RIGHT (wraps below on mobile) -->
    <div class="hero-flex" style="display:flex;align-items:stretch;gap:14px;flex-wrap:wrap;">
      <!-- Primary currency block -->
      <div style="flex:1;min-width:0;">
        <div style="font-size:11px;opacity:0.75;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:2px;">${netLabel} · ${defaultCur}</div>
        <div style="font-size:36px;font-weight:900;letter-spacing:-.02em;line-height:1;">${fmtMoney(netAbs, defaultCur)}</div>
        <div style="display:flex;gap:18px;font-size:12px;opacity:0.85;margin-top:10px;">
          <div><span style="opacity:.7;">Owed to Me</span><div style="font-weight:800;font-size:14px;">${fmtMoney(toy, defaultCur)}</div></div>
          <div><span style="opacity:.7;">I Owe</span><div style="font-weight:800;font-size:14px;">${fmtMoney(yot, defaultCur)}</div></div>
        </div>
        <!-- Compact currency pill — dropdown rendered in body to avoid overflow:hidden clipping -->
        <div style="display:inline-block;margin-top:10px;">
          <button onclick="toggleCurPicker(this)" title="Change default currency"
            style="background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.35);color:#fff;border-radius:20px;padding:4px 12px;font-size:12px;font-weight:800;cursor:pointer;display:flex;align-items:center;gap:5px;letter-spacing:.04em;">
            ${defaultCur} <span style="font-size:9px;opacity:.7;">▼</span>
          </button>
        </div>
      </div>
      <!-- Other currencies stretch panel (right side) -->
      ${otherCurPanel}
    </div>
  </div>`;

  // Tip is now shown in the persistent topbar strip (loaded in enterApp, random per refresh)

  // Stat cards row
  const pendingCount = recent.filter(e => !['settled','voided','cancelled','fulfilled'].includes(e.status)).length;
  html += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:10px;margin-bottom:14px;">
    <div class="stat-card" style="cursor:pointer;border-color:var(--line-2,var(--border));" onclick="navTo('contacts')">
      <div class="stat-lbl">Contacts</div><div class="stat-val" style="color:var(--blue);">${contacts.length}</div>
    </div>
    <div class="stat-card" style="cursor:pointer;border-color:var(--line-2,var(--border));" onclick="navTo('entries')">
      <div class="stat-lbl">Entries</div><div class="stat-val">${recent.length}+</div>
    </div>
    <div class="stat-card" style="cursor:pointer;border-color:rgba(214,185,122,.18);" onclick="navTo('entries')">
      <div class="stat-lbl">Pending</div><div class="stat-val" style="color:var(--amber);">${pendingCount}</div>
    </div>
    ${unread > 0 ? `<div class="stat-card" style="cursor:pointer;border-color:rgba(108,99,255,.22);" onclick="navTo('notifications')">
      <div class="stat-lbl">Unread</div><div class="stat-val" style="color:var(--accent);">${unread}</div>
    </div>` : ''}
  </div>`;

  // (Currency ledgers now embedded inside hero card — no separate section needed)

  // Quick Actions — canvas-style pill tab strip
  const _qaBtnBase = 'display:inline-flex;align-items:center;gap:6px;border-radius:8px;padding:8px 16px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;border:1px solid;letter-spacing:.01em;transition:filter .15s;';
  html += `<div style="margin-bottom:14px;overflow-x:auto;padding-bottom:2px;">
    <div style="display:flex;gap:8px;min-width:max-content;">
      <button onclick="openNewEntryModal('owe-me')"
        style="${_qaBtnBase}background:rgba(99,214,154,.10);border-color:rgba(99,214,154,.20);color:#63d69a;"
        onmouseover="this.style.filter='brightness(1.12)'" onmouseout="this.style.filter=''">
        + They Owe Me
      </button>
      <button onclick="openNewEntryModal('i-owe')"
        style="${_qaBtnBase}background:rgba(208,120,120,.10);border-color:rgba(208,120,120,.20);color:#d07878;"
        onmouseover="this.style.filter='brightness(1.12)'" onmouseout="this.style.filter=''">
        + I Owe Them
      </button>
      <button onclick="openNewEntryModal('advance')"
        style="${_qaBtnBase}background:rgba(213,187,122,.10);border-color:rgba(213,187,122,.20);color:#d5bb7a;"
        onmouseover="this.style.filter='brightness(1.12)'" onmouseout="this.style.filter=''">
        + Advances
      </button>
      <button onclick="openNewEntryModal('owe-me');setTimeout(()=>{document.querySelector('[onclick*=invoice_sent]')?.click()},80)"
        style="${_qaBtnBase}background:rgba(157,178,219,.10);border-color:rgba(157,178,219,.20);color:#9db2db;"
        onmouseover="this.style.filter='brightness(1.12)'" onmouseout="this.style.filter=''">
        + New Invoice
      </button>
      <button onclick="openNewContactModal()"
        style="${_qaBtnBase}background:transparent;border-color:rgba(255,255,255,.15);color:var(--muted);"
        onmouseover="this.style.borderColor='rgba(255,255,255,.3)';this.style.color='var(--text)'" onmouseout="this.style.borderColor='rgba(255,255,255,.15)';this.style.color='var(--muted)'">
        + Contact
      </button>
      ${window._modEnabled?.('groups') ? `<button onclick="navTo('groups')"
        style="${_qaBtnBase}background:transparent;border-color:rgba(255,255,255,.15);color:var(--muted);"
        onmouseover="this.style.borderColor='rgba(255,255,255,.3)';this.style.color='var(--text)'" onmouseout="this.style.borderColor='rgba(255,255,255,.15)';this.style.color='var(--muted)'">
        Groups
      </button>` : ''}
      ${window._modEnabled?.('investments') ? `<button onclick="navTo('investments')"
        style="${_qaBtnBase}background:transparent;border-color:rgba(255,255,255,.15);color:var(--muted);"
        onmouseover="this.style.borderColor='rgba(255,255,255,.3)';this.style.color='var(--text)'" onmouseout="this.style.borderColor='rgba(255,255,255,.15)';this.style.color='var(--muted)'">
        Invest
      </button>` : ''}
      <button onclick="navTo('recurring')"
        style="${_qaBtnBase}background:transparent;border-color:rgba(255,255,255,.15);color:var(--muted);"
        onmouseover="this.style.borderColor='rgba(255,255,255,.3)';this.style.color='var(--text)'" onmouseout="this.style.borderColor='rgba(255,255,255,.15)';this.style.color='var(--muted)'">
        Recurring
      </button>
      ${window._modEnabled?.('nok') ? `<button onclick="navTo('nok')"
        style="${_qaBtnBase}background:transparent;border-color:rgba(255,255,255,.15);color:var(--muted);"
        onmouseover="this.style.borderColor='rgba(255,255,255,.3)';this.style.color='var(--text)'" onmouseout="this.style.borderColor='rgba(255,255,255,.15)';this.style.color='var(--muted)'">
        Trusted
      </button>` : ''}
    </div>
  </div>`;

  // Top contacts by balance
  const topContacts = (ledger || [])
    .filter(l => Math.abs(l.net_balance || 0) > 0)
    .sort((a,b) => Math.abs(b.net_balance||0) - Math.abs(a.net_balance||0))
    .slice(0, 5);

  if (topContacts.length > 0) {
    const maxAbs = Math.max(...topContacts.map(l => Math.abs(l.net_balance||0)));
    html += `<div class="card card-sm" style="margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <div class="section-title" style="margin:0;">Top Balances</div>
        <a onclick="navTo('contacts')" style="font-size:12px;cursor:pointer;color:var(--accent);">All →</a>
      </div>`;
    topContacts.forEach(l => {
      const nb = l.net_balance || 0;
      const pct = maxAbs > 0 ? Math.abs(nb) / maxAbs * 100 : 0;
      const color = nb > 0 ? 'var(--green)' : 'var(--red)';
      const label = nb > 0 ? 'owes you' : 'you owe';
      const aColor = contactColor(l.contact_id);
      html += `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;cursor:pointer;" onclick="openContactDetail('${l.contact_id}')">
        <div style="width:32px;height:32px;border-radius:50%;background:${aColor};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;flex-shrink:0;color:#fff;">
          ${esc((l.contact_name||'?').charAt(0).toUpperCase())}
        </div>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
            <span style="font-size:13px;font-weight:600;">${esc(l.contact_name||'—')}</span>
            <span style="font-size:13px;font-weight:800;color:${color};">${fmtMoney(Math.abs(nb))}</span>
          </div>
          <div style="height:4px;background:var(--bg3);border-radius:2px;overflow:hidden;">
            <div style="height:100%;width:${pct.toFixed(0)}%;background:${color};border-radius:2px;transition:width .4s;"></div>
          </div>
          <div style="font-size:10px;color:var(--muted);margin-top:2px;">${label}</div>
        </div>
      </div>`;
    });
    html += `</div>`;
  }

  // ── Pending Shared Records on Dashboard (same as entries page) ────
  if (window._pendingSharesAll === null) {
    try {
      const allShares = await listReceivedShares(currentUser.id);
      window._pendingSharesAll = (allShares || []).filter(s => s.status !== 'confirmed' && s.status !== 'dismissed');
    } catch(e) { window._pendingSharesAll = []; }
  }
  if (window._pendingSharesAll && window._pendingSharesAll.length > 0) {
    html += `<div class="card" style="padding:0;overflow:hidden;border:2px solid rgba(245,158,11,.5);margin-bottom:14px;">
      <div style="background:rgba(245,158,11,.1);padding:10px 16px;border-bottom:1px solid rgba(245,158,11,.2);display:flex;align-items:center;gap:8px;">
        <span style="font-size:15px;">⏳</span>
        <span style="font-weight:700;font-size:13px;color:#f59e0b;">Pending — Records Shared With You (${window._pendingSharesAll.length})</span>
      </div>
      <div class="tbl-wrap"><table><thead><tr>
        <th>From</th><th>Amount</th><th class="hide-mobile">Type</th><th>Action</th>
      </tr></thead><tbody>`;
    window._pendingSharesAll.forEach(s => {
      const snap = s.entry_snapshot || {};
      const fromName = snap.from_name || s.sender_name || 'Someone';
      const amt = snap.amount || 0;
      const amtCents = snap.amount !== undefined ? snap.amount : toCents(amt);
      const cur = snap.currency || 'USD';
      // Flip tx_type to show recipient's perspective (sender's "Owed to me" → recipient's "I Owe")
      const SNAP_FLIP = { 'they_owe_you':'you_owe_them','you_owe_them':'they_owe_you','owed_to_me':'i_owe','i_owe':'owed_to_me','they_paid_you':'you_paid_them','you_paid_them':'they_paid_you','invoice_sent':'invoice_received','invoice_received':'invoice_sent','bill_sent':'bill_received','bill_received':'bill_sent','invoice':'bill','bill':'invoice' };
      const txLabel = TX_LABELS[SNAP_FLIP[snap.tx_type] || snap.tx_type] || snap.tx_type || '—';
      html += `<tr data-pending-id="${s.id}">
        <td style="font-weight:700;">${esc(fromName)}</td>
        <td style="font-weight:700;color:#f59e0b;">${fmtMoney(amtCents, cur)}</td>
        <td class="hide-mobile" style="font-size:12px;color:var(--muted);">${esc(txLabel)}</td>
        <td style="white-space:nowrap;">
          <button class="btn btn-primary btn-sm" onclick="doPendingConfirm('${s.id}')" style="padding:5px 14px;font-size:12px;font-weight:700;">✓ Confirm</button>
          <button class="bs sm" onclick="doPendingReject('${s.id}')" style="margin-left:4px;padding:5px 10px;font-size:12px;color:var(--red);border-color:var(--red);">✕ Reject</button>
        </td>
      </tr>`;
    });
    html += `</tbody></table></div></div>`;
  }

  // Recent Entries — same format as full entries page
  html += `<div class="card" style="padding:0;overflow:hidden;">
    <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 16px 10px;border-bottom:1px solid var(--border);">
      <h3 style="font-size:15px;font-weight:700;margin:0;">Recent Entries</h3>
      <a onclick="navTo('entries')" style="font-size:13px;cursor:pointer;color:var(--accent);">View all →</a>
    </div>`;
  if (recent.length === 0) {
    html += `<div style="text-align:center;padding:32px;"><div style="font-size:36px;margin-bottom:8px;">📋</div>
      <p style="color:var(--muted);font-size:14px;">No entries yet.</p>
      <button class="btn btn-primary btn-sm" style="margin-top:12px;" onclick="openNewEntryModal()">Create First Entry</button>
    </div>`;
  } else {
    html += `<div class="tbl-wrap"><table><thead><tr>
      <th>Contact</th><th>Amount</th><th class="hide-mobile">Doc #</th><th class="hide-mobile">Type</th><th>Date</th><th>Status</th><th style="width:44px;"></th>
    </tr></thead><tbody>`;
    recent.forEach(e => {
      const cName = e.contact?.name || '—';
      const cId = e.contact?.id || '';
      const _txKey = e.category || e.tx_type;
      const txLabel = TX_LABELS[_txKey] || _txKey;
      const txColor = TX_COLORS[_txKey] || 'var(--text)';
      const remaining = e.amount - e.settled_amount;
      const settled = e.settled_amount > 0;
      const typeMobileDash = `<div class="show-mobile" style="font-size:11px;font-weight:700;color:${txColor};margin-bottom:2px;">${esc(txLabel)}</div>`;
      const amtHtml = settled
        ? `${typeMobileDash}${fmtMoney(e.amount, e.currency)}<div style="font-size:11px;color:var(--muted);">Pd ${fmtMoney(e.settled_amount, e.currency)}</div><div style="font-size:11px;font-weight:700;color:${remaining<=0?'var(--green)':'var(--amber)'};">Bal ${fmtMoney(remaining,e.currency)}</div>`
        : `${typeMobileDash}${fmtMoney(e.amount, e.currency)}`;
      const col = cId ? contactColor(cId) : 'var(--bg3)';
      const reminderHtml = e.reminder_count > 0 ? `<span class="badge badge-red" style="margin-left:4px;">🚩${e.reminder_count}</span>` : '';
      html += `<tr>
        <td style="min-width:80px;">
          ${cId ? `<span style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;" onclick="openContactDetail('${cId}')">
            <span style="width:24px;height:24px;border-radius:50%;background:${col};display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0;color:#fff;">${esc(cName.charAt(0).toUpperCase())}</span>
            <span style="font-weight:600;color:var(--contact,#d88978);">${esc(cName)}</span>
          </span>` : `<span style="color:var(--muted);">${esc(cName)}</span>`}
        </td>
        <td style="font-weight:700;cursor:pointer;" onclick="openEntryDetail('${e.id}')">${amtHtml}</td>
        <td class="hide-mobile">${e.invoice_number ? `<span style="font-size:11px;font-family:monospace;color:var(--accent);font-weight:700;">${esc(e.invoice_number)}</span>` : e.entry_number ? `<span style="font-size:11px;font-family:monospace;color:var(--muted);font-weight:700;">#${String(e.entry_number).padStart(4,'0')}</span>` : '<span style="color:var(--bg3);">—</span>'}</td>
        <td class="hide-mobile"><span style="font-weight:600;font-size:12px;color:${txColor};">${esc(txLabel)}</span></td>
        <td style="color:var(--muted);font-size:12px;">${fmtDate(e.date)}</td>
        <td>${statusBadge(e.status)}${reminderHtml}</td>
        <td><button class="action-menu-btn" onclick="openEntryDetail('${e.id}')" title="View" style="font-size:18px;padding:4px 8px;">⋮</button></td>
      </tr>`;
    });
    html += `</tbody></table></div>`;
  }
  html += `</div>`;
  el.innerHTML = html;
}
