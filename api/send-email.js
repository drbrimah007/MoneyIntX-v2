// api/send-email.js — Vercel Serverless Function
// Calls Resend API server-side to send transactional emails

export default async function handler(req, res) {
    if (req.method !== 'POST') {
          return res.status(405).json({ error: 'Method not allowed' });
    }

  const { to, subject, html, text } = req.body;

  if (!to || !subject || (!html && !text)) {
        return res.status(400).json({ error: 'Missing required fields: to, subject, html or text' });
  }

  const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM || 'Money IntX <noreply@moneyintx.com>';

  if (!apiKey) {
        console.error('RESEND_API_KEY not set');
        return res.status(500).json({ error: 'Email service not configured' });
  }

  try {
        const response = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                          'Authorization': `Bearer ${apiKey}`,
                          'Content-Type': 'application/json'
                },
                body: JSON.stringify({ from, to, subject, html: html || `<p>${text}</p>`, text })
        });

      const data = await response.json();

      if (!response.ok) {
              console.error('Resend error:', data);
              return res.status(response.status).json({ error: data.message || 'Failed to send email' });
      }

      return res.status(200).json({ ok: true, id: data.id });
  } catch (err) {
        console.error('Send email error:', err);
        return res.status(500).json({ error: 'Internal server error' });
  }
}
