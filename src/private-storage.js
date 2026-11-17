(() => {
  'use strict';

  const MESSAGE = 'okx-goal:private-storage';
  const PREFIX = 'okxGoalEncryptedV1:';
  const CONSENT_KEY = 'okxGoalLocalReadConsentV1';
  const financialKey = /^(?:okxLiveGoalV2:|okxLiveRoundV3:)[A-Z][A-Z0-9]{1,11}$/;
  const isFinancialKey = key => typeof key === 'string' && financialKey.test(key);

  function originalKey(key) {
    if (!key.startsWith(PREFIX)) return undefined;
    const original = key.slice(PREFIX.length);
    return isFinancialKey(original) ? original : undefined;
  }

  if (typeof document !== 'undefined') {
    async function request(operation, payload) {
      const reply = await chrome.runtime.sendMessage({ type: MESSAGE, operation, payload });
      if (reply?.ok) return reply.result;
      throw new Error(reply?.error === 'consent'
        ? '请先同意在本地读取交易页面数据。'
        : '无法访问加密的本地交易目标记录。');
    }

    async function readChanges(changes) {
      const entries = [];
      const deleted = [];
      for (const [key, change] of Object.entries(changes)) {
        const original = originalKey(key);
        if (!original) continue;
        if (change.newValue === undefined) deleted.push(original);
        else entries.push([original, change.newValue]);
      }
      if (!entries.length && !deleted.length) return {};
      const values = await request('changes', Object.fromEntries(entries));
      for (const key of deleted) values[key] = undefined;
      return values;
    }

    globalThis.GoalPrivateStorage = Object.freeze({
      prefix: PREFIX,
      get: keys => request('get', keys),
      set: values => request('set', values),
      readChanges,
    });
    return;
  }

  const KEY_DATABASE = 'okx-goal-private';
  const KEY_STORE = 'keys';
  const KEY_ID = 'financial-v1';
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let keyPromise;

  function openKeyDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(KEY_DATABASE, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(KEY_STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function readKey(db, candidate) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(KEY_STORE, candidate ? 'readwrite' : 'readonly');
      const store = transaction.objectStore(KEY_STORE);
      const request = store.get(KEY_ID);
      let key;
      request.onsuccess = () => {
        key = request.result;
        if (key === undefined && candidate) {
          store.add(candidate, KEY_ID);
          key = candidate;
        }
      };
      transaction.oncomplete = () => resolve(key);
      transaction.onabort = () => reject(transaction.error ?? new Error('Key transaction aborted'));
    });
  }

  async function loadKey() {
    const db = await openKeyDatabase();
    try {
      const stored = await readKey(db);
      if (stored) return stored;
      const candidate = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      // A read-write transaction chooses one key if more than one worker tries to initialize it.
      return await readKey(db, candidate);
    } finally {
      db.close();
    }
  }

  function encryptionKey() {
    keyPromise ??= loadKey().catch(error => {
      keyPromise = undefined;
      throw error;
    });
    return keyPromise;
  }

  function toBase64(bytes) {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 16384) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
    }
    return btoa(binary);
  }

  function fromBase64(value) {
    return Uint8Array.from(atob(value), char => char.charCodeAt(0));
  }

  function cipherParams(key, iv) {
    return { name: 'AES-GCM', iv, additionalData: encoder.encode(PREFIX + key) };
  }

  async function encrypt(secret, key, value) {
    const json = JSON.stringify(value);
    if (json === undefined) throw new TypeError('Invalid value');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt(cipherParams(key, iv), secret, encoder.encode(json));
    return { v: 1, iv: toBase64(iv), data: toBase64(new Uint8Array(cipher)) };
  }

  async function decrypt(secret, key, envelope) {
    if (envelope?.v !== 1 || typeof envelope.iv !== 'string' || typeof envelope.data !== 'string') {
      throw new TypeError('Invalid encrypted value');
    }
    const iv = fromBase64(envelope.iv);
    const data = fromBase64(envelope.data);
    if (iv.length !== 12 || data.length < 16) throw new TypeError('Invalid encrypted value');
    return JSON.parse(decoder.decode(await crypto.subtle.decrypt(cipherParams(key, iv), secret, data)));
  }

  function financialEntries(values) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new TypeError('Invalid entries');
    const entries = Object.entries(values);
    if (!entries.every(([key]) => isFinancialKey(key))) throw new TypeError('Invalid storage key');
    return entries;
  }

  async function decryptEntries(entries) {
    if (!entries.length) return {};
    const secret = await encryptionKey();
    return Object.fromEntries(await Promise.all(entries.map(async ([key, value]) => [key, await decrypt(secret, key, value)])));
  }

  async function getEntries(keys) {
    const storage = chrome.storage.local;
    let encryptedKeys;
    if (keys === null) {
      encryptedKeys = (await storage.getKeys()).filter(originalKey);
    } else {
      if (!Array.isArray(keys) || !keys.every(isFinancialKey)) throw new TypeError('Invalid storage keys');
      encryptedKeys = keys.map(key => PREFIX + key);
    }
    if (!encryptedKeys.length) return {};
    const found = await storage.get(encryptedKeys);
    return decryptEntries(Object.entries(found).map(([key, envelope]) => [originalKey(key), envelope]));
  }

  async function hasConsent() {
    const values = await chrome.storage.local.get(CONSENT_KEY);
    return values[CONSENT_KEY] === true;
  }

  async function handle({ operation, payload }) {
    if (!await hasConsent()) return { ok: false, error: 'consent' };
    if (operation === 'set') {
      const entries = financialEntries(payload);
      if (!entries.length) return { ok: true };
      const secret = await encryptionKey();
      const encrypted = Object.fromEntries(await Promise.all(entries.map(async ([key, value]) => [
        PREFIX + key, await encrypt(secret, key, value),
      ])));
      if (!await hasConsent()) return { ok: false, error: 'consent' };
      await chrome.storage.local.set(encrypted);
      return { ok: true };
    }
    const result = operation === 'get' ? await getEntries(payload) : await decryptEntries(financialEntries(payload));
    return await hasConsent() ? { ok: true, result } : { ok: false, error: 'consent' };
  }

  function trustedSender(sender) {
    if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !Number.isInteger(sender.tab?.id)) return false;
    try {
      const url = new URL(sender.url);
      return (url.origin === 'https://www.okx.com' || url.origin === 'https://okx.com') &&
        (!sender.origin || sender.origin === url.origin) && !url.username && !url.password &&
        /^\/(?:[a-z]{2}(?:-[a-z]{2,8})?\/)?trade-swap\/[a-z0-9][a-z0-9-]*\/?$/i.test(url.pathname);
    } catch {
      return false;
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.type !== MESSAGE || !['get', 'set', 'changes'].includes(message.operation) || !trustedSender(sender)) return false;
    void handle(message).then(reply, () => reply({ ok: false }));
    return true;
  });
})();
