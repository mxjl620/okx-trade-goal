(function () {
  'use strict';

  function normalizeCurrency(value) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new RangeError('无法确认资金或仓位的币种。');
    }
    return value.trim().toUpperCase();
  }

  function validMode(value) {
    return value === 'isolated' || value === 'cross';
  }

  function calculateCapital({ available, mode, currency, positions } = {}) {
    if (!Number.isFinite(available)) throw new RangeError('可用资金必须是有限数字。');
    if (!validMode(mode)) throw new RangeError('无法确认下单区是逐仓还是全仓。');
    if (!Array.isArray(positions)) throw new TypeError('无法确认当前仓位列表。');

    const baseCurrency = normalizeCurrency(currency);
    let positionMargin = 0;
    let isolatedMargin = 0;
    let crossMargin = 0;
    let includedPnl = 0;
    let crossPnl = 0;
    let crossPnlComplete = true;
    let isolatedCount = 0;
    let crossCount = 0;
    let foreignIgnored = 0;

    for (const [index, position] of positions.entries()) {
      if (normalizeCurrency(position?.currency) !== baseCurrency) {
        foreignIgnored++;
        continue;
      }
      if (!validMode(position.mode)) throw new RangeError(`第 ${index + 1} 条仓位无法确认逐仓或全仓。`);
      if (!Number.isFinite(position.margin) || position.margin < 0) {
        throw new RangeError(`第 ${index + 1} 条仓位的保证金必须是非负数字。`);
      }

      positionMargin += position.margin;
      if (position.mode === 'isolated') {
        if (!Number.isFinite(position.pnl)) throw new RangeError(`无法读取第 ${index + 1} 条逐仓的浮动盈亏。`);
        isolatedMargin += position.margin;
        includedPnl += position.pnl;
        isolatedCount++;
      } else {
        crossMargin += position.margin;
        if (Number.isFinite(position.crossPnl)) crossPnl += position.crossPnl;
        else crossPnlComplete = false;
        crossCount++;
      }
    }

    const currentCapital = available + positionMargin + includedPnl;
    if (!Number.isFinite(currentCapital)) throw new RangeError('当前资金金额超出计算范围。');
    return {
      currentCapital,
      available,
      positionMargin,
      isolatedMargin,
      crossMargin,
      includedPnl,
      crossPnl: crossCount > 0 && crossPnlComplete && Number.isFinite(crossPnl) ? crossPnl : null,
      includedPositions: isolatedCount + crossCount,
      foreignIgnored,
      isolatedCount,
      crossCount,
      mixedModes: mode === 'isolated' ? crossCount > 0 : isolatedCount > 0,
      mode,
      currency: baseCurrency,
    };
  }

  function snapInteger(value, logPerWin) {
    const nearest = Math.round(value);
    // A rounded currency amount can represent a value a few ULPs from a step.
    const roundingInSteps = 4 * Number.EPSILON / logPerWin;
    const tolerance = Math.min(1e-6, Math.max(roundingInSteps, 8 * Number.EPSILON * Math.abs(value)));
    if (Math.abs(value - nearest) > tolerance || !Number.isFinite(value)) return value;
    return nearest === 0 ? 0 : nearest;
  }

  function compoundStep(startCapital, logPerWin, win) {
    const gainLog = win * logPerWin;
    const growth = Math.expm1(gainLog);
    const capital = Number.isFinite(growth)
      ? startCapital + startCapital * growth
      : Math.exp(Math.log(startCapital) + gainLog);
    return { capital, growth };
  }

  function goalPlan(value) {
    const { mode = 'compound', startCapital, targetPct, targetWins, growthPct, growthAmount } = value ?? {};
    if (!Number.isFinite(startCapital) || startCapital <= 0) throw new RangeError('起始资金必须是大于 0 的数字。');
    let settings;
    let targetCapital;
    let targetReturnPct;
    let logPerWin;

    if (mode === 'compound') {
      if (!Number.isFinite(targetPct) || targetPct <= 0 || targetPct / 100 === 0) {
        throw new RangeError('每笔目标收益率必须是大于 0 的数字。');
      }
      if (!Number.isSafeInteger(targetWins) || targetWins <= 0) throw new RangeError('目标笔数必须是正整数。');
      settings = { mode, startCapital, targetPct, targetWins };
      logPerWin = Math.log1p(targetPct / 100);
      const step = compoundStep(startCapital, logPerWin, targetWins);
      targetCapital = step.capital;
      targetReturnPct = step.growth * 100;
    } else if (mode === 'percent') {
      if (!Number.isFinite(growthPct) || growthPct <= 0) throw new RangeError('目标增长百分比必须大于 0。');
      settings = { mode, startCapital, growthPct };
      targetCapital = startCapital + startCapital * (growthPct / 100);
      targetReturnPct = growthPct;
    } else if (mode === 'amount') {
      if (!Number.isFinite(growthAmount) || growthAmount <= 0) throw new RangeError('目标增长金额必须大于 0。');
      settings = { mode, startCapital, growthAmount };
      targetCapital = startCapital + growthAmount;
      targetReturnPct = growthAmount / startCapital * 100;
    } else {
      throw new RangeError('无法识别目标类型。');
    }
    if (!Number.isFinite(targetCapital)) throw new RangeError('目标资金超出计算范围，请调低目标。');
    if (targetCapital <= startCapital) throw new RangeError('目标增长太小，无法与起始资金区分。');
    return { settings, targetCapital, targetReturnPct, logPerWin };
  }

  function normalizeGoal(value) {
    try { return goalPlan(value).settings; }
    catch { return undefined; }
  }

  function compoundSchedule(goal, { offset = 0, limit = 10 } = {}) {
    const { settings, targetCapital, logPerWin } = goalPlan(goal);
    const { mode, startCapital, targetWins } = settings;
    if (mode !== 'compound') throw new RangeError('资金计划仅适用于复利连赢目标。');
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1) {
      throw new RangeError('资金计划的起始位置和显示笔数无效。');
    }

    const total = targetWins;
    const length = Math.max(0, Math.min(total - offset, limit, 100));
    if (!length) return { rows: [], total };

    const rows = [];
    let fromCapital = compoundStep(startCapital, logPerWin, offset).capital;
    for (let index = 0; index < length; index++) {
      const win = offset + index + 1;
      const capital = win === targetWins ? targetCapital : compoundStep(startCapital, logPerWin, win).capital;
      rows.push({ win, fromCapital, capital });
      fromCapital = capital;
    }
    return { rows, total };
  }

  function calculateTarget(value, currentCapital) {
    const { settings, targetCapital, targetReturnPct, logPerWin } = goalPlan(value);
    if (!Number.isFinite(currentCapital)) throw new RangeError('当前资金必须是有限数字。');
    const { mode, startCapital, targetWins } = settings;
    const capitalChange = currentCapital - startCapital;
    const capitalRatio = currentCapital / startCapital;
    const growth = Number.isFinite(capitalChange) ? capitalChange / startCapital : capitalRatio - 1;
    const depleted = currentCapital <= 0;
    const shared = { targetCapital, targetReturnPct, cumulativeReturnPct: growth * 100, depleted };

    if (mode !== 'compound') {
      const achieved = currentCapital >= targetCapital;
      const progress = capitalChange / (targetCapital - startCapital);
      return {
        ...shared,
        remainingCapital: achieved ? 0 : targetCapital - currentCapital,
        progressPct: Math.min(1, Math.max(0, progress)) * 100,
        achieved,
      };
    }

    let equivalentWins = null;
    let remainingWins = null;
    if (!depleted) {
      let currentLog;
      if (Math.abs(growth) < 0.5) {
        currentLog = Math.log1p(growth);
      } else if (capitalRatio > 0 && Number.isFinite(capitalRatio)) {
        currentLog = Math.log(capitalRatio);
      } else {
        currentLog = Math.log(currentCapital) - Math.log(startCapital);
      }
      equivalentWins = snapInteger(currentLog / logPerWin, logPerWin);
      remainingWins = Math.max(0, Math.ceil(snapInteger(targetWins - equivalentWins, logPerWin)));
    }

    const achieved = remainingWins === 0;
    return {
      ...shared,
      equivalentWins,
      remainingWins,
      remainingCapital: achieved ? 0 : Math.max(0, targetCapital - currentCapital),
      progressPct: depleted ? 0 : Math.min(1, Math.max(0, equivalentWins / targetWins)) * 100,
      achieved,
    };
  }

  const api = { calculateCapital, calculateTarget, normalizeGoal, compoundSchedule };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.GoalCapital = api;
})();
