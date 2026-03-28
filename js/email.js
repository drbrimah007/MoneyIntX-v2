// Money IntX v2 — Email Module
// Sends transactional emails via /api/send-email (Vercel serverless → Resend)
import { supabase } from './supabase.js';

const TX_LABELS = {
  // v2 categories
  owed_to_me:       'Owed to Me',
  i_owe:            'I Owe',
  invoice_sent:     'Invoice Sent',
  invoice_received: 'Invoice Received',
  bill_sent:        'Bill Sent',
  bill_received:    'Bill Received',
  advance_paid:     'Advance Sent',
  advance_received: 'Advance Received',
  payment_recorded: 'Payment Recorded',
  // legacy
  they_owe_you:  'They Owe You',
  you_owe_them:  'You Owe Them',
  they_paid_you: 'They Settled Up',
  you_paid_them: 'You Settled Up',
  invoice:       'Invoice',
  bill:          'Bill'
};

// ── Brand constants ────────────────────────────────────────────────────────────
const BRAND = {
  name: 'Money IntX',
  color: '#6366f1',       // indigo accent
  colorDark: '#4f46e5',
  bg: '#f8fafc',
  cardBg: '#ffffff',
  text: '#1e293b',
  muted: '#64748b',
  border: '#e2e8f0',
  logoUrl: 'https://v2.moneyinteractions.com/money.png',
  siteUrl: 'https://v2.moneyinteractions.com'
};

// ── Base email wrapper ─────────────────────────────────────────────────────────
function baseTemplate({ title, preheader, body }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <style>
    body { margin:0; padding:0; background:${BRAND.bg}; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; }
    .wrapper { max-width:580px; margin:32px auto; background:${BRAND.cardBg}; border-radius:12px; border:1px solid ${BRAND.border}; overflow:hidden; }
    .header { background:${BRAND.color}; padding:24px 32px; text-align:center; }
    .header img { height:40px; width:40px; border-radius:8px; vertical-align:middle; margin-right:10px; }
    .header span { color:#fff; font-size:20px; font-weight:700; vertical-align:middle; letter-spacing:-0.3px; }
    .body { padding:32px; color:${BRAND.text}; font-size:15px; line-height:1.6; }
    .body h2 { margin:0 0 16px; font-size:20px; font-weight:700; color:${BRAND.text}; }
    .amount-box { background:${BRAND.bg}; border:1px solid ${BRAND.border}; border-radius:10px; padding:18px 22px; margin:20px 0; }
    .amount-box .label { font-size:12px; color:${BRAND.muted}; text-transform:uppercase; letter-spacing:.5px; margin-bottom:4px; }
    .amount-box .value { font-size:28px; font-weight:800; color:${BRAND.colorDark}; }
    .detail-row { display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid ${BRAND.border}; font-size:14px; }
    .detail-row:last-child { border-bottom:none; }
    .detail-row .k { color:${BRAND.muted}; }
    .detail-row .v { font-weight:600; color:${BRAND.text}; }
    .message-box { background:#f0fdf4; border-left:4px solid #22c55e; border-radius:0 8px 8px 0; padding:12px 16px; margin:20px 0; font-size:14px; color:#166534; }
    .btn { display:inline-block; background:${BRAND.color}; color:#fff !important; text-decoration:none; padding:12px 28px; border-radius:8px; font-weight:700; font-size:15px; margin:20px 0; }
    .footer { padding:20px 32px; text-align:center; font-size:12px; color:${BRAND.muted}; border-top:1px solid ${BRAND.border}; background:${BRAND.bg}; }
    .footer a { color:${BRAND.color}; text-decoration:none; }
    .badge { display:inline-block; background:${BRAND.color}1a; color:${BRAND.colorDark}; border-radius:20px; padding:3px 12px; font-size:12px; font-weight:700; margin-bottom:12px; }
    @media(max-width:600px) { .wrapper { margin:0; border-radius:0; } .body { padding:20px; } }
  </style>
</head>
<body>
  <!-- preheader hidden text -->
  <span style="display:none;max-height:0;overflow:hidden;">${preheader}</span>

  <div class="wrapper">
    <div class="header">
      <img src="${BRAND.logoUrl}" alt="Money IntX Logo">
      <span>Money IntX</span>
    </div>
    <div class="body">
      ${body}
    </div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} Money IntX · Record · Manage · Grow</p>
      <p><a href="${BRAND.siteUrl}">Open App</a> · <a href="${BRAND.siteUrl}?page=settings">Manage Notifications</a></p>
      <p style="margin-top:8px;color:#94a3b8;font-size:11px;">This email was sent because you have an active record in Money IntX. It is not a payment request or financial instrument.</p>
    </div>
  </div>
</body>
</html>`;
}

// ── Store email record in log ──────────────────────────────────────────────────
export async function logEmail(userId, { type, recipient, subject, status = 'sent', error = '', entryId = null }) {
  await supabase.from('email_log').insert({
    user_id: userId, type, recipient, subject, status, error, entry_id: entryId
  });
}

// ── Send via /api/send-email serverless function ───────────────────────────────
async function callSendEmail({ to, subject, html, text }) {
  try {
    const res = await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject, html, text })
    });
    const data = await res.json();
    if (!data.ok) {
      console.error('[callSendEmail] Failed:', data.error || 'Unknown error');
    }
    return data;
  } catch (err) {
    console.error('[callSendEmail] Network/parse error:', err);
    return { ok: false, error: 'Network error: ' + err.message };
  }
}

// ── Notification / Reminder email ─────────────────────────────────────────────
export async function sendNotificationEmail(userId, {
  to, fromName, txType, amount, currency = 'USD', message, entryId,
  shareLink, isReminder = false
}) {
  const label   = TX_LABELS[txType] || txType;
  const prefix  = isReminder ? 'Reminder: ' : '';
  const subject = `${prefix}${fromName} sent you a record — ${label}`;

  const typeColor = {
    they_owe_you: '#6366f1', you_owe_them: '#f59e0b',
    they_paid_you: '#22c55e', you_paid_them: '#22c55e',
    invoice: '#6366f1', bill: '#f59e0b'
  }[txType] || BRAND.color;

  const badgeLabel = isReminder ? '⏰ Reminder' : '📬 New Record';

  const body = `
    <div class="badge">${badgeLabel}</div>
    <h2>${isReminder ? 'Friendly Reminder' : 'You have a new financial record'}</h2>
    <p>${fromName} ${isReminder ? 'is following up on a record' : 'has added a record'} with you on Money IntX.</p>

    <div class="amount-box">
      <div class="label">Amount</div>
      <div class="value" style="color:${typeColor};">${currency} ${amount}</div>
    </div>

    <div>
      <div class="detail-row"><span class="k">Record Type</span><span class="v">${label}</span></div>
      <div class="detail-row"><span class="k">From</span><span class="v">${fromName}</span></div>
      ${entryId ? `<div class="detail-row"><span class="k">Reference</span><span class="v">#${String(entryId).slice(-6).toUpperCase()}</span></div>` : ''}
    </div>

    ${message ? `<div class="message-box"><strong>Message:</strong> ${message}</div>` : ''}

    ${shareLink ? `<a class="btn" href="${shareLink}">View Record →</a>` : `<a class="btn" href="${BRAND.siteUrl}">Open Money IntX →</a>`}

    <p style="font-size:13px;color:${BRAND.muted};">If you were not expecting this, you can ignore this email. Money IntX does not hold or transfer money.</p>
  `;

  const html = baseTemplate({
    title: subject,
    preheader: `${fromName} shared a ${label} record of ${currency} ${amount} with you.`,
    body
  });

  const text = `${fromName} ${isReminder ? 'is following up on a record' : 'has a new record'} with you on Money IntX.\n\nType: ${label}\nAmount: ${currency} ${amount}${message ? '\nMessage: ' + message : ''}\n\nView at: ${BRAND.siteUrl}`;

  const result = await callSendEmail({ to, subject, html, text });
  const status = result.ok ? 'sent' : 'failed';

  await logEmail(userId, {
    type: isReminder ? 'reminder' : 'notification',
    recipient: to, subject, status,
    error: result.error || '',
    entryId
  });

  return { ok: result.ok, subject };
}

// ── Invoice email ──────────────────────────────────────────────────────────────
export async function sendInvoiceEmail(userId, {
  to, fromName, invoiceNumber, amount, currency = 'USD',
  companyName, companyEmail, companyAddress, logoUrl,
  dueDate, lineItems = [], message, entryId, shareLink
}) {
  const subject = `Invoice ${invoiceNumber} from ${companyName || fromName}`;

  const lineItemsHtml = lineItems.length
    ? `<div style="margin:16px 0;">
        <div style="font-size:12px;color:${BRAND.muted};text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">Items</div>
        ${lineItems.map(item => `
          <div class="detail-row">
            <span class="k">${item.description}</span>
            <span class="v">${currency} ${Number(item.amount).toLocaleString('en-US', {minimumFractionDigits:2})}</span>
          </div>`).join('')}
      </div>`
    : '';

  const senderLogoHtml = logoUrl
    ? `<img src="${logoUrl}" alt="${companyName || fromName}" style="max-height:48px;max-width:140px;border-radius:6px;margin-bottom:8px;">`
    : '';

  const body = `
    <div style="margin-bottom:16px;">
      ${senderLogoHtml}
      <div class="badge">🧾 Invoice</div>
    </div>
    <h2>Invoice from ${companyName || fromName}</h2>

    <div>
      <div class="detail-row"><span class="k">Invoice #</span><span class="v">${invoiceNumber}</span></div>
      <div class="detail-row"><span class="k">From</span><span class="v">${companyName || fromName}${companyEmail ? ` &lt;${companyEmail}&gt;` : ''}</span></div>
      ${companyAddress ? `<div class="detail-row"><span class="k">Address</span><span class="v">${companyAddress}</span></div>` : ''}
      ${dueDate ? `<div class="detail-row"><span class="k">Due Date</span><span class="v">${dueDate}</span></div>` : ''}
    </div>

    ${lineItemsHtml}

    <div class="amount-box">
      <div class="label">Total Amount Due</div>
      <div class="value">${currency} ${Number(amount).toLocaleString('en-US', {minimumFractionDigits:2})}</div>
    </div>

    ${message ? `<div class="message-box"><strong>Note:</strong> ${message}</div>` : ''}

    ${shareLink ? `<a class="btn" href="${shareLink}">View Invoice →</a>` : `<a class="btn" href="${BRAND.siteUrl}">Open Money IntX →</a>`}

    <p style="font-size:12px;color:${BRAND.muted};margin-top:20px;">This is a record-keeping notification. Money IntX does not process payments or hold funds.</p>
  `;

  const html = baseTemplate({
    title: subject,
    preheader: `Invoice ${invoiceNumber} for ${currency} ${amount} from ${companyName || fromName}.`,
    body
  });

  const text = `Invoice ${invoiceNumber} from ${companyName || fromName}\n\nAmount: ${currency} ${Number(amount).toLocaleString('en-US', {minimumFractionDigits:2})}${dueDate ? '\nDue: ' + dueDate : ''}${message ? '\nNote: ' + message : ''}\n\nView at: ${BRAND.siteUrl}`;

  const result = await callSendEmail({ to, subject, html, text });
  const status = result.ok ? 'sent' : 'failed';

  await logEmail(userId, {
    type: 'invoice', recipient: to, subject, status, error: result.error || '', entryId
  });

  return { ok: result.ok, subject };
}

// ── OTP / Locker access email ──────────────────────────────────────────────────
export async function sendOtpEmail(userId, { to, otp, lockerName }) {
  const subject = `Your Money IntX access code: ${otp}`;

  const body = `
    <h2>Locker Access Code</h2>
    <p>You requested access to <strong>${lockerName || 'a protected locker'}</strong>.</p>
    <p>Your one-time verification code is:</p>

    <div class="amount-box" style="text-align:center;">
      <div class="label">One-Time Code</div>
      <div class="value" style="font-size:40px;letter-spacing:8px;">${otp}</div>
      <div style="font-size:12px;color:${BRAND.muted};margin-top:6px;">Expires in 10 minutes</div>
    </div>

    <p style="font-size:13px;color:${BRAND.muted};">If you did not request this code, please ignore this email. Never share this code with anyone.</p>
  `;

  const html = baseTemplate({
    title: subject,
    preheader: `Your Money IntX locker access code is ${otp}. Expires in 10 minutes.`,
    body
  });

  const result = await callSendEmail({ to, subject, html });
  const status = result.ok ? 'sent' : 'failed';

  await logEmail(userId, {
    type: 'otp', recipient: to, subject, status, error: result.error || ''
  });

  return { ok: result.ok, subject };
}

// ── Group / Investment invite email ───────────────────────────────────────────
export async function sendInviteEmail(userId, {
  to, fromName, groupName, inviteType = 'group', inviteLink
}) {
  const typeLabel = inviteType === 'investment' ? 'investment group' : 'savings group';
  const subject   = `${fromName} invited you to join ${groupName}`;

  const body = `
    <div class="badge">🤝 Invitation</div>
    <h2>You're invited!</h2>
    <p><strong>${fromName}</strong> has invited you to join the ${typeLabel} <strong>${groupName}</strong> on Money IntX.</p>

    <div class="amount-box">
      <div class="label">${inviteType === 'investment' ? 'Investment' : 'Savings'} Group</div>
      <div class="value" style="font-size:22px;">${groupName}</div>
    </div>

    ${inviteLink ? `<a class="btn" href="${inviteLink}">Accept Invitation →</a>` : `<a class="btn" href="${BRAND.siteUrl}">View in App →</a>`}

    <p style="font-size:13px;color:${BRAND.muted};">Money IntX is a financial record-keeping app. It does not hold or transfer money.</p>
  `;

  const html = baseTemplate({
    title: subject,
    preheader: `${fromName} invited you to join ${groupName} on Money IntX.`,
    body
  });

  const result = await callSendEmail({ to, subject, html });
  const status = result.ok ? 'sent' : 'failed';

  await logEmail(userId, {
    type: 'invite', recipient: to, subject, status, error: result.error || ''
  });

  return { ok: result.ok, subject };
}
