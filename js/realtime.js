// Money IntX v2 — Realtime Module
// Live updates across all devices via Supabase Realtime
import { supabase } from './supabase.js';

let channels = [];

export function subscribeToEntries(userId, onInsert, onUpdate, onDelete) {
  const ch = supabase.channel('entries:' + userId)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'entries', filter: 'user_id=eq.' + userId }, p => onInsert(p.new))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'entries', filter: 'user_id=eq.' + userId }, p => onUpdate(p.new))
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'entries', filter: 'user_id=eq.' + userId }, p => onDelete(p.old))
    .subscribe();
  channels.push(ch);
  return ch;
}

export function subscribeToContacts(userId, onChange) {
  const ch = supabase.channel('contacts:' + userId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'contacts', filter: 'user_id=eq.' + userId }, p => onChange(p.eventType, p.new || p.old))
    .subscribe();
  channels.push(ch);
  return ch;
}

export function subscribeToNotifications(userId, onNew) {
  const ch = supabase.channel('notifs_rt:' + userId)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'user_id=eq.' + userId }, p => onNew(p.new))
    .subscribe();
  channels.push(ch);
  return ch;
}

export function subscribeToSettlements(userId, onNew) {
  const ch = supabase.channel('settlements:' + userId)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'settlements' }, p => onNew(p.new))
    .subscribe();
  channels.push(ch);
  return ch;
}

export function unsubscribeAll() {
  channels.forEach(ch => supabase.removeChannel(ch));
  channels = [];
}
