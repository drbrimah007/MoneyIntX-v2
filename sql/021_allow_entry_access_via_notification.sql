-- ═══════════════════════════════════════════════════════════════════
-- Fix: Allow recipients to view entries via notifications
-- ═══════════════════════════════════════════════════════════════════
-- Issue: When a user receives a settlement_pending or payment_received
-- notification, they should be able to view the entry even without a
-- confirmed share_token. This migration updates the entries RLS policy
-- to allow access via notification as well.

-- Drop the existing policy
DROP POLICY IF EXISTS entries_select ON entries;

-- Recreate with notification access included
CREATE POLICY entries_select ON entries FOR SELECT TO authenticated USING (
  auth.uid() = user_id OR
  -- Access via confirmed share token
  id IN (SELECT entry_id FROM share_tokens WHERE recipient_id = auth.uid() AND status = 'confirmed') OR
  -- Access via notification (recipient can view entry they have a notification about)
  id IN (SELECT entry_id FROM notifications WHERE user_id = auth.uid() AND entry_id IS NOT NULL)
);
