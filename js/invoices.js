// Money IntX v2 — Invoice Generation Module
import { supabase } from './supabase.js';
import { fmtMoney } from './entries.js';

// ── Helper: render template_data fields as invoice line items ──────
// Returns { rows: string, hasFinalTotal: boolean }
function renderTemplateRows(entry, currency) {
  const tdata = entry.template_data;
  if (!tdata || typeof tdata !== 'object') return { rows: '', hasFinalTotal: false };
  const fields = entry.template_fields || []; // ordered field definitions
  let rows = '';
  let hasFinalTotal = false;

  // Walk field definitions in order (if available)
  const keys = fields.length > 0
    ? fields.map(f => f.id || f.name)
    : Object.keys(tdata);

  const fieldMap = {};
  fields.forEach(f => { fieldMap[f.id || f.name] = f; });

  keys.forEach(key => {
    const val = tdata[key];
    const fDef = fieldMap[key] || {};
    const label = fDef.name || key;
    if (fDef.isFinalTotal) { hasFinalTotal = true; }

    // Skip hidden/private fields
    if (fDef.visibility === 'private') return;

    // Paired row: render sub-fields
    if (fDef.type === 'paired' && typeof val === 'object' && val !== null) {
      const leftLabel = fDef.leftLabel || 'Item';
      const rightLabel = fDef.rightLabel || 'Value';
      const leftVal = val[fDef.leftId] || val.left || '';
      const rightVal = val[fDef.rightId] || val.right || '';
      const numericRight = fDef.isNumeric || !isNaN(parseFloat(rightVal));
      rows += `<tr>
        <td>${escHtml(String(leftVal || leftLabel))}</td>
        <td style="text-align:right;">${numericRight && rightVal !== '' ? fmtMoney(parseFloat(rightVal)*100, currency) : escHtml(String(rightVal))}</td>
      </tr>`;
      return;
    }

    // Computed / calculator field
    if (fDef.isComputed || fDef.isFinalTotal) {
      const numVal = parseFloat(val);
      if (!isNaN(numVal)) {
        rows += `<tr style="background:#f8fafc;">
          <td style="font-weight:600;">${escHtml(label)}</td>
          <td style="text-align:right;font-weight:700;">${fmtMoney(numVal*100, currency)}</td>
        </tr>`;
      }
      return;
    }

    // Numeric field
    if (fDef.isNumeric || fDef.type === 'number') {
      const numVal = parseFloat(val);
      if (!isNaN(numVal)) {
        rows += `<tr>
          <td>${escHtml(label)}</td>
          <td style="text-align:right;">${fmtMoney(numVal*100, currency)}</td>
        </tr>`;
      }
      return;
    }

    // Dropdown
    if (fDef.type === 'dropdown' && val) {
      const opt = (fDef.options || []).find(o => o.value === val || o.label === val);
      const dispLabel = opt ? opt.label : val;
      const dispVal = opt?.numericValue != null ? fmtMoney(parseFloat(opt.numericValue)*100, currency) : '';
      rows += `<tr>
        <td>${escHtml(label)}: <em>${escHtml(String(dispLabel))}</em></td>
        <td style="text-align:right;">${dispVal}</td>
      </tr>`;
      return;
    }

    // Text / default — only show non-empty, non-redundant values
    if (val !== null && val !== undefined && String(val).trim() !== '') {
      const strVal = String(val);
      const numVal = parseFloat(strVal);
      const isNum = !isNaN(numVal);
      rows += `<tr>
        <td>${escHtml(label)}</td>
        <td style="text-align:right;">${isNum ? fmtMoney(numVal*100, currency) : escHtml(strVal)}</td>
      </tr>`;
    }
  });

  return { rows, hasFinalTotal };
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Main invoice HTML generator ────────────────────────────────────
export function generateInvoiceHTML(entry, contact, profile, settlements = []) {
  const amt = entry.amount;
  const settled = entry.settled_amount || 0;
  const remaining = amt - settled;
  const date = new Date(entry.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const company = profile?.company_name || profile?.display_name || 'Money IntX';
  const companyEmail = profile?.company_email || profile?.email || '';
  const companyPhone = profile?.company_phone || profile?.phone || '';
  const companyAddr = profile?.company_address || '';
  const logoUrl = profile?.logo_url || '';
  const currency = entry.currency || 'USD';

  // Build line items: template fields if available, else single note row
  const tdata = entry.template_data;
  const hasTemplateData = tdata && typeof tdata === 'object' && Object.keys(tdata).length > 0;
  const { rows: templateRows, hasFinalTotal } = hasTemplateData
    ? renderTemplateRows(entry, currency)
    : { rows: '', hasFinalTotal: false };

  // If template has fields, don't show the plain "note" row (avoid duplication)
  const showNoteRow = !hasTemplateData;

  // When the template itself contains a Final Total field (rendered inside templateRows),
  // suppress the bottom totals block — the template IS the total.
  // Only keep the "Balance Due" row if there are partial settlements.
  const suppressTotalsBlock = hasTemplateData && hasFinalTotal && settled === 0;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escHtml(entry.invoice_number || 'Record')} — ${escHtml(company)}</title><style>
    * { box-sizing: border-box; }
    body { font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #0f172a; margin: 0; padding: 40px; background:#fff; }
    .inv { max-width: 720px; margin: 0 auto; }
    .inv-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 36px; gap: 20px; }
    .inv-brand { display: flex; align-items: center; gap: 14px; }
    .inv-logo { width: 48px; height: 48px; object-fit: contain; border-radius: 10px; }
    .inv-title { font-size: 26px; font-weight: 900; color: #6c63ff; letter-spacing: -.02em; }
    .inv-subtitle { font-size: 13px; color: #64748b; margin-top: 3px; }
    .inv-meta { text-align: right; min-width: 160px; }
    .inv-meta p { margin: 2px 0; font-size: 13px; color: #64748b; }
    .inv-status { display: inline-block; padding: 3px 10px; border-radius: 5px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
    .inv-divider { border: none; border-top: 2px solid #e2e8f0; margin: 0 0 28px; }
    .inv-parties { display: flex; justify-content: space-between; gap: 40px; margin-bottom: 28px; }
    .inv-party h4 { font-size: 10px; text-transform: uppercase; color: #94a3b8; letter-spacing: .12em; margin: 0 0 8px; font-weight: 700; }
    .inv-party p { margin: 2px 0; font-size: 14px; color: #1e293b; }
    .inv-table { width: 100%; border-collapse: collapse; margin-bottom: 0; }
    .inv-table th { text-align: left; padding: 9px 12px; font-size: 10px; text-transform: uppercase; color: #94a3b8; border-bottom: 2px solid #e2e8f0; font-weight: 700; letter-spacing: .08em; }
    .inv-table td { padding: 11px 12px; border-bottom: 1px solid #f1f5f9; font-size: 14px; vertical-align: top; }
    .inv-table tr:last-child td { border-bottom: none; }
    .inv-totals { background: #f8fafc; border-radius: 0 0 10px 10px; padding: 16px 12px 12px; }
    .inv-totals .row { display: flex; justify-content: flex-end; gap: 48px; padding: 4px 0; font-size: 14px; color: #334155; }
    .inv-totals .row.total { font-size: 18px; font-weight: 900; color: #0f172a; border-top: 2px solid #0f172a; padding-top: 10px; margin-top: 6px; }
    .inv-settlements { margin-top: 28px; }
    .inv-settlements h4 { font-size: 13px; font-weight: 700; margin-bottom: 10px; color: #334155; }
    .settle-row { display: flex; justify-content: space-between; padding: 7px 0; border-bottom: 1px solid #f1f5f9; font-size: 13px; }
    .inv-note { margin-top: 24px; background: #fffbeb; border-left: 3px solid #f59e0b; padding: 10px 14px; border-radius: 0 8px 8px 0; font-size: 13px; color: #78350f; }
    .inv-footer { margin-top: 36px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; text-align: center; line-height: 1.8; }
    .inv-footer .logo-footer { display: flex; align-items: center; justify-content: center; gap: 6px; margin-bottom: 4px; }
    .inv-footer img { width: 20px; height: 20px; border-radius: 4px; }
    .print-btn { text-align: center; margin-top: 28px; }
    @media print {
      body { padding: 16px; }
      .no-print { display: none !important; }
      .inv { max-width: 100%; }
      @page { margin: 14mm 16mm; }
    }
  </style></head><body>
  <div class="inv">
    <div class="inv-header">
      <div class="inv-brand">
        ${logoUrl ? `<img class="inv-logo" src="${escHtml(logoUrl)}" alt="Logo">` : ''}
        <div>
          <div class="inv-title">${escHtml(entry.invoice_number || (entry.tx_type === 'invoice' ? 'INVOICE' : 'RECORD'))}</div>
          <div class="inv-subtitle">${entry.invoice_number ? 'Invoice' : 'Financial Record'}</div>
        </div>
      </div>
      <div class="inv-meta">
        <p><strong>${escHtml(company)}</strong></p>
        ${companyEmail ? `<p>${escHtml(companyEmail)}</p>` : ''}
        ${companyPhone ? `<p>${escHtml(companyPhone)}</p>` : ''}
        <p style="margin-top:6px;"><strong>Date:</strong> ${date}</p>
        <p><strong>Status:</strong> <span class="inv-status" style="background:${entry.status === 'settled' ? '#d1fae5' : entry.status === 'partially_settled' ? '#fef3c7' : '#dbeafe'};color:${entry.status === 'settled' ? '#065f46' : entry.status === 'partially_settled' ? '#92400e' : '#1e40af'};">${escHtml(entry.status || 'pending')}</span></p>
        ${entry.entry_number ? `<p><strong>Ref:</strong> ${escHtml(String(entry.entry_number))}</p>` : ''}
      </div>
    </div>
    <hr class="inv-divider">
    <div class="inv-parties">
      <div class="inv-party">
        <h4>From</h4>
        <p><strong>${escHtml(company)}</strong></p>
        ${companyEmail ? `<p>${escHtml(companyEmail)}</p>` : ''}
        ${companyPhone ? `<p>${escHtml(companyPhone)}</p>` : ''}
        ${companyAddr ? `<p style="white-space:pre-line;">${escHtml(companyAddr)}</p>` : ''}
      </div>
      <div class="inv-party" style="text-align:right;">
        <h4>To</h4>
        <p><strong>${escHtml(contact?.name || '—')}</strong></p>
        ${contact?.email ? `<p>${escHtml(contact.email)}</p>` : ''}
        ${contact?.phone ? `<p>${escHtml(contact.phone)}</p>` : ''}
        ${contact?.address ? `<p style="white-space:pre-line;">${escHtml(contact.address)}</p>` : ''}
      </div>
    </div>
    <table class="inv-table">
      <thead><tr><th>Description</th><th style="text-align:right;min-width:100px;">Amount</th></tr></thead>
      <tbody>
        ${showNoteRow ? `<tr>
          <td>${escHtml(entry.note || (entry.invoice_number ? 'Invoice services' : 'Financial record'))}</td>
          <td style="text-align:right;font-weight:700;">${fmtMoney(amt, currency)}</td>
        </tr>` : ''}
        ${templateRows}
      </tbody>
    </table>
    ${suppressTotalsBlock ? '' : `
    <div class="inv-totals">
      ${hasTemplateData ? '' : `<div class="row"><span>Subtotal</span><span>${fmtMoney(amt, currency)}</span></div>`}
      ${settled > 0 ? `<div class="row" style="color:#16a34a;"><span>Amount Settled</span><span>−${fmtMoney(settled, currency)}</span></div>` : ''}
      <div class="row total"><span>${settled > 0 ? 'Balance Due' : 'Total'}</span><span>${fmtMoney(remaining, currency)}</span></div>
    </div>`}

    ${entry.note && hasTemplateData ? `<div class="inv-note">📝 ${escHtml(entry.note)}</div>` : ''}

    ${settlements.length > 0 ? `
    <div class="inv-settlements">
      <h4>💳 Payment History</h4>
      ${settlements.map(s => `<div class="settle-row">
        <span>${fmtMoney(s.amount, currency)} ${s.method ? '· <em>' + escHtml(s.method) + '</em>' : ''} ${s.note ? '· ' + escHtml(s.note) : ''}</span>
        <span style="color:#64748b;">${new Date(s.created_at).toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'})}</span>
      </div>`).join('')}
    </div>` : ''}

    <div class="inv-footer">
      <div class="logo-footer">
        <img src="money.png" alt="Money IntX" onerror="this.style.display='none'" style="width:18px;height:18px;border-radius:4px;">
        <strong>Money IntX</strong>
        <span style="opacity:.7;">— Record · Manage · Grow</span>
      </div>
      ${companyEmail ? `<div>${escHtml(companyEmail)}</div>` : ''}
      <div style="margin-top:6px;color:#cbd5e1;">moneyinteractions.com &bull; Financial Tracking, Not a Bank or Payment Processor</div>
    </div>

    <div class="no-print print-btn">
      <button onclick="window.print()" style="padding:11px 28px;border-radius:10px;background:#6c63ff;color:#fff;font-weight:700;border:none;cursor:pointer;font-size:14px;">🖨 Print / Save PDF</button>
      <button onclick="window.close()" style="margin-left:10px;padding:11px 20px;border-radius:10px;background:#f1f5f9;color:#334155;font-weight:600;border:none;cursor:pointer;font-size:14px;">Close</button>
    </div>
  </div>
  </body></html>`;
}

export function openInvoiceWindow(html) {
  // Use a Blob URL — opens as a real navigable page in a new tab,
  // not a popup, so it bypasses mobile popup blockers entirely.
  try {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const tab = window.open(url, '_blank');
    if (tab) {
      // Revoke the blob URL after the tab has had time to load it
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return;
    }
    // If window.open returned null (aggressive blocker), try an anchor click
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    console.error('[openInvoiceWindow]', e);
    alert('Could not open the invoice. Please check your browser settings.');
  }
}
