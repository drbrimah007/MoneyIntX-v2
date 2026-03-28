// Money IntX v2 — UI Helpers
// Shared utilities used across all pages

// ── Escape HTML ───────────────────────────────────────────────────
export function esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

// ── Toast notifications ───────────────────────────────────────────
export function toast(msg, type = 'info', duration = 3000) {
  const el = document.createElement('div');
  const colors = {
    info: 'background:#1a1a2e;color:#fff;',
    success: 'background:#16a34a;color:#fff;',
    error: 'background:#dc2626;color:#fff;',
    warning: 'background:#d97706;color:#fff;'
  };
  el.style.cssText = `
    position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
    ${colors[type] || colors.info}
    padding:12px 24px;border-radius:12px;font-size:14px;font-weight:500;
    box-shadow:0 8px 24px rgba(0,0,0,0.15);z-index:9999;
    animation:slideUp 0.25s ease;max-width:90vw;text-align:center;
  `;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.3s';
    setTimeout(() => el.remove(), 300);
  }, duration);
}

// ── Navigation ────────────────────────────────────────────────────
let _currentPage = 'landing';
const _pageHandlers = {};

export function registerPage(name, handler) {
  _pageHandlers[name] = handler;
}

export function navigate(page, params = {}) {
  _currentPage = page;
  if (_pageHandlers[page]) {
    _pageHandlers[page](params);
  }
  if (page !== 'landing') {
    history.replaceState(null, '', '#' + page);
  }
}

export function getCurrentPage() { return _currentPage; }

// ── Modal helpers ─────────────────────────────────────────────────
export function openModal(html, { maxWidth = '520px', id = 'modal' } = {}) {
  closeModal(id);
  const wrap = document.createElement('div');
  wrap.id = id;
  wrap.style.cssText = `
    position:fixed;inset:0;z-index:200;
    background:rgba(0,0,0,0.4);backdrop-filter:blur(4px);
    display:flex;align-items:center;justify-content:center;
    padding:20px;animation:fadeIn 0.2s ease;
  `;
  wrap.innerHTML = `
    <div style="background:var(--bg);border-radius:16px;padding:28px;
      max-width:${maxWidth};width:100%;max-height:90vh;overflow-y:auto;
      box-shadow:0 20px 40px rgba(0,0,0,0.15);animation:slideUp 0.25s ease;"
      onclick="event.stopPropagation()">
      ${html}
    </div>
  `;
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap) closeModal(id);
  });
  document.body.appendChild(wrap);
  return wrap;
}

export function closeModal(id = 'modal') {
  document.getElementById(id)?.remove();
}

// ── Format helpers ────────────────────────────────────────────────
export function fmtDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString();
}

export function fmtRelative(ts) {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  if (days < 7) return days + 'd ago';
  return fmtDate(ts);
}

// ── Status badge — exact production tokens ─────────────────────────
const STATUS_COLORS = {
  draft:             { bg: 'rgba(157,178,219,.10)', color: '#9db2db', border: 'rgba(157,178,219,.16)' },
  posted:            { bg: 'rgba(157,178,219,.12)', color: '#9db2db', border: 'rgba(157,178,219,.20)' },
  sent:              { bg: 'rgba(108,99,255,.10)',  color: '#a78bfa', border: 'rgba(108,99,255,.18)' },
  viewed:            { bg: 'rgba(108,99,255,.08)',  color: '#c4b5fd', border: 'rgba(108,99,255,.15)' },
  accepted:          { bg: 'rgba(99,214,154,.12)',  color: '#63d69a', border: 'rgba(99,214,154,.20)' },
  due:               { bg: 'rgba(213,187,122,.12)', color: '#d5bb7a', border: 'rgba(213,187,122,.20)' },
  partially_settled: { bg: 'rgba(213,187,122,.12)', color: '#d5bb7a', border: 'rgba(213,187,122,.20)' },
  settled:           { bg: 'rgba(99,214,154,.12)',  color: '#63d69a', border: 'rgba(99,214,154,.20)' },
  fulfilled:         { bg: 'rgba(99,214,154,.12)',  color: '#63d69a', border: 'rgba(99,214,154,.20)' },
  overdue:           { bg: 'rgba(208,120,120,.12)', color: '#d07878', border: 'rgba(208,120,120,.20)' },
  disputed:          { bg: 'rgba(208,120,120,.12)', color: '#d07878', border: 'rgba(208,120,120,.20)' },
  voided:            { bg: 'rgba(255,255,255,.04)', color: '#6f7788', border: 'rgba(255,255,255,.08)' },
  cancelled:         { bg: 'rgba(255,255,255,.04)', color: '#6f7788', border: 'rgba(255,255,255,.08)' },
  closed:            { bg: 'rgba(255,255,255,.04)', color: '#6f7788', border: 'rgba(255,255,255,.08)' },
  payment:           { bg: 'rgba(99,214,154,.12)',  color: '#63d69a', border: 'rgba(99,214,154,.20)' },
};

const STATUS_LABELS = {
  draft: 'Draft', posted: 'Posted', sent: 'Sent', viewed: 'Viewed',
  accepted: 'Accepted', due: 'Due', partially_settled: 'Partial',
  settled: 'Settled', fulfilled: 'Fulfilled', overdue: 'Overdue',
  disputed: 'Disputed', voided: 'Voided', cancelled: 'Cancelled',
  closed: 'Closed', payment: 'Payment'
};

export function statusBadge(status) {
  const s = STATUS_COLORS[status] || STATUS_COLORS.posted;
  const label = STATUS_LABELS[status] || status;
  return `<span style="display:inline-block;background:${s.bg};color:${s.color};border:1px solid ${s.border || s.bg};
    border-radius:100px;padding:3px 10px;font-size:11px;font-weight:700;
    text-transform:uppercase;letter-spacing:0.05em;">${esc(label)}</span>`;
}

// ── TX Category labels (ledger = past tense; canonical enums per handoff spec) ─
// Internal enums are permanent. UI copy may change.
export const TX_LABELS = {
  // ── New canonical categories (v2) ──────────────────────────────
  owed_to_me:        'Owed to Me',
  bill_sent:         'Bill Sent',
  invoice_sent:      'Invoice Sent',
  i_owe:             'I Owe',
  bill_received:     'Bill Received',
  invoice_received:  'Invoice Received',
  advance_paid:      'Advance Paid',
  advance_received:  'Advance Received',
  payment_recorded:  'Payment',
  // ── Legacy tx_type aliases (backward compat for un-migrated rows) ──
  they_owe_you:  'Owed to Me',
  you_owe_them:  'I Owe',
  they_paid_you: 'Payment',
  you_paid_them: 'Payment',
  invoice:       'Invoice Sent',
  bill:          'Bill Sent'
};

// UI tab labels (present tense, user-facing) — create actions
export const TX_CREATE_LABELS = {
  owed_to_me:       'They owe me',
  bill_sent:        'Send a bill',
  invoice_sent:     'Send an invoice',
  i_owe:            'I owe them',
  bill_received:    'Receive a bill',
  invoice_received: 'Receive an invoice',
  advance_paid:     'Pay in advance',
  advance_received: 'Receive advance payment'
};

export const TX_COLORS = {
  // Receivable / owed to me → success green
  owed_to_me:       '#63d69a',
  invoice_sent:     '#63d69a',
  bill_sent:        '#63d69a',
  they_owe_you:     '#63d69a',
  they_paid_you:    '#63d69a',
  // Payable / I owe → muted red
  i_owe:            '#d07878',
  invoice_received: '#d07878',
  bill_received:    '#d07878',
  you_owe_them:     '#d07878',
  you_paid_them:    '#d07878',
  // Neutral invoice/bill → posted blue
  invoice:          '#9db2db',
  bill:             '#9db2db',
  // Payment recorded → success green
  payment_recorded: '#63d69a',
  // Advances → partial gold
  advance_paid:     '#d5bb7a',
  advance_received: '#d5bb7a'
};

// Direction sign per category (canonical source of truth for new entries)
export const DIRECTION_SIGN = {
  owed_to_me:       1,
  bill_sent:        1,
  invoice_sent:     1,
  i_owe:           -1,
  bill_received:   -1,
  invoice_received:-1,
  advance_paid:    -1,
  advance_received: 1,
  payment_recorded: 0   // direction set from context
};
