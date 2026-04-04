// Money IntX v2 — Sharing Module
import { supabase } from './supabase.js';
import { toCents } from './entries.js';
import { getCurrentProfile } from './pages/state.js';

// ── Create share token ────────────────────────────────────────────
export async function createShareToken(senderId, entryId, { recipientEmail = '', recipientId = null, entrySnapshot = {}, targetBusinessId = null } = {}) {
  const insert = {
    sender_id: senderId,
    entry_id: entryId,
    recipient_email: recipientEmail,
    recipient_id: recipientId || null,
    entry_snapshot: entrySnapshot,
    status: recipientId ? 'sent' : 'created'   // auto-sent if recipient known
  };
  // If sender explicitly targets a recipient's business, store it
  if (targetBusinessId) insert.target_business_id = targetBusinessId;
  const { data, error } = await supabase
    .from('share_tokens')
    .insert(insert)
    .select()
    .single();
  if (error) console.error('[createShareToken]', error.message);
  return data;
}

// ── Get share token by token string ───────────────────────────────
export async function getShareByToken(token) {
  const { data, error } = await supabase
    .from('share_tokens')
    .select('*, entry:entries(*, contact:contacts(id, name, email))')
    .eq('token', token)
    .single();
  if (error) console.error('[getShareByToken]', error.message);
  return data;
}

// ── List shares I sent ────────────────────────────────────────────
export async function listSentShares(senderId) {
  const { data, error } = await supabase
    .from('share_tokens')
    .select('*, entry:entries(id, amount, currency, tx_type, status, date, contact:contacts(id, name))')
    .eq('sender_id', senderId)
    .order('created_at', { ascending: false });
  if (error) console.error('[listSentShares]', error.message);
  return data || [];
}

// ── List shares sent to me ────────────────────────────────────────
export async function listReceivedShares(recipientId) {
  const { data, error } = await supabase
    .from('share_tokens')
    .select('*, entry:entries(id, amount, currency, tx_type, status, date)')
    .eq('recipient_id', recipientId)
    .neq('status', 'expired')
    .neq('status', 'dismissed')
    .order('created_at', { ascending: false });
  if (error) console.error('[listReceivedShares]', error.message);
  return data || [];
}

// ── Update share status ───────────────────────────────────────────
export async function updateShareStatus(tokenId, status) {
  const updates = { status };
  if (status === 'viewed') updates.viewed_at = new Date().toISOString();
  if (status === 'confirmed') updates.confirmed_at = new Date().toISOString();
  const { data, error } = await supabase
    .from('share_tokens')
    .update(updates)
    .eq('id', tokenId)
    .select()
    .single();
  if (error) console.error('[updateShareStatus]', error.message);
  return data;
}

// ── Link share to recipient user ──────────────────────────────────
export async function linkShareToUser(tokenId, recipientId) {
  const { data, error } = await supabase
    .from('share_tokens')
    .update({ recipient_id: recipientId })
    .eq('id', tokenId)
    .select()
    .single();
  if (error) console.error('[linkShareToUser]', error.message);
  return data;
}

// ── Confirm shared record (recipient accepts) ─────────────────────
export async function confirmShare(tokenId, recipientId) {
  // Update token status
  await updateShareStatus(tokenId, 'confirmed');
  await linkShareToUser(tokenId, recipientId);

  // Get the share token with full entry + snapshot + sender profile
  const { data: token } = await supabase
    .from('share_tokens')
    .select('*, entry:entries(id, amount, currency, tx_type, category, context_type, business_id, date, note, invoice_number, user_id, settled_amount, contact_id)')
    .eq('id', tokenId)
    .single();
  if (!token?.entry) return null;

  // ── Recipient context ──
  // Default: personal. But if sender explicitly targeted a business_id, use it.
  // This is NOT guessing — the sender intentionally chose the business target.
  let rCtx = { context_type: 'personal', context_id: recipientId, business_id: null };
  if (token.target_business_id) {
    rCtx = {
      context_type: 'business',
      context_id:   token.target_business_id,
      business_id:  token.target_business_id
    };
  }

  // Resolve sender display name + email from snapshot or sender profile
  const snap = token.entry_snapshot || {};
  const fromName = snap.from_name || '';
  const fromEmail = snap.from_email || token.recipient_email || '';

  // Flip tx_type for recipient perspective
  const FLIP = {
    'they_owe_you':    'you_owe_them',
    'you_owe_them':    'they_owe_you',
    'they_paid_you':   'you_paid_them',
    'you_paid_them':   'they_paid_you',
    'owed_to_me':      'i_owe',
    'i_owe':           'owed_to_me',
    'invoice_sent':    'invoice_received',
    'invoice_received':'invoice_sent',
    'bill_sent':       'bill_received',
    'bill_received':   'bill_sent',
    'invoice':         'invoice_received',   // legacy: sender created 'invoice' → recipient sees 'invoice_received'
    'bill':            'bill_received',      // legacy: sender created 'bill'    → recipient sees 'bill_received'
    'advance_paid':    'advance_received',
    'advance_received':'advance_paid'
  };
  // Also flip the v2 category (preferred) for display purposes
  const CATEGORY_FLIP = {
    'owed_to_me':      'i_owe',
    'i_owe':           'owed_to_me',
    'invoice_sent':    'invoice_received',
    'invoice_received':'invoice_sent',
    'bill_sent':       'bill_received',
    'bill_received':   'bill_sent',
    'advance_paid':    'advance_received',
    'advance_received':'advance_paid'
  };
  const senderCategory = token.entry.category || token.entry.tx_type;
  const flippedCategory = CATEGORY_FLIP[senderCategory] || FLIP[senderCategory] || senderCategory;
  const flippedType = FLIP[token.entry.tx_type] || token.entry.tx_type;

  // Find or AUTO-CREATE contact for sender in recipient's contact list
  let contactId = null;
  if (token.sender_id) {
    // First try: contact whose linked_user_id matches the sender
    const { data: linkedContact } = await supabase
      .from('contacts')
      .select('id')
      .eq('user_id', recipientId)
      .eq('linked_user_id', token.sender_id)
      .maybeSingle();
    if (linkedContact) {
      contactId = linkedContact.id;
    } else if (fromEmail) {
      // Fallback: match by email
      const { data: emailContact } = await supabase
        .from('contacts')
        .select('id')
        .eq('user_id', recipientId)
        .eq('email', fromEmail)
        .maybeSingle();
      if (emailContact) contactId = emailContact.id;
    }

    // AUTO-CREATE: if no contact found, create one linked to the sender
    if (!contactId) {
      const contactName = fromName || snap.from_name || 'Unknown';
      const contactEmail = fromEmail || '';
      const contactInsert = {
        user_id:        recipientId,
        name:           contactName,
        email:          contactEmail,
        linked_user_id: token.sender_id,
        tags:           ['shared']
      };
      // If delivering to a business context, assign business_id (sole authority for BS membership)
      if (rCtx.context_type === 'business' && rCtx.business_id) {
        contactInsert.business_id = rCtx.business_id;
      }
      const { data: newContact, error: cErr } = await supabase
        .from('contacts')
        .insert(contactInsert)
        .select('id')
        .single();
      if (newContact) {
        contactId = newContact.id;
        console.log('[confirmShare] Auto-created contact:', contactName, contactId);
      } else if (cErr) {
        console.error('[confirmShare] Failed to auto-create contact:', cErr.message);
      }
    }
  }

  // ── CHECK: Does a mirror already exist? (auto-mirror trigger may have created one) ──
  let newEntry = null;
  const { data: existingMirror } = await supabase
    .from('entries')
    .select('*')
    .eq('user_id', recipientId)
    .eq('linked_entry_id', token.entry_id)
    .maybeSingle();

  if (existingMirror) {
    // Mirror already exists (auto-mirror trigger beat us) — reuse it
    newEntry = existingMirror;
    console.log('[confirmShare] Mirror already exists, reusing:', existingMirror.id);
    // Update contact_id if it was auto-created with a different one
    if (contactId && existingMirror.contact_id !== contactId) {
      await supabase.from('entries').update({ contact_id: contactId }).eq('id', existingMirror.id);
    }
  } else {
    // No mirror exists — create one
    let entryNumber = null;
    try {
      const { data: counterData } = await supabase.rpc('increment_entry_counter', { p_user_id: recipientId });
      if (counterData) entryNumber = counterData;
    } catch (_) { /* RPC not deployed yet — entry_number stays null */ }

    const { data: created, error } = await supabase
      .from('entries')
      .insert({
        user_id:          recipientId,
        contact_id:       contactId,
        tx_type:          flippedType,
        category:         flippedCategory,
        sender_tx_type:   token.entry.tx_type,
        amount:           token.entry.amount,
        currency:         token.entry.currency,
        date:             token.entry.date,
        note:             token.entry.note || '',
        invoice_number:   token.entry.invoice_number || '',
        entry_number:     entryNumber,
        is_shared:        true,
        share_token:      token.token,
        from_name:        fromName,
        from_email:       fromEmail,
        linked_entry_id:  token.entry_id,     // ← set at insert time so trigger skips
        source:           'share_accept',     // ← trigger MUST skip for this source
        status:           'posted',
        settled_amount:   0,
        context_type:     rCtx.context_type,                          // business or personal
        context_id:       rCtx.context_id || recipientId,             // business_id or user_id
        business_id:      rCtx.business_id || null,                   // set if business context
        sender_context:   token.entry.context_type || 'personal'      // sender's original context
      })
      .select()
      .single();
    if (error) console.error('[confirmShare]', error.message);
    newEntry = created;
  }

  // Update share token with confirmed_entry_id for audit trail
  if (newEntry) {
    await supabase.from('share_tokens')
      .update({ confirmed_entry_id: newEntry.id })
      .eq('id', tokenId)
      .catch(() => {});
  }

  // Bidirectionally link both entries via SECURITY DEFINER RPC (bypasses RLS)
  if (newEntry && token.entry_id) {
    await supabase.rpc('link_mirror_entries', {
      p_entry_id: token.entry_id,
      p_linked_entry_id: newEntry.id
    }).catch(err => console.error('[confirmShare] link_mirror_entries failed:', err.message));
  }

  // Link the sender's contact to the recipient's user account
  // This is critical for name-only contacts (no email) — without this,
  // future payments/settlements won't sync to the linked user
  if (token.sender_id && token.entry?.contact_id) {
    await supabase.from('contacts')
      .update({ linked_user_id: recipientId })
      .eq('id', token.entry.contact_id)
      .eq('user_id', token.sender_id)  // safety: only update sender's own contact
      .catch(() => {});

    // Sync the linked user's email/name back to the sender's contact record
    await supabase.rpc('sync_contact_from_linked_user', {
      p_contact_id: token.entry.contact_id
    }).catch(() => {});
  }

  // Notify the sender that the share was confirmed
  if (newEntry && token.sender_id) {
    // Get recipient name — use current profile (the recipient IS the logged-in user)
    // Fallback: query users table (may fail due to RLS), then use 'Someone'
    let recipientName = '';
    try {
      const profile = getCurrentProfile();
      recipientName = profile?.display_name || profile?.full_name || '';
    } catch(_) {}
    if (!recipientName) {
      try {
        const { data: rUser } = await supabase.from('users').select('display_name').eq('id', recipientId).single();
        recipientName = rUser?.display_name || '';
      } catch(_) {}
    }
    recipientName = recipientName || 'Someone';
    const amtFmt = token.entry.currency + ' ' + ((token.entry.amount || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });
    await supabase.from('notifications').insert({
      user_id:      token.sender_id,
      type:         'confirmed',
      contact_name: recipientName,
      contact_id:   contactId || null,
      message:      `Your shared record was confirmed by ${recipientName} — ${amtFmt}`,
      entry_id:     token.entry_id,
      amount:       token.entry.amount,
      currency:     token.entry.currency,
      read:         false
    }).catch(() => {});
  }

  return newEntry;
}

// ── Dismiss share ─────────────────────────────────────────────────
export async function dismissShare(tokenId) {
  return updateShareStatus(tokenId, 'dismissed');
}

// ── Expire share ──────────────────────────────────────────────────
export async function expireShare(tokenId) {
  return updateShareStatus(tokenId, 'expired');
}

// ── Generate share URL ────────────────────────────────────────────
export function getShareUrl(token) {
  return window.location.origin + '/view?t=' + token;
}
