// Money IntX v2 — Sharing Module
import { supabase } from './supabase.js';
import { toCents } from './entries.js';

// ── Create share token ────────────────────────────────────────────
export async function createShareToken(senderId, entryId, { recipientEmail = '', entrySnapshot = {} } = {}) {
  const { data, error } = await supabase
    .from('share_tokens')
    .insert({
      sender_id: senderId,
      entry_id: entryId,
      recipient_email: recipientEmail,
      entry_snapshot: entrySnapshot,
      status: 'created'
    })
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
    .select('*, entry:entries(id, amount, currency, tx_type, date, note, invoice_number, user_id, settled_amount)')
    .eq('id', tokenId)
    .single();
  if (!token?.entry) return null;

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
    'invoice':         'bill',
    'bill':            'invoice'
  };
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
      const { data: newContact, error: cErr } = await supabase
        .from('contacts')
        .insert({
          user_id:        recipientId,
          name:           contactName,
          email:          contactEmail,
          linked_user_id: token.sender_id,
          tags:           ['shared']
        })
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

  // Get next entry_number for recipient
  let entryNumber = null;
  try {
    const { data: counterData } = await supabase.rpc('increment_entry_counter', { p_user_id: recipientId });
    if (counterData) entryNumber = counterData;
  } catch (_) { /* RPC not deployed yet — entry_number stays null */ }

  // Create entry in recipient's records
  const { data: newEntry, error } = await supabase
    .from('entries')
    .insert({
      user_id:          recipientId,
      contact_id:       contactId,           // ← linked to sender contact if found
      tx_type:          flippedType,
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
      linked_entry_id:  token.entry_id,     // ← link back to original entry
      status:           'posted',
      settled_amount:   0
    })
    .select()
    .single();
  if (error) console.error('[confirmShare]', error.message);

  // Also link the original entry back to this new entry
  if (newEntry && token.entry_id) {
    await supabase.from('entries').update({ linked_entry_id: newEntry.id })
      .eq('id', token.entry_id).catch(() => {});
  }

  // Notify the sender that the share was confirmed
  if (newEntry && token.sender_id) {
    await supabase.from('notifications').insert({
      user_id:      token.sender_id,
      type:         'shared_record',
      message:      `Your shared record was confirmed by the recipient.`,
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
