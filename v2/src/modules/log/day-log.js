// Day log module — pure state transformers for the dayLog array.
// All dayLog mutations in app.jsx flow through these helpers so the future
// write-behind queue can intercept at one seam instead of every setState call.
//
// Public API: window.Modules.Log.{ addEntry, addEntries, removeEntry }
// Each takes the current state and returns a new state object (immutable).
(function (global) {
  function addEntry(state, entry) {
    return Object.assign({}, state, { dayLog: state.dayLog.concat([entry]) });
  }

  function addEntries(state, entries) {
    if (!entries || entries.length === 0) return state;
    return Object.assign({}, state, { dayLog: state.dayLog.concat(entries) });
  }

  function removeEntry(state, id) {
    return Object.assign({}, state, {
      dayLog: state.dayLog.filter(function (e) { return e.id !== id; }),
    });
  }

  global.Modules = global.Modules || {};
  global.Modules.Log = {
    addEntry: addEntry,
    addEntries: addEntries,
    removeEntry: removeEntry,
  };
})(window);
