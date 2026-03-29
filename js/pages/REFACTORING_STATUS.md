# MoneyIntX Index.html Refactoring Status

## Status: COMPLETE (2026-03-28)

All page modules have been extracted, imports fixed, and the site is live with zero console errors.

## Completed

### 1. `/js/pages/state.js` ✅
- Shared state module with getters/setters for:
  - `currentUser` (via `getCurrentUser()`, `setCurrentUser()`)
  - `currentProfile` (via `getCurrentProfile()`, `setCurrentProfile()`)
  - `notifChannel` (via `getNotifChannel()`, `setNotifChannel()`)
- Common utility functions exported:
  - `contactColor(id)` — deterministic contact colors from localStorage
  - `contactAvatar(name, id, size)` — HTML avatar span
  - `renderPagination(totalItems, currentPage, onClickFn)` — pagination HTML
  - `PAGE_SIZE = 10` constant
  - `_invalidateEntries()` — clears entry cache after CRUD operations
  - `_fmtAmt(dollarAmount, currency)` — formats currency amounts (dollars, not cents)
- Currency picker functions:
  - `setupCurrencyPicker()` — initializes window.setDefaultCurrency, window.toggleCurPicker, window.pickCurrency
  - These functions depend on supabase, toast, and are exposed to window for inline onclick handlers

### 2. `/js/pages/dashboard.js` ✅
- Exports `renderDash(el)` — async dashboard page renderer
- Imports from:
  - `./state.js` — state getters and utilities
  - `../entries.js` — getDashboardTotals, recentEntries, getLedgerSummary, getCurrencyLedger, fmtMoney, toCents, invalidateEntryCache
  - `../contacts.js` — listContacts
  - `../notifications.js` — getUnreadCount, listReceivedShares
  - `../ui.js` — esc, statusBadge, TX_LABELS, TX_COLORS, fmtDate
- Renders hero card with primary + secondary currencies, stat cards, quick actions, top contacts, pending shares, recent entries
- Uses window._impersonatedData if available (admin view)
- All onclick handlers remain as `window.xxx()` calls (backward compatible)

## All Page Modules — Completed

Each page module should follow the pattern:
1. Import necessary dependencies (from ../entries.js, ../contacts.js, etc.)
2. Import state getters from ./state.js
3. Export the main render function
4. All window.xxx = function assignments stay as-is for onclick handlers

### 3. `/js/pages/contacts-page.js` ✅
**Functions to extract:**
- `renderContacts(el, page = 1)` — main contacts list with pagination
- `window.renderContactsPage(p)` — pagination callback
- `window.filterAndRenderContacts(q)` — search/filter handler
- `window.filterContactRows(q)` — row-level filter for display
- Contact detail modal:
  - `window.openContactDetail(id)` — async contact detail view with tabs
  - `window.showCPTab(tab, contactId)` — tab switcher (entries, ledger, info)
  - `_cpEntriesTable(entries, page)` — helper to render entries in contact detail
- Contact edit/create:
  - `window.openEditContactModal(id)` — edit form
  - `window.saveEditContact(id)` — save edit
  - `window.openNewContactModal()` — new contact form
  - `window.saveNewContact(returnCallback)` — save new contact
  - `window.confirmDeleteContact(id, name)` — delete with confirmation

**Dependencies:** state.js, entries.js, contacts.js, sharing.js, ui.js, supabase.js

### 4. `/js/pages/entries-page.js` ✅
**Note:** This is the largest module (~2480 lines). Contains:
- Main entries list render function
- Entry detail modal with all tabs (preview, splits, attachments, history, actions)
- New Entry modal with category selector, form, validations
- Edit Entry modal
- All settlement/split/payment modals
- Share entry modal
- All related window.xxx functions for entry CRUD operations

**Key functions:**
- `renderEntries(el, page, forceRefresh)` — main entries list
- `window.openNewEntryModal(category, prefilledContactId)` — new entry form
- `window.openEntryDetail(id)` — full entry detail view
- `window.saveEntry()` — entry form submission
- `window.deleteEntry(id)` — soft/hard delete
- Entry modals for splits, settlements, share, etc.

**Dependencies:** state.js, entries.js, contacts.js, sharing.js, ui.js, invoices.js, email.js

### 5. `/js/pages/contacts-page.js` already identified above

### 6. `/js/pages/settings-page.js` ✅
**Functions to extract:**
- `renderSettings(el)` — async settings page with tabs
- All form handlers and save functions
- Theme toggle, notification preferences, account settings, etc.

**Dependencies:** state.js, supabase.js, ui.js, entries.js

### 7. `/js/pages/templates-page.js` ✅
**Functions to extract:**
- `renderTemplatesPage(el)` — main templates list
- `renderFieldList(scrollToBottom)` — template field builder UI
- `renderPublicTemplateList(templates)` — public templates gallery
- All template CRUD window.xxx functions
- Template builder/engine integration

**Dependencies:** state.js, templates.js, template-engine.js, ui.js

### 8. `/js/pages/view-all.js` ✅
**Functions to extract:**
- `renderViewAll(el, page)` — paginated view of all user entries

**Dependencies:** state.js, entries.js, ui.js

### 9. `/js/pages/nok-page.js` ✅
**Functions to extract:**
- `renderNokPage(el)` — trusted contacts/Next of Kin management
- All NOK-related modals and handlers

**Dependencies:** state.js, nok.js, ui.js

### 10. `/js/pages/asset-lockers.js` ✅
**Functions to extract:**
- Asset/Locker management page renderer (if exists in provided range)

### 11. `/js/pages/trash-page.js` ✅
**Functions to extract:**
- `renderTrash(el)` — trashed/voided entries with restore/delete options

**Dependencies:** state.js, entries.js, ui.js

### 12. `/js/pages/admin-page.js` ✅
**Functions to extract:**
- `renderAdmin(el)` — admin dashboard with user management, audit log, etc.

**Dependencies:** state.js, admin.js, ui.js

### 13. `/js/pages/recurring-page.js` ✅
**Functions to extract:**
- `renderRecurringPage(el)` — recurring entry management

**Dependencies:** state.js, recurring.js, ui.js

### 14. `/js/pages/investments-page.js` and `/js/pages/groups-page.js` ✅
- `renderInvestments(el)` — investment tracking
- `renderGroups(el)` — group management
- Note: These may be already partially in /js/investments.js and /js/groups.js

### 15. `/js/pages/notifications-page.js` ✅
- `renderNotifications(el)` — notification list

## Index.html Changes Required

After all page modules are extracted, update index.html's `<script type="module">` block:

```javascript
<script type="module">
// Import all page renderers
import { renderDash } from './js/pages/dashboard.js';
import { renderContacts } from './js/pages/contacts-page.js';
import { renderEntries } from './js/pages/entries-page.js';
// ... etc for all pages

// Import state and set after auth
import { setCurrentUser, setCurrentProfile, setupCurrencyPicker } from './js/pages/state.js';

// ... existing imports for auth, supabase, etc.

// After currentUser and currentProfile are loaded in onAuthChange:
setCurrentUser(user);
setCurrentProfile(profile);
setupCurrencyPicker();

// Expose render functions to window for navTo() routing
window.renderDash = renderDash;
window.renderContacts = renderContacts;
// ... etc

// Keep ONLY these key functions in main script:
// - enterApp(u, p) — initialization
// - navTo(page) — routing
// - handleLogOut() — logout
// - checkAuth() — auth status check
// - onAuthChange(user) — auth state listener
// - All auth tab UI functions
// - Toast, modal, and UI utilities (from ui.js)
</script>
```

## Implementation Strategy

1. For each page module, extract the render function and all associated window.xxx handlers
2. Update imports to use the state module getters instead of direct `currentUser`/`currentProfile` variables
3. Keep all onclick handlers intact (no refactoring needed there)
4. Test each page module independently before final integration
5. Update index.html to import all page modules and expose them to window for routing
6. Ensure window._currentPage tracking is maintained for guards

## Notes

- All window.xxx function assignments must remain — they're called from inline onclick="" attributes in HTML strings
- The state module handles initialization of currentUser/currentProfile via setters called from main auth flow
- Each page module should be self-contained with its own imports
- No modification of business logic — purely structural refactoring
- Total lines to be removed from index.html: ~6,000+ (move to pages/ directory)
- Estimated final index.html script block size: ~1,500-2,000 lines
