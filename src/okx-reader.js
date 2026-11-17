(function (root) {
  'use strict';

  const textNodes = 'button, [role], label, span, div, p, th, td, a, strong, small, b';
  const positionTab = /^(?:当前仓位|當前倉位|当前持仓|當前持倉|positions|open positions|current positions)\s*(?:\(\s*(\d+|\d{1,3}(?:,\d{3})+)\s*\)|(\d+|\d{1,3}(?:,\d{3})+))?$/i;
  const availability = /^(?:可用(?:余额|余額|金额|金額|资金|資金|保证金|保證金)?|(?:available|avail\.?)(?: balance| margin| funds| to trade| for trading)?)(?=\s|[:+\-−\d]|$)\s*:?\s*/i;
  const columnTitles = {
    instrument: /^(?:交易品种|交易品種|交易产品|交易產品|instrument(?: name)?|symbol)$/i,
    margin: /^(?:保证金|保證金|保证金余额|保證金餘額|仓位保证金|倉位保證金|初始保证金|初始保證金|margin(?: balance)?|position margin|initial margin)(?:\s*\([A-Z][A-Z0-9]{1,11}\))?$/i,
    pnl: /^(?:浮动收益|浮動收益|浮动盈亏|浮動盈虧|未实现盈亏|未實現盈虧|未实现收益|未實現收益|unrealized (?:pnl|p&l)|floating (?:pnl|p&l))(?:\s*\((?:%|[A-Z][A-Z0-9]{1,11})\))?$/i,
    mode: /^(?:保证金模式|保證金模式|仓位模式|倉位模式|margin mode)$/i,
  };
  const pairFilter = /^(?:当前交易品种|當前交易品種|当前交易对|當前交易對|只展示当前品种|只展示當前品種|仅显示当前交易品种|僅顯示當前交易品種|current (?:trading pair|instrument|symbol|contract)(?: only)?|(?:show )?only current (?:trading pair|instrument|symbol|contract))$/i;
  const groupFilter = /^(?:按币种分组|按幣種分組|group by (?:currency|crypto|coin))$/i;
  const allTypes = /全部交易类型|全部交易類型|全部交易品种|全部交易品種|all (?:trading|instrument|product) types|all instruments/i;
  const allModes = /(?:逐仓\s*\/\s*全仓|全仓\s*\/\s*逐仓|逐倉\s*\/\s*全倉|全倉\s*\/\s*逐倉|isolated\s*\/\s*cross|cross\s*\/\s*isolated|all margin modes|全部保证金模式|全部保證金模式)/i;
  const emptyPositions = /^(?:暂无(?:当前)?仓位|暫無(?:當前)?倉位|暂无持仓|暫無持倉|没有(?:当前)?仓位|沒有(?:當前)?倉位|no (?:open |current )?positions|you have no (?:open |current )?positions)[.!。]?$/i;
  const emptyData = /^(?:暂无(?:数据|记录)|暫無(?:數據|記錄)|no (?:data|records)(?: available)?)[.!。]?$/i;

  function normalize(text) {
    return String(text ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  }

  function visible(element) {
    if (!element.getClientRects().length || element.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
    const style = element.ownerDocument.defaultView.getComputedStyle(element);
    return style.visibility !== 'hidden' && style.visibility !== 'collapse' && style.display !== 'none';
  }

  function displayText(element) {
    return normalize(element.innerText ?? element.textContent);
  }

  // A label may be one node or split across a label and a counter/balance span.
  function findText(scope, pattern) {
    const matches = new Set();
    for (const element of scope.querySelectorAll(textNodes)) {
      const raw = element.textContent;
      if (!raw || raw.length > 180 || !pattern.test(normalize(raw)) || !visible(element)) continue;
      if (pattern.test(displayText(element))) matches.add(element);
    }
    const parents = new Set();
    for (const match of matches) {
      for (let parent = match.parentElement; parent && parent !== scope; parent = parent.parentElement) {
        if (matches.has(parent)) parents.add(parent);
      }
    }
    return [...matches].filter(element => !parents.has(element));
  }

  function amount(text, field, { fallbackCurrency } = {}) {
    const numbers = [...text.matchAll(/(?<![\d.,])([+\-−]?\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*([A-Z][A-Z0-9]{1,11})(?![A-Za-z0-9.%])/g)];
    if (!numbers.length && fallbackCurrency) return { number: 0, currency: fallbackCurrency };
    if (numbers.length !== 1) throw new Error(`无法确认「${field}」的金额和币种。`);
    const [, value, currency] = numbers[0];
    const number = Number(value.replace(/[ ,]/g, '').replace('−', '-'));
    if (!Number.isFinite(number)) {
      if (fallbackCurrency && currency === fallbackCurrency) return { number: 0, currency };
      throw new Error(`「${field}」的金额无效。`);
    }
    return { number, currency };
  }

  function modesIn(text) {
    const modes = [];
    if (/逐[仓倉]|\bisolated\b/i.test(text)) modes.push('isolated');
    if (/全[仓倉]|\bcross\b/i.test(text)) modes.push('cross');
    return modes;
  }

  function explicitState(element) {
    for (const attr of ['aria-selected', 'aria-checked', 'aria-pressed']) {
      const value = element.getAttribute(attr);
      if (value === 'true') return true;
      if (value === 'false') return false;
    }
    const value = element.getAttribute('data-state');
    if (['active', 'checked', 'selected', 'on'].includes(value)) return true;
    if (['inactive', 'unchecked', 'unselected', 'off'].includes(value)) return false;
    return null;
  }

  function labelState(label, selector) {
    for (let node = label, depth = 0; node && depth < 5; node = node.parentElement, depth += 1) {
      if (node !== label && !node.matches(selector)) continue;
      const state = explicitState(node);
      if (state != null) return state;
    }
    return null;
  }

  function readOrderCard(document) {
    const orderTypes = /(?:限价委托|限價委託|\blimit\b)/i;
    const orderActions = /(?:预计可[买卖]入?|預計可[買賣]入?|买入\s*\(做多\)|買入\s*\(做多\)|卖出\s*\(做空\)|賣出\s*\(做空\)|\b(?:est\.?|estimated|max)\s*(?:buy|sell)\b|\bbuy\s*(?:\/\s*long\b|\(long\))|\bsell\s*(?:\/\s*short\b|\(short\)))/i;
    const labelMode = /^(?:逐[仓倉]|全[仓倉]|isolated(?: margin)?|cross(?: margin)?)$/i;
    const balanceLabel = new RegExp(availability.source + '$', 'i');
    const balanceUnavailable = '无法读取下单区「可用」的金额与币种。请确认已登录且金额可见。';
    const orderContainers = [...document.querySelectorAll('.place-order-container-common .place-order-inner-common, .place-order-container-common.place-order-inner-common')].filter(visible);
    const cards = new Map();

    function readMode(element) {
      const controls = [...element.querySelectorAll('.order-settings-box > .top')].filter(visible);
      const anchored = controls.flatMap(control => labelMode.test(displayText(control)) ? [control] : findText(control, labelMode));
      const labels = anchored.length ? anchored : findText(element, labelMode).filter(label =>
        !label.closest('.order-settings-box > .bottom'));
      const selector = 'button, [role="button"], [role="tab"], [role="radio"], [role="option"]';
      const selected = labels.filter(label => labelState(label, selector) === true);
      const usable = selected.length ? selected : labels.filter(label => labelState(label, selector) !== false);
      const modes = [...new Set(usable.flatMap(label => modesIn(displayText(label))))];
      if (modes.length !== 1) {
        throw new Error('无法确认下单区的保证金模式。请显示「逐仓」或「全仓」选项后重试。');
      }
      return modes[0];
    }

    function recordBalance(container, available) {
      const previous = cards.get(container);
      if (previous && (previous.number !== available.number || previous.currency !== available.currency)) {
        throw new Error('下单区显示了多个不同的可用余额，无法确定计算口径。');
      }
      cards.set(container, available);
    }

    function readMarkedBalances(container) {
      // The amount span is separate from the label, transfer controls and account tooltips.
      const rows = [...container.querySelectorAll('[data-testid="max-asset"] [class*="index_availableItemInner__"]')].filter(visible);
      const balances = [];
      for (const row of rows) {
        const labels = [...row.querySelectorAll('[class*="index_text__"]')].filter(visible);
        if (!labels.some(label => balanceLabel.test(displayText(label)))) continue;
        const values = [...row.querySelectorAll('[class*="index_value__"]')].filter(visible);
        if (values.length !== 1) throw new Error(balanceUnavailable);
        const text = displayText(values[0]);
        if (!/^[+\-−]?\s*\d[\d.,]*\s*[A-Z][A-Z0-9]{1,11}$/.test(text)) {
          throw new Error(balanceUnavailable);
        }
        try {
          balances.push(amount(text, '可用'));
        } catch {
          throw new Error(balanceUnavailable);
        }
      }
      return balances;
    }

    function addUnmarkedCard(anchor, container) {
      let available;
      const end = container?.parentElement ?? document.body;
      for (let element = anchor, depth = 0; element && element !== end && depth < 16; element = element.parentElement, depth += 1) {
        const contents = displayText(element);
        if (!container && (contents.length > 3800 || /当前仓位|當前倉位|(?:current|open) positions\s*\(/i.test(contents))) break;
        if (!available && availability.test(contents) && contents.length < 120) {
          try { available = amount(contents.replace(availability, ''), '可用'); } catch { /* The amount may be in the next ancestor. */ }
        }
        const isOrderCard = container ? element === container : orderTypes.test(contents) && orderActions.test(contents);
        if (!available || !isOrderCard) continue;
        if (!container && !findText(element, labelMode).length) continue;
        recordBalance(element, available);
        break;
      }
    }

    if (orderContainers.length) {
      for (const container of orderContainers) {
        const marked = readMarkedBalances(container);
        if (marked.length) {
          for (const balance of marked) recordBalance(container, balance);
          continue;
        }
        const anchors = findText(container, availability).filter(anchor =>
          !anchor.closest('[data-testid="max-trade"], [data-testid="max-close"]'));
        const balanceAnchors = anchors.filter(anchor => anchor.closest('[data-testid="max-asset"], [class*="index_availableItemInner__"], .avail-display-container, .avail-display-box, [data-testid="quick-margin-max-avail"]'));
        for (const anchor of balanceAnchors.length ? balanceAnchors : anchors) addUnmarkedCard(anchor, container);
      }
      if (!cards.size) throw new Error(balanceUnavailable);
    } else {
      for (const anchor of findText(document, availability)) addUnmarkedCard(anchor);
    }
    if (cards.size !== 1) throw new Error('无法确认下单区的可用余额和保证金模式。请显示完整的合约下单区并重试。');
    const [[container, balance]] = cards;
    const confirmed = { available: balance.number, currency: balance.currency };
    try {
      return { ...confirmed, mode: readMode(container) };
    } catch (error) {
      error.balance = confirmed;
      throw error;
    }
  }

  function visibleChildren(element) {
    return [...element.children].filter(visible);
  }

  function containsHeading(cell, pattern) {
    return pattern.test(displayText(cell)) || findText(cell, pattern).length > 0;
  }

  function schemaFor(row) {
    const children = visibleChildren(row);
    if (children.length < 3 || children.length > 40) return null;
    const indexes = Object.fromEntries(Object.entries(columnTitles).map(([name, pattern]) => [
      name, children.flatMap((child, index) => containsHeading(child, pattern) ? [index] : []),
    ]));
    if (['instrument', 'margin'].some(key => indexes[key].length !== 1) || indexes.pnl.length > 1 || indexes.mode.length > 1) return null;
    const recognized = Object.values(indexes).flat();
    if (new Set(recognized).size !== recognized.length) return null;
    if (!indexes.pnl.length) {
      const markers = [/^(?:持仓量|持倉量|position size|position quantity)$/i, /^(?:标记价格|標記價格|mark price)$/i,
        /^(?:维持保证金率|維持保證金率|maintenance margin ratio)$/i];
      if (markers.filter(pattern => children.some(child => containsHeading(child, pattern))).length < 2) return null;
    }
    return {
      row, width: children.length, instrument: indexes.instrument[0], margin: indexes.margin[0],
      pnl: indexes.pnl[0], mode: indexes.mode[0],
    };
  }

  function findSchemas(panel) {
    const schemas = new Map();
    for (const margin of findText(panel, columnTitles.margin)) {
      for (let row = margin.parentElement; row && row !== panel; row = row.parentElement) {
        if (row.textContent.length > 2500) break;
        const schema = schemaFor(row);
        if (!schema) continue;
        schemas.set(row, schema);
        break;
      }
    }
    return [...schemas.values()];
  }

  function checkboxState(label, panel) {
    const selector = 'input[type="checkbox"], [role="checkbox"], [role="switch"], [aria-checked]';
    for (let element = label, depth = 0; element && element !== panel && depth < 5; element = element.parentElement, depth += 1) {
      const controls = element.matches(selector) ? [element] : [...element.querySelectorAll(selector)];
      if (controls.length > 1) break;
      if (!controls.length) continue;
      const control = controls[0];
      if (control.matches('input[type="checkbox"]')) return control.indeterminate ? null : control.checked;
      return explicitState(control);
    }
    const wrapper = label.closest('.okui-checkbox-wrapper');
    if (wrapper && panel.contains(wrapper)) {
      if (wrapper.classList.contains('okui-checkbox-wrapper-indeterminate')) return null;
      return wrapper.classList.contains('okui-checkbox-wrapper-checked');
    }
    return null;
  }

  function visiblePositionFilters(scope) {
    return [...scope.querySelectorAll('[data-position-filter]')].filter(filter => visible(filter) ||
      [...filter.querySelectorAll('.inst-type-select, .mgn-mode-select')].some(visible));
  }

  const actualCheckbox = 'input[type="checkbox"], [role="checkbox"], [role="switch"]';

  function checkableElements(container) {
    const children = [...container.querySelectorAll(actualCheckbox)];
    if (container.matches(actualCheckbox)) children.unshift(container);
    return children;
  }

  function actualCheckboxState(control) {
    if (control.matches('input[type="checkbox"]')) return control.indeterminate ? null : control.checked;
    return control.getAttribute('aria-checked') === 'mixed' ? null : explicitState(control);
  }

  function checkboxForLabel(label, bar) {
    const linked = label.closest('label')?.control;
    if (linked?.matches(actualCheckbox) && bar.contains(linked)) return linked;
    const wrapper = label.closest(`.okui-checkbox-wrapper, ${actualCheckbox}`);
    if (!wrapper || !bar.contains(wrapper)) return null;
    const controls = checkableElements(wrapper);
    return controls.length === 1 ? controls[0] : null;
  }

  function checkProductionCheckboxes(bar, pairLabels, groupLabels) {
    const symbolFilters = [...bar.querySelectorAll('[class*="pos-filter_symbol-filter-control__"]')].filter(visible);
    // OKX's symbol dropdown and its enabling checkbox are siblings. The dropdown label is not a checkbox label.
    const pairWrappers = symbolFilters.length === 1
      ? [...symbolFilters[0].querySelectorAll('[class*="pos-filter_symbol-filter-checkbox__"]')]
      : [];
    const pairControls = symbolFilters.length
      ? pairWrappers.length === 1 ? checkableElements(pairWrappers[0]) : []
      : pairLabels.map(label => checkboxForLabel(label, bar)).filter(Boolean);
    if (!pairControls.length) throw new Error('无法确认「当前交易品种」筛选的复选框。请显示完整的当前仓位筛选栏。');
    if (groupLabels.some(label => !checkboxForLabel(label, bar))) {
      throw new Error('无法确认「按币种分组」筛选的复选框。请显示完整的当前仓位筛选栏。');
    }
    const indeterminate = bar.querySelector('.okui-checkbox-wrapper-indeterminate, .okui-checkbox-wrapper-checked');
    if (indeterminate || checkableElements(bar).some(box => actualCheckboxState(box) !== false)) {
      throw new Error('请取消「当前交易品种」和「按币种分组」，显示全部仓位后重试。');
    }
  }

  function checkFilters(panel, detachedFilter) {
    const positionFilters = detachedFilter ? [detachedFilter] : visiblePositionFilters(panel);
    if (positionFilters.length > 1) throw new Error('识别到多个当前仓位筛选区，请只打开一个仓位面板。');
    const filterBar = positionFilters[0] ?? panel;
    const pairLabels = findText(filterBar, pairFilter);
    const groupLabels = findText(filterBar, groupFilter);
    if (positionFilters.length) {
      checkProductionCheckboxes(filterBar, pairLabels, groupLabels);
      const typeSelect = [...filterBar.querySelectorAll('.inst-type-select')].filter(visible);
      const marginSelect = [...filterBar.querySelectorAll('.mgn-mode-select')].filter(visible);
      if (typeSelect.length !== 1 || !allTypes.test(displayText(typeSelect[0])) || !marginSelect[0] || !allModes.test(displayText(marginSelect[0]))) {
        throw new Error('请把当前仓位的交易类型和保证金模式筛选恢复为全部后重试。');
      }
    } else if ([...pairLabels, ...groupLabels].some(label => checkboxState(label, filterBar) !== false)) {
      throw new Error('请取消「当前交易品种」和「按币种分组」，显示全部仓位后重试。');
    }
    if (pairLabels.length || groupLabels.length || positionFilters.length) {
      if ([...filterBar.querySelectorAll('[role="combobox"][aria-expanded="true"]')].some(visible)) {
        throw new Error('请先关闭当前仓位的筛选菜单再重试。');
      }
      const text = displayText(filterBar);
      if (!allTypes.test(text) || !allModes.test(text)) {
        throw new Error('请把当前仓位的交易类型和保证金模式筛选恢复为全部后重试。');
      }
    }
    const pageControls = panel.querySelectorAll('[aria-label*="page" i], [aria-label*="分页"], [class*="pagination" i], [data-testid*="pagination" i]');
    for (const control of pageControls) {
      if (!visible(control)) continue;
      const label = normalize(control.getAttribute('aria-label'));
      const text = displayText(control);
      const pageIndicator = text.match(/\b([0-9]+)\s*\/\s*([0-9]+)\b/);
      const pagerButtons = [...control.querySelectorAll('button, [role="button"], a')].filter(visible);
      const enabledNav = button => !button.disabled && button.getAttribute('aria-disabled') !== 'true' &&
        /^(?:(?:next|previous|prev|first|last)(?: page)?|load more|下一页|上一页|首页|末页|下一頁|上一頁|加载更多|載入更多)$/i.test(normalize(button.getAttribute('aria-label') || button.getAttribute('title') || displayText(button)));
      if ((pageIndicator && (Number(pageIndicator[1]) !== 1 || Number(pageIndicator[2]) !== 1)) ||
          enabledNav(control) || pagerButtons.some(enabledNav) ||
          ((/pagination|分页/i.test(label + ' ' + control.className)) && pagerButtons.some(button => /^[2-9]\d*$|^1\d+$/.test(displayText(button))))) {
        throw new Error('当前仓位有分页。请在一页中显示全部仓位后重试。');
      }
    }
  }

  function matchingRows(panel, schema, count) {
    const table = schema.row.closest('table, [role="table"], [role="grid"], [role="treegrid"]');
    const okxTable = schema.row.closest('[class*="draggable-table_orderableTableContainer"], #positionBox');
    if (okxTable && panel.contains(okxTable)) {
      const markedRows = [...okxTable.querySelectorAll('[data-testid="e2e-position-row"]')].filter(visible);
      if (markedRows.length) return markedRows;
    }
    if (table && panel.contains(table)) {
      const rows = [...table.querySelectorAll('tr, [role="row"]')].filter(row =>
        row !== schema.row && visible(row) && row.closest('table, [role="table"], [role="grid"], [role="treegrid"]') === table &&
        !row.matches('[class*="draggable-table_expandedRow"]') && (row.matches('[role="row"]') || row.querySelector('td')));
      return rows;
    }

    // Some OKX layouts render a scrollable grid without table roles.
    let rows = [];
    for (let scope = schema.row.parentElement; scope && panel.contains(scope); scope = scope.parentElement) {
      rows = [...scope.querySelectorAll('div, [role="row"]')].filter(row => {
        if (row === schema.row || row.contains(schema.row) || schema.row.contains(row) || !visible(row)) return false;
        const cells = visibleChildren(row);
        if (cells.length !== schema.width) return false;
        const instrument = displayText(cells[schema.instrument]);
        const margin = displayText(cells[schema.margin]);
        const pnl = schema.pnl == null ? '' : displayText(cells[schema.pnl]);
        return instrument.length > 0 && instrument.length < 120 && (modesIn(margin).length ||
          /[A-Z]{2,}/.test(margin) || /[A-Z]{2,}/.test(pnl) ||
          (schema.mode != null && modesIn(displayText(cells[schema.mode])).length));
      });
      if (rows.length >= Math.max(1, count) || scope === panel) break;
    }
    return rows;
  }

  function readPositionValues({ instrument, marginText, modeText, pnlText }, index) {
    if (!instrument || instrument === '--') throw new Error(`第 ${index + 1} 个仓位的交易品种未显示。`);
    const modes = modesIn(`${marginText} ${modeText}`);
    if (modes.length !== 1) throw new Error(`无法确认 ${instrument} 仓位的逐仓或全仓模式。`);
    const { number: margin, currency } = amount(marginText, `${instrument} 保证金`);
    if (margin < 0) throw new Error(`${instrument} 保证金为负数，无法计算。`);
    if (modes[0] === 'isolated') {
      if (pnlText == null) throw new Error('请在当前仓位表中显示「浮动收益」列以读取逐仓仓位。');
      const profit = amount(pnlText, `${instrument} 浮动收益`, { fallbackCurrency: currency });
      if (profit.currency !== currency) throw new Error(`${instrument} 的保证金和浮动收益币种不同。`);
      return { margin, pnl: profit.number, mode: 'isolated', currency };
    }
    const position = { margin, pnl: 0, mode: 'cross', currency };
    if (pnlText != null) {
      try {
        const profit = amount(pnlText, `${instrument} 浮动收益`, { fallbackCurrency: currency });
        if (profit.currency === currency) position.crossPnl = profit.number;
      } catch {
        // Cross PnL is optional display data and does not enter the capital formula.
      }
    }
    return position;
  }

  function readPosition(row, schema, index) {
    const cells = visibleChildren(row);
    if (cells.length !== schema.width) throw new Error(`第 ${index + 1} 个仓位的表格列不完整。请显示交易品种、保证金和浮动收益。`);
    return readPositionValues({
      instrument: displayText(cells[schema.instrument]),
      marginText: displayText(cells[schema.margin]),
      modeText: `${positionGroupMode(row)} ${schema.mode == null ? '' : displayText(cells[schema.mode])}`,
      pnlText: schema.pnl == null ? null : positionPnlText(cells[schema.pnl]),
    }, index);
  }

  function positionGroupMode(row) {
    const group = row.closest('[class*="risk-unit-list_cross-positions-box__"], .isolated-positions-box');
    if (!group) return '';
    return group.matches('.isolated-positions-box') ? 'isolated' : 'cross';
  }

  const markedPositionRow = '[data-testid="e2e-position-row"]';
  const instrumentField = '[class*="pos-info_inst-id__"]';
  const marginField = '[class*="margin-balance_field-margin-balance-box__"]';
  const marginValue = '[class*="margin-balance_margin-balance-value-box__"]';
  const marginMode = '[class*="margin-balance_margin-balance-mode__"]';
  const pnlWrapper = '[class*="unrealized-pnl_valueWrapper__"]';
  const positionCard = '[class*="pos-item_pos-item-box__"]';

  function hasPositionBody(box) {
    return [...box.querySelectorAll(`${markedPositionRow}, ${positionCard}, tr, [role="row"]`)].some(row =>
      visible(row) && (row.matches(`${markedPositionRow}, ${positionCard}`) || row.querySelector('td, [role="cell"], [role="gridcell"]')));
  }

  function positionBoxIsLoading(box) {
    const loading = '[class*="position-loader"], [aria-busy="true"]';
    return box.matches('[aria-busy="true"]') || [...box.querySelectorAll(loading)].some(visible);
  }

  function hasLoadedEmptyState(box) {
    if (positionBoxIsLoading(box) || hasPositionBody(box)) return false;
    if ([...box.querySelectorAll('.empty-box, .okui-empty')].some(visible)) return true;
    const emptyLabel = text => emptyPositions.test(text) || emptyData.test(text);
    if (findText(box, emptyPositions).length === 1 || findText(box, emptyData).length === 1) return true;
    return [...box.querySelectorAll('img[alt], [role="img"][aria-label]')].some(image =>
      visible(image) && emptyLabel(normalize(image.getAttribute('alt') || image.getAttribute('aria-label'))));
  }

  function readMarkedPosition(row, index) {
    const instrumentNodes = [...row.querySelectorAll(instrumentField)].filter(visible);
    const instrument = instrumentNodes.length === 1 ? displayText(instrumentNodes[0]) : `第 ${index + 1} 个`;
    const values = [...row.querySelectorAll(marginValue)].filter(visible);
    const field = values.length === 1 ? values[0] : null;
    const outerFields = [...row.querySelectorAll(marginField)].filter(visible);
    const marginScope = field ?? (values.length === 0 && outerFields.length === 1 ? outerFields[0] : null);
    if (!marginScope) throw new Error(`无法确认 ${instrument} 仓位的保证金金额。请在当前仓位显示「保证金」列。`);

    const amounts = [...marginScope.querySelectorAll('[class*="original-field_item-content__"]')].filter(visible);
    if (amounts.length > 1) throw new Error(`无法区分 ${instrument} 仓位的多个保证金金额。`);
    const marginText = displayText(amounts[0] ?? marginScope);
    const modeText = [...marginScope.querySelectorAll(marginMode)].filter(visible).map(displayText).join(' ');
    const pnlFields = [...row.querySelectorAll(pnlWrapper)].filter(visible);
    const pnlField = pnlFields.length === 1 ? pnlFields[0] : null;
    const nativePnl = pnlField ? visibleChildren(pnlField)[0] ?? pnlField : null;
    return readPositionValues({
      instrument, marginText,
      modeText: `${positionGroupMode(row)} ${modeText}`,
      pnlText: nativePnl ? displayText(nativePnl) : null,
    }, index);
  }

  function positionPnlText(container, unit = '') {
    // OKX renders the native amount first, then its return percentage and an optional USD conversion.
    const wrappers = [...container.querySelectorAll(pnlWrapper)].filter(visible);
    const primary = wrappers.length === 1 ? visibleChildren(wrappers[0])[0] : null;
    const cardValues = unit ? [...container.querySelectorAll('[class*="original-field_item-content__"]')].filter(visible) : [];
    const value = primary || (cardValues.length === 1 ? cardValues[0] : null);
    const text = displayText(value ?? container);
    const plain = /^[+\-−]?\s*(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/;
    return unit && plain.test(text) ? `${text} ${unit}` : text;
  }

  function readPositionCard(card, index) {
    const cardHeader = card.querySelector('[class*="pos-item_headerInfo__"]');
    const instrument = cardHeader && visible(cardHeader) ? displayText(cardHeader) : '';
    const modeLabel = /^(?:逐[仓倉]|全[仓倉]|isolated(?: margin)?|cross(?: margin)?)$/i;
    const modeText = cardHeader ? findText(cardHeader, modeLabel).map(displayText).join(' ') : '';
    function cardField(pattern) {
      const labels = findText(card, pattern);
      if (labels.length !== 1) return null;
      const container = labels[0].closest('li, [class*="pos-item_pos-card-head-pnl__"]');
      return container && card.contains(container) ? container : null;
    }
    const margin = cardField(columnTitles.margin);
    if (!margin) throw new Error('仓位卡片未显示保证金。请展开「当前仓位」并切换到表格布局。');
    const pnl = cardField(columnTitles.pnl);
    const headerPnl = card.querySelector('[class*="pos-item_pos-card-head-pnl__"]');
    const unitCaption = /^(?:收益|盈亏|盈虧|pnl|p&l|profit and loss)\s*\(\s*([A-Z][A-Z0-9]{1,11})\s*\)$/i;
    const captions = headerPnl && visible(headerPnl) ? findText(headerPnl, unitCaption) : [];
    const unit = captions.length === 1 ? unitCaption.exec(displayText(captions[0]))?.[1].toUpperCase() : '';
    const pnlText = pnl ? positionPnlText(pnl) : unit ? positionPnlText(headerPnl, unit) : null;
    return readPositionValues({ instrument, marginText: displayText(margin), modeText, pnlText }, index);
  }

  function readPositions(document) {
    const account = document.getElementById('trade-account-tab-box');
    const scope = account && visible(account) ? account : document;
    const candidates = findText(scope, positionTab);
    const counted = new Map();
    for (const candidate of candidates) {
      for (let tab = candidate, depth = 0; tab && depth < 5; tab = tab.parentElement, depth += 1) {
        const match = positionTab.exec(displayText(tab));
        if (!match) break;
        const value = match[1] ?? match[2];
        if (value == null) continue;
        counted.set(tab, Number(value.replaceAll(',', '')));
        break;
      }
    }
    const tabSelector = '[role="tab"], button, [aria-selected], [aria-controls], .okui-tabs-pane, .flexlayout__tab_button, .trade-layout-tab-button';
    const uncounted = new Set(candidates.map(candidate => candidate.closest(tabSelector) ?? candidate));
    if (counted.size > 1 || (!counted.size && uncounted.size !== 1)) {
      throw new Error('无法确认当前仓位总数。请打开下方「当前仓位」标签并显示仓位数量。');
    }
    const [tab, count] = counted.size ? counted.entries().next().value : [uncounted.values().next().value, null];
    if (count != null && (!Number.isSafeInteger(count) || count < 0)) throw new Error('「当前仓位」数量无效。');
    let active = labelState(tab, tabSelector);
    if (active == null) {
      const activeTab = '.okui-tabs-active, .okui-tabs-pane-underline-active, .okui-tabs-pane-button-active, .okui-tabs-pane-muted-active, .okui-tabs-pane-segmented-active, .flexlayout__tab_button--selected, .layout-tab-selected';
      const pane = tab.closest('.okui-tabs-pane, .flexlayout__tab_button, .trade-layout-tab-button');
      if (tab.closest(activeTab)) active = true;
      else if (pane?.parentElement.querySelector(activeTab)) active = false;
    }
    if (active === false) throw new Error('请切换到下方「当前仓位」标签后重试。');

    // The account tabs, filter bar and draggable table can be mounted in separate layout branches.
    const productionBoxes = [...document.querySelectorAll('#positionBox')];
    const markedBoxes = productionBoxes.map(box => ({
      box, rows: [...box.querySelectorAll(markedPositionRow)].filter(visible),
    })).filter(({ rows }) => rows.length);
    if (markedBoxes.length > 1) throw new Error('识别到多个当前仓位列表，请只打开一个仓位面板。');
    const marked = markedBoxes[0];
    if (marked?.rows.some(row => row.querySelector(`${marginValue}, ${marginField}, ${instrumentField}, ${pnlWrapper}`))) {
      if (count == null) throw new Error('没有可验证的当前仓位数量。请显示仓位数量或等待当前仓位加载后重试。');
      const filters = visiblePositionFilters(document);
      if (filters.length !== 1) throw new Error('无法确认当前仓位筛选。请显示完整的当前仓位筛选栏。');
      const panel = marked.box.closest('[class*="pos-list_position-tab-wrapper__"]') ?? marked.box;
      checkFilters(panel, filters[0]);
      if (marked.rows.length !== count) throw new Error(`「当前仓位」显示 ${count} 个仓位，页面读取到 ${marked.rows.length} 行。请取消筛选并让全部仓位在同一页显示后重试。`);
      return marked.rows.map(readMarkedPosition);
    }

    if (!marked && (count == null || count === 0)) {
      const emptyBoxes = productionBoxes.filter(hasLoadedEmptyState);
      if (emptyBoxes.length) {
        const box = emptyBoxes[0];
        if (emptyBoxes.length !== 1 || productionBoxes.some(other => other !== box && (visible(other) || hasPositionBody(other)))) {
          throw new Error('识别到多个当前仓位列表，请只打开一个仓位面板。');
        }
        const filters = visiblePositionFilters(document);
        if (filters.length !== 1) throw new Error('无法确认当前仓位筛选。请显示完整的当前仓位筛选栏。');
        checkFilters(box.closest('[class*="pos-list_position-tab-wrapper__"]') ?? box, filters[0]);
        return [];
      }
    }

    const control = tab.closest(tabSelector);
    const regionId = control?.getAttribute('aria-controls');
    const region = regionId ? document.getElementById(regionId) : null;
    const positionBox = scope.querySelector('#positionBox');
    const positionFilter = visiblePositionFilters(scope)[0];
    if (count == null && active !== true) throw new Error('无法确认当前仓位总数。请切换到下方「当前仓位」标签后重试。');

    for (let panel = tab.parentElement, depth = 0; panel && panel !== document.body && scope.contains(panel) && depth < 14; panel = panel.parentElement, depth += 1) {
      const contents = displayText(panel);
      if (scope === document && (contents.length > 15000 || /(?:限价委托|限價委託|\blimit\b).*(?:预计可[买卖]|預計可[買賣])/i.test(contents))) break;
      if (positionFilter && !panel.contains(positionFilter)) continue;
      if (positionBox && (!panel.contains(positionBox) || !visible(positionBox))) continue;
      if (positionBox && positionBoxIsLoading(positionBox)) throw new Error('当前仓位正在加载，请稍后重试。');
      const schemas = findSchemas(positionBox ?? panel);
      const cards = positionBox ? [...positionBox.querySelectorAll(positionCard)].filter(visible) : [];
      if ((count == null || count === 0) && active === true) {
        const visibleRegion = positionBox ?? (region && panel.contains(region) && visible(region) ? region : panel);
        const scoped = visibleRegion !== panel || panel === account || (allTypes.test(contents) && allModes.test(contents));
        const exactEmpty = scoped && findText(visibleRegion, emptyPositions).length === 1;
        const genericEmpty = findText(visibleRegion, emptyData).length === 1 && allTypes.test(contents) && allModes.test(contents);
        const hasEmptyState = positionBox ? hasLoadedEmptyState(positionBox) : exactEmpty || genericEmpty;
        if (hasEmptyState) {
          checkFilters(panel);
          if (!cards.length && schemas.every(schema => matchingRows(panel, schema, 0).length === 0)) return [];
        }
      }
      if (!schemas.length) {
        if (cards.length) {
          checkFilters(panel);
          if (cards.length !== count) throw new Error('仓位卡片未完整显示。请展开「当前仓位」并显示全部仓位后重试。');
          return cards.map(readPositionCard);
        }
        continue;
      }
      if (count == null) throw new Error('没有可验证的当前仓位数量。请显示仓位数量或等待当前仓位加载后重试。');
      checkFilters(panel);
      const rows = schemas.flatMap(schema => matchingRows(panel, schema, count).map(row => ({ row, schema })));
      if (schemas.length > 1 && (!positionBox ||
          rows.some(({ row }) => !row.matches('[data-testid="e2e-position-row"]')) ||
          new Set(rows.map(({ row }) => row)).size !== rows.length)) {
        throw new Error('无法区分多张仓位表中的记录。请切换到未分组的「当前仓位」表格后重试。');
      }
      if (rows.length !== count) throw new Error(`「当前仓位」显示 ${count} 个仓位，页面读取到 ${rows.length} 行。请取消筛选并让全部仓位在同一页显示后重试。`);
      return rows.map(({ row, schema }, index) => readPosition(row, schema, index));
    }
    throw new Error('未找到完整的当前仓位表。请打开下方「当前仓位」并显示交易品种、浮动收益和保证金列。');
  }

  function readSnapshot(document) {
    const order = readOrderCard(document);
    const positions = readPositions(document);
    const market = /\/(?:trade-swap|trade-futures)\/([a-z0-9-]+)(?:\/|$)/i.exec(document.location.pathname);
    return { ...order, positions, marketLabel: market ? market[1].toUpperCase() : '' };
  }

  const api = Object.freeze({ readSnapshot, readOrderCard, readPositions });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GoalOkx = api;
})(globalThis);
