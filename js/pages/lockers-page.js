// Money IntX — Asset Lockers Page Module
// Extracted from index.html page modules (part of NOK/Trusted Access)

import { getCurrentUser, getCurrentProfile } from './state.js';
import { esc, toast, openModal, closeModal } from '../ui.js';
import { supabase } from '../supabase.js';

// Asset lockers functionality is tightly integrated with NOK/renderNokPage
// This module provides the locker management portion.
// Import and re-export the renderNokPage which handles both NOK and lockers.

import { renderNokPage } from './nok-page.js';

// Alias for lockers page - uses the same render function
export const renderLockers = renderNokPage;

// Locker management functions are defined on window in nok-page.js
// This file serves as the interface for the lockers page navigation.
