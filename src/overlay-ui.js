(function () {
  'use strict';

  const numbers = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 4 });
  const moneyNumbers = new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
  const times = new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const dates = new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const progressNumbers = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 });
  const compactProgressNumbers = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const schedulePageSize = 10;
  const drawdownMessage = '保持冷静，避免情绪化交易';
  const drawdownEnglish = 'STAY CALM. DON’T REVENGE TRADE.';
  const goalModes = Object.freeze({
    compound: { title: '复利连赢', fields: ['targetPct', 'targetWins'] },
    percent: { title: '按百分比增长', fields: ['growthPct'] },
    amount: { title: '按固定金额增长', fields: ['growthAmount'] },
  });

  function readGoalNumber(raw) {
    const text = raw.trim();
    return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text) ? Number(text) : NaN;
  }

  function formatNumber(value, money = false) {
    if (!Number.isFinite(value)) return value === Infinity ? '∞' : '—';
    if (Math.abs(value) >= 1e12 || (value !== 0 && Math.abs(value) < 0.0001)) {
      return value.toExponential(2);
    }
    return (money ? moneyNumbers : numbers).format(value);
  }

  function formatTime(value) {
    return Number.isFinite(value) ? times.format(value) : '';
  }

  function modeLabel(mode) {
    if (mode === 'cross' || mode === '全仓') return '全仓';
    if (mode === 'isolated' || mode === '逐仓') return '逐仓';
    return '';
  }

  function drawEquity(canvas, points) {
    const { width, height } = canvas.getBoundingClientRect();
    if (width <= 0 || height <= 0 || !points.length) return;
    const scale = Math.min(globalThis.devicePixelRatio || 1, 3);
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(scale, scale);
    let low = points[0].capital;
    let high = low;
    for (const { capital } of points) {
      low = Math.min(low, capital);
      high = Math.max(high, capital);
    }
    const padding = Math.max((high - low) * 0.12, Math.abs(high) * 0.002, 0.001);
    const from = points[0].at;
    const to = points.at(-1).at;
    const label = [formatNumber(high), formatNumber(low)];
    ctx.font = '10px system-ui';
    const left = Math.min(width * 0.32, Math.max(...label.map(text => ctx.measureText(text).width)) + 7);
    const right = width - 5;
    const top = 13;
    const bottom = height - 11;
    const y = value => bottom - (value - (low - padding)) / (high - low + 2 * padding) * (bottom - top);
    const x = point => to === from ? (left + right) / 2 : left + (point.at - from) / (to - from) * (right - left);

    ctx.lineWidth = 1;
    ctx.strokeStyle = '#344159';
    ctx.fillStyle = '#a9b8d0';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const value of low === high ? [low] : [high, low]) {
      const lineY = y(value);
      ctx.beginPath();
      ctx.moveTo(left, lineY);
      ctx.lineTo(right, lineY);
      ctx.stroke();
      ctx.fillText(formatNumber(value), left - 5, lineY, left - 5);
    }

    if (points.length > 1) {
      ctx.beginPath();
      ctx.moveTo(x(points[0]), y(points[0].capital));
      for (const point of points.slice(1)) ctx.lineTo(x(point), y(point.capital));
      ctx.strokeStyle = '#8ab9ff';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    const latest = points.at(-1);
    ctx.beginPath();
    ctx.arc(x(latest), y(latest.capital), 3.5, 0, 2 * Math.PI);
    ctx.fillStyle = '#b0d1ff';
    ctx.fill();
  }

  const styles = `
      :host {
        all: initial !important;
        position: fixed !important;
        z-index: 2147483600 !important;
        display: block !important;
        pointer-events: none !important;
        inset: var(--okx-goal-overlay-top, clamp(104px, 17vh, 154px)) auto auto
          var(--okx-goal-overlay-left, clamp(22px, 3vw, 46px)) !important;
        color-scheme: dark !important;
      }
      *, *::before, *::after { box-sizing: border-box; }
      [hidden] { display: none !important; }
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        margin: -1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }
      .workspace {
        --surface: #141b2a;
        --raised: #1b2537;
        --line: #36445d;
        --text: #eef3fb;
        --muted: #b2bed3;
        --accent: #a2c8ff;
        display: flex;
        align-items: flex-start;
        gap: 8px;
        pointer-events: none;
      }
      .panel, .schedule {
        pointer-events: auto;
        color: var(--text);
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 13px;
        box-shadow: 0 12px 35px #0008, 0 1px 4px #0008;
        font: 12px/1.45 -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
        font-variant-numeric: tabular-nums;
      }
      .panel {
        flex: 0 0 auto;
        width: min(338px, calc(100vw - 58px));
        overflow: hidden;
      }
      .consent { width: min(396px, calc(100vw - 50px)); }
      .consent .body { padding: 12px; }
      .consent .body > p { margin: 0 0 8px; color: var(--muted); overflow-wrap: anywhere; }
      .consent .body strong { color: var(--text); }
      .consent-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
      .consent-actions .save, .consent-actions .secondary { width: auto; margin: 0; padding: 6px 8px; }
      .panel[data-collapsed="true"] { width: max-content; max-width: calc(100vw - 24px); }
      header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 9px 11px 9px 12px;
        border-bottom: 1px solid var(--line);
        background: #1a2435;
      }
      [data-collapsed="true"] header { border-bottom: 0; }
      h2 { margin: 0; flex: 0 0 auto; font-size: 13px; font-weight: 700; letter-spacing: .025em; white-space: nowrap; }
      .brand {
        display: flex;
        flex: 1 1 auto;
        align-items: center;
        gap: 7px;
        min-width: 0;
        cursor: grab;
        touch-action: none;
        user-select: none;
      }
      [data-dragging="true"] .brand { cursor: grabbing; }
      .brand:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 3px; }
      .grip {
        flex: 0 0 8px;
        height: 12px;
        background: radial-gradient(circle, #8192af 1px, transparent 1.3px) 0 0 / 4px 4px;
        opacity: .85;
      }
      .mark {
        display: inline-grid;
        grid-template-columns: repeat(3, 2px);
        align-items: end;
        justify-content: center;
        gap: 2px;
        width: 20px;
        flex: 0 0 20px;
        height: 20px;
        padding-bottom: 5px;
        border-radius: 5px;
        background: #2b4166;
      }
      .mark i { height: 4px; background: #b2d0ff; border-radius: 1px; }
      .mark i:nth-child(2) { height: 7px; }
      .mark i:nth-child(3) { height: 10px; }
      .tools { display: flex; flex: 0 0 auto; align-items: center; gap: 4px; }
      .compact-progress { flex: 0 1 auto; width: max-content; min-width: 82px; margin-left: 3px; }
      .compact-readout { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
      #compact-percent {
        flex: 0 0 7.5ch;
        inline-size: 7.5ch;
        color: var(--accent);
        font-size: 18px;
        font-variant-numeric: tabular-nums;
        font-weight: 750;
        line-height: 1.15;
        white-space: nowrap;
      }
      #compact-remaining {
        padding: 1px 4px;
        border: 0;
        border-radius: 4px;
        background: #2a3a55;
        color: var(--text);
        font-size: 14px;
        font-weight: 650;
        line-height: 1.2;
        white-space: nowrap;
      }
      #compact-remaining:hover, #compact-remaining[aria-expanded="true"] { background: #344d74; color: #fff; }
      .compact-track { height: 6px; margin-top: 4px; overflow: hidden; border-radius: 6px; background: #35435d; }
      button, input, select, summary { font: inherit; }
      button { color: inherit; cursor: pointer; }
      button:focus-visible, summary:focus-visible, input:focus-visible, select:focus-visible {
        outline: 2px solid #a2c8ff;
        outline-offset: 2px;
      }
      button:disabled { opacity: .5; cursor: default; }
      .tool {
        display: grid;
        place-items: center;
        width: 27px;
        height: 25px;
        padding: 0;
        border: 1px solid transparent;
        border-radius: 5px;
        background: none;
        color: #aebabe;
        font-size: 16px;
        line-height: 1;
      }
      .tool:hover:not(:disabled) { color: var(--text); border-color: var(--line); background: #25344d; }
      .body {
        max-height: min(65dvh, 600px, max(0px, calc(100dvh - 62px)));
        overflow: auto;
        overscroll-behavior: contain;
        padding: 11px 12px 12px;
        scrollbar-width: thin;
        scrollbar-color: #455676 transparent;
      }
      .context { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .market { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #afb8bd; }
      .chip {
        flex: 0 0 auto;
        padding: 2px 6px;
        color: #d7e0e2;
        background: #26344c;
        border: 1px solid var(--line);
        border-radius: 4px;
        font-size: 10px;
        letter-spacing: .01em;
      }
      .notice {
        margin: 8px 0 0;
        padding: 7px 8px;
        border-radius: 6px;
        background: var(--raised);
        color: var(--muted);
        overflow-wrap: anywhere;
      }
      .notice[data-tone="error"] { color: #ffcdc2; background: #34211f; }
      .notice[data-tone="warning"] { color: #f5d6a0; background: #302820; }
      .hero { padding: 11px 0 12px; }
      .progress-head { display: flex; align-items: end; justify-content: space-between; gap: 8px; }
      .percent { color: var(--accent); font-size: 27px; line-height: 1.05; letter-spacing: -.035em; }
      .progress-title { display: block; color: var(--muted); font-size: 11px; margin-bottom: 3px; }
      .progress-state { color: var(--muted); text-align: right; }
      .progress-state[data-achieved="true"] { color: var(--accent); font-weight: 700; }
      .compound-progress { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-top: 7px; }
      .need {
        min-width: 0;
        color: #b0b9bd;
        display: flex;
        align-items: baseline;
        gap: 5px;
        white-space: nowrap;
      }
      .need b {
        font-size: 17px;
        line-height: 1.15;
        letter-spacing: -.055em;
        color: var(--accent);
        font-weight: 720;
      }
      .need b[data-compact="true"] { font-size: 13px; letter-spacing: -.02em; }
      .equivalent { color: #c3ccd0; text-align: right; }
      .equivalent span { font-size: 10px; color: var(--muted); margin-right: 4px; }
      .equivalent b { color: #f0f2f4; font-size: 12px; }
      .track { margin-top: 8px; overflow: hidden; height: 10px; border-radius: 8px; background: #35435d; }
      .track, .compact-track { container-type: inline-size; }
      .fill {
        width: 0;
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, #ff738b, #ffcb66 24%, #61e6ad 47%, #55d5ff 68%, #7f9cff 83%, #ca93ff)
          left / 100cqw 100% no-repeat;
      }
      .capital {
        padding: 9px 9px 8px;
        background: var(--raised);
        border: 1px solid var(--line);
        border-radius: 8px;
      }
      .capital-label { display: flex; justify-content: space-between; gap: 5px; color: #b6c0c3; }
      .capital-amount { display: flex; align-items: baseline; gap: 5px; margin-top: 2px; }
      .capital-amount b { font-size: 24px; line-height: 1.2; letter-spacing: -.035em; overflow-wrap: anywhere; }
      .capital-amount span { color: #b1bdc2; font-size: 10px; }
      #change[data-tone="positive"], #isolated-pnl[data-tone="positive"], #cross-pnl[data-tone="positive"] { color: var(--accent); }
      #change[data-tone="negative"], #isolated-pnl[data-tone="negative"], #cross-pnl[data-tone="negative"] { color: #ffd09b; }
      .metrics { margin: 7px 0 0; }
      .metrics div { display: flex; align-items: baseline; justify-content: space-between; gap: 7px; padding: 2px 0; }
      .metrics dt { min-width: 0; color: #afb9bd; }
      .metrics dd { margin: 0; text-align: right; color: #e6ecee; overflow-wrap: anywhere; }
      .metrics .rule { border-top: 1px solid var(--line); padding-top: 5px; margin-top: 3px; }
      .metrics .margin-split { margin-inline-start: 3px; padding-inline-start: 8px; border-inline-start: 2px solid var(--line); font-size: 11px; }
      .metric-note { margin-inline-start: 5px; color: var(--muted); font-size: 10px; white-space: nowrap; }
      details { border-top: 1px solid var(--line); margin-top: 7px; }
      summary {
        padding: 7px 0 2px;
        cursor: pointer;
        font-weight: 650;
        color: #d8e1e4;
      }
      .fields { display: grid; grid-template-columns: 1.1fr 1fr .85fr; gap: 5px; margin-top: 6px; }
      .fields[data-mode="percent"], .fields[data-mode="amount"] { grid-template-columns: 1fr 1fr; }
      .fields label, .mode-field { display: block; color: var(--muted); min-width: 0; font-size: 11px; }
      .mode-field { margin-top: 6px; }
      input, select {
        display: block;
        color: #f0f2f4;
        background: var(--raised);
        border: 1px solid #495a78;
        border-radius: 5px;
        width: 100%;
        margin-top: 3px;
        padding: 5px 4px;
        min-height: 27px;
      }
      input { appearance: textfield; }
      input::-webkit-inner-spin-button { appearance: none; }
      .save {
        display: block;
        width: 100%;
        margin-top: 6px;
        padding: 5px;
        color: #152843;
        background: var(--accent);
        border: 1px solid var(--accent);
        border-radius: 5px;
        font-weight: 700;
      }
      .save:hover:not(:disabled) { background: #c0daff; }
      .drawdown {
        margin: 0 0 8px;
        padding: 8px 9px;
        border: 1px solid #9c4255;
        border-left: 3px solid #ff657d;
        border-radius: 7px;
        background: #3a1e27;
        color: #ffe3e8;
      }
      .drawdown strong { display: block; font-size: 13px; font-weight: 800; letter-spacing: .025em; }
      .drawdown span { display: block; margin-top: 2px; color: #ffb4bf; font-size: 11px; }
      .drawdown .drawdown-message { color: #ffe3e8; }
      .compact-drawdown { margin: 0 8px 8px; padding: 5px 7px; overflow-wrap: anywhere; }
      .compact-drawdown strong { font-size: 12px; }
      .compact-drawdown span { margin-top: 0; font-size: 10px; }
      .chart-box { margin-top: 5px; }
      canvas { display: block; width: 100%; height: 88px; background: #182234; border-radius: 6px; }
      .chart-meta, .round-actions { display: flex; align-items: center; justify-content: space-between; gap: 5px; }
      .chart-meta { color: var(--muted); margin-top: 3px; font-size: 10px; }
      .chart-empty { margin: 4px 0 0; color: var(--muted); }
      .chart-note { margin: 4px 0 0; color: var(--muted); font-size: 10px; }
      .schedule-toggle { margin-top: 7px; }
      .schedule {
        width: 276px;
        padding: 10px 11px;
        display: flex;
        flex: 0 0 auto;
        flex-direction: column;
        max-height: min(65dvh, max(0px, calc(100dvh - 20px)));
      }
      .schedule h3 { margin: 0; font-size: 13px; }
      .schedule-meta { margin: 2px 0 6px; color: var(--muted); overflow-wrap: anywhere; }
      .schedule-location { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 6px; }
      .schedule-current { color: var(--accent); font-weight: 700; overflow-wrap: anywhere; }
      .schedule-current[data-unavailable] { color: var(--muted); font-weight: 400; }
      .schedule-location .secondary { padding: 2px 6px; white-space: nowrap; }
      .schedule-scroll { min-height: 0; overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; }
      .schedule table { width: 100%; border-collapse: collapse; }
      .schedule th, .schedule td { padding: 4px 3px; border-bottom: 1px solid var(--line); text-align: left; }
      .schedule thead th { position: sticky; top: 0; background: var(--surface); color: var(--muted); }
      .schedule tbody th { font-weight: 500; overflow-wrap: anywhere; }
      .schedule tr > :nth-child(n+2) { text-align: right; white-space: nowrap; }
      .schedule tr[data-target] { color: var(--accent); font-weight: 700; }
      .schedule tr[data-target] th { font-weight: 700; }
      .schedule tr[aria-current="step"] { background: #2c4570; color: #f0f6ff; font-weight: 700; }
      .schedule tr[aria-current="step"] th { box-shadow: inset 2px 0 var(--accent); font-weight: 700; }
      .schedule tr[data-achieved] { background: #34446d; }
      .schedule-win-state { display: block; color: #c6dcff; font-size: 10px; }
      .schedule-pages { display: flex; align-items: center; justify-content: space-between; gap: 4px; margin-top: 8px; }
      .schedule-pages .secondary { min-width: 25px; padding: 2px 5px; }
      .schedule-page { flex: 1 1 auto; min-width: 0; color: var(--muted); font-size: 10px; text-align: center; overflow-wrap: anywhere; }
      .risk-calculator { flex: 0 0 auto; }
      .risk-body { max-height: min(31dvh, 265px); overflow: auto; overscroll-behavior: contain; padding: 0 3px 3px; scrollbar-width: thin; }
      .risk-body p { margin: 4px 0; font-size: 11px; color: var(--muted); overflow-wrap: anywhere; }
      .risk-body p[data-invalid] { color: #ffb1b9; }
      .risk-body input[aria-invalid="true"] { border-color: #ff8797; }
      .risk-fields { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 5px; }
      .risk-fields label { flex: 1 0 85px; color: var(--muted); font-size: 11px; }
      .risk-result { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin-top: 5px; }
      .risk-result output { color: var(--accent); font-weight: 700; text-align: right; white-space: nowrap; }
      .risk-body section + section { margin-top: 7px; padding-top: 6px; border-top: 1px solid var(--line); }
      @media (max-width: 719px) {
        .body .schedule { width: auto; margin-top: 6px; background: var(--raised); box-shadow: none; }
        .body .schedule thead th { background: var(--raised); }
        .workspace[data-compact] { flex-direction: column; }
        .workspace[data-compact] > .schedule { max-width: calc(100vw - 24px); }
      }
      .round-actions { justify-content: flex-end; margin-top: 5px; }
      .secondary {
        padding: 4px 8px;
        border: 1px solid #495a78;
        border-radius: 5px;
        background: #22304a;
        color: var(--text);
      }
      .secondary:hover:not(:disabled) { background: #30466b; }
      .round-confirm { margin-top: 6px; color: #ffe3b9; background: #35281f; border-radius: 6px; padding: 7px; }
      .round-confirm p { margin: 0; }
      .diagnostic textarea {
        display: block;
        width: 100%;
        margin-top: 5px;
        padding: 6px;
        resize: vertical;
        color: #e1ebed;
        background: var(--raised);
        border: 1px solid var(--line);
        border-radius: 5px;
        font: inherit;
      }
      .diagnostic button {
        margin-top: 5px;
        padding: 4px 8px;
        border: 1px solid var(--line);
        border-radius: 5px;
        background: var(--raised);
      }
      footer { color: #a5afb3; font-size: 10px; margin-top: 9px; }
      footer p { margin: 0; }
      footer p + p { margin-top: 3px; }
      @media (max-width: 600px) {
        :host { inset: var(--okx-goal-overlay-top, 96px) auto auto var(--okx-goal-overlay-left, 18px) !important; }
        .panel { width: min(300px, calc(100vw - 35px)); }
        .body { max-height: min(60dvh, max(0px, calc(100dvh - 62px))); }
      }
      @media (max-width: 390px) {
        [data-collapsed="true"] header { gap: 6px; padding-inline: 8px; }
        [data-collapsed="true"] .mark { display: none; }
        .compact-readout { flex-wrap: wrap; gap: 2px 8px; }
      }
      :host([data-okx-goal-consent]) { top: clamp(8px, 12vh, 112px) !important; }
      .consent .body { max-height: min(65dvh, max(0px, calc(100dvh - 62px))); }
  `;

  // Create elements directly so the panel can mount on pages that enforce Trusted Types.
  function element(tag, attributes, ...children) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    node.append(...children);
    return node;
  }

  function riskCalculator() {
    function field(id, label, inputmode, hint) {
      return element('label', {}, label, element('input', {
        id, type: 'text', inputmode, autocomplete: 'off', 'aria-describedby': hint,
      }));
    }
    function readout(id, title, inputIds) {
      return element('div', { class: 'risk-result' },
        element('strong', { id: id + '-label' }, title),
        element('output', { id, for: inputIds, 'aria-labelledby': id + '-label' }, '—'));
    }
    const breakEven = element('section', { 'aria-labelledby': 'risk-break-even-label' },
      readout('risk-break-even', '复利盈亏平衡线', 'risk-win-rate'),
      element('div', { class: 'risk-fields' }, field('risk-win-rate', '假设胜率（%）', 'decimal', 'risk-break-even-hint')),
      element('p', { id: 'risk-break-even-hint' }, '填入假设胜率。'));
    const budget = element('section', { 'aria-labelledby': 'risk-drawdown-limit-label' },
      readout('risk-drawdown-limit', '回撤预算下单笔上限', 'risk-max-drawdown risk-loss-streak'),
      element('div', { class: 'risk-fields' },
        field('risk-max-drawdown', '最大回撤（%）', 'decimal', 'risk-drawdown-hint'),
        field('risk-loss-streak', '假设连亏笔数', 'numeric', 'risk-drawdown-hint')),
      element('p', { id: 'risk-drawdown-hint' }, '填入回撤预算和连亏笔数。'));
    return element('details', { class: 'risk-calculator', id: 'risk-calculator' },
      element('summary', {}, '单笔风险测算'),
      element('div', { class: 'risk-body' },
        element('p', {}, '结果为近似值，以每笔交易前的账户净值为基数，使用扣费后的收益和亏损。测算不是止损价格或交易建议。'),
        breakEven, budget));
  }

  function createConsentPanel({ onAllow, onClose }) {
    const host = document.createElement('div');
    host.setAttribute('data-okx-goal-consent', '');
    const shadow = host.attachShadow({ mode: 'closed' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(styles);
    shadow.adoptedStyleSheets = [sheet];

    const allow = element('button', { type: 'button', class: 'save', id: 'privacy-enable' }, '同意并启用');
    const later = element('button', { type: 'button', class: 'secondary', id: 'privacy-later' }, '暂不启用');
    const close = element('button', {
      type: 'button', class: 'tool', id: 'privacy-close', 'aria-label': '关闭授权浮层', title: '关闭授权浮层',
    }, '×');
    const status = element('div', { class: 'notice', id: 'privacy-status', role: 'status', hidden: '' });
    const header = element('header', {}, element('h2', { id: 'consent-title' }, '启用 OKX 交易目标'), close);
    const body = element('div', { class: 'body' },
      element('p', {}, '选「同意并启用」后，扩展才会读取本页显示的交易数据。'),
      element('p', {}, element('strong', {}, '读取范围 '), '可用余额、当前仓位的保证金和浮动盈亏。打开「历史仓位」时，还会读取已显示的平仓时间和已实现收益，用于计算目标进度、资金曲线和回撤。'),
      element('p', {}, element('strong', {}, '本地保存 '), '目标设置、带时间的资金曲线采样和本轮平仓记录使用 AES-GCM 加密。不可导出的密钥保留在当前 Chrome 配置中。'),
      element('p', {}, '扩展不会读取或保存账号凭据或 API 密钥，也不会上传交易数据。'),
      status, element('div', { class: 'consent-actions' }, allow, later));
    shadow.append(element('div', { class: 'workspace' },
      element('section', { class: 'panel consent', 'aria-labelledby': 'consent-title' }, header, body)));

    function cancel(event) {
      if (event.isTrusted) onClose?.();
    }

    close.addEventListener('click', cancel);
    later.addEventListener('click', cancel);
    allow.addEventListener('click', async (event) => {
      if (!event.isTrusted || allow.disabled) return;
      allow.disabled = close.disabled = later.disabled = true;
      status.hidden = false;
      delete status.dataset.tone;
      status.textContent = '正在保存你的选择…';
      try {
        if (await onAllow() === false) throw new Error('Consent was not saved.');
      } catch {
        status.dataset.tone = 'error';
        status.textContent = '无法保存授权，请重试。';
      } finally {
        allow.disabled = close.disabled = later.disabled = false;
        if (host.isConnected && status.dataset.tone === 'error') allow.focus();
      }
    });
    for (const type of ['keydown', 'keyup', 'keypress', 'click', 'pointerdown', 'wheel']) {
      host.addEventListener(type, event => event.stopPropagation());
    }
    return { host, dispose: () => host.remove() };
  }

  function panelContent() {
    const compactProgress = element('div', { class: 'compact-progress', id: 'compact-progress', hidden: '' },
      element('div', { class: 'compact-readout' },
        element('b', { id: 'compact-percent' }, '—'),
        element('button', {
          id: 'compact-remaining', type: 'button', 'aria-controls': 'compound-schedule', 'aria-expanded': 'false',
          title: '查看复利计划', hidden: '',
        })),
      element('div', {
        class: 'compact-track', id: 'compact-track', role: 'progressbar', 'aria-label': '目标进度',
        'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuetext': '暂无进度',
      }, element('div', { class: 'fill', id: 'compact-fill' })));
    const brand = element('div', {
      class: 'brand', id: 'drag-handle', tabindex: '0', role: 'group',
      'aria-label': '移动收益目标面板', 'aria-describedby': 'drag-instructions',
      title: '拖动移动面板，方向键微调，Home 恢复默认位置',
    }, element('span', { class: 'grip', 'aria-hidden': 'true' }),
      element('span', { class: 'mark', 'aria-hidden': 'true' },
        element('i', {}), element('i', {}), element('i', {})),
      element('h2', { id: 'title' }, '收益目标'),
      compactProgress,
      element('span', { class: 'sr-only', id: 'drag-instructions' }, '使用方向键移动面板，按住 Shift 加快移动，按 Home 恢复默认位置。'));
    const refresh = element('button', {
      type: 'button', class: 'tool', id: 'refresh', 'aria-label': '刷新页面数据', title: '刷新页面数据',
    }, '↻');
    const toggle = element('button', {
      type: 'button', class: 'tool', id: 'toggle', 'aria-expanded': 'true', 'aria-controls': 'body',
      'aria-label': '收起收益目标', title: '收起收益目标',
    }, '−');
    const close = element('button', {
      type: 'button', class: 'tool', id: 'close-panel', 'aria-label': '关闭收益目标面板', title: '关闭收益目标面板',
    }, '×');
    const header = element('header', {}, brand, element('div', { class: 'tools' }, refresh, toggle, close),
      element('span', { class: 'sr-only', id: 'position-announcement', role: 'status' }));
    const context = element('div', { class: 'context' },
      element('span', { class: 'market', id: 'market' }, 'OKX'),
      element('span', { class: 'chip', id: 'context', hidden: '' }));
    const status = element('p', { class: 'notice', id: 'status', role: 'status', hidden: '' });
    const diagnostic = element('details', { class: 'diagnostic', id: 'diagnostic', hidden: '' },
      element('summary', {}, '读取诊断'),
      element('textarea', { id: 'diagnostic-text', 'aria-label': '读取诊断信息', rows: '4', readonly: '' }),
      element('button', { id: 'diagnostic-copy', type: 'button' }, '复制诊断'));
    const hero = element('div', { class: 'hero' },
      element('div', { class: 'progress-head' },
        element('div', {},
          element('span', { class: 'progress-title' }, '目标进度'),
          element('b', { class: 'percent', id: 'progress-percent' }, '—')),
        element('span', { class: 'progress-state', id: 'progress-state' })),
      element('div', {
        class: 'track', id: 'track', role: 'progressbar', 'aria-label': '目标进度',
        'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuetext': '暂无进度',
      }, element('div', { class: 'fill', id: 'fill' })),
      element('div', { class: 'compound-progress', id: 'compound-progress' },
        element('div', { class: 'need' },
          element('span', { id: 'remaining-label' }, '还差'),
          element('b', { id: 'remaining' }, '—'), element('span', {}, '笔')),
        element('div', { class: 'equivalent' },
          element('span', {}, '等效进度'), element('b', { id: 'equivalent' }, '—'))));
    function drawdownBox(id, compact = false) {
      return element('div', { class: compact ? 'drawdown compact-drawdown' : 'drawdown', id, hidden: '' },
        element('strong', { lang: 'en' }, drawdownEnglish),
        element('span', { class: 'drawdown-message' }, drawdownMessage),
        element('span', { id: id + '-detail' }));
    }
    const drawdown = drawdownBox('drawdown');
    const compactDrawdown = drawdownBox('compact-drawdown', true);
    const drawdownAnnouncement = element('span', { class: 'sr-only', id: 'drawdown-announce', role: 'status', 'aria-atomic': 'true' });
    const capital = element('div', { class: 'capital' },
      element('div', { class: 'capital-label' },
        element('span', {}, '当前估算资金'), element('span', { id: 'change' }, '—')),
      element('div', { class: 'capital-amount' },
        element('b', { id: 'capital' }, '—'), element('span', { id: 'currency' })));
    const round = element('details', { id: 'round', open: '' },
      element('summary', {}, '本轮资金曲线'),
      element('div', { class: 'chart-box' },
        element('canvas', { id: 'equity-chart', role: 'img', 'aria-label': '本轮资金曲线', hidden: '' }),
        element('div', { class: 'chart-meta', id: 'chart-meta', hidden: '' },
          element('span', { id: 'chart-start' }), element('span', { id: 'chart-end' })),
        element('p', { class: 'chart-empty', id: 'chart-empty' }, '保存目标后开始记录资金。'),
        element('p', { class: 'chart-note' }, '平仓回撤只计入同币种仓位的已实现盈亏。持仓浮动盈亏反映在实时资金里。'),
        element('p', { class: 'chart-note', id: 'settlement-hint', hidden: '' })),
      element('div', { class: 'round-actions' },
        element('button', {
          class: 'secondary', id: 'new-round', type: 'button', 'aria-controls': 'round-confirm', 'aria-expanded': 'false', disabled: '',
        }, '开始新一轮')),
      element('div', { class: 'round-confirm', id: 'round-confirm', hidden: '' },
        element('p', {}, '以当前估算资金作为新起点，并清空本轮曲线。'),
        element('div', { class: 'round-actions' },
          element('button', { class: 'secondary', type: 'button', id: 'round-cancel' }, '取消'),
          element('button', { class: 'secondary', type: 'button', id: 'round-confirm-button' }, '确认开始'))),
      element('p', { class: 'notice', id: 'round-status', role: 'status', hidden: '' }));

    function metric(label, id, { labelId, rule, split, note, rowId } = {}) {
      const row = rule ? { class: 'rule' } : split ? { class: 'margin-split' } : {};
      if (rowId) Object.assign(row, { id: rowId, hidden: '' });
      const title = [label];
      if (note) title.push(element('span', { class: 'metric-note' }, note));
      return element('div', row,
        element('dt', labelId ? { id: labelId } : {}, ...title),
        element('dd', { id }, '—'));
    }
    const metrics = element('dl', { class: 'metrics' },
      metric('可用余额', 'available'),
      metric('仓位保证金', 'margin', { labelId: 'margin-label' }),
      metric('逐仓保证金', 'isolated-margin', { labelId: 'isolated-margin-label', rowId: 'isolated-margin-row', split: true }),
      metric('全仓保证金', 'cross-margin', { labelId: 'cross-margin-label', rowId: 'cross-margin-row', split: true }),
      metric('逐仓浮动收益', 'isolated-pnl'),
      metric('全仓浮动收益', 'cross-pnl', { rowId: 'cross-pnl-row', note: '未单独计入' }),
      metric('目标资金', 'target-capital', { rule: true }),
      metric('还差资金', 'remaining-capital'));

    function field(label, id, attributes) {
      return element('label', { id: id + '-label' }, label,
        element('input', { type: 'text', id, required: '', autocomplete: 'off', ...attributes }));
    }
    const goalMode = element('label', { class: 'mode-field' }, '目标方式',
      element('select', { id: 'goal-mode' },
        ...Object.entries(goalModes).map(([value, { title }]) => element('option', { value }, title))));
    const fields = element('div', { class: 'fields', id: 'goal-fields', 'data-mode': 'compound' },
      field('起始资金', 'start-capital', { inputmode: 'decimal' }),
      field('每笔目标 (%)', 'target-pct', { inputmode: 'decimal' }),
      field('连赢笔数', 'target-wins', { inputmode: 'numeric' }),
      field('目标涨幅 (%)', 'growth-pct', { inputmode: 'decimal', disabled: '' }),
      field('目标增加金额', 'growth-amount', { inputmode: 'decimal', disabled: '' }));
    const form = element('form', { id: 'form' }, goalMode, fields,
      element('p', { class: 'notice', id: 'form-status', 'data-tone': 'error', role: 'alert', hidden: '' }),
      element('button', { class: 'save', type: 'submit', id: 'save' }, '保存目标'));
    const goal = element('details', { id: 'goal', open: '' }, element('summary', {}, '目标设置'), form);
    const scheduleToggle = element('button', {
      class: 'secondary schedule-toggle', id: 'schedule-toggle', type: 'button',
      'aria-controls': 'compound-schedule', 'aria-expanded': 'false', hidden: '',
    }, '查看复利计划');
    function pageButton(id, label, glyph) {
      return element('button', { class: 'secondary', id, type: 'button', 'aria-label': label, title: label, disabled: '' }, glyph);
    }
    const schedule = element('aside', {
      class: 'schedule', id: 'compound-schedule', 'aria-labelledby': 'schedule-title', hidden: '',
    },
    element('h3', { id: 'schedule-title' }, '复利计划'),
    element('p', { class: 'schedule-meta', id: 'schedule-meta' }),
    element('div', { class: 'schedule-location' },
      element('span', { class: 'schedule-current', id: 'schedule-current' }),
      element('button', { class: 'secondary', id: 'schedule-jump', type: 'button', 'aria-controls': 'schedule-rows', hidden: '' }, '定位当前笔')),
    element('div', { class: 'schedule-scroll', id: 'schedule-scroll', tabindex: '-1' },
      element('table', { 'aria-label': '按计划复利的资金列表' },
        element('thead', {}, element('tr', {},
          element('th', { scope: 'col' }, '笔数'),
          element('th', { scope: 'col' }, '交易前资金'),
          element('th', { scope: 'col', id: 'schedule-capital-heading' }, '达标后资金'))),
        element('tbody', { id: 'schedule-rows' }))),
    element('div', { class: 'schedule-pages', id: 'schedule-pages' },
      pageButton('schedule-first', '第一页', '«'),
      pageButton('schedule-prev', '上一页', '‹'),
      element('span', { class: 'schedule-page', id: 'schedule-page', role: 'status' }),
      pageButton('schedule-next', '下一页', '›'),
      pageButton('schedule-last', '最后一页', '»')),
    riskCalculator());
    const footer = element('footer', {},
      element('p', { id: 'compound-note' }, '按当前资金换算等效笔数。实际连赢需查已平仓记录。'),
      element('p', { id: 'freshness', hidden: '' }));
    const body = element('div', { class: 'body', id: 'body' },
      context, status, diagnostic, hero, drawdown, capital, goal, scheduleToggle, round, metrics, footer);
    const panel = element('section', {
      class: 'panel', 'data-collapsed': 'false', 'aria-labelledby': 'title',
    }, header, compactDrawdown, drawdownAnnouncement, body);
    return element('div', { class: 'workspace' }, panel, schedule);
  }

  function createPanel({ onSave, onRefresh, onNewRound, onPositionChange, onClose }) {
    const host = document.createElement('div');
    const view = host.ownerDocument.defaultView;
    const shadow = host.attachShadow({ mode: 'open' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(styles);
    shadow.adoptedStyleSheets = [sheet];
    shadow.append(panelContent());
    const byId = (id) => shadow.getElementById(id);
    const workspace = shadow.querySelector('.workspace');
    const panel = shadow.querySelector('.panel');
    const body = byId('body');
    const drawdownNotice = byId('drawdown');
    const compactDrawdownNotice = byId('compact-drawdown');
    const dragHandle = byId('drag-handle');
    const toggle = byId('toggle');
    const refresh = byId('refresh');
    const compactRemaining = byId('compact-remaining');
    const form = byId('form');
    const save = byId('save');
    const details = byId('goal');
    const diagnostic = byId('diagnostic');
    const diagnosticText = byId('diagnostic-text');
    const copyDiagnostic = byId('diagnostic-copy');
    const fields = {
      startCapital: byId('start-capital'),
      targetPct: byId('target-pct'),
      targetWins: byId('target-wins'),
      growthPct: byId('growth-pct'),
      growthAmount: byId('growth-amount'),
    };
    const riskWinRate = byId('risk-win-rate');
    const riskMaxDrawdown = byId('risk-max-drawdown');
    const riskLossStreak = byId('risk-loss-streak');
    const riskFields = [riskWinRate, riskMaxDrawdown, riskLossStreak];
    globalThis.GoalInputKeys?.register([...Object.values(fields), ...riskFields]);
    const selectMode = byId('goal-mode');
    const newRound = byId('new-round');
    const roundConfirm = byId('round-confirm');
    const roundConfirmButton = byId('round-confirm-button');
    const roundCancel = byId('round-cancel');
    const canvas = byId('equity-chart');
    const schedule = byId('compound-schedule');
    const scheduleToggle = byId('schedule-toggle');
    const scheduleRows = byId('schedule-rows');
    const schedulePages = byId('schedule-pages');
    const scheduleJump = byId('schedule-jump');
    const scheduleWide = view.matchMedia('(min-width: 720px)');
    const pageButtons = ['first', 'prev', 'next', 'last'].map(name => byId('schedule-' + name));
    let points = [];
    let roundPending = false;
    let roundReady = false;
    let goalKey;
    let configured = false;
    let position = null;
    let drag = null;
    let scheduleGoal;
    let scheduleKey;
    let scheduleOpen = false;
    let compactScheduleOpen = false;
    let schedulePage = 0;
    let schedulePageCount = 1;
    let scheduleOpening = true;
    let scheduleCurrentWin = null;
    let scheduleAchieved = false;

    function put(id, text) {
      const node = byId(id);
      if (node.textContent !== text) node.textContent = text;
    }

    function notice(id, message, tone = '') {
      const node = byId(id);
      node.hidden = !message;
      node.dataset.tone = tone;
      put(id, message || '');
    }

    function signedAmount(id, value) {
      byId(id).dataset.tone = value > 0 ? 'positive' : value < 0 ? 'negative' : '';
      put(id, (value > 0 ? '+' : '') + formatNumber(value, true));
    }

    function writePosition(next) {
      const axes = ['left', 'top'];
      for (const axis of axes) {
        const name = '--okx-goal-overlay-' + axis;
        const value = next ? next[axis] + 'px' : '';
        if (host.style.getPropertyValue(name) !== value) {
          if (value) host.style.setProperty(name, value);
          else host.style.removeProperty(name);
        }
      }
    }

    function place(next) {
      if (!next) writePosition(null);
      if (!host.isConnected) {
        writePosition(next);
        return next;
      }
      const rect = host.getBoundingClientRect();
      const page = host.ownerDocument.documentElement;
      const edge = 8;
      const maxLeft = Math.max(edge, (page.clientWidth || view.innerWidth) - rect.width - edge);
      const maxTop = Math.max(edge, (page.clientHeight || view.innerHeight) - rect.height - edge);
      const desired = next ?? rect;
      const clamped = {
        left: Math.round(Math.max(edge, Math.min(maxLeft, desired.left))),
        top: Math.round(Math.max(edge, Math.min(maxTop, desired.top))),
      };
      if (next || Math.abs(clamped.left - rect.left) > 0.5 || Math.abs(clamped.top - rect.top) > 0.5) {
        writePosition(clamped);
      }
      return clamped;
    }

    function keepVisible() {
      place(drag?.preview ?? position);
    }

    function setPosition(next) {
      position = Number.isFinite(next?.left) && Number.isFinite(next?.top)
        ? { left: next.left, top: next.top }
        : null;
      if (!drag) keepVisible();
    }

    function commitPosition(next) {
      const placed = place(next);
      position = next ? placed : null;
      const saved = position;
      if (typeof onPositionChange === 'function') {
        Promise.resolve().then(() => onPositionChange(saved)).catch(() => {});
      }
      return placed;
    }

    function syncCompactDrawdown() {
      compactDrawdownNotice.hidden = !body.hidden || drawdownNotice.hidden;
    }

    function riskInput(input, validate) {
      const raw = input.value.trim();
      const value = readGoalNumber(raw);
      const valid = validate(value);
      const invalid = raw !== '' && !valid;
      if (invalid) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
      return { value: valid ? value : null, invalid };
    }

    function formatRisk(value) {
      if (!Number.isFinite(value)) return '—';
      if (value >= 99.99995) return '接近 100%';
      return formatNumber(value === 0 ? 0 : value) + '%';
    }

    function updateRisk() {
      const winRate = riskInput(riskWinRate, value => Number.isFinite(value) && value >= 0 && value <= 100);
      const maxDrawdown = riskInput(riskMaxDrawdown, value => Number.isFinite(value) && value >= 0 && value < 100);
      const lossStreak = riskInput(riskLossStreak, value => Number.isSafeInteger(value) && value >= 1);
      const targetPct = scheduleGoal?.targetPct;
      const noLoss = winRate.value === 100;
      const breakEven = winRate.value === null || noLoss || targetPct === undefined ? null :
        GoalRisk.breakEvenLossPct(targetPct, winRate.value);
      const budget = maxDrawdown.value === null || lossStreak.value === null ? null :
        GoalRisk.drawdownLossPct(maxDrawdown.value, lossStreak.value);
      const lossInputErrors = [];
      if (maxDrawdown.invalid) lossInputErrors.push('最大回撤须大于或等于 0%，且小于 100%。');
      if (lossStreak.invalid) lossInputErrors.push('连亏笔数须为正整数。');

      put('risk-break-even', noLoss ? '不适用' : formatRisk(breakEven));
      byId('risk-break-even-hint').toggleAttribute('data-invalid', winRate.invalid);
      let breakEvenHint = targetPct === undefined
        ? '填入假设胜率。'
        : '每笔盈利按已设置的 +' + formatNumber(targetPct) + '% 测算。';
      if (winRate.invalid) breakEvenHint = '胜率须在 0% 至 100% 之间。';
      else if (noLoss) breakEvenHint = '该假设下没有亏损样本。';
      else if (winRate.value === 0) breakEvenHint = '胜率为 0% 时，每笔亏损只能为 0% 才能维持净值。';
      put('risk-break-even-hint', breakEvenHint);

      put('risk-drawdown-limit', formatRisk(budget));
      byId('risk-drawdown-hint').toggleAttribute('data-invalid', lossInputErrors.length > 0);
      put('risk-drawdown-hint', lossInputErrors.join(' ') || (budget === null
        ? '填入回撤预算和连亏笔数。'
        : '按每笔亏损比例相同的连亏情景测算。'));
    }

    function currentSchedulePage() {
      return scheduleCurrentWin === null ? 0 : Math.floor((scheduleCurrentWin - 1) / schedulePageSize);
    }

    function highlightScheduleRow() {
      const oldRow = scheduleRows.querySelector('tr[aria-current="step"]');
      const row = scheduleCurrentWin === null ? null : scheduleRows.querySelector(`tr[data-win="${scheduleCurrentWin}"]`);
      if (oldRow && oldRow !== row) {
        oldRow.removeAttribute('aria-current');
        oldRow.removeAttribute('data-achieved');
        const badge = oldRow.querySelector('.schedule-win-state');
        badge.hidden = true;
        badge.textContent = '';
      }
      if (row) {
        row.setAttribute('aria-current', 'step');
        row.toggleAttribute('data-achieved', scheduleAchieved);
        const badge = row.querySelector('.schedule-win-state');
        badge.hidden = false;
        badge.textContent = scheduleAchieved ? '已达标' : '当前';
      }
      const label = scheduleCurrentWin === null ? '等待读取实时资金' : '第 ' + numbers.format(scheduleCurrentWin) + ' 笔';
      put('schedule-current', scheduleCurrentWin === null ? label : scheduleAchieved ? label + '已达标' : '当前' + label);
      byId('schedule-current').toggleAttribute('data-unavailable', scheduleCurrentWin === null);
      scheduleJump.hidden = scheduleCurrentWin === null || currentSchedulePage() === schedulePage;
      put('schedule-jump', scheduleAchieved ? '定位达标笔' : '定位当前笔');
    }

    function revealCurrentScheduleRow() {
      const row = scheduleRows.querySelector('tr[aria-current="step"]');
      if (!row) return;
      const scroller = byId('schedule-scroll');
      const bottom = row.getBoundingClientRect().bottom - scroller.getBoundingClientRect().bottom;
      if (bottom > 0) scroller.scrollTop += bottom;
    }

    function renderSchedulePage() {
      const { rows, total } = GoalCapital.compoundSchedule(scheduleGoal, {
        offset: schedulePage * schedulePageSize,
        limit: schedulePageSize,
      });
      schedulePageCount = Math.ceil(total / schedulePageSize);
      const rendered = rows.map(({ win, fromCapital, capital }) => {
        const row = { 'data-win': String(win) };
        if (win === scheduleGoal.targetWins) row['data-target'] = '';
        return element('tr', row,
          element('th', { scope: 'row' }, '第 ' + numbers.format(win) + ' 笔',
            element('span', { class: 'schedule-win-state', hidden: '' })),
          element('td', {}, formatNumber(fromCapital, true)),
          element('td', {}, formatNumber(capital, true)));
      });
      scheduleRows.replaceChildren(...rendered);
      byId('schedule-scroll').scrollTop = 0;
      put('schedule-page', numbers.format(schedulePage + 1) + ' / ' + numbers.format(schedulePageCount) + ' 页');
      schedulePages.hidden = schedulePageCount === 1;
      pageButtons[0].disabled = pageButtons[1].disabled = schedulePage === 0;
      pageButtons[2].disabled = pageButtons[3].disabled = schedulePage === schedulePageCount - 1;
      highlightScheduleRow();
    }

    function syncScheduleVisibility() {
      const compact = body.hidden;
      const visible = Boolean(scheduleGoal && (compact ? compactScheduleOpen : scheduleOpen));
      const opening = visible && schedule.hidden;
      schedule.hidden = !visible;
      if (opening) {
        const followCurrent = scheduleOpening;
        if (followCurrent) schedulePage = currentSchedulePage();
        scheduleOpening = false;
        renderSchedulePage();
        if (followCurrent) revealCurrentScheduleRow();
      }
      scheduleToggle.hidden = !scheduleGoal;
      scheduleToggle.setAttribute('aria-expanded', String(!compact && visible));
      compactRemaining.setAttribute('aria-expanded', String(compact && visible));
      put('schedule-toggle', !compact && visible ? '收起复利计划' : '查看复利计划');
    }

    function placeSchedule() {
      if (body.hidden || scheduleWide.matches) {
        if (schedule.parentElement !== workspace) workspace.append(schedule);
      } else if (schedule.previousElementSibling !== scheduleToggle) {
        scheduleToggle.after(schedule);
      }
    }

    function resizeSchedule() {
      placeSchedule();
      keepVisible();
    }

    function updateSchedule(settings, goalMode, nextKey, progress) {
      const changedGoal = nextKey !== scheduleKey;
      if (changedGoal) {
        scheduleKey = nextKey;
        scheduleGoal = goalMode === 'compound' ? GoalCapital.normalizeGoal(settings) : undefined;
        scheduleOpening = true;
        if (!scheduleGoal) scheduleOpen = compactScheduleOpen = false;
        updateRisk();
      }
      const achieved = Boolean(scheduleGoal && progress?.achieved);
      let win = null;
      if (scheduleGoal && progress) {
        if (achieved) win = scheduleGoal.targetWins;
        else if (progress.depleted) win = 1;
        else if (Number.isFinite(progress.equivalentWins)) {
          win = Math.max(1, Math.min(scheduleGoal.targetWins, Math.floor(progress.equivalentWins) + 1));
        }
      }
      const changedStep = scheduleCurrentWin !== win || scheduleAchieved !== achieved;
      scheduleCurrentWin = win;
      scheduleAchieved = achieved;
      if (changedGoal && scheduleGoal) {
        put('schedule-meta', '每笔 +' + formatNumber(scheduleGoal.targetPct) + '% · 共 ' +
          numbers.format(scheduleGoal.targetWins) + ' 笔' + (settings?.currency ? ' · ' + settings.currency : ''));
        if (!schedule.hidden) {
          schedulePage = currentSchedulePage();
          scheduleOpening = false;
          renderSchedulePage();
          revealCurrentScheduleRow();
        }
      }
      if (changedGoal) syncScheduleVisibility();
      if (changedStep && !changedGoal && !schedule.hidden) highlightScheduleRow();
    }

    function setCollapsed(collapsed) {
      if (!collapsed && body.hidden && compactScheduleOpen) scheduleOpen = true;
      body.hidden = collapsed;
      refresh.hidden = collapsed;
      compactScheduleOpen = false;
      byId('compact-progress').hidden = !collapsed;
      workspace.toggleAttribute('data-compact', collapsed);
      placeSchedule();
      syncScheduleVisibility();
      syncCompactDrawdown();
      panel.dataset.collapsed = String(collapsed);
      toggle.textContent = collapsed ? '+' : '−';
      toggle.setAttribute('aria-expanded', String(!collapsed));
      const label = collapsed ? '展开收益目标' : '收起收益目标';
      toggle.setAttribute('aria-label', label);
      toggle.title = label;
      keepVisible();
    }

    function setGoalMode(mode) {
      selectMode.value = mode;
      byId('goal-fields').dataset.mode = mode;
      const visible = ['startCapital', ...goalModes[mode].fields];
      for (const [name, field] of Object.entries(fields)) {
        field.disabled = !visible.includes(name);
        field.closest('label').hidden = field.disabled;
      }
    }

    function showRoundConfirm(open) {
      roundConfirm.hidden = !open;
      newRound.setAttribute('aria-expanded', String(open));
    }

    function syncRoundControls() {
      newRound.disabled = !roundReady || roundPending;
      roundConfirmButton.disabled = !roundReady || roundPending;
      roundCancel.disabled = roundPending;
      if (!roundReady && !roundPending) showRoundConfirm(false);
    }

    toggle.addEventListener('click', () => setCollapsed(!body.hidden));
    for (const input of riskFields) input.addEventListener('input', updateRisk);
    byId('close-panel').addEventListener('click', () => onClose?.());
    refresh.addEventListener('click', () => onRefresh());
    scheduleToggle.addEventListener('click', () => {
      scheduleOpen = !scheduleOpen;
      syncScheduleVisibility();
      keepVisible();
    });
    compactRemaining.addEventListener('click', () => {
      if (!body.hidden || !scheduleGoal) return;
      compactScheduleOpen = !compactScheduleOpen;
      if (compactScheduleOpen) scheduleOpening = true;
      syncScheduleVisibility();
      keepVisible();
    });
    scheduleJump.addEventListener('click', () => {
      if (schedule.hidden || scheduleCurrentWin === null) return;
      schedulePage = currentSchedulePage();
      renderSchedulePage();
      revealCurrentScheduleRow();
      byId('schedule-scroll').focus({ preventScroll: true });
    });
    const pageTargets = [() => 0, () => schedulePage - 1, () => schedulePage + 1, () => schedulePageCount - 1];
    pageButtons.forEach((button, index) => button.addEventListener('click', () => {
      const next = pageTargets[index]();
      if (schedule.hidden || next < 0 || next >= schedulePageCount || next === schedulePage) return;
      schedulePage = next;
      renderSchedulePage();
      if (button.disabled) pageButtons[index < 2 ? 2 : 1].focus();
    }));
    scheduleWide.addEventListener('change', resizeSchedule);
    dragHandle.addEventListener('pointerdown', (event) => {
      if (drag || !event.isPrimary || event.button !== 0 || compactRemaining.contains(event.target)) return;
      const { left, top } = host.getBoundingClientRect();
      dragHandle.setPointerCapture(event.pointerId);
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left, top, preview: null };
    });
    dragHandle.addEventListener('pointermove', (event) => {
      if (drag?.id !== event.pointerId) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!drag.preview && Math.hypot(dx, dy) < 5) return;
      event.preventDefault();
      event.stopPropagation();
      drag.preview = { left: drag.left + dx, top: drag.top + dy };
      panel.dataset.dragging = 'true';
      keepVisible();
    });

    function finishDrag(pointerId, commit) {
      if (drag?.id !== pointerId) return;
      const preview = drag.preview;
      drag = null;
      delete panel.dataset.dragging;
      if (preview && commit) commitPosition(preview);
      else keepVisible();
      if (dragHandle.hasPointerCapture(pointerId)) dragHandle.releasePointerCapture(pointerId);
    }

    dragHandle.addEventListener('pointerup', (event) => finishDrag(event.pointerId, true));
    dragHandle.addEventListener('pointercancel', (event) => finishDrag(event.pointerId, false));
    dragHandle.addEventListener('lostpointercapture', (event) => finishDrag(event.pointerId, false));
    dragHandle.addEventListener('keydown', (event) => {
      if (event.target !== dragHandle) return;
      if (event.key === 'Escape' && drag) {
        finishDrag(drag.id, false);
      } else if (event.key === 'Home') {
        event.preventDefault();
        if (drag) finishDrag(drag.id, false);
        commitPosition(null);
        put('position-announcement', '面板已恢复默认位置。');
      } else {
        const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
        if (!direction || drag) return;
        event.preventDefault();
        const step = event.shiftKey ? 48 : 16;
        const { left, top } = host.getBoundingClientRect();
        const next = commitPosition({ left: left + direction[0] * step, top: top + direction[1] * step });
        put('position-announcement', '面板位置：距左 ' + next.left + ' 像素，距顶部 ' + next.top + ' 像素。');
      }
    });
    const panelObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(keepVisible) : null;
    panelObserver?.observe(workspace);
    view.addEventListener('resize', keepVisible);
    selectMode.addEventListener('change', () => {
      setGoalMode(selectMode.value);
      notice('form-status', '');
    });
    newRound.addEventListener('click', () => {
      notice('round-status', '');
      showRoundConfirm(true);
      roundCancel.focus();
    });
    roundCancel.addEventListener('click', () => {
      showRoundConfirm(false);
      newRound.focus();
    });
    roundConfirmButton.addEventListener('click', async () => {
      if (!roundReady || roundPending) return;
      roundPending = true;
      syncRoundControls();
      try {
        await onNewRound();
        showRoundConfirm(false);
        notice('round-status', '已开始新一轮。');
      } catch (error) {
        notice('round-status', error?.message || '无法开始新一轮，请重试。', 'error');
      } finally {
        roundPending = false;
        syncRoundControls();
        if (roundConfirm.hidden) newRound.focus();
      }
    });
    byId('round').addEventListener('toggle', () => drawEquity(canvas, points));
    const chartObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => drawEquity(canvas, points)) : null;
    chartObserver?.observe(canvas);
    copyDiagnostic.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(diagnosticText.value);
        copyDiagnostic.textContent = '已复制';
      } catch {
        diagnosticText.focus();
        diagnosticText.select();
        copyDiagnostic.textContent = '已选中，请手动复制';
      }
    });
    for (const type of ['keydown', 'keyup', 'keypress', 'click', 'pointerdown', 'wheel']) {
      host.addEventListener(type, (event) => event.stopPropagation());
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (save.disabled) return;
      const mode = selectMode.value;
      const payload = { mode };
      const labels = { startCapital: '起始资金', targetPct: '每笔目标收益率', targetWins: '连赢笔数', growthPct: '目标涨幅', growthAmount: '目标增加金额' };
      for (const key of ['startCapital', ...goalModes[mode].fields]) {
        const value = readGoalNumber(fields[key].value);
        const integer = key === 'targetWins';
        if (!Number.isFinite(value) || value <= 0 || (integer && !Number.isSafeInteger(value))) {
          notice('form-status', labels[key] + (integer ? '需要是正整数。' : '需要大于 0。'), 'error');
          fields[key].focus();
          return;
        }
        payload[key] = value;
      }
      save.disabled = true;
      notice('form-status', '');
      try {
        await onSave(payload);
        details.open = false;
        details.querySelector('summary').focus();
      } catch (error) {
        notice('form-status', error?.message || '目标保存失败，请重试。', 'error');
      } finally {
        save.disabled = false;
      }
    });

    function render({ settings, snapshot, order, result, error, diagnostic: report, updatedAt, marketLabel, lastGood, scanning = false, round, settled, settlementHint, historyView } = {}) {
      const goalMode = Object.hasOwn(goalModes, settings?.mode) ? settings.mode : 'compound';
      const isCompound = goalMode === 'compound';
      const names = Object.keys(fields);
      const nextKey = JSON.stringify([settings?.currency, goalMode, ...names.map(name => settings?.[name])]);
      if (nextKey !== goalKey) {
        for (const name of names) fields[name].value = settings?.[name] ?? '';
        setGoalMode(goalMode);
        const nextConfigured = ['startCapital', ...goalModes[goalMode].fields].every(name =>
          Number.isFinite(settings?.[name]) && settings[name] > 0);
        if (goalKey === undefined || nextConfigured !== configured) details.open = !nextConfigured;
        configured = nextConfigured;
        goalKey = nextKey;
      }
      byId('settlement-hint').hidden = !settlementHint;
      put('settlement-hint', settlementHint ?? '');

      const data = error ? null : snapshot;
      const progress = error ? null : result;
      updateSchedule(settings, goalMode, nextKey, progress);
      const balance = order ?? data;
      const mode = modeLabel(balance?.mode);
      const currency = balance?.currency || settings?.currency || '';
      const market = marketLabel || 'OKX';
      put('market', market);
      byId('market').title = market;
      const context = [mode, currency].filter(Boolean).join(' · ');
      byId('context').hidden = !context;
      put('context', context);
      refresh.disabled = scanning;
      diagnostic.hidden = !report;
      if (diagnosticText.value !== (report || '')) {
        diagnosticText.value = report || '';
        copyDiagnostic.textContent = '复制诊断';
        if (!report) diagnostic.open = false;
      }

      if (historyView) {
        notice('status', '正在读取「历史仓位」。切回「当前仓位」可查看实时资金。');
      } else if (error) {
        notice('status', typeof error === 'string' ? error : error.message || '读取页面数据失败。', 'error');
      } else if (!data) {
        notice('status', scanning ? '正在读取 OKX 页面数据…' : '正在等待交易页面数据。');
      } else {
        const warnings = [];
        if (data.isolatedCount > 0 && data.crossCount > 0) {
          warnings.push('已汇总 ' + data.isolatedCount + ' 个逐仓和 ' + data.crossCount + ' 个全仓。资金估算的浮动收益仅计逐仓。');
        } else if (data.mixedModes) {
          warnings.push('余额按面板模式读取，保证金汇总同币种仓位，浮动收益仅计逐仓。');
        }
        if (data.foreignIgnored > 0) warnings.push('有 ' + data.foreignIgnored + ' 个其他币种的仓位未计入。');
        if (progress?.depleted && isCompound) warnings.push('当前估算资金需大于 0，才能换算还差几笔。');
        notice('status', warnings.join(' '), 'warning');
      }

      byId('compound-progress').hidden = !isCompound;
      byId('compound-note').hidden = !isCompound;
      const count = formatNumber(progress?.remainingWins);
      put('remaining', count);
      byId('remaining').dataset.compact = String(count.length > 5);
      put('remaining-label', progress?.achieved ? '已达标 · 还差' : '还差');
      put('equivalent', configured && isCompound
        ? formatNumber(progress?.equivalentWins) + ' / ' + formatNumber(settings.targetWins) + ' 笔'
        : '—');
      const percent = Number.isFinite(progress?.progressPct) ? progress.progressPct : null;
      const percentage = percent === null ? '—' :
        (!progress.achieved && percent > 99.9 ? '>99.9%' : progressNumbers.format(percent) + '%');
      const compactPercentage = percent === null ? '—' :
        compactProgressNumbers.format(progress.achieved ? percent : Math.min(percent, 99.99)) + '%';
      const track = byId('track');
      put('progress-percent', percentage);
      put('progress-state', progress?.achieved ? '已达标' : configured ? goalModes[goalMode].title : '先设置目标');
      byId('progress-state').dataset.achieved = String(progress?.achieved === true);
      byId('fill').style.width = (percent ?? 0) + '%';
      if (percent === null) track.removeAttribute('aria-valuenow');
      else track.setAttribute('aria-valuenow', String(percent));
      track.setAttribute('aria-valuetext', percent === null ? '暂无进度' : percentage);
      const compactTrack = byId('compact-track');
      put('compact-percent', compactPercentage);
      byId('compact-percent').title = percent === null ? '暂无进度' : String(percent) + '%';
      byId('compact-fill').style.width = (percent ?? 0) + '%';
      if (percent === null) compactTrack.removeAttribute('aria-valuenow');
      else compactTrack.setAttribute('aria-valuenow', String(percent));
      compactTrack.setAttribute('aria-valuetext', percent === null ? '暂无进度' : compactPercentage);
      const compactWins = isCompound && Number.isSafeInteger(progress?.remainingWins) && count.length <= 4;
      compactRemaining.hidden = !scheduleGoal;
      const compactLabel = compactWins ? '差 ' + count + ' 笔' : '复利计划';
      compactRemaining.setAttribute('aria-label', compactWins ? compactLabel + '，查看复利计划' : compactLabel);
      put('compact-remaining', compactLabel);

      put('capital', formatNumber(data?.currentCapital, true));
      put('currency', currency);
      const change = progress?.cumulativeReturnPct;
      put('change', typeof change === 'number' ? (change > 0 ? '+' : '') + formatNumber(change) + '%' : '—');
      byId('change').dataset.tone = change > 0 ? 'positive' : change < 0 ? 'negative' : '';
      put('available', formatNumber(balance?.available, true));
      put('margin-label', Number.isInteger(data?.includedPositions)
        ? '仓位保证金 · ' + data.includedPositions + ' 个'
        : '仓位保证金');
      put('margin', formatNumber(data?.positionMargin, true));
      for (const [key, title] of [['isolated', '逐仓保证金'], ['cross', '全仓保证金']]) {
        const count = data?.[key + 'Count'];
        const margin = data?.[key + 'Margin'];
        byId(key + '-margin-row').hidden = !(count > 0 && Number.isFinite(margin));
        put(key + '-margin-label', Number.isInteger(count) ? title + ' · ' + count + ' 个' : title);
        put(key + '-margin', formatNumber(margin, true));
      }
      signedAmount('isolated-pnl', data?.includedPnl);
      byId('cross-pnl-row').hidden = !data?.crossCount;
      signedAmount('cross-pnl', data?.crossPnl);
      byId('cross-pnl').title = data?.crossCount > 0 && !Number.isFinite(data?.crossPnl)
        ? '部分全仓仓位的浮动收益无法确认'
        : '';
      put('target-capital', formatNumber(progress?.targetCapital, true));
      put('remaining-capital', formatNumber(progress?.remainingCapital, true));

      const drawdown = configured && Number.isFinite(settled?.drawdownAmount) && settled.drawdownAmount > 0;
      drawdownNotice.hidden = !drawdown;
      put('drawdown-announce', drawdown ? drawdownMessage : '');
      if (drawdown) {
        const percentText = Number.isFinite(settled.drawdownPct) ? formatNumber(settled.drawdownPct) + '% · ' : '';
        const detail = percentText + formatNumber(settled.drawdownAmount, true) + ' ' + currency;
        put('drawdown-detail', '平仓回撤 ' + detail);
        put('compact-drawdown-detail', '回撤 ' + detail);
      }
      syncCompactDrawdown();
      points = (Array.isArray(round?.points) ? round.points : [])
        .filter(point => Number.isFinite(point?.at) && Number.isFinite(point?.capital));
      const hasPoints = points.length > 0;
      canvas.hidden = !hasPoints;
      byId('chart-meta').hidden = !hasPoints;
      byId('chart-empty').hidden = hasPoints;
      if (hasPoints) {
        const latest = points.at(-1);
        const started = Number.isFinite(round.startedAt) ? round.startedAt : points[0].at;
        put('chart-start', '起点 ' + dates.format(started));
        put('chart-end', points.length > 1 ? '末次 ' + dates.format(latest.at) : '');
        canvas.setAttribute('aria-label', '本轮资金曲线，' + points.length + ' 个记录，末次资金 ' +
          formatNumber(latest.capital, true) + ' ' + currency);
        drawEquity(canvas, points);
      } else {
        put('chart-empty', configured ? '等待第一条资金记录。' : '保存目标后开始记录资金。');
      }
      roundReady = typeof onNewRound === 'function' && configured && Number.isFinite(data?.currentCapital) && data.currentCapital > 0;
      syncRoundControls();

      const fresh = data ? formatTime(updatedAt) : '';
      const prior = error ? formatTime(lastGood?.updatedAt ?? lastGood) : '';
      const detail = fresh ? '更新于 ' + fresh : prior ? '上次读取 ' + prior : '';
      byId('freshness').hidden = !detail;
      put('freshness', detail);
    }

    setGoalMode('compound');
    placeSchedule();
    return {
      host,
      render,
      setPosition,
      expand: () => setCollapsed(false),
      dispose() {
        scheduleWide.removeEventListener('change', resizeSchedule);
        view.removeEventListener('resize', keepVisible);
        panelObserver?.disconnect();
        chartObserver?.disconnect();
        host.remove();
      },
    };
  }

  globalThis.GoalOverlay = Object.freeze({ createPanel, createConsentPanel });
})();
