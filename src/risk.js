(function () {
  'use strict';

  const roundingThresholdPct = 100 * Number.EPSILON;

  function breakEvenLossPct(targetPct, winRatePct) {
    if (!Number.isFinite(targetPct) || targetPct <= 0 ||
        !Number.isFinite(winRatePct) || winRatePct < 0 || winRatePct > 100) return null;
    if (winRatePct === 0) return 0;
    if (winRatePct === 100) return 100;

    // Set expected log growth to zero: p log(1 + win) + (1 - p) log(1 - loss) = 0.
    const lossRatePct = 100 - winRatePct;
    const odds = winRatePct / lossRatePct;
    const winLog = Math.log1p(targetPct / 100);
    const lossLog = odds * winLog;
    if (lossLog <= Number.EPSILON) {
      // Apply the percent scale before tiny increments can round to zero.
      return targetPct < roundingThresholdPct ? targetPct * odds : winRatePct * (100 * winLog / lossRatePct);
    }
    return -Math.expm1(-lossLog) * 100;
  }

  function drawdownLossPct(maxDrawdownPct, lossStreak) {
    if (!Number.isFinite(maxDrawdownPct) || maxDrawdownPct < 0 || maxDrawdownPct >= 100 ||
        !Number.isSafeInteger(lossStreak) || lossStreak < 1) return null;
    if (maxDrawdownPct === 0) return 0;
    if (lossStreak === 1) return maxDrawdownPct;
    if (maxDrawdownPct < roundingThresholdPct) return maxDrawdownPct / lossStreak;

    // Use the remaining capital directly near a 100% drawdown to retain precision.
    const remainingLog = maxDrawdownPct > 50
      ? Math.log((100 - maxDrawdownPct) / 100)
      : Math.log1p(-maxDrawdownPct / 100);
    return -Math.expm1(remainingLog / lossStreak) * 100;
  }

  const api = Object.freeze({ breakEvenLossPct, drawdownLossPct });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.GoalRisk = api;
})();
