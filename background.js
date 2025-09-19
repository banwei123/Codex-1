const STORAGE_KEY = 'keepAwakeState';
const ALARM_NAME = 'keepAwakeRefresh';
const DEFAULT_STATE = { enabled: false, mode: 'none' };
function createContentFallbackConfig() {
  const baseMin = 18000;
  const baseMax = 42000;
  const minIntervalMs = baseMin + Math.floor(Math.random() * 7000);
  const maxIntervalMs = Math.max(minIntervalMs + 10000, baseMax + Math.floor(Math.random() * 8000));
  const jitterRadiusPx = 20 + Math.floor(Math.random() * 10);
  const keyOptions = ['Shift', 'Alt', 'Control'];
  return { minIntervalMs, maxIntervalMs, jitterRadiusPx, keyOptions };
}

let runtimeState = {
  enabled: false,
  mode: 'none',
  wakeLockWindowId: null,
  wakeLockTabId: null,
  contentTabId: null,
  error: null
};

async function loadStoredState() {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    if (stored && stored[STORAGE_KEY]) {
      return { ...DEFAULT_STATE, ...stored[STORAGE_KEY] };
    }
  } catch (error) {
    console.error('Failed to load state', error);
  }
  return { ...DEFAULT_STATE };
}

async function saveState() {
  const toSave = {
    enabled: runtimeState.enabled,
    mode: runtimeState.mode
  };
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: toSave });
  } catch (error) {
    console.error('Failed to save state', error);
  }
}

async function updateBadge() {
  try {
    if (runtimeState.enabled) {
      await chrome.action.setBadgeText({ text: 'ON' });
      await chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
    } else {
      await chrome.action.setBadgeText({ text: '' });
    }
  } catch (error) {
    console.warn('Badge update failed', error);
  }
}

async function ensureAlarm(enabled) {
  try {
    if (enabled) {
      await chrome.alarms.create(ALARM_NAME, { periodInMinutes: 15 });
    } else {
      await chrome.alarms.clear(ALARM_NAME);
    }
  } catch (error) {
    console.warn('Alarm configuration failed', error);
  }
}

async function requestPowerKeepAwake() {
  if (!chrome.power || typeof chrome.power.requestKeepAwake !== 'function') {
    throw new Error('chrome.power API unavailable');
  }
  chrome.power.requestKeepAwake('display');
}

async function releasePowerKeepAwake() {
  if (!chrome.power || typeof chrome.power.releaseKeepAwake !== 'function') {
    return;
  }
  chrome.power.releaseKeepAwake();
}

async function activateWakeLockWindow() {
  const url = chrome.runtime.getURL('wakelock.html');
  if (runtimeState.wakeLockWindowId && runtimeState.wakeLockTabId) {
    await pingWakeLockPage('wakelockRefresh');
    runtimeState.mode = 'wakelock';
    runtimeState.enabled = true;
    runtimeState.error = null;
    await saveState();
    await updateBadge();
    await ensureAlarm(true);
    return { success: true, mode: 'wakelock' };
  }

  try {
    const created = await chrome.windows.create({
      url,
      type: 'popup',
      focused: false,
      width: 320,
      height: 180
    });
    runtimeState.wakeLockWindowId = created.id ?? null;
    const tab = created.tabs && created.tabs.length ? created.tabs[0] : null;
    runtimeState.wakeLockTabId = tab && typeof tab.id === 'number' ? tab.id : null;
    runtimeState.mode = 'wakelock';
    runtimeState.enabled = true;
    runtimeState.error = null;
    await saveState();
    await updateBadge();
    await ensureAlarm(true);
    return { success: true, mode: 'wakelock' };
  } catch (error) {
    console.error('Failed to open wake lock page', error);
    runtimeState.error = '无法开启屏幕唤醒窗口：' + (error && error.message ? error.message : '未知错误');
    return { success: false, mode: 'wakelock', error: runtimeState.error };
  }
}

async function pingWakeLockPage(type) {
  if (!runtimeState.wakeLockTabId) {
    return;
  }
  try {
    await chrome.tabs.sendMessage(runtimeState.wakeLockTabId, { type });
  } catch (error) {
    console.warn('Wake lock page unreachable', error);
  }
}

async function enableContentFallback(forcedTabId) {
  try {
    if (runtimeState.contentTabId && runtimeState.contentTabId !== forcedTabId) {
      await sendContentMessage(runtimeState.contentTabId, { type: 'contentFallbackStop' });
      runtimeState.contentTabId = null;
    }
    let targetTabId = forcedTabId;
    if (typeof targetTabId !== 'number') {
      const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (active && typeof active.id === 'number') {
        targetTabId = active.id;
      }
    }
    if (typeof targetTabId !== 'number') {
      throw new Error('无法找到可用于兜底的活动标签页');
    }
    await chrome.scripting.executeScript({ target: { tabId: targetTabId }, files: ['content.js'] });
    const config = createContentFallbackConfig();
    await sendContentMessage(targetTabId, {
      type: 'contentFallbackStart',
      config
    });
    runtimeState.contentTabId = targetTabId;
    runtimeState.mode = 'content';
    runtimeState.enabled = true;
    runtimeState.error = null;
    await saveState();
    await updateBadge();
    await ensureAlarm(true);
    return { success: true, mode: 'content' };
  } catch (error) {
    console.error('Content fallback failed', error);
    runtimeState.error = '模拟活动兜底失败：' + (error && error.message ? error.message : '未知错误');
    return { success: false, mode: 'content', error: runtimeState.error };
  }
}

async function sendContentMessage(tabId, payload) {
  try {
    await chrome.tabs.sendMessage(tabId, payload);
  } catch (error) {
    console.warn('Content script message failed', error);
  }
}

async function disableContentFallback() {
  if (!runtimeState.contentTabId) {
    return;
  }
  const tabId = runtimeState.contentTabId;
  runtimeState.contentTabId = null;
  try {
    await sendContentMessage(tabId, { type: 'contentFallbackStop' });
  } catch (error) {
    console.warn('Failed to stop content fallback', error);
  }
}

async function closeWakeLockWindow() {
  if (runtimeState.wakeLockWindowId) {
    const windowId = runtimeState.wakeLockWindowId;
    runtimeState.wakeLockWindowId = null;
    runtimeState.wakeLockTabId = null;
    try {
      await pingWakeLockPage('wakelockShutdown');
    } catch (error) {
      console.warn('Failed to notify wake lock window before closing', error);
    }
    try {
      await chrome.windows.remove(windowId);
    } catch (error) {
      console.warn('Failed to close wake lock window', error);
    }
  }
}

async function disableAllModes() {
  await releasePowerKeepAwake();
  await disableContentFallback();
  await closeWakeLockWindow();
}

async function enableKeepAwake(initiator) {
  runtimeState.error = null;
  try {
    await requestPowerKeepAwake();
    runtimeState.enabled = true;
    runtimeState.mode = 'power';
    await saveState();
    await updateBadge();
    await ensureAlarm(true);
    return { success: true, mode: 'power' };
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    console.warn('Power API unavailable, fallback required', message);
    if (initiator === 'user') {
      return { success: false, needWakeLock: true, message };
    }
    const fallbackResult = await activateWakeLockWindow();
    if (!fallbackResult.success) {
      return enableContentFallback();
    }
    return fallbackResult;
  }
}

async function disableKeepAwake() {
  await disableAllModes();
  runtimeState.enabled = false;
  runtimeState.mode = 'none';
  runtimeState.error = null;
  await saveState();
  await updateBadge();
  await ensureAlarm(false);
  return { success: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message && message.type) {
      case 'getState': {
        sendResponse({ ...runtimeState });
        return;
      }
      case 'enable': {
        const result = await enableKeepAwake('user');
        sendResponse(result);
        return;
      }
      case 'disable': {
        const result = await disableKeepAwake();
        sendResponse(result);
        return;
      }
      case 'wakeLockAttemptResult': {
        if (message.success) {
          const result = await activateWakeLockWindow();
          if (!result.success) {
            const fallback = await enableContentFallback();
            sendResponse(fallback);
            return;
          }
          sendResponse(result);
          return;
        }
        const fallbackResult = await enableContentFallback();
        sendResponse(fallbackResult);
        return;
      }
      case 'wakeLockPageStatus': {
        if (sender && sender.tab && typeof sender.tab.id === 'number') {
          runtimeState.wakeLockTabId = sender.tab.id;
        }
        if (message.status === 'failed') {
          const fallbackResult = await enableContentFallback();
          sendResponse(fallbackResult);
          return;
        }
        if (message.status === 'released') {
          if (message.extra === 'shutdown') {
            sendResponse({ success: true });
            return;
          }
          if (runtimeState.enabled && runtimeState.mode === 'wakelock') {
            const fallbackResult = await enableContentFallback();
            sendResponse(fallbackResult);
            return;
          }
        }
        sendResponse({ success: true });
        return;
      }
      default:
        sendResponse({ success: false, error: '未知指令' });
    }
  })().catch((error) => {
    const messageText = error && error.message ? error.message : String(error);
    runtimeState.error = messageText;
    sendResponse({ success: false, error: messageText });
  });
  return true;
});

chrome.runtime.onInstalled.addListener(async () => {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: { ...DEFAULT_STATE } });
  } catch (error) {
    console.error('Failed to initialize storage', error);
  }
});

chrome.runtime.onStartup.addListener(async () => {
  const stored = await loadStoredState();
  runtimeState.enabled = stored.enabled;
  runtimeState.mode = stored.mode;
  await updateBadge();
  if (stored.enabled) {
    if (stored.mode === 'power') {
      const result = await enableKeepAwake('startup');
      if (!result.success && !result.needWakeLock) {
        runtimeState.error = result.error || null;
      }
    } else if (stored.mode === 'wakelock') {
      const result = await activateWakeLockWindow();
      if (!result.success) {
        const fallback = await enableContentFallback();
        if (!fallback.success) {
          runtimeState.error = fallback.error || null;
        }
      }
    } else if (stored.mode === 'content') {
      const fallback = await enableContentFallback();
      if (!fallback.success) {
        runtimeState.error = fallback.error || null;
      }
    }
  } else {
    await ensureAlarm(false);
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm && alarm.name === ALARM_NAME && runtimeState.enabled) {
    if (runtimeState.mode === 'power') {
      try {
        await requestPowerKeepAwake();
      } catch (error) {
        console.warn('Reassert power keep-awake failed', error);
      }
    } else if (runtimeState.mode === 'wakelock') {
      await pingWakeLockPage('wakelockRefresh');
    } else if (runtimeState.mode === 'content') {
      if (runtimeState.contentTabId) {
        await sendContentMessage(runtimeState.contentTabId, {
          type: 'contentFallbackNudge',
          config: createContentFallbackConfig()
        });
      }
    }
  }
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  if (runtimeState.wakeLockWindowId && windowId === runtimeState.wakeLockWindowId) {
    runtimeState.wakeLockWindowId = null;
    runtimeState.wakeLockTabId = null;
    if (runtimeState.enabled && runtimeState.mode === 'wakelock') {
      const fallbackResult = await enableContentFallback();
      if (!fallbackResult.success) {
        runtimeState.error = fallbackResult.error || null;
      }
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (runtimeState.contentTabId && tabId === runtimeState.contentTabId) {
    runtimeState.contentTabId = null;
  }
  if (runtimeState.wakeLockTabId && tabId === runtimeState.wakeLockTabId) {
    runtimeState.wakeLockTabId = null;
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  if (!activeInfo || typeof activeInfo.tabId !== 'number') {
    return;
  }
  if (runtimeState.enabled && runtimeState.mode === 'content') {
    await enableContentFallback(activeInfo.tabId);
  }
});

(async () => {
  const stored = await loadStoredState();
  runtimeState.enabled = stored.enabled;
  runtimeState.mode = stored.mode;
  await updateBadge();
})();
