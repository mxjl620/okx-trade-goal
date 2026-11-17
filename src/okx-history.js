(function (root) {
  'use strict';

  const titles = {
    instrument: /^(?:交易品种|交易品種|交易产品|交易產品|instrument(?: name)?|symbol)$/i,
    status: /^(?:仓位状态|倉位狀態|position status|status)$/i,
    pnl: /^(?:已实现收益|已實現收益|已实现盈亏|已實現盈虧|realized (?:pnl|p&l))$/i,
    size: /^(?:最大持仓量|最大持倉量|max(?:imum)? position (?:size|quantity))$/i,
    mode: /^(?:保证金模式|保證金模式|仓位模式|倉位模式|margin mode)$/i,
    openedAt: /^(?:开仓时间|開倉時間|open(?:ed|ing)? time)$/i,
    closedAt: /^(?:平仓时间|平倉時間|close(?:d|ing)? time)$/i,
  };
  const fullClose = /^(?:全部平仓|全部平倉|完全平仓|完全平倉|全部强平|全部強平|完全强平|完全強平|close all|fully closed|full close|closed|fully liquidated|full liquidation)$/i;
  const incompleteClose = /^(?:部分平仓|部分平倉|部分强平|部分強平|未平仓|未平倉|持仓中|持倉中|partially closed|partial close|partial liquidation|partially liquidated|open)$/i;
  const autoDeleveraging = /^(?:自动减仓|自動減倉|adl|auto[- ]deleveraging)$/i;
  const empty = /^(?:暂无(?:数据|记录|历史仓位)|暫無(?:數據|記錄|歷史倉位)|no (?:data|records|position history)(?: available)?)[.!。]?$/i;

  function normalize(value) {
    return String(value ?? '').normalize('NFKC').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim();
  }

  function shown(node) {
    if (!node.getClientRects().length || node.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
    const { visibility, display } = node.ownerDocument.defaultView.getComputedStyle(node);
    return display !== 'none' && visibility !== 'hidden' && visibility !== 'collapse';
  }

  function renderedText(node) {
    return normalize(node.innerText ?? node.textContent);
  }

  function matchesCaption(node, pattern) {
    if (pattern.test(renderedText(node))) return true;
    return [...node.querySelectorAll('div, span, strong, small')].some(part => shown(part) && pattern.test(renderedText(part)));
  }

  function parseTimestamp(value) {
    const match = /^(\d{4})([-/])(\d{1,2})\2(\d{1,2})[ T](\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(normalize(value));
    if (!match) return null;
    const [, year, , month, day, hour, minute, second, fraction = '', zone] = match;
    const utcBase = new Date(0);
    utcBase.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
    utcBase.setUTCHours(Number(hour), Number(minute), Number(second), Number(fraction.padEnd(3, '0')));
    if (utcBase.getUTCFullYear() !== Number(year) || utcBase.getUTCMonth() !== Number(month) - 1 ||
        utcBase.getUTCDate() !== Number(day) || utcBase.getUTCHours() !== Number(hour) ||
        Number(minute) > 59 || Number(second) > 59) return null;

    if (zone) {
      if (zone.toUpperCase() === 'Z') return utcBase.getTime();
      const offset = zone.slice(1).replace(':', '');
      const hours = Number(offset.slice(0, 2));
      const minutes = Number(offset.slice(2));
      if (hours > 23 || minutes > 59) return null;
      return utcBase.getTime() - (zone[0] === '-' ? -1 : 1) * (hours * 60 + minutes) * 60_000;
    }

    // The history view's Intl formatter omits timeZone, so it displays the browser's local wall time.
    const local = new Date(0);
    local.setFullYear(Number(year), Number(month) - 1, Number(day));
    local.setHours(Number(hour), Number(minute), Number(second), Number(fraction.padEnd(3, '0')));
    if (local.getFullYear() !== Number(year) || local.getMonth() !== Number(month) - 1 ||
        local.getDate() !== Number(day) || local.getHours() !== Number(hour) || local.getMinutes() !== Number(minute)) return null;
    const at = local.getTime();
    // A repeated wall time at a clock change cannot identify one actual close without an offset.
    const laterOffset = new Date(at + 86_400_000).getTimezoneOffset();
    const offsetChange = laterOffset - local.getTimezoneOffset();
    if (offsetChange > 0 && new Date(at + offsetChange * 60_000).getTimezoneOffset() === laterOffset) return null;
    return at;
  }

  function parsePnl(value) {
    const match = /^([+\-−]?\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s+([A-Z][A-Z0-9]{1,11})$/.exec(normalize(value));
    if (!match) return null;
    const netPnl = Number(match[1].replace(/[\s,]/g, '').replace('−', '-'));
    return Number.isFinite(netPnl) ? { currency: match[2], netPnl } : null;
  }

  function marginMode(value) {
    const text = renderedText(value);
    const isolated = /逐[仓倉]|\bisolated\b/i.test(text);
    const cross = /全[仓倉]|\bcross\b/i.test(text);
    return isolated === cross ? null : isolated ? 'isolated' : 'cross';
  }

  function readTime(cell) {
    const times = [...cell.querySelectorAll('time[datetime]')].filter(shown);
    if (times.length > 1) return null;
    return parseTimestamp(times.length ? times[0].getAttribute('datetime') : renderedText(cell));
  }

  function readPnl(cell) {
    const values = [...cell.querySelectorAll('[class*="original-field_item-content__"]')].filter(shown);
    if (values.length > 1) return null;
    return parsePnl(renderedText(values[0] ?? cell));
  }

  function instrumentKey(value) {
    const match = /^([A-Z0-9/_-]+)(?:\s+(永续|永續|交割|期权|期權|PERPETUAL(?: SWAP| FUTURES)?|(?:EXPIRY )?FUTURES|OPTIONS?))?$/.exec(value.toUpperCase());
    if (!match) return null;
    const [, symbol, product] = match;
    if (!product) return symbol;
    const family = /^(?:永续|永續|PERPETUAL)/.test(product) ? 'SWAP'
      : /^(?:交割|(?:EXPIRY )?FUTURES)/.test(product) ? 'FUTURES' : 'OPTION';
    return `${symbol} ${family}`;
  }

  function tableRows(table, section) {
    return [...table.querySelectorAll(`${section} > tr`)].filter(row => row.closest('table') === table && shown(row));
  }

  function readHeader(row) {
    const cells = [...row.cells];
    const fields = {};
    for (const [name, pattern] of Object.entries(titles)) {
      const matches = cells.flatMap((cell, index) => shown(cell) && matchesCaption(cell, pattern) ? [index] : []);
      if (matches.length > 1) return null;
      if (matches.length) fields[name] = matches[0];
    }
    if (['instrument', 'status', 'pnl', 'openedAt', 'closedAt'].some(name => fields[name] == null) ||
        (fields.mode == null && fields.size == null) || new Set(Object.values(fields)).size !== Object.keys(fields).length) return null;
    return { fields, width: cells.length };
  }

  function readRow(row, header) {
    const cells = [...row.cells];
    const { fields, width } = header;
    if (cells.length !== width) return { issue: true };
    const statusCell = cells[fields.status];
    const badges = [...statusCell.querySelectorAll('button, [role="button"]')].filter(shown);
    const status = renderedText(badges.length === 1 ? badges[0] : statusCell);
    if (incompleteClose.test(status)) return {};
    const isAdl = autoDeleveraging.test(status);
    if (!fullClose.test(status) && !isAdl) return { issue: true };
    const closingTime = cells[fields.closedAt];
    // OKX labels full and partial ADL the same; only the full record gets a close timestamp.
    if (isAdl && /^[-–—]*$/.test(renderedText(closingTime))) return {};

    const instrumentCell = cells[fields.instrument];
    const instruments = [...instrumentCell.querySelectorAll('[class*="pos-info_inst-id__"]')].filter(shown);
    if (instruments.length > 1) return { issue: true };
    const instrument = instrumentKey(renderedText(instruments[0] ?? instrumentCell));
    const mode = marginMode(cells[fields.mode ?? fields.size]);
    const openedAt = readTime(cells[fields.openedAt]);
    const closedAt = readTime(closingTime);
    const pnl = readPnl(cells[fields.pnl]);
    if (!instrument || !mode || openedAt == null || closedAt == null || openedAt > closedAt || !pnl) return { issue: true };
    const id = JSON.stringify([instrument, mode, openedAt, closedAt, pnl.currency]);
    return { record: { id, closedAt, ...pnl } };
  }

  function hasEmptyState(box) {
    return [...box.querySelectorAll('.okui-empty, .empty-box, p, span, div, img[alt], [role="img"][aria-label]')].some(node =>
      shown(node) && empty.test(normalize(node.getAttribute('alt') || node.getAttribute('aria-label') || renderedText(node))));
  }

  function read(document) {
    const boxes = [...document.querySelectorAll('.history-position-box')].filter(box => shown(box) ||
      [...box.querySelectorAll('table, .okui-empty, img[alt]')].some(shown));
    if (!boxes.length) return undefined;
    if (boxes.length !== 1) return { records: [], issue: '检测到多个历史仓位区域，请只显示一个历史仓位表。' };
    const box = boxes[0];
    if (box.matches('[aria-busy="true"]') || [...box.querySelectorAll('[aria-busy="true"], .okui-loader')].some(shown)) {
      return { records: [], issue: '历史仓位正在加载。' };
    }

    const tables = [...box.querySelectorAll('table')].filter(shown);
    const headers = tables.flatMap(table => tableRows(table, 'thead').flatMap(row => {
      const header = readHeader(row);
      return header ? [{ table, header }] : [];
    }));
    if (headers.length !== 1) {
      if (!tables.some(table => tableRows(table, 'tbody').length) && hasEmptyState(box)) return { records: [] };
      return { records: [], issue: '无法确认历史仓位表。请显示仓位状态、已实现收益、保证金模式或最大持仓量，以及开仓和平仓时间。' };
    }

    const [{ table, header }] = headers;
    let rows = tableRows(table, 'tbody');
    if (!rows.length) {
      const bodies = tables.filter(candidate => candidate !== table && tableRows(candidate, 'tbody').length);
      if (bodies.length === 1) rows = tableRows(bodies[0], 'tbody');
      else if (!bodies.length && hasEmptyState(box)) return { records: [] };
      else return { records: [], issue: '历史仓位明细尚未完整显示。' };
    }

    const recordsById = new Map();
    let skipped = 0;
    let ambiguous = 0;
    for (const row of rows) {
      const { record, issue } = readRow(row, header);
      if (!record) {
        skipped += 1;
        if (issue) ambiguous += 1;
        continue;
      }
      if (recordsById.has(record.id)) {
        const duplicateAlreadySeen = recordsById.get(record.id) === null;
        ambiguous += duplicateAlreadySeen ? 1 : 2;
        skipped += duplicateAlreadySeen ? 1 : 2;
        recordsById.set(record.id, null);
      } else recordsById.set(record.id, record);
    }
    const result = { records: [...recordsById.values()].filter(Boolean).sort((a, b) => a.closedAt - b.closedAt), skipped };
    if (ambiguous) result.issue = `有 ${ambiguous} 条仓位记录的完整平仓状态、时间、收益或唯一标识无法确认，已跳过。`;
    return result;
  }

  const api = Object.freeze({ read });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GoalOkxHistory = api;
})(globalThis);
