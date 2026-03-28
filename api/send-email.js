// api/send-email.js — Vercel Serverless Function
// Calls Resend API server-side to send transactional emails

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { to, subject, html, text, from: fromOverride } = req.body;

  if (!to || !subject || (!html && !text)) {
    return res.status(400).json({ ok: false, error: 'Missing required fields: to, subject, html or text' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  // Allow caller to supply a branded from address (e.g. "Acme <hello@moneyinteractions.com>")
  // Fallback to the verified domain sender. Strip anything suspicious (must contain @moneyinteractions.com or @moneyintx.com).
  const ALLOWED_DOMAINS = ['moneyinteractions.com', 'moneyintx.com'];
  const safeFrom = (fromOverride && ALLOWED_DOMAINS.some(d => fromOverride.includes(d)))
    ? fromOverride
    : 'Money IntX <hello@moneyinteractions.com>';

  if (!apiKey) {
    console.error('[send-email] RESEND_API_KEY is not set in environment variables');
    return res.status(500).json({ ok: false, error: 'RESEND_API_KEY not configured. Set it in Vercel → Project Settings → Environment Variables.' });
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: safeFrom,
        to: Array.isArray(to) ? to : [to],
        subject,
        html: html || `<p>${text}</p>`,
        text: text || ''
      })
    });

    const data = await response.json();

    if (!response.ok) {
      const errMsg = data?.message || data?.name || JSON.stringify(data);
      console.error('[send-email] Resend API error:', response.status, errMsg);
      return res.status(200).json({ ok: false, error: `Resend: ${errMsg}` });
    }

    console.log('[send-email] Sent OK, id:', data.id, '→', to);
    return res.status(200).json({ ok: true, id: data.id });
  } catch (err) {
    console.error('[send-email] Exception:', err);
    return res.status(200).json({ ok: false, error: err.message || 'Internal server error' });
  }
}
