const assert = require('node:assert/strict');
const test = require('node:test');
const { calculateCapital, calculateTarget, normalizeGoal, compoundSchedule } = require('../src/capital.js');

const account = { available: 900, mode: 'cross', currency: 'USDT' };
const position = (mode, margin, pnl, currency = 'USDT') => ({ mode, margin, pnl, currency });
const goal = { startCapital: 1000, targetPct: 5, targetWins: 3 };
const closeTo = (value, expected) => assert.ok(Math.abs(value - expected) < 1e-10, `${value} ≠ ${expected}`);

test('uses available funds as the entire capital when there are no positions', () => {
  assert.deepEqual(calculateCapital({ ...account, positions: [] }), {
    currentCapital: 900,
    available: 900,
    positionMargin: 0,
    isolatedMargin: 0,
    crossMargin: 0,
    includedPnl: 0,
    crossPnl: null,
    includedPositions: 0,
    foreignIgnored: 0,
    isolatedCount: 0,
    crossCount: 0,
    mixedModes: false,
    mode: 'cross',
    currency: 'USDT',
  });
});

test('sums all matching margins but adds floating profit and loss only for isolated positions', () => {
  const positions = [
    position('cross', 100, 50),
    position('isolated', 80, -15, ' usdt '),
    position('isolated', 25, 10),
    position('cross', 0.05, 0.01, 'BTC'),
  ];
  for (const mode of ['cross', 'isolated']) {
    const result = calculateCapital({ ...account, mode, positions });
    assert.equal(result.currentCapital, 1100);
    assert.equal(result.positionMargin, 205);
    assert.equal(result.includedPnl, -5);
    assert.equal(result.includedPositions, 3);
    assert.equal(result.crossCount, 1);
    assert.equal(result.isolatedCount, 2);
    assert.equal(result.foreignIgnored, 1);
    assert.equal(result.mixedModes, true);
  }
});

test('does not require unused cross PnL and rejects unreadable matching positions', () => {
  const result = calculateCapital({ ...account, positions: [position('cross', 20, null)] });
  assert.equal(result.currentCapital, 920);
  assert.equal(result.crossPnl, null);
  assert.equal(result.mixedModes, false);
  assert.throws(() => calculateCapital({ ...account, positions: [position('isolated', 20, null)] }), /浮动盈亏/);
  assert.throws(() => calculateCapital({ ...account, positions: [position('cross', NaN, 5)] }), /保证金/);
  assert.throws(() => calculateCapital({ ...account, positions: [position('cross', 20, 5, '')] }), /币种/);
});

test('shows cross and isolated margin and PnL separately without changing the capital formula', () => {
  const positions = [
    { ...position('cross', 120.25, 0), crossPnl: -22.50 },
    position('isolated', 24.75, -5.50),
    position('cross', 0.05, null, 'BTC'),
  ];
  for (const mode of ['cross', 'isolated']) {
    const result = calculateCapital({ ...account, mode, positions });
    closeTo(result.currentCapital, 1039.5);
    closeTo(result.positionMargin, 145);
    assert.equal(result.crossMargin, 120.25);
    assert.equal(result.isolatedMargin, 24.75);
    assert.equal(result.crossPnl, -22.50);
    assert.equal(result.includedPnl, -5.50);
    assert.equal(result.crossCount, 1);
    assert.equal(result.isolatedCount, 1);
    assert.equal(result.includedPositions, 2);
  }
  const partial = calculateCapital({ ...account, positions: [...positions, position('cross', 8, 0)] });
  assert.equal(partial.crossPnl, null);
  closeTo(partial.currentCapital, 1047.5);
});

test('computes compounded steps and additional capital from a live balance', () => {
  const progress = calculateTarget(goal, 1102.5);
  closeTo(progress.targetCapital, 1157.625);
  closeTo(progress.targetReturnPct, 15.7625);
  closeTo(progress.cumulativeReturnPct, 10.25);
  assert.equal(progress.equivalentWins, 2);
  assert.equal(progress.remainingWins, 1);
  closeTo(progress.remainingCapital, 55.125);
  closeTo(progress.progressPct, 200 / 3);
  assert.equal(progress.achieved, false);
});

test('lists before and after capital on every win through exactly the calculated target', () => {
  const schedule = compoundSchedule(goal);
  assert.equal(schedule.total, 3);
  assert.deepEqual(schedule.rows.map(row => row.win), [1, 2, 3]);
  assert.equal(schedule.rows[0].fromCapital, 1000);
  closeTo(schedule.rows[0].capital, 1050);
  closeTo(schedule.rows[1].capital, 1102.5);
  assert.equal(schedule.rows[1].fromCapital, schedule.rows[0].capital);
  assert.equal(schedule.rows[2].fromCapital, schedule.rows[1].capital);
  assert.equal(schedule.rows[2].capital, calculateTarget(goal, 1000).targetCapital);
  assert.deepEqual(compoundSchedule(goal, { offset: 1, limit: 2 }), { total: 3, rows: schedule.rows.slice(1, 3) });
  assert.deepEqual(compoundSchedule(goal, { offset: 3 }), { total: 3, rows: [] });
  assert.deepEqual(compoundSchedule({ ...goal, targetWins: 1 }), {
    total: 1,
    rows: [{ win: 1, fromCapital: 1000, capital: 1050 }],
  });
});

test('pages ten wins by default and carries the same boundary amount into the next page', () => {
  const longer = { ...goal, targetWins: 21 };
  const first = compoundSchedule(longer);
  assert.equal(first.rows.length, 10);
  assert.equal(first.rows.at(-1).win, 10);
  const second = compoundSchedule(longer, { offset: 10 });
  assert.equal(second.rows.length, 10);
  assert.equal(second.rows[0].win, 11);
  assert.equal(second.rows[0].fromCapital, first.rows.at(-1).capital);
  const last = compoundSchedule(longer, { offset: 20 });
  assert.equal(last.rows.length, 1);
  assert.equal(last.rows[0].win, 21);
  assert.equal(last.rows[0].fromCapital, second.rows.at(-1).capital);
  assert.equal(last.rows[0].capital, calculateTarget(longer, 1000).targetCapital);
});

test('bounds the number of rows even for very long schedules and supports seeking directly to the end', () => {
  const many = { mode: 'compound', startCapital: 1000, targetPct: 1e-14, targetWins: Number.MAX_SAFE_INTEGER };
  const first = compoundSchedule(many, { limit: Number.MAX_SAFE_INTEGER });
  assert.equal(first.total, many.targetWins);
  assert.equal(first.rows.length, 100);
  const last = compoundSchedule(many, { offset: many.targetWins - 2 });
  assert.deepEqual(last.rows.map(row => row.win), [many.targetWins - 1, many.targetWins]);
  assert.equal(last.rows.at(-1).capital, calculateTarget(many, 1000).targetCapital);
});

test('uses the fallback for large compound growth and rejects invalid schedule arguments', () => {
  const smallBase = { startCapital: 1e-300, targetPct: 100, targetWins: 1100 };
  const { rows } = compoundSchedule(smallBase, { offset: 1098 });
  assert.ok(rows.every(row => Number.isFinite(row.capital)));
  assert.ok(rows[0].capital < rows[1].capital);
  assert.equal(rows[1].capital, calculateTarget(smallBase, 1000).targetCapital);
  assert.throws(() => compoundSchedule(goal, { offset: -1 }), /显示笔数/);
  assert.throws(() => compoundSchedule(goal, { limit: 0 }), /显示笔数/);
  assert.throws(() => compoundSchedule({ mode: 'amount', startCapital: 1000, growthAmount: 100 }), /复利连赢/);
});

test('tracks a drawdown from the chosen start and rounds remaining wins up', () => {
  const progress = calculateTarget(goal, 900);
  closeTo(progress.cumulativeReturnPct, -10);
  assert.ok(progress.equivalentWins < 0);
  assert.equal(progress.remainingWins, 6);
  closeTo(progress.remainingCapital, 257.625);
  assert.equal(progress.progressPct, 0);
});

test('recognizes an exact compounded target and tiny per-win percentages', () => {
  const exact = calculateTarget(goal, 1157.625);
  assert.equal(exact.equivalentWins, 3);
  assert.equal(exact.remainingWins, 0);
  assert.equal(exact.remainingCapital, 0);
  assert.equal(exact.progressPct, 100);
  assert.equal(exact.achieved, true);
  assert.equal(calculateTarget({ ...goal, targetPct: 0.0001, targetWins: 1 }, 1000.001).achieved, true);
  assert.equal(calculateTarget(goal, 1157.624999).achieved, false);
});

test('reports actual zero or negative capital and does not project wins from it', () => {
  for (const currentCapital of [0, -50]) {
    const progress = calculateTarget(goal, currentCapital);
    assert.equal(progress.cumulativeReturnPct, currentCapital === 0 ? -100 : -105);
    assert.equal(progress.equivalentWins, null);
    assert.equal(progress.remainingWins, null);
    assert.equal(progress.progressPct, 0);
    assert.equal(progress.achieved, false);
    assert.equal(progress.depleted, true);
  }
  const capital = calculateCapital({ ...account, available: 10, positions: [position('isolated', 20, -35)] });
  assert.equal(capital.currentCapital, -5);
});

test('normalizes saved compound goals and preserves their existing calculation', () => {
  const normalized = normalizeGoal({ ...goal, unrelated: true });
  assert.deepEqual(normalized, { mode: 'compound', ...goal });
  assert.deepEqual(calculateTarget(normalized, 1102.5), calculateTarget(goal, 1102.5));
});

test('tracks a percentage growth goal using capital gained from the chosen start', () => {
  const percent = { mode: 'percent', startCapital: 1000, growthPct: 20 };
  const progress = calculateTarget(percent, 1075);
  assert.deepEqual(normalizeGoal(percent), percent);
  assert.equal(progress.targetCapital, 1200);
  assert.equal(progress.targetReturnPct, 20);
  assert.equal(progress.cumulativeReturnPct, 7.5);
  assert.equal(progress.remainingCapital, 125);
  assert.equal(progress.progressPct, 37.5);
  assert.equal(progress.achieved, false);
  assert.equal('remainingWins' in progress, false);
  assert.equal(calculateTarget(percent, 1200).achieved, true);
  assert.equal(calculateTarget(percent, 1200).remainingCapital, 0);
});

test('tracks an amount goal above target and during a drawdown', () => {
  const amount = { mode: 'amount', startCapital: 1000, growthAmount: 400 };
  assert.deepEqual(normalizeGoal(amount), amount);
  const partial = calculateTarget(amount, 1100);
  assert.equal(partial.targetCapital, 1400);
  assert.equal(partial.targetReturnPct, 40);
  assert.equal(partial.remainingCapital, 300);
  assert.equal(partial.progressPct, 25);
  const loss = calculateTarget(amount, -50);
  assert.equal(loss.cumulativeReturnPct, -105);
  assert.equal(loss.remainingCapital, 1450);
  assert.equal(loss.progressPct, 0);
  assert.equal(loss.depleted, true);
  const exceeded = calculateTarget(amount, 1500);
  assert.equal(exceeded.remainingCapital, 0);
  assert.equal(exceeded.progressPct, 100);
  assert.equal(exceeded.achieved, true);
});

test('rejects invalid, overflowing, and indistinguishable targets when reading or saving goals', () => {
  const cases = [
    [undefined, /起始资金/],
    [{ ...goal, mode: 'other' }, /目标类型/],
    [{ mode: 'percent', startCapital: 1000, growthPct: 0 }, /增长百分比/],
    [{ mode: 'amount', startCapital: 1000, growthAmount: Infinity }, /增长金额/],
    [{ mode: 'amount', startCapital: 1000, growthAmount: 1e-20 }, /无法与起始资金区分/],
    [{ mode: 'percent', startCapital: 1e308, growthPct: 100 }, /超出计算范围/],
    [{ ...goal, targetWins: 1000000 }, /超出计算范围/],
  ];
  for (const [settings, reason] of cases) {
    assert.equal(normalizeGoal(settings), undefined);
    assert.throws(() => calculateTarget(settings, 1000), reason);
  }
});
