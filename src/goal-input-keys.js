(() => {
  'use strict';

  const fields = new WeakSet();
  const listeners = new AbortController();
  const options = { capture: true, signal: listeners.signal };

  function protectEditingKey(event) {
    if (event.key !== 'Backspace' && event.key !== 'Delete') return;
    if (!fields.has(event.composedPath()[0])) return;
    if (!chrome.runtime?.id) {
      listeners.abort();
      return;
    }
    // Keep the browser's native edit while shielding it from page shortcut handlers.
    event.stopImmediatePropagation();
  }

  window.addEventListener('keydown', protectEditingKey, options);
  window.addEventListener('keyup', protectEditingKey, options);
  globalThis.GoalInputKeys = Object.freeze({
    register(inputs) {
      for (const input of inputs) fields.add(input);
    },
  });
})();
