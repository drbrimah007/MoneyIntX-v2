# MoneyIntX — System Contract (v1)

**Date locked: 2026-03-30**
**Rule: No mirror, settlement, or notification may be created outside a single transaction that locks the related rows, validates the current state, writes both sides, recalculates balances, and commits once.**

---

## Non-Negotiable Rules

1. **Personal suite communication uses `recipient_id` (UUID)**. Not email. Not username. Not inferred text. ID only.

2. **One linked pair only**. For any shared/confirmed entry: one sender entry, one recipient mirror entry, never more.

3. **No auto-posting to recipient ledger before confirmation**. Unconfirmed = pending share, not a posted entry.

4. **Settlements never create entries**. They only update existing linked entries.

5. **UI is never the source of truth**. No optimistic inserts for entries, mirrors, settlements, or notifications.

6. **No notification without a valid target**. Entry/settlement notifications MUST have `entry_id`. If null → rollback.

---

## Core RPCs (all SECURITY DEFINER, all use FOR UPDATE row locks)

### `create_settlement_with_mirror(p_entry_id, p_amount, p_method, p_note, p_proof_url, p_recorded_by)`
- Locks sender entry FOR UPDATE
- If linked entry exists → locks it too, creates mirror settlement (pending), creates notification with guaranteed entry_id
- If no linked entry → creates settlement only, no mirror, no recipient notification (mirror gets synced on share confirm)
- Always creates self-notification for recorder
- Logs to event_log

### `confirm_share_for_recipient(p_token_id, p_recipient_id)`
- Locks share_token FOR UPDATE
- Idempotent: if already confirmed, returns existing confirmed_entry_id
- Locks sender entry FOR UPDATE
- Creates mirror entry exactly once (checks for existing)
- Sets bidirectional linked_entry_id
- Stores confirmed_entry_id on share_token
- Syncs ALL unmirrored settlements from sender → creates pending mirrors with notifications
- Recalculates recipient entry
- Logs to event_log

### `confirm_mirror_settlement(p_settlement_id, p_reviewed_by)`
- Locks settlement, mirror settlement, both entries — all FOR UPDATE
- Idempotent: already-confirmed returns success
- Confirms BOTH sides of the settlement pair
- Recalculates BOTH entries' settled_amount and status
- Notifies original recorder
- Logs to event_log

### `reject_mirror_settlement(p_settlement_id, p_rejected_by, p_reason)`
- Locks settlement, mirror, both entries — all FOR UPDATE
- Rejects BOTH sides
- Recalculates BOTH entries
- Notifies original recorder with reason
- Logs to event_log

---

## DB Constraints

- `uq_settlements_mirror_of` — UNIQUE partial index on `settlements.mirror_of WHERE mirror_of IS NOT NULL` (prevents duplicate mirrors)
- `share_tokens.confirmed_entry_id` — stores the mirror entry created on confirm (enables idempotency)

---

## Event Log

Table: `event_log`
Events tracked: `settlement_recorded`, `mirror_created`, `share_confirmed`, `share_confirm_idempotent`, `settlement_mirror_synced`, `settlement_confirmed`, `settlement_rejected`

Each event stores: actor_id, entry_id, settlement_id, share_token_id, linked_entry_id, detail (jsonb)

---

## Allowed Flows

### A. Create/Share/Confirm Entry
1. Sender creates entry (manual)
2. Sender shares → creates share_token with recipient_id
3. Recipient confirms → `confirm_share_for_recipient` creates mirror, links both, syncs settlements

### B. Record/Review/Confirm Settlement
1. Recorder calls `create_settlement_with_mirror` → locks entries, creates pair
2. Recipient sees pending settlement → confirms via `confirm_mirror_settlement`
3. Both entries recalculated atomically

### C. Settlement Before Share Confirm
1. Sender records settlement on unlinked entry → settlement created, no mirror
2. Recipient later confirms share → `confirm_share_for_recipient` backfills mirror settlements + notifications

---

## Trigger Policy

**Use triggers ONLY for derived values:**
- `trg_settlement_update` → recalculates `settled_amount` on settlement insert/update/delete

**NEVER use triggers for:**
- Creating mirrors
- Creating notifications
- Share confirmations
- Any business event

---

## UI Contract

**Allowed:** Call RPC → show spinner → disable buttons → await response → clear caches → refetch → render

**Forbidden:** Locally append mirrors, locally patch balances, locally fake settlement rows, locally infer contact mappings
