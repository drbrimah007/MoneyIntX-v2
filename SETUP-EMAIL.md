# Custom Email Setup (Send from your domain, not Supabase)

## Why emails come from Supabase
By default Supabase sends auth emails (confirm, reset password) from `no-reply@mail.app.supabase.io`.
To send from your own domain (e.g. `hello@moneyintx.com`) you need to configure a custom SMTP provider.

---

## Step 1 — Choose an email provider

Free options that work great:
- **Resend** (https://resend.com) — 100 emails/day free, easy setup ✅ Recommended
- **Brevo** (https://brevo.com) — 300 emails/day free
- **SendGrid** (https://sendgrid.com) — 100 emails/day free
- **Mailgun** — 1,000 emails/month free

---

## Step 2 — Get your SMTP credentials

### Using Resend (recommended):
1. Go to https://resend.com → Sign up
2. Add your domain (e.g. `moneyintx.com`) and verify DNS records
3. Go to **API Keys** → Create API key → copy it
4. SMTP settings:
   - Host: `smtp.resend.com`
   - Port: `465`
   - Username: `resend`
   - Password: `your-api-key`
   - From: `noreply@yourdomain.com`

---

## Step 3 — Configure Supabase SMTP

1. Go to your Supabase project: https://supabase.com/dashboard
2. Click **Authentication** in the left sidebar
3. Click **Settings** tab (or **Email** under configuration)
4. Scroll to **SMTP Settings** → Enable custom SMTP
5. Fill in:
   - **Sender name**: `Money IntX`
   - **Sender email**: `noreply@yourdomain.com`
   - **Host**: `smtp.resend.com`
   - **Port**: `465`
   - **Username**: `resend`
   - **Password**: `your-resend-api-key`
6. Click **Save**
7. Click **Test connection** to verify

---

## Step 4 — Update Email Templates (optional)

Still in Supabase → Authentication → **Email Templates**:

- **Confirm signup** — customize the welcome email
- **Reset password** — customize the reset email
- **Magic link** — not used by Money IntX

The `{{ .ConfirmationURL }}` variable will automatically include the redirect back to your app.

---

## Step 5 — Verify

1. Go to your app → click **Forgot password**
2. Enter your email → you should receive an email from your domain within seconds
3. Click the link → you'll be taken to the reset password box on your app

---

## Troubleshooting

- **Email not arriving**: Check spam folder, verify DNS records are correct
- **Invalid credentials**: Double-check SMTP password (it's your API key, not account password)
- **Link doesn't work**: Make sure your app URL matches the `redirectTo` in the code (currently `window.location.origin + '#reset'`)

---

## Current redirect URL in code

Located in `index.html` → `doSendResetEmail()`:
```js
redirectTo: window.location.origin + window.location.pathname + '#reset'
```

This means the reset link will redirect to whatever URL your app is hosted at.
If hosting at `https://moneyintx.com/app/`, the redirect becomes `https://moneyintx.com/app/#reset`.

Make sure this matches what you've whitelisted in Supabase → Authentication → **URL Configuration → Redirect URLs**.
