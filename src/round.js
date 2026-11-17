(function () {
  'use strict';

  const SAMPLE_INTERVAL_MS = 60_000;
  const MAX_POINTS = 720;

  function validTime(at) {
    return Number.isSafeInteger(at) && at >= 0;
  }

  function validObservation(capital, at) {
    return Number.isFinite(capital) && validTime(at);
  }

  function balanceNoise(left, right) {
    return 4 * Number.EPSILON * Math.max(Math.abs(left), Math.abs(right));
  }

  function newRound(startCapital, at, realizedBase = startCapital) {
    if (!Number.isFinite(startCapital)) throw new RangeError('本轮起始资金必须是有限数字。');
    if (!validTime(at)) throw new RangeError('本轮起始时间无效。');
    if (!Number.isFinite(realizedBase)) throw new RangeError('本轮已实现资金基准无效。');
    return {
      startedAt: at,
      highWater: startCapital,
      highWaterAt: at,
      observedAt: at,
      points: [{ at, capital: startCapital }],
      realizedLedger: { base: realizedBase, closes: [] },
    };
  }

  function thin(points) {
    if (points.length <= MAX_POINTS) return points;
    // Keep the start and preserve more detail around recent activity.
    const recentStart = Math.floor(points.length / 2);
    return points.filter((_, index) => index >= recentStart || index % 2 === 0);
  }

  function record(round, capital, at) {
    if (!round || !validObservation(capital, at) || at < round.observedAt) return round;
    const last = round.points.at(-1);
    const keepPoint = capital !== last.capital && at - last.at >= SAMPLE_INTERVAL_MS;
    const newHigh = capital - round.highWater > balanceNoise(capital, round.highWater);
    if (!keepPoint && !newHigh) return round;
    return {
      ...round,
      highWater: newHigh ? capital : round.highWater,
      highWaterAt: newHigh ? at : round.highWaterAt,
      observedAt: at,
      points: keepPoint ? thin([...round.points, { at, capital }]) : round.points,
    };
  }

  function addPoint(points, point) {
    const index = points.findIndex(previous => previous.at >= point.at);
    if (index < 0) points.push(point);
    else if (points[index].at !== point.at) points.splice(index, 0, point);
  }

  function drawdownFrom(highWater, capital) {
    const difference = highWater - capital;
    const drawdown = difference <= balanceNoise(highWater, capital) ? 0 : difference;
    const percent = highWater > 0
      ? (Number.isFinite(drawdown) ? drawdown / highWater : 1 - capital / highWater) * 100
      : null;
    return {
      drawdownAmount: Number.isFinite(drawdown) ? drawdown : null,
      drawdownPct: Number.isFinite(percent) ? percent : null,
    };
  }

  function view(round, currentCapital, at) {
    if (!round) return { startedAt: null, points: [] };

    const points = round.points.slice();
    addPoint(points, { at: round.highWaterAt, capital: round.highWater });
    if (validObservation(currentCapital, at) && at >= round.observedAt) {
      addPoint(points, { at, capital: currentCapital });
    }
    return { startedAt: round.startedAt, points };
  }

  function realizedLedger(round) {
    return round.realizedLedger ?? { base: round.points[0].capital, closes: [] };
  }

  function summarizeLedger({ base, closes }) {
    let highWater = base;
    let capital = base;
    for (let i = 0; i < closes.length;) {
      // The history table can round timestamps to the second. Do not invent
      // an intrasecond peak when the order of closes is not distinguishable.
      const time = closes[i].closedAt;
      let sum = 0;
      do {
        sum += closes[i++].netPnl;
      } while (i < closes.length && closes[i].closedAt === time);
      capital += sum;
      highWater = Math.max(highWater, capital);
    }
    return { capital, highWater };
  }

  function recordCloses(round, records, currency, now) {
    if (!round || !Array.isArray(records) || !records.length || !validTime(now)) return round;
    const ledger = realizedLedger(round);
    const known = new Set(ledger.closes.map(item => item.id));
    const candidates = new Map();
    for (const entry of records) {
      const { id, netPnl, closedAt } = entry ?? {};
      if (entry?.currency !== currency || typeof id !== 'string' || !id || id.length > 512 || known.has(id) ||
          !validObservation(netPnl, closedAt) || closedAt < round.startedAt || closedAt > now) continue;
      if (candidates.has(id)) {
        const previous = candidates.get(id);
        if (!previous || previous.closedAt !== closedAt || previous.netPnl !== netPnl) candidates.set(id, null);
      } else {
        candidates.set(id, { id, closedAt, netPnl });
      }
    }
    const additions = [...candidates.values()].filter(Boolean);
    if (!additions.length) return round;
    const closes = ledger.closes.concat(additions).sort((a, b) => a.closedAt - b.closedAt ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const updated = { base: ledger.base, closes };
    if (!Number.isFinite(summarizeLedger(updated).capital)) return round;
    return { ...round, realizedLedger: updated };
  }

  function realizedBalance(round) {
    return round ? summarizeLedger(realizedLedger(round)).capital : undefined;
  }

  function settledView(round) {
    if (!round?.realizedLedger?.closes?.length) return undefined;
    const { capital, highWater } = summarizeLedger(round.realizedLedger);
    return { ...drawdownFrom(highWater, capital), count: round.realizedLedger.closes.length };
  }

  const api = Object.freeze({ newRound, record, view, recordCloses, realizedBalance, settledView });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.GoalRound = api;
})();
