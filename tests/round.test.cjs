const assert = require('node:assert/strict');
const test = require('node:test');
const { newRound, record, view, recordCloses, realizedBalance, settledView } = require('../src/round.js');

const minute = 60_000;

test('shows a recent peak and a live point between recorded chart samples', () => {
  const start = newRound(100, 0);
  const peak = record(start, 120, 5_000);
  assert.equal(peak.points, start.points);
  assert.equal(record(peak, 90, 10_000), peak);
  assert.deepEqual(view(peak, 90, 10_000), {
    startedAt: 0,
    points: [{ at: 0, capital: 100 }, { at: 5_000, capital: 120 }, { at: 10_000, capital: 90 }],
  });
  assert.deepEqual(view(peak, 130, 11_000).points.at(-1), { at: 11_000, capital: 130 });
});

test('records changed balances at intervals, ignores invalid and stale samples, and retains the anchor', () => {
  const start = newRound(100, 1_000);
  assert.equal(record(start, null, 10 * minute), start);
  assert.equal(record(start, 95, minute), start);
  const next = record(start, 95, minute + 1_000);
  assert.deepEqual(next.points, [{ at: 1_000, capital: 100 }, { at: 61_000, capital: 95 }]);
  assert.equal(record(next, 200, 2_000), next);
  assert.equal(record(next, 95, 2 * minute), next);
  assert.deepEqual(view(next, NaN, 3 * minute), {
    startedAt: 1_000,
    points: next.points,
  });
  assert.deepEqual(view(next, 95, 2_000).points, next.points);
  assert.deepEqual(view(start, 80, 1_000).points, start.points);
});

test('plots zero and negative balances and validates the chart anchor', () => {
  const round = newRound(100, 0);
  assert.deepEqual(view(round, 0, minute).points.at(-1), { at: minute, capital: 0 });
  const depleted = record(newRound(0, 0), -20, minute);
  assert.deepEqual(view(depleted, -20, minute), {
    startedAt: 0,
    points: [{ at: 0, capital: 0 }, { at: minute, capital: -20 }],
  });
  assert.throws(() => newRound(Infinity, 0), /起始资金/);
  assert.throws(() => newRound(100, -1), /起始时间/);
});

test('bounds saved points and recovers the chronological peak after pruning and serialization', () => {
  let round = newRound(100, 0);
  round = record(round, 150, minute);
  for (let i = 2; i <= 1_500; i += 1) round = record(round, i % 2 ? 90 : 91, i * minute);
  assert.ok(round.points.length <= 720);
  assert.deepEqual(round.points[0], { at: 0, capital: 100 });
  assert.equal(round.points.at(-1).at, 1_500 * minute);
  assert.equal(round.highWater, 150);
  assert.ok(!round.points.some(point => point.capital === 150));
  const restored = view(JSON.parse(JSON.stringify(round)), 75, 1_501 * minute);
  assert.deepEqual(restored.points[1], { at: minute, capital: 150 });
  assert.deepEqual(restored.points.at(-1), { at: 1_501 * minute, capital: 75 });
  assert.ok(restored.points.every((point, i) => !i || point.at > restored.points[i - 1].at));
});

const closed = (id, closedAt, netPnl, currency = 'USDT') => ({ id, closedAt, netPnl, currency });
const ingest = (round, ...closes) => recordCloses(round, closes, 'USDT', 10_000);

test('uses closed positions independently of other live equity and migrates past flat checkpoints safely', () => {
  const { realizedLedger: discarded, ...beforeUpgrade } = newRound(1000, 1_000);
  const legacy = { ...beforeUpgrade, settled: { highWater: 1300, lastAmount: 900 } };
  assert.equal(settledView(legacy), undefined);
  const peak = record(legacy, 1500, 2_000);
  const loss = ingest(peak, closed('one', 3_000, -100));
  assert.deepEqual(settledView(loss), { drawdownAmount: 100, drawdownPct: 10, count: 1 });
  assert.equal(realizedBalance(loss), 900);
  assert.equal(loss.highWater, 1500);
  assert.deepEqual(settledView(record(loss, 2000, 4_000)), settledView(loss));
});

test('deduplicates across reloads and backfills older records before computing the peak', () => {
  const win = closed('win', 3_000, 50);
  const loss = closed('loss', 5_000, -30);
  const partialHistory = ingest(newRound(100, 0), loss);
  const restored = JSON.parse(JSON.stringify(partialHistory));
  const backfilled = ingest(restored, loss, win);
  assert.deepEqual(backfilled.realizedLedger.closes.map(item => item.id), ['win', 'loss']);
  assert.deepEqual(settledView(backfilled), { drawdownAmount: 30, drawdownPct: 20, count: 2 });
  assert.equal(ingest(backfilled, win, loss), backfilled);
  const recovered = ingest(backfilled, closed('recover', 9_000, 80));
  assert.deepEqual(settledView(recovered), { drawdownAmount: 0, drawdownPct: 0, count: 3 });
});

test('filters foreign, invalid, old, future and conflicting records; a reset keeps its own realized basis', () => {
  const round = newRound(500, 2_000, 0);
  assert.equal(ingest(round, closed('before', 1_999, 5), closed('future', 10_001, 2),
    closed('btc', 3_000, 2, 'BTC'), closed('invalid', 3_000, NaN),
    closed('collision', 3_000, -8), closed('collision', 3_000, -4)), round);
  const next = ingest(round, closed('one', 3_000, -10));
  assert.equal(realizedBalance(next), -10);
  assert.deepEqual(settledView(next), { drawdownAmount: 10, drawdownPct: null, count: 1 });
  assert.equal(settledView(ingest(newRound(500, 10_000, realizedBalance(next)), closed('one', 3_000, -10))), undefined);
});

test('uses one checkpoint for distinct closes with the same displayed timestamp', () => {
  const round = ingest(newRound(100, 0), closed('a', 4_000, 50), closed('b', 4_000, -60));
  assert.deepEqual(settledView(round), { drawdownAmount: 10, drawdownPct: 10, count: 2 });
});
