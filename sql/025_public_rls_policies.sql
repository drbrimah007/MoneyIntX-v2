-- ═══════════════════════════════════════════════════════════════
-- Migration 025: Add RLS policies for reading public panels + templates
-- Without these, users can only see their OWN rows — public DB is empty
-- ═══════════════════════════════════════════════════════════════

-- ── Business Panels: allow anyone authenticated to READ public panels ──
CREATE POLICY "bp_read_public" ON business_panels
  FOR SELECT
  USING (is_public = true);

-- ── Templates: allow anyone authenticated to READ public templates ──
-- (Only if is_public column exists on templates table)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'templates' AND column_name = 'is_public'
  ) THEN
    EXECUTE 'CREATE POLICY "tpl_read_public" ON templates FOR SELECT USING (is_public = true)';
  END IF;
END
$$;
