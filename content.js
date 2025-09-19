let activityIntervalId = null;

function dispatchActivityOnce() {
  try {
    const body = document.body || document.documentElement;
    if (!body) {
      return;
    }
    const now = Date.now();
    const mouseMove = new MouseEvent('mousemove', {
      bubbles: true,
      cancelable: false,
      view: window,
      clientX: (now % window.innerWidth) || 1,
      clientY: (now % window.innerHeight) || 1
    });
    const keyDown = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: false,
      key: 'Shift',
      code: 'ShiftLeft'
    });
    body.dispatchEvent(mouseMove);
    body.dispatchEvent(keyDown);
  } catch (error) {
    console.warn('Activity dispatch error', error);
  }
}

function startActivityLoop() {
  if (activityIntervalId) {
    return;
  }
  dispatchActivityOnce();
  activityIntervalId = setInterval(dispatchActivityOnce, 30000);
}

function stopActivityLoop() {
  if (activityIntervalId) {
    clearInterval(activityIntervalId);
    activityIntervalId = null;
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message || !message.type) {
    return;
  }
  if (message.type === 'contentFallbackStart') {
    startActivityLoop();
  } else if (message.type === 'contentFallbackStop') {
    stopActivityLoop();
  } else if (message.type === 'contentFallbackPing') {
    dispatchActivityOnce();
  }
});
