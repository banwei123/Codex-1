const button = document.getElementById('toggleButton');
const statusText = document.getElementById('statusText');
const errorText = document.getElementById('errorText');

let currentState = {
  enabled: false,
  mode: 'none',
  error: null
};
let isProcessing = false;
let popupWakeLock = null;
let visibilityListenerAttached = false;

function updateUI() {
  if (!button || !statusText || !errorText) {
    return;
  }
  button.disabled = isProcessing;
  if (currentState.enabled) {
    button.textContent = '停止';
    button.classList.add('stop');
    statusText.textContent = `当前：已开启（模式：${currentState.mode}）`;
  } else {
    button.textContent = '启动';
    button.classList.remove('stop');
    statusText.textContent = '当前：已关闭';
  }
  if (currentState.error) {
    errorText.style.display = 'block';
    errorText.textContent = currentState.error;
  } else {
    errorText.style.display = 'none';
    errorText.textContent = '';
  }
}

function setProcessing(state) {
  isProcessing = state;
  updateUI();
}

async function queryState() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'getState' });
    if (response) {
      currentState.enabled = Boolean(response.enabled);
      currentState.mode = response.mode || 'none';
      currentState.error = response.error || null;
    }
  } catch (error) {
    currentState.error = '读取状态失败：' + (error && error.message ? error.message : error);
  }
  updateUI();
}

async function releasePopupWakeLock() {
  if (popupWakeLock) {
    try {
      await popupWakeLock.release();
    } catch (error) {
      console.warn('释放弹窗 wake lock 失败', error);
    }
    popupWakeLock = null;
  }
  if (visibilityListenerAttached) {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    visibilityListenerAttached = false;
  }
}

async function requestPopupWakeLock() {
  if (!('wakeLock' in navigator)) {
    return { success: false, error: '当前环境不支持 Screen Wake Lock API' };
  }
  try {
    const sentinel = await navigator.wakeLock.request('screen');
    popupWakeLock = sentinel;
    const handleRelease = async () => {
      popupWakeLock = null;
      sentinel.removeEventListener('release', handleRelease);
    };
    sentinel.addEventListener('release', handleRelease);
    if (!visibilityListenerAttached) {
      document.addEventListener('visibilitychange', handleVisibilityChange);
      visibilityListenerAttached = true;
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error && error.message ? error.message : String(error) };
  }
}

async function handleVisibilityChange() {
  if (document.visibilityState === 'visible' && !popupWakeLock) {
    await requestPopupWakeLock();
  }
}

async function handleEnable() {
  setProcessing(true);
  let result = null;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'enable' });
    if (response.needWakeLock) {
      const attempt = await requestPopupWakeLock();
      result = await chrome.runtime.sendMessage({
        type: 'wakeLockAttemptResult',
        success: attempt.success,
        error: attempt.error
      });
      if (!attempt.success && attempt.error) {
        currentState.error = 'Wake Lock 尝试失败：' + attempt.error;
      }
    } else {
      result = response;
    }
  } catch (error) {
    currentState.error = '启动失败：' + (error && error.message ? error.message : error);
  }
  await finalizeResult(result, true);
  setProcessing(false);
}

async function handleDisable() {
  setProcessing(true);
  let result = null;
  try {
    await releasePopupWakeLock();
    result = await chrome.runtime.sendMessage({ type: 'disable' });
  } catch (error) {
    currentState.error = '停止失败：' + (error && error.message ? error.message : error);
  }
  await finalizeResult(result, false);
  setProcessing(false);
}

async function finalizeResult(result, enabledTarget) {
  if (result && result.success) {
    currentState.enabled = enabledTarget;
    currentState.mode = result.mode || (enabledTarget ? currentState.mode : 'none');
    currentState.error = null;
  } else if (result && result.error) {
    currentState.error = result.error;
    currentState.enabled = enabledTarget ? false : currentState.enabled;
    if (!enabledTarget) {
      currentState.mode = 'none';
    }
  }
  updateUI();
}

button.addEventListener('click', async () => {
  if (isProcessing) {
    return;
  }
  if (currentState.enabled) {
    await handleDisable();
  } else {
    await handleEnable();
  }
});

window.addEventListener('unload', () => {
  releasePopupWakeLock();
});

queryState();
