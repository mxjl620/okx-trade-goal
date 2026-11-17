(() => {
  'use strict';

  const MESSAGE = 'okx-goal:expand-panel';
  const GOAL_PREFIX = 'okxLiveGoalV2:';
  const ROUND_PREFIX = 'okxLiveRoundV3:';
  const PANEL_POSITION_KEY = 'okxLivePanelPositionV1';
  const PANEL_CLOSED_KEY = 'okxLivePanelClosedV1';
  const CONSENT_KEY = 'okxGoalLocalReadConsentV1';
  const SCAN_INTERVAL_MS = 1500;
  const extensionId = chrome.runtime?.id;
  if (!extensionId) return;
  const extensionVersion = chrome.runtime.getManifest().version;
  const pageListeners = new AbortController();
  const goals = new Map();
  const rounds = new Map();
  const recording = new Set();
  let scanTimer;
  let settingsLoaded = false;
  let consentGranted = false;
  let recordsLoaded = false;
  let panelClosed = false;
  let panel;
  let consentPanel;
  let panelPosition = null;
  let liveOrder;
  let liveSnapshot;
  let knownCurrency;
  let lastGood;
  let currentPath;
  let waitingForSettings;

  function contextIsActive() {
    if (pageListeners.signal.aborted) return false;
    try {
      if (chrome.runtime?.id === extensionId) return true;
    } catch {
      // Chrome can invalidate the extension API while this page stays open.
    }
    pageListeners.abort();
    clearInterval(scanTimer);
    panel?.dispose();
    consentPanel?.dispose();
    return false;
  }

  function marketFromPath() {
    const match = /(?:^|\/)trade-swap\/([a-z0-9][a-z0-9-]*)\/?$/i.exec(location.pathname);
    return match?.[1].toUpperCase() ?? '';
  }

  function storedRound(value) {
    return value && Number.isSafeInteger(value.startedAt) && Number.isSafeInteger(value.observedAt) &&
      Number.isSafeInteger(value.highWaterAt) && Number.isFinite(value.highWater) &&
      Array.isArray(value.points) && value.points.length > 0 &&
      value.points.every(point => Number.isSafeInteger(point?.at) && Number.isFinite(point.capital))
      ? value : undefined;
  }

  function applyStored(key, value) {
    if (key === PANEL_CLOSED_KEY) {
      applyPanelClosed(value === true);
    } else if (key === PANEL_POSITION_KEY) {
      panelPosition = normalizePanelPosition(value);
      panel?.setPosition(panelPosition);
    } else if (key.startsWith(GOAL_PREFIX)) {
      const currency = key.slice(GOAL_PREFIX.length);
      const goal = GoalCapital.normalizeGoal(value);
      if (goal) goals.set(currency, goal);
      else goals.delete(currency);
    } else if (key.startsWith(ROUND_PREFIX)) {
      const currency = key.slice(ROUND_PREFIX.length);
      const round = storedRound(value);
      if (round) rounds.set(currency, round);
      else rounds.delete(currency);
    } else {
      return false;
    }
    return true;
  }

  function applyPanelClosed(closed) {
    panelClosed = closed;
    if (closed) {
      panel?.host.remove();
      consentPanel?.host.remove();
    }
  }

  async function savePanelClosed(closed) {
    if (!contextIsActive()) return;
    applyPanelClosed(closed);
    try {
      await chrome.storage.local.set({ [PANEL_CLOSED_KEY]: closed });
    } catch {
      // Visibility still changes in this tab if storage is unavailable.
    }
  }

  function normalizePanelPosition(value) {
    if (!Number.isFinite(value?.left) || !Number.isFinite(value?.top)) return null;
    return { left: value.left, top: value.top };
  }

  async function savePanelPosition(position) {
    if (!contextIsActive()) return;
    panelPosition = normalizePanelPosition(position);
    try {
      await chrome.storage.local.set({ [PANEL_POSITION_KEY]: panelPosition });
    } catch {
      // The panel can still be moved in the current page.
    }
  }

  async function withRoundLock(currency, operation) {
    const run = () => {
      if (!contextIsActive()) throw new Error('扩展已重新加载，请刷新交易页。');
      return operation();
    };
    return navigator.locks ? navigator.locks.request(`${extensionId}:${ROUND_PREFIX}${currency}`, run) : run();
  }

  function recordRoundSample(currency, capital, at, closes) {
    if (!settingsLoaded || document.hidden || recording.has(currency)) return;
    const liveCapital = document.hasFocus() ? capital : undefined;
    if (!Number.isFinite(liveCapital) && !closes?.length) return;
    const record = round => {
      const chart = GoalRound.record(round, liveCapital, at);
      return GoalRound.recordCloses(chart, closes, currency, at);
    };
    const local = rounds.get(currency);
    if (local && record(local) === local) return;

    const goalKey = GOAL_PREFIX + currency;
    const roundKey = ROUND_PREFIX + currency;
    recording.add(currency);
    void withRoundLock(currency, async () => {
      const values = await GoalPrivateStorage.get([goalKey, roundKey]);
      const persistedGoal = GoalCapital.normalizeGoal(values[goalKey]);
      if (!persistedGoal || panelClosed || !contextIsActive()) return;
      const persisted = storedRound(values[roundKey]);
      if (local && persisted && local.startedAt !== persisted.startedAt) return;
      const round = persisted ?? GoalRound.newRound(persistedGoal.startCapital, at);
      const updated = record(round);
      if (!persisted || updated !== persisted) {
        await GoalPrivateStorage.set({ [roundKey]: updated });
      }
      rounds.set(currency, updated);
    }).catch(() => {
      // The live point remains visible. The next valid scan can retry the storage write.
    }).finally(() => recording.delete(currency));
  }

  function describePage({ phase, order, positions }) {
    const count = selector => document.querySelectorAll(selector).length;
    return [
      `扩展版本 ${extensionVersion}`,
      `失败步骤 ${phase}`,
      `可用余额 ${order ? '已识别' : '未识别'}`,
      `保证金模式 ${order?.mode ? '已识别' : '未识别'}`,
      `当前仓位 ${positions ? '已识别' : '未识别'}`,
      `页面标记 下单区=${count('.place-order-inner-common')} 余额=${count('[data-testid="max-asset"]')} 模式=${count('.order-settings-box > .top')}`,
      `仓位区=${count('#positionBox')} 仓位行=${count('[data-testid="e2e-position-row"]')} 筛选=${count('[data-position-filter]')}`,
      `仓位字段 区内行=${count('#positionBox [data-testid="e2e-position-row"]')} 保证金=${count('[data-testid="e2e-position-row"] [class*="margin-balance_margin-balance-value-box__"]')} 逐仓/全仓=${count('[data-testid="e2e-position-row"] [class*="margin-balance_margin-balance-mode__"]')} 浮动收益=${count('[data-testid="e2e-position-row"] [class*="unrealized-pnl_valueWrapper__"]')}`,
    ].join('\n');
  }

  function scan() {
    if (!contextIsActive() || !settingsLoaded || panelClosed) return false;
    const market = marketFromPath();
    if (!market) {
      panel?.host.remove();
      consentPanel?.host.remove();
      liveOrder = undefined;
      liveSnapshot = undefined;
      knownCurrency = undefined;
      lastGood = undefined;
      currentPath = undefined;
      return false;
    }
    if (location.pathname !== currentPath) {
      liveOrder = undefined;
      liveSnapshot = undefined;
      knownCurrency = undefined;
      lastGood = undefined;
      currentPath = location.pathname;
    }
    if (!consentGranted) {
      panel?.host.remove();
      consentPanel ??= GoalOverlay.createConsentPanel({
        onAllow: allowLocalReading,
        onClose: () => savePanelClosed(true),
      });
      if (!consentPanel.host.isConnected) document.body.append(consentPanel.host);
      return true;
    }
    consentPanel?.host.remove();
    if (!panel) {
      panel = GoalOverlay.createPanel({
        onSave: saveGoal,
        onRefresh: scan,
        onNewRound: startNewRound,
        onPositionChange: savePanelPosition,
        onClose: () => savePanelClosed(true),
      });
    }
    if (!panel.host.isConnected) {
      document.body.append(panel.host);
      panel.setPosition(panelPosition);
    }
    if (!recordsLoaded) {
      panel.render({ marketLabel: market, error: '无法打开本机加密记录，请刷新交易页后重试。' });
      return true;
    }

    let orderError;
    let positionsError;
    let calculationError;
    let positions;
    liveSnapshot = undefined;
    try {
      liveOrder = GoalOkx.readOrderCard(document);
    } catch (failure) {
      liveOrder = failure.balance;
      orderError = failure.message || '读取下单区失败，请确认下单区已显示。';
    }
    if (liveOrder) knownCurrency = liveOrder.currency;
    try {
      positions = GoalOkx.readPositions(document);
    } catch (failure) {
      positionsError = failure.message || '读取仓位失败，请打开下方「当前仓位」。';
    }
    if (!orderError && !positionsError) {
      try {
        liveSnapshot = GoalCapital.calculateCapital({ ...liveOrder, positions });
        lastGood = Date.now();
      } catch (failure) {
        calculationError = failure.message || '当前资金无法计算。';
      }
    }
    const error = orderError || positionsError || calculationError;
    const phase = orderError ? '下单区' : positionsError ? '当前仓位' : '资金汇总';

    const stored = goals.get(knownCurrency);
    const settings = knownCurrency ? { currency: knownCurrency, ...stored } : undefined;
    const currentCapital = liveSnapshot?.currentCapital;
    const result = stored && liveSnapshot ? GoalCapital.calculateTarget(stored, currentCapital) : undefined;
    const now = Date.now();
    let round = rounds.get(knownCurrency);
    let history;
    if (stored && liveOrder?.currency) {
      try {
        history = GoalOkxHistory.read(document);
      } catch {
        history = { records: [], issue: '暂时无法读取历史仓位，请重新打开「历史仓位」。' };
      }
    }
    if (stored && (liveSnapshot || history?.records?.length)) {
      round ??= GoalRound.newRound(stored.startCapital, Math.max(0, now - 1));
      recordRoundSample(knownCurrency, currentCapital, now, history?.records);
    }
    const settled = round ? GoalRound.settledView(round) : undefined;
    const historyView = Boolean(history && positionsError && !orderError);
    let settlementHint;
    if (stored) {
      const count = '本轮已计 ' + (settled?.count ?? 0) + ' 笔。';
      settlementHint = count + (history
        ? (history.issue || '已载入的记录会自动计入；可滚动加载本轮较早的记录。')
        : '打开下方「历史仓位」同步已平仓的收益。');
    }
    panel.render({
      settings,
      snapshot: liveSnapshot,
      order: liveOrder,
      result,
      round: round ? GoalRound.view(round, currentCapital, now) : undefined,
      settled,
      settlementHint,
      historyView,
      error,
      diagnostic: error && !historyView ? describePage({ phase, order: liveOrder, positions }) : undefined,
      updatedAt: liveSnapshot ? lastGood : undefined,
      lastGood: liveSnapshot ? undefined : lastGood,
      marketLabel: market,
    });
    return true;
  }

  function checkCurrentCurrency() {
    const currency = liveOrder?.currency;
    const market = currentPath;
    if (!scan()) throw new Error('扩展已重新加载，请刷新交易页。');
    if (!currency || !liveOrder) throw new Error('请先让面板读取到可用余额和币种，再保存目标。');
    if (market !== currentPath || liveOrder.currency !== currency) {
      throw new Error('交易页面或币种已切换，请检查当前目标后再保存。');
    }
    return currency;
  }

  async function persistGoal(currency, goal, resetRound) {
    await waitingForSettings;
    try {
      await withRoundLock(currency, async () => {
        const goalKey = GOAL_PREFIX + currency;
        const roundKey = ROUND_PREFIX + currency;
        const previous = await GoalPrivateStorage.get([goalKey, roundKey]);
        if (!contextIsActive()) throw new Error('扩展已重新加载，请刷新交易页。');
        const currentRound = storedRound(previous[roundKey]);
        const realizedBase = resetRound
          ? GoalRound.realizedBalance(currentRound) ?? GoalCapital.normalizeGoal(previous[goalKey])?.startCapital ?? goal.startCapital
          : goal.startCapital;
        const round = resetRound || !currentRound
          ? GoalRound.newRound(goal.startCapital, Date.now(), realizedBase) : currentRound;
        const values = { [goalKey]: goal };
        if (round !== currentRound) values[roundKey] = round;
        await GoalPrivateStorage.set(values);
        goals.set(currency, goal);
        rounds.set(currency, round);
      });
    } catch {
      throw new Error('Chrome 无法保存目标，请刷新交易页后重试。');
    }
    scan();
  }

  async function saveGoal(input) {
    const currency = checkCurrentCurrency();
    const goal = GoalCapital.normalizeGoal(input);
    if (!goal) throw new Error('请输入有效的起始资金和目标。目标须为正，连赢笔数须为整数。');
    await persistGoal(currency, goal, false);
  }

  async function startNewRound() {
    const currency = checkCurrentCurrency();
    const stored = goals.get(currency);
    const startCapital = liveSnapshot?.currentCapital;
    if (!Number.isFinite(startCapital) || startCapital <= 0) {
      throw new Error('读到大于零的当前资金后，才能开始新一轮。');
    }
    if (!stored) throw new Error('请先保存一个目标。');
    const goal = GoalCapital.normalizeGoal({ ...stored, startCapital });
    if (!goal) throw new Error('当前资金与已有目标无法计算，请检查目标设置。');
    await persistGoal(currency, goal, true);
  }

  async function applyConsent(granted) {
    consentGranted = granted;
    if (!granted) {
      recordsLoaded = false;
      goals.clear();
      rounds.clear();
      liveOrder = undefined;
      liveSnapshot = undefined;
      knownCurrency = undefined;
      lastGood = undefined;
    } else if (!recordsLoaded) {
      const values = await GoalPrivateStorage.get(null);
      for (const [key, value] of Object.entries(values)) applyStored(key, value);
      recordsLoaded = true;
    }
  }

  function queueSettings(operation) {
    const task = waitingForSettings.then(operation);
    waitingForSettings = task.catch(() => {});
    return task;
  }

  async function allowLocalReading() {
    if (!contextIsActive()) throw new Error('请刷新交易页后重试。');
    await chrome.storage.local.set({ [CONSENT_KEY]: true });
    await queueSettings(async () => {
      await applyConsent(true);
      scan();
    });
  }

  const preferenceKeys = [PANEL_CLOSED_KEY, PANEL_POSITION_KEY];
  waitingForSettings = chrome.storage.local.get([CONSENT_KEY, ...preferenceKeys]).then(async values => {
    for (const key of preferenceKeys) applyStored(key, values[key]);
    await applyConsent(values[CONSENT_KEY] === true);
  }).catch(() => {}).finally(() => {
    settingsLoaded = true;
    if (!document.hidden) scan();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const changedPreferences = preferenceKeys.filter(key => Object.hasOwn(changes, key));
    const changedConsent = Object.hasOwn(changes, CONSENT_KEY);
    const changedRecords = Object.keys(changes).some(key => key.startsWith(GoalPrivateStorage.prefix));
    if (!changedPreferences.length && !changedConsent && !changedRecords) return;
    void queueSettings(async () => {
      for (const key of changedPreferences) applyStored(key, changes[key].newValue);
      if (changedConsent) await applyConsent(changes[CONSENT_KEY].newValue === true);
      if (recordsLoaded && changedRecords) {
        const values = await GoalPrivateStorage.readChanges(changes);
        for (const [key, value] of Object.entries(values)) applyStored(key, value);
      }
    }).catch(() => {}).then(() => {
      if (!document.hidden) scan();
    });
  });

  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message?.type !== MESSAGE) return;
    void waitingForSettings.then(async () => {
      if (!contextIsActive() || !marketFromPath()) return false;
      if (panelClosed) await savePanelClosed(false);
      const shown = scan();
      if (shown && consentGranted) panel?.expand();
      return shown;
    }).then(shown => reply({ shown }), () => reply({ shown: false }));
    return true;
  });

  function scanVisible() {
    if (document.hidden) contextIsActive();
    else scan();
  }

  const listenerOptions = { signal: pageListeners.signal };
  document.addEventListener('visibilitychange', scanVisible, listenerOptions);
  window.addEventListener('pageshow', scan, listenerOptions);
  window.addEventListener('popstate', scan, listenerOptions);
  scanTimer = setInterval(scanVisible, SCAN_INTERVAL_MS);
})();
