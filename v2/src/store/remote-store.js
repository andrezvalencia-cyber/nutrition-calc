// Remote (Supabase) read-only store — Phase 4 of the Supabase migration.
//
// Public API: window.RemoteStore.{ isAvailable, fetchDays, fetchEntries,
//                                   mapDayRow, mapEntryRow }
//
// Phase 4 contract:
//   - READS ONLY. No inserts, updates, or deletes from this module.
//   - Caller is responsible for gating on syncEnabled + signed-in session.
//   - Mapping helpers translate DB column names to the local state shape so
//     the hydration merge in app.jsx stays declarative.
//
// Loaded as a plain <script> after src/modules/identity/auth.js so that
// Modules.Identity.getClient() is available.
(function (global) {
  "use strict";

  function getClient() {
    var I = global.Modules && global.Modules.Identity;
    return (I && I.getClient && I.getClient()) || null;
  }

  function isAvailable() { return !!getClient(); }

  // dayHistory entry shape, see src/modules/history/day-history.js:11.
  function mapDayRow(row) {
    return {
      date: row.day_date,
      dayLog: [],
      totals: row.totals || {},
      gapsClosed: row.gaps_closed != null ? row.gaps_closed : 0,
      energy: row.energy != null ? row.energy : null,
      digestion: row.digestion != null ? row.digestion : null,
      notes: row.notes || "",
      _cloud: true,
      _updatedAt: row.updated_at,
    };
  }

  // dayLog entry shape, see app.jsx:452.
  function mapEntryRow(row) {
    return {
      id: row.idempotency_key,
      recipeId: row.recipe_id || null,
      name: row.name,
      emoji: row.emoji || "",
      nutrients: row.nutrients || {},
      ingredientStates: row.ingredient_states || [],
      timestamp: row.logged_at ? Date.parse(row.logged_at) : Date.now(),
      _cloud: true,
    };
  }

  function fetchDays(userId) {
    var c = getClient();
    if (!c || !userId) return Promise.resolve([]);
    return c.from("days")
      .select("day_date,gaps_closed,energy,digestion,notes,totals,carryover,updated_at")
      .eq("user_id", userId)
      .order("day_date", { ascending: true })
      .then(function (r) {
        if (r && r.error) throw r.error;
        return ((r && r.data) || []).map(mapDayRow);
      });
  }

  // `since` is an ISO date string (YYYY-MM-DD); pass currentDate to fetch
  // today's entries for dayLog hydration.
  function fetchEntries(userId, since) {
    var c = getClient();
    if (!c || !userId) return Promise.resolve([]);
    var q = c.from("day_entries")
      .select("idempotency_key,recipe_id,name,emoji,nutrients,ingredient_states,logged_at,day_date")
      .eq("user_id", userId)
      .is("deleted_at", null);
    if (since) q = q.gte("day_date", since);
    return q.order("logged_at", { ascending: true }).then(function (r) {
      if (r && r.error) throw r.error;
      return ((r && r.data) || []).map(mapEntryRow);
    });
  }

  global.RemoteStore = {
    isAvailable: isAvailable,
    fetchDays: fetchDays,
    fetchEntries: fetchEntries,
    mapDayRow: mapDayRow,
    mapEntryRow: mapEntryRow,
  };
})(window);
