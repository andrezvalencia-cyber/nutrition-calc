// SyncMap — pure mapping/merge functions for the cloud-sync boundary.
// Loaded as a <script> in the browser AND require-able from Node (unit tests).
//
// Public API:
//   Modules.SyncMap.buildEntryRow(entry, userId, dayDate) → Supabase day_entries row
//   Modules.SyncMap.buildDayRow(histEntry, carryover, userId) → Supabase days row
//   Modules.SyncMap.isSyncEnabled(auth, state, hasWriteBehind) → bool
//   Modules.SyncMap.mergeHydration(prevState, days, entries) → merged state slice
(function (global) {
  function buildEntryRow(entry, userId, dayDate) {
    entry = entry || {};
    return {
      idempotency_key:   entry.id,
      user_id:           userId,
      day_date:          dayDate,
      recipe_id:         entry.recipeId || null,
      name:              entry.name,
      emoji:             entry.emoji || "",
      nutrients:         entry.nutrients,
      ingredient_states: entry.ingredientStates || [],
      logged_at:         new Date(entry.timestamp || Date.now()).toISOString(),
    };
  }

  function buildDayRow(histEntry, carryover, userId) {
    histEntry = histEntry || {};
    return {
      user_id:     userId,
      day_date:    histEntry.date,
      gaps_closed: histEntry.gapsClosed || 0,
      energy:      histEntry.energy || null,
      digestion:   histEntry.digestion || null,
      notes:       histEntry.notes || "",
      totals:      histEntry.totals || {},
      carryover:   carryover || {},
      updated_at:  new Date().toISOString(),
    };
  }

  function isSyncEnabled(auth, state, hasWriteBehind) {
    return !!(hasWriteBehind && state && state.cloudSync &&
              auth && auth.status === "signed_in" && auth.user);
  }

  function mergeHydration(prevState, days, entries) {
    var s = prevState || {};
    var localDates = {};
    var hist = s.dayHistory || [];
    for (var i = 0; i < hist.length; i++) {
      localDates[hist[i].date] = true;
    }
    var newHistoryRows = [];
    var inDays = days || [];
    for (var j = 0; j < inDays.length; j++) {
      if (!localDates[inDays[j].date]) {
        newHistoryRows.push(inDays[j]);
      }
    }
    var mergedHistory = hist.concat(newHistoryRows);
    mergedHistory.sort(function (a, b) {
      return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    });

    var localIds = {};
    var log = s.dayLog || [];
    for (var k = 0; k < log.length; k++) {
      localIds[log[k].id] = true;
    }
    var newEntries = [];
    var inEntries = entries || [];
    for (var m = 0; m < inEntries.length; m++) {
      if (!localIds[inEntries[m].id]) {
        newEntries.push(inEntries[m]);
      }
    }
    var mergedLog = log.concat(newEntries);

    var result = {};
    for (var p in s) {
      if (Object.prototype.hasOwnProperty.call(s, p)) {
        result[p] = s[p];
      }
    }
    result.dayHistory = mergedHistory;
    result.dayLog = mergedLog;
    return result;
  }

  var api = {
    buildEntryRow: buildEntryRow,
    buildDayRow: buildDayRow,
    isSyncEnabled: isSyncEnabled,
    mergeHydration: mergeHydration,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.Modules = global.Modules || {};
    global.Modules.SyncMap = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
