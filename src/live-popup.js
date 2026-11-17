(() => {
  'use strict';

  const button = document.getElementById('reveal');
  const status = document.getElementById('status');
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error();
      const reply = await chrome.tabs.sendMessage(tab.id, { type: 'okx-goal:expand-panel' });
      if (!reply?.shown) throw new Error();
      window.close();
    } catch {
      status.textContent = '请打开 OKX 永续交易页。刚安装或更新扩展时，刷新交易页后再试。';
      button.disabled = false;
    }
  });
})();
