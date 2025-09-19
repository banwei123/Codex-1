const defaultConfig = {
  minIntervalMs: 25000,
  maxIntervalMs: 45000,
  jitterRadiusPx: 20,
  keyOptions: ['Shift']
};

let runLoop = false;
let pendingTimeoutId = null;
let currentConfig = { ...defaultConfig };

function randomBetween(min, max) {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return Math.random() * (high - low) + low;
}

function pickKey() {
  const options = Array.isArray(currentConfig.keyOptions) && currentConfig.keyOptions.length
    ? currentConfig.keyOptions
    : defaultConfig.keyOptions;
  const index = Math.floor(Math.random() * options.length);
  return options[index] || 'Shift';
}

function dispatchActivityOnce() {
  try {
    const body = document.body || document.documentElement;
    if (!body) {
      return;
    }
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    const radius = Math.max(4, currentConfig.jitterRadiusPx || defaultConfig.jitterRadiusPx);
    const angle = randomBetween(0, 2 * Math.PI);
    const distance = randomBetween(radius * 0.25, radius);
    const offsetX = Math.cos(angle) * distance;
    const offsetY = Math.sin(angle) * distance;
    const clientX = Math.max(1, Math.min(window.innerWidth - 1, Math.round(centerX + offsetX)));
    const clientY = Math.max(1, Math.min(window.innerHeight - 1, Math.round(centerY + offsetY)));

    const targetElement = document.elementFromPoint(clientX, clientY) || body;
    const mouseMove = new MouseEvent('mousemove', {
      bubbles: true,
      cancelable: false,
      view: window,
      clientX,
      clientY
    });
    targetElement.dispatchEvent(mouseMove);

    if (Math.random() > 0.35) {
      return;
    }

    const key = pickKey();
    const keyDown = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: false,
      key,
      code: `${key}Left`
    });
    targetElement.dispatchEvent(keyDown);
  } catch (error) {
    console.warn('Activity dispatch error', error);
  }
}

function clearScheduledActivity() {
  if (pendingTimeoutId) {
    clearTimeout(pendingTimeoutId);
    pendingTimeoutId = null;
  }
}

function scheduleNextActivity() {
  if (!runLoop || document.visibilityState !== 'visible') {
    return;
  }
  clearScheduledActivity();
  const wait = randomBetween(currentConfig.minIntervalMs, currentConfig.maxIntervalMs);
  pendingTimeoutId = setTimeout(() => {
    pendingTimeoutId = null;
    dispatchActivityOnce();
    scheduleNextActivity();
  }, Math.max(5000, wait));
}

function updateConfig(incoming) {
  if (incoming && typeof incoming === 'object') {
    currentConfig = {
      minIntervalMs: Number(incoming.minIntervalMs) || defaultConfig.minIntervalMs,
      maxIntervalMs: Number(incoming.maxIntervalMs) || defaultConfig.maxIntervalMs,
      jitterRadiusPx: Number(incoming.jitterRadiusPx) || defaultConfig.jitterRadiusPx,
      keyOptions: Array.isArray(incoming.keyOptions) && incoming.keyOptions.length
        ? incoming.keyOptions
        : defaultConfig.keyOptions
    };
  } else {
    currentConfig = { ...defaultConfig };
  }
}

function startLoop(config) {
  updateConfig(config);
  runLoop = true;
  if (document.visibilityState === 'visible') {
    dispatchActivityOnce();
    scheduleNextActivity();
  }
}

function stopLoop() {
  runLoop = false;
  clearScheduledActivity();
}

function nudge(config) {
  if (config) {
    updateConfig(config);
  }
  dispatchActivityOnce();
  if (runLoop && !pendingTimeoutId && document.visibilityState === 'visible') {
    scheduleNextActivity();
  }
}

document.addEventListener('visibilitychange', () => {
  if (!runLoop) {
    return;
  }
  if (document.visibilityState === 'visible') {
    scheduleNextActivity();
  } else {
    clearScheduledActivity();
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message || !message.type) {
    return;
  }
  if (message.type === 'contentFallbackStart') {
    startLoop(message.config);
  } else if (message.type === 'contentFallbackStop') {
    stopLoop();
  } else if (message.type === 'contentFallbackNudge') {
    nudge(message.config);
  }
});
