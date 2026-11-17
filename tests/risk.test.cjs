const assert = require('node:assert/strict');
const test = require('node:test');
const { breakEvenLossPct, drawdownLossPct } = require('../src/risk.js');

function near(actual, expected, tolerance = 1e-12) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
}

test('5% winner return at 50% win rate breaks even at a 4.7619% loss', () => {
  near(breakEvenLossPct(5, 50), 4.761904761904762);
  const loss = breakEvenLossPct(8.25, 37.5);
  near((1.0825 ** 0.375) * ((1 - loss / 100) ** 0.625), 1);
});

test('returns the limits at 0 and 100% win rates and rejects invalid percentages', () => {
  assert.equal(breakEvenLossPct(5, 0), 0);
  assert.equal(breakEvenLossPct(5, 100), 100);
  for (const [target, wins] of [[0, 50], [-5, 50], [Infinity, 50], ['5', 50], [5, -1], [5, 101], [5, NaN]]) {
    assert.equal(breakEvenLossPct(target, wins), null);
  }
});

test('retains tiny break-even results and remains finite near 100% win rate', () => {
  near(breakEvenLossPct(1e-10, 50), 1e-10 / (1 + 1e-12), 1e-25);
  assert.equal(breakEvenLossPct(Number.MIN_VALUE, 50), Number.MIN_VALUE);
  assert.equal(breakEvenLossPct(5, 99.99999999999999), 100);
});

test('ten 1.04807% losses produce a 10% drawdown', () => {
  const loss = drawdownLossPct(10, 10);
  near(loss, 1.048074179378568);
  near(100 * (1 - (1 - loss / 100) ** 10), 10);
});

test('handles drawdown bounds, an exact one-loss cap and very long streaks', () => {
  assert.equal(drawdownLossPct(0, 10), 0);
  assert.equal(drawdownLossPct(99.99999999999999, 1), 99.99999999999999);
  near(drawdownLossPct(99.9999, 2), 99.9, 2e-11);
  near(drawdownLossPct(1e-10, 10), 1e-11, 1e-22);
  assert.equal(drawdownLossPct(Number.MIN_VALUE * 2, 2), Number.MIN_VALUE);
  assert.ok(drawdownLossPct(10, Number.MAX_SAFE_INTEGER) > 0);
  for (const [drawdown, losses] of [[-1, 10], [100, 10], [NaN, 10], [10, 0], [10, 2.5], [10, '10'], [10, Number.MAX_SAFE_INTEGER + 1]]) {
    assert.equal(drawdownLossPct(drawdown, losses), null);
  }
});
