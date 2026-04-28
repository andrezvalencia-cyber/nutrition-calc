// Day history module — pure state transformer that archives the current
// dayLog into dayHistory, clears the day, advances the date, and applies the
// fat-soluble carryover for the next day. Centralizing here means the future
// remote-store sync can replay a logDay() server-side from the same input.
//
// Public API: window.Modules.History.{ logDay, buildEntry }
//   buildEntry(state, { runningTotals, gapsClosed, energy, digestion, notes })
//     → { date, dayLog, totals, gapsClosed, energy, digestion, notes }
//   logDay(state, opts) → new state (immutable)
(function (global) {
  function buildEntry(state, opts) {
    return {
      date: state.currentDate,
      dayLog: state.dayLog,
      totals: Object.assign({}, opts.runningTotals),
      gapsClosed: opts.gapsClosed,
      energy: opts.energy,
      digestion: opts.digestion,
      notes: opts.notes,
    };
  }

  function logDay(state, opts) {
    var entry = buildEntry(state, opts);
    var carry = Modules.Carryover.computeCarryover(state);
    return Object.assign({}, state, {
      dayHistory: (state.dayHistory || []).concat([entry]),
      dayLog: [],
      currentDate: todayStr(),
      fatSolubleCarryover: carry.carryover,
      carryoverDaysRemaining: carry.daysRemaining,
    });
  }

  global.Modules = global.Modules || {};
  global.Modules.History = {
    buildEntry: buildEntry,
    logDay: logDay,
  };
})(window);
