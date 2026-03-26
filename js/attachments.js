// Money IntX v2 — Attachments Module
import { supabase } from './supabase.js';

export async function uploadAttachment(entryId, file, userId) {
  const ext = file.name.split('.').pop();
  const path = `${userId}/${entryId}/${Date.now()}.${ext}`;
  const { data, error } = await supabase.storage.from('documents').upload(path, file);
  if (error) { console.error('[uploadAttachment]', error.message); return null; }
  // Create metadata record
  const { data: record } = await supabase.from('entry_attachments').insert({
    entry_id: entryId, file_name: file.name, file_type: file.type,
    file_size: file.size, storage_path: path, uploaded_by: userId
  }).select().single();
  return record;
}

export async function listAttachments(entryId) {
  const { data, error } = await supabase.from('entry_attachments')
    .select('*').eq('entry_id', entryId).order('created_at');
  if (error) console.error('[listAttachments]', error.message);
  return data || [];
}

export async function getAttachmentUrl(path) {
  const { data } = await supabase.storage.from('documents').createSignedUrl(path, 3600);
  return data?.signedUrl || '';
}

export async function deleteAttachment(id, path) {
  await supabase.storage.from('documents').remove([path]);
  await supabase.from('entry_attachments').delete().eq('id', id);
}

export async function uploadAvatar(file, userId) {
  const ext = file.name.split('.').pop();
  const path = `avatars/${userId}.${ext}`;
  const { error } = await supabase.storage.from('avatars').upload(path, file, { upsert: true });
  if (error) { console.error('[uploadAvatar]', error.message); return null; }
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  await supabase.from('users').update({ avatar_url: data.publicUrl }).eq('id', userId);
  return data.publicUrl;
}
