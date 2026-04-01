// Money IntX v2 — Recurring Rules Module
import { supabase } from './supabase.js';
import { toCents, createEntry } from './entries.js';

export async function listRecurring(businessId) {
  const { data, error } = await supabase
    .from('recurring_rules')
    .select('*, contact:contacts(id, name), template:templates(id, name)')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false });
  if (error) console.error('[listRecurring]', error.message);
  return data || [];
}

export async function createRecurring(businessId, userId, { contactId, templateId, frequency, customDays, nextRunAt, txType, amount, currency = 'USD', note = '', autoNotify = false, notifyWho = 'them', notifyMessage = '', maxRuns, description = '', customLabel = '', remindDays = 0, notifyContact = false, notifySelf = false, notifyEmail = false }) {
  const { data, error } = await supabase.from('recurring_rules').insert({
    business_id: businessId,
    user_id: userId, contact_id: contactId, template_id: templateId,
    frequency, custom_days: customDays || null,
    next_run_at: nextRunAt, tx_type: txType, amount: toCents(amount),
    currency, note, auto_notify: autoNotify, notify_who: notifyWho,
    notify_message: notifyMessage, max_runs: maxRuns || null,
    description: description || null,
    custom_label: customLabel || null,
    remind_days: remindDays || 0,
    notify_contact: notifyContact,
    notify_self: notifySelf,
    notify_email: notifyEmail
  }).select().single();
  if (error) {
    console.error('[createRecurring]', error.message);
    return null;
  }
  return data || null;
}

export async function updateRecurring(id, updates) {
  if (updates.amount !== undefined) updates.amount = toCents(updates.amount);
  const { data, error } = await supabase.from('recurring_rules')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id).select().single();
  if (error) console.error('[updateRecurring]', error.message);
  return data;
}

export async function deleteRecurring(id) {
  const { error } = await supabase.from('recurring_rules').delete().eq('id', id);
  return !error;
}

export async function toggleRecurring(id, active) {
  return updateRecurring(id, { active });
}

export async function processDueRecurring(userId, { emailFn } = {}) {
  const now = new Date().toISOString();
  const { data: due } = await supabase.from('recurring_rules')
    .select('*, contact:contacts(id, name, email, linked_user_id)')
    .eq('user_id', userId)
    .eq('active', true)
    .lte('next_run_at', now);
  if (!due?.length) return [];

  // Resolve sender name once
  let senderName = 'Someone';
  try {
    const { data: profile } = await supabase.from('users').select('display_name, email').eq('id', userId).single();
    senderName = profile?.display_name || profile?.email || 'Someone';
  } catch(_) {}

  const processed = [];
  for (const rule of due) {
    try {
      // Check max_runs limit
      if (rule.max_runs && rule.run_count >= rule.max_runs) {
        await supabase.from('recurring_rules').update({ active: false }).eq('id', rule.id);
        continue;
      }

      // Create the entry — tagged as recurring with rule link
      const entry = await createEntry(userId, {
        contactId: rule.contact_id,
        txType: rule.tx_type,
        amount: rule.amount / 100,
        currency: rule.currency,
        note: rule.note || '',
        templateId: rule.template_id,
        source: 'recurring',
        recurringRuleId: rule.id
      });

      if (!entry) {
        console.error('[processDueRecurring] createEntry returned null for rule', rule.id);
        continue; // Don't update run_count if entry wasn't created
      }

      // ── Notifications (mirrors reminders.js pattern) ──────────
      const contactName = rule.contact?.name || 'contact';
      const linkedUserId = rule.contact?.linked_user_id;
      const contactEmail = rule.contact?.email;
      const amtLabel = (rule.amount / 100).toLocaleString('en-US', { style: 'currency', currency: rule.currency || 'USD' });
      const msg = rule.notify_message || `Recurring entry created: ${amtLabel}`;

      // Notify linked contact (in-app)
      if (rule.auto_notify && linkedUserId && (rule.notify_contact !== false)) {
        await supabase.from('notifications').insert({
          user_id: linkedUserId, type: 'notification',
          message: `${senderName}: Recurring ${rule.tx_type} — ${amtLabel}`,
          entry_id: entry.id, contact_name: senderName,
          amount: rule.amount, currency: rule.currency, read: false
        }).then(r => { if (r.error) console.warn('[recurring notif contact]', r.error.message); });
      }

      // Notify self (in-app)
      if (rule.notify_self !== false) {
        await supabase.from('notifications').insert({
          user_id: userId, type: 'notification',
          message: `Recurring entry created for ${contactName}: ${amtLabel}`,
          entry_id: entry.id, contact_name: contactName,
          amount: rule.amount, currency: rule.currency, read: false
        }).then(r => { if (r.error) console.warn('[recurring notif self]', r.error.message); });
      }

      // Email to contact (if enabled and email function provided)
      if (rule.auto_notify && rule.notify_email && contactEmail && emailFn) {
        try {
          await emailFn(userId, {
            to: contactEmail, fromName: senderName,
            txType: rule.tx_type, amount: rule.amount,
            currency: rule.currency || 'USD',
            message: msg, entryId: entry.id,
            isReminder: false, siteUrl: 'https://moneyinteractions.com'
          });
        } catch (e) { console.warn('[recurring email]', e); }
      }

      // ── Calculate next run ────────────────────────────────────
      const freq = { daily: 1, weekly: 7, biweekly: 14, monthly: 30, quarterly: 90, yearly: 365, custom: rule.custom_days || 30 };
      const days = freq[rule.frequency] || 30;
      const nextRun = new Date(Date.now() + days * 86400000).toISOString();

      await supabase.from('recurring_rules').update({
        next_run_at: nextRun, last_run_at: now, run_count: (rule.run_count || 0) + 1
      }).eq('id', rule.id);

      processed.push(rule);
    } catch (err) {
      console.error('[processDueRecurring] Failed for rule', rule.id, err?.message || err);
      // Don't update run_count — will retry next interval
    }
  }
  return processed;
}

export const FREQUENCIES = {
  daily: 'Daily', weekly: 'Weekly', biweekly: 'Bi-weekly',
  monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly', custom: 'Custom'
};
