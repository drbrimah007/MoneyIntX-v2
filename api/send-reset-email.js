// api/send-reset-email.js — Vercel Serverless Function
// Sends a password-reset email from Money IntX <hello@moneyintx.com> via Resend.
// Generates the actual Supabase recovery link server-side (using service role key)
// so the email arrives from our domain instead of Supabase's default no-reply address.

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { email } = req.body || {};
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ ok: false, error: 'Email is required' });
  }

  const supabaseUrl     = process.env.SUPABASE_URL || 'https://nczneamvffmzdbeuvloo.supabase.co';
  const serviceRoleKey  = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendApiKey    = process.env.RESEND_API_KEY;
  const siteUrl         = 'https://moneyinteractions.com';

  if (!serviceRoleKey) {
    console.error('[send-reset-email] Missing SUPABASE_SERVICE_KEY');
    // Fall through — we'll try generating the link; fail gracefully
    return res.status(500).json({ ok: false, error: 'Server misconfiguration — contact support.' });
  }
  if (!resendApiKey) {
    console.error('[send-reset-email] Missing RESEND_API_KEY');
    return res.status(500).json({ ok: false, error: 'Server misconfiguration — contact support.' });
  }

  try {
    // 1. Generate the recovery link via Supabase Admin API
    const genRes = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'apikey':         serviceRoleKey,
        'Content-Type':   'application/json'
      },
      body: JSON.stringify({
        type:    'recovery',
        email:   email.trim().toLowerCase(),
        options: { redirectTo: siteUrl + '/' }
      })
    });

    const genData = await genRes.json();

    if (!genRes.ok || !genData.action_link) {
      // Don't reveal whether the email exists (prevents account enumeration).
      console.warn('[send-reset-email] generateLink result:', genRes.status, genData);
      // Return success to the client either way — user always sees "check your inbox"
      return res.status(200).json({ ok: true });
    }

    const resetLink = genData.action_link;

    // 2. Send via Resend
    const emailRes = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type':  'application/json'
      },
      body: JSON.stringify({
        from:    'Money IntX <hello@moneyintx.com>',
        to:      [email.trim().toLowerCase()],
        subject: 'Reset your Money IntX password',
        html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#07111f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#07111f;padding:40px 0;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#0d1b2e;border-radius:16px;padding:36px 32px;max-width:480px;width:100%;">
        <tr><td align="center" style="padding-bottom:24px;">
          <div style="font-size:38px;margin-bottom:8px;">🔐</div>
          <h1 style="margin:0 0 6px;font-size:22px;font-weight:800;color:#eef4ff;">Reset Your Password</h1>
          <p style="margin:0;font-size:14px;color:#8892a4;">We received a request to reset the password for your Money IntX account.</p>
        </td></tr>
        <tr><td style="padding:0 0 20px;">
          <a href="${resetLink}" style="display:block;text-align:center;background:linear-gradient(135deg,#6c63ff,#5a52e0);color:#ffffff;padding:15px 28px;border-radius:12px;font-weight:700;font-size:15px;text-decoration:none;">
            Reset My Password →
          </a>
        </td></tr>
        <tr><td style="border-top:1px solid #1e2d42;padding-top:20px;">
          <p style="margin:0 0 8px;font-size:12px;color:#5a6478;text-align:center;">This link expires in 1 hour.</p>
          <p style="margin:0;font-size:12px;color:#5a6478;text-align:center;">If you didn't request a password reset, you can safely ignore this email — your account is not at risk.</p>
        </td></tr>
        <tr><td align="center" style="padding-top:24px;">
          <p style="margin:0;font-size:11px;color:#3d4d63;">Money IntX — Financial Record Keeping</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
        `.trim()
      })
    });

    const emailData = await emailRes.json();
    if (!emailRes.ok) {
      const errMsg = emailData?.message || emailData?.name || JSON.stringify(emailData);
      console.error('[send-reset-email] Resend error:', emailRes.status, errMsg);
      return res.status(200).json({ ok: false, error: `Failed to send email: ${errMsg}` });
    }

    console.log('[send-reset-email] Sent to:', email, '— Resend id:', emailData.id);
    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('[send-reset-email] Exception:', err);
    return res.status(200).json({ ok: false, error: err.message || 'Internal server error' });
  }
}
