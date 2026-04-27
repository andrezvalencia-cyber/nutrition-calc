/* Vitality v2 — Supabase project configuration.
 *
 * The anon key is a public client credential (RLS enforces per-user access).
 * Paste the values from your Supabase project's API settings page below.
 *
 * Until both fields are populated with non-placeholder values,
 * window.Modules.Identity.isConfigured() returns false and the Cloud Sync
 * toggle in Settings will surface "Cloud sync is not configured yet."
 */
(function () {
  "use strict";
  window.SupabaseConfig = {
    url: "TODO_SUPABASE_URL",       // e.g. "https://abcdxyz.supabase.co"
    anonKey: "TODO_SUPABASE_ANON_KEY", // long JWT starting with "eyJ..."
  };
})();
