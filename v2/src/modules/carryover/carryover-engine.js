// Carryover engine — pure functions for the fat-soluble decrement rules.
// Loaded as a <script> in the browser AND require-able from Node (unit tests).
//
// Rules (CLAUDE.md §5):
//   - B12: dayLog contains an entry with b12 >= 1000 mcg
//          → carry round(5000 / 7) = 714 mcg/day for the next 6 days
//   - VitE: dayLog contains an entry with vit_e >= 100 mg
//          → carry round(268 / 7) = 38 mg/day for the next 6 days
//   - VitD: dead field — carryover always 0 (intentional, see CLAUDE.md memory)
//
// Decrement: when computing the *next* day's carryover, if there is no
// fresh trigger today, and the previous daysRemaining was > 1, carry the
// per-day dose with daysRemaining - 1. If daysRemaining was 1 or 0, reset to 0.
//
// Public API:
//   Modules.Carryover.computeCarryover(state) → { carryover, daysRemaining }
//   Modules.Carryover.CONSTANTS              → frozen rule numbers
(function (global) {
  var CONSTANTS = Object.freeze({
    B12_TRIGGER_MCG: 1000,
    B12_WEEKLY_DOSE_MCG: 5000,
    B12_DAILY_CARRYOVER_MCG: Math.round(5000 / 7),   // 714
    VIT_E_TRIGGER_MG: 100,
    VIT_E_WEEKLY_DOSE_MG: 268,
    VIT_E_DAILY_CARRYOVER_MG: Math.round(268 / 7),   // 38
    CARRYOVER_DAYS: 6,
  });

  function dayLogTriggers(dayLog, key, threshold) {
    if (!dayLog || !dayLog.length) return false;
    for (var i = 0; i < dayLog.length; i++) {
      var n = (dayLog[i] && dayLog[i].nutrients) || {};
      if ((n[key] || 0) >= threshold) return true;
    }
    return false;
  }

  function nextCarry(triggered, prevDaysRemaining, dailyDose) {
    if (triggered) {
      return { value: dailyDose, days: CONSTANTS.CARRYOVER_DAYS };
    }
    var prev = prevDaysRemaining || 0;
    if (prev > 1) {
      return { value: dailyDose, days: prev - 1 };
    }
    return { value: 0, days: 0 };
  }

  function computeCarryover(state) {
    var dayLog = (state && state.dayLog) || [];
    var prevDays = (state && state.carryoverDaysRemaining) || {};

    var b12Triggered = dayLogTriggers(dayLog, "b12", CONSTANTS.B12_TRIGGER_MCG);
    var vitETriggered = dayLogTriggers(dayLog, "vit_e", CONSTANTS.VIT_E_TRIGGER_MG);

    var b12 = nextCarry(b12Triggered, prevDays.b12, CONSTANTS.B12_DAILY_CARRYOVER_MCG);
    var vitE = nextCarry(vitETriggered, prevDays.vit_e, CONSTANTS.VIT_E_DAILY_CARRYOVER_MG);

    return {
      carryover: { b12: b12.value, vit_e: vitE.value, vit_d: 0 },
      daysRemaining: { b12: b12.days, vit_e: vitE.days },
    };
  }

  var api = {
    computeCarryover: computeCarryover,
    CONSTANTS: CONSTANTS,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.Modules = global.Modules || {};
    global.Modules.Carryover = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
