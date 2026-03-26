// Money IntX v2 — Invoice Generation Module
import { supabase } from './supabase.js';
import { fmtMoney } from './entries.js';

export function generateInvoiceHTML(entry, contact, profile, settlements = []) {
  const amt = entry.amount;
  const settled = entry.settled_amount || 0;
  const remaining = amt - settled;
  const date = new Date(entry.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const company = profile?.company_name || profile?.display_name || 'Money IntX';
  const companyEmail = profile?.company_email || profile?.email || '';
  const companyPhone = profile?.company_phone || profile?.phone || '';
  const companyAddr = profile?.company_address || '';

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    body { font-family: Inter, -apple-system, sans-serif; color: #0f172a; margin: 0; padding: 40px; }
    .inv { max-width: 700px; margin: 0 auto; }
    .inv-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; }
    .inv-title { font-size: 28px; font-weight: 800; color: #6c63ff; }
    .inv-meta { text-align: right; }
    .inv-meta p { margin: 2px 0; font-size: 13px; color: #64748b; }
    .inv-parties { display: flex; justify-content: space-between; gap: 40px; margin-bottom: 32px; }
    .inv-party h4 { font-size: 11px; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.1em; margin-bottom: 8px; }
    .inv-party p { margin: 2px 0; font-size: 14px; }
    .inv-table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    .inv-table th { text-align: left; padding: 10px 12px; font-size: 11px; text-transform: uppercase; color: #94a3b8; border-bottom: 2px solid #e2e8f0; }
    .inv-table td { padding: 12px; border-bottom: 1px solid #e2e8f0; font-size: 14px; }
    .inv-totals { text-align: right; }
    .inv-totals .row { display: flex; justify-content: flex-end; gap: 40px; padding: 6px 0; font-size: 14px; }
    .inv-totals .total { font-size: 20px; font-weight: 800; color: #0f172a; border-top: 2px solid #0f172a; padding-top: 8px; margin-top: 8px; }
    .inv-footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8; text-align: center; }
    .inv-status { display: inline-block; padding: 4px 12px; border-radius: 6px; font-size: 12px; font-weight: 700; text-transform: uppercase; }
    @media print { body { padding: 20px; } .no-print { display: none; } }
  </style></head><body>
  <div class="inv">
    <div class="inv-header">
      <div>
        <div class="inv-title">${entry.invoice_number || 'RECORD'}</div>
        <p style="color:#64748b;font-size:14px;margin-top:4px;">${entry.invoice_number ? 'Invoice' : 'Financial Record'}</p>
      </div>
      <div class="inv-meta">
        <p><strong>Date:</strong> ${date}</p>
        <p><strong>Status:</strong> <span class="inv-status" style="background:${entry.status === 'settled' ? '#d1fae5' : entry.status === 'partially_settled' ? '#fef3c7' : '#dbeafe'};color:${entry.status === 'settled' ? '#065f46' : entry.status === 'partially_settled' ? '#92400e' : '#1e40af'};">${entry.status}</span></p>
        ${entry.entry_number ? `<p><strong>Entry #:</strong> ${entry.entry_number}</p>` : ''}
      </div>
    </div>
    <div class="inv-parties">
      <div class="inv-party">
        <h4>From</h4>
        <p><strong>${company}</strong></p>
        ${companyEmail ? `<p>${companyEmail}</p>` : ''}
        ${companyPhone ? `<p>${companyPhone}</p>` : ''}
        ${companyAddr ? `<p>${companyAddr}</p>` : ''}
      </div>
      <div class="inv-party">
        <h4>To</h4>
        <p><strong>${contact?.name || '—'}</strong></p>
        ${contact?.email ? `<p>${contact.email}</p>` : ''}
        ${contact?.phone ? `<p>${contact.phone}</p>` : ''}
        ${contact?.address ? `<p>${contact.address}</p>` : ''}
      </div>
    </div>
    <table class="inv-table">
      <thead><tr><th>Description</th><th style="text-align:right;">Amount</th></tr></thead>
      <tbody>
        <tr>
          <td>${entry.note || (entry.invoice_number ? 'Invoice' : 'Financial record')}</td>
          <td style="text-align:right;font-weight:700;">${fmtMoney(amt, entry.currency)}</td>
        </tr>
      </tbody>
    </table>
    <div class="inv-totals">
      <div class="row"><span>Subtotal</span><span>${fmtMoney(amt, entry.currency)}</span></div>
      ${settled > 0 ? `<div class="row" style="color:#16a34a;"><span>Settled</span><span>-${fmtMoney(settled, entry.currency)}</span></div>` : ''}
      <div class="row total"><span>${settled > 0 ? 'Balance Due' : 'Total'}</span><span>${fmtMoney(remaining, entry.currency)}</span></div>
    </div>
    ${settlements.length > 0 ? `
      <div style="margin-top:24px;">
        <h4 style="font-size:14px;font-weight:700;margin-bottom:12px;">Payment History</h4>
        ${settlements.map(s => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px;">
          <span>${fmtMoney(s.amount, entry.currency)} ${s.method ? '· ' + s.method : ''}</span>
          <span style="color:#64748b;">${new Date(s.created_at).toLocaleDateString()}</span>
        </div>`).join('')}
      </div>
    ` : ''}
    <div class="inv-footer">
      <p>${company} &bull; ${companyEmail}</p>
      <p style="margin-top:4px;">Generated by Money IntX</p>
    </div>
    <div class="no-print" style="text-align:center;margin-top:24px;">
      <button onclick="window.print()" style="padding:10px 24px;border-radius:10px;background:#6c63ff;color:#fff;font-weight:600;border:none;cursor:pointer;font-size:14px;">Print / Save PDF</button>
    </div>
  </div>
  </body></html>`;
}

export function openInvoiceWindow(html) {
  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
}
