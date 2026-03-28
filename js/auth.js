// Money IntX v2 — Auth Module
import { supabase, getProfile } from './supabase.js';
import { toast, navigate } from './ui.js';

// ── Sign Up ───────────────────────────────────────────────────────
export async function signUp({ email, password, displayName }) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName },
      // emailRedirectTo only used when email confirmation is ON in Supabase dashboard
      emailRedirectTo: window.location.origin + '/'
    }
  });
  if (error) {
    toast(error.message, 'error');
    return null;
  }
  // If email_confirmed_at is already set, confirmation is disabled — user can log in now
  const isAutoConfirmed = data.user && !!data.user.email_confirmed_at;
  // Update the users table with display name
  if (data.user) {
    await supabase.from('users').update({
      display_name: displayName,
      verified_email: isAutoConfirmed
    }).eq('id', data.user.id).select();
  }
  if (isAutoConfirmed) {
    toast('Account created! You can now log in.', 'success');
  } else {
    toast('Account created! A verification email has been sent — please check your inbox.', 'info');
  }
  return data.user;
}

// ── Log In ────────────────────────────────────────────────────────
export async function logIn({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });
  if (error) {
    toast(error.message, 'error');
    return null;
  }
  return data.user;
}

// ── Log Out ───────────────────────────────────────────────────────
export async function logOut() {
  const { error } = await supabase.auth.signOut();
  if (error) toast(error.message, 'error');
  navigate('landing');
}

// ── Password Reset ────────────────────────────────────────────────
export async function resetPassword(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/'
  });
  if (error) {
    toast(error.message, 'error');
    return false;
  }
  toast('Password reset email sent.', 'success');
  return true;
}

// ── Update Password ───────────────────────────────────────────────
export async function updatePassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) {
    toast(error.message, 'error');
    return false;
  }
  toast('Password updated.', 'success');
  return true;
}

// ── Session Listener ──────────────────────────────────────────────
export function onAuthChange(callback) {
  supabase.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
}
