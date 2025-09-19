const statusEl = document.getElementById('status');
let wakeLockSentinel = null;
let retryTimeout = null;

function updateStatus(text) {
  if (statusEl) {
    statusEl.textContent = text;
  }
}

async function notifyBackground(status, extra) {
  try {
    await chrome.runtime.sendMessage({ type: 'wakeLockPageStatus', status, extra });
  } catch (error) {
    console.warn('notifyBackground failed', error);
  }
}

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) {
    updateStatus('当前环境不支持 Screen Wake Lock API。');
    await notifyBackground('failed', 'unsupported');
    return;
  }
  try {
    const sentinel = await navigator.wakeLock.request('screen');
    wakeLockSentinel = sentinel;
    updateStatus('Screen Wake Lock 已激活。');
    await notifyBackground('active');
    sentinel.addEventListener('release', async () => {
      updateStatus('Screen Wake Lock 已释放，尝试重新申请…');
      if (wakeLockSentinel) {
        wakeLockSentinel = null;
      }
      await requestWakeLock();
    });
  } catch (error) {
    updateStatus('申请 Screen Wake Lock 失败：' + (error && error.message ? error.message : error));
    await notifyBackground('failed', error && error.message ? error.message : String(error));
  }
}

async function shutdownWakeLock() {
  if (retryTimeout) {
    clearTimeout(retryTimeout);
    retryTimeout = null;
  }
  if (wakeLockSentinel) {
    try {
      await wakeLockSentinel.release();
    } catch (error) {
      console.warn('Release wake lock failed', error);
    }
    wakeLockSentinel = null;
  }
  updateStatus('已停止唤醒。');
  await notifyBackground('released', 'shutdown');
  window.close();
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message || !message.type) {
    return;
  }
  if (message.type === 'wakelockRefresh') {
    requestWakeLock();
  } else if (message.type === 'wakelockShutdown') {
    shutdownWakeLock();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    requestWakeLock();
  }
});

requestWakeLock();
