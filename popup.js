/**
 * AutoSkip – Popup Script
 * Giao tiếp với background và content scripts để bật/tắt,
 * hiện thống kê, quản lý cài đặt, và API key Gemini AI.
 */

'use strict';

const toggleBtn   = document.getElementById('toggle-btn');
const statusLabel = document.getElementById('status-label');
const skipCountEl = document.getElementById('skip-count');
const timeSavedEl = document.getElementById('time-saved');
const statusText  = document.getElementById('status-text');
const pulseDot    = document.getElementById('pulse-dot');
const statusBar   = document.getElementById('status-bar');
const resetBtn    = document.getElementById('reset-btn');
const sitesBtn    = document.getElementById('sites-btn');
const sitesList   = document.getElementById('sites-list');
const adTabBtn    = document.getElementById('adtab-btn');
const shieldBtn   = document.getElementById('shield-btn');
const apiKeyInput = document.getElementById('api-key-input');
const saveKeyBtn  = document.getElementById('save-key-btn');
const aiStatus    = document.getElementById('ai-status');

const SECONDS_PER_AD = 30;

// ============================================================
// INIT
// ============================================================
function init() {
  chrome.storage.sync.get({
    enabled: true,
    autoCloseAdTabs: false,
    shieldEnabled: true,
    geminiApiKey: '',
  }, (data) => {
    toggleBtn.checked = data.enabled;
    adTabBtn.checked = data.autoCloseAdTabs;
    shieldBtn.checked = data.shieldEnabled;
    updateUI(data.enabled);
    updateAiStatus(data.geminiApiKey);
    if (data.geminiApiKey) {
      apiKeyInput.value = '••••••••' + data.geminiApiKey.slice(-6);
    }
    // skipCount from local storage (avoid sync quota)
    chrome.storage.local.get({ skipCount: 0 }, (local) => {
      updateCount(local.skipCount);
    });
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.enabled !== undefined) {
      toggleBtn.checked = changes.enabled.newValue;
      updateUI(changes.enabled.newValue);
    }
    if (changes.autoCloseAdTabs !== undefined) {
      adTabBtn.checked = changes.autoCloseAdTabs.newValue;
    }
    if (changes.shieldEnabled !== undefined) {
      shieldBtn.checked = changes.shieldEnabled.newValue;
    }
    if (changes.geminiApiKey !== undefined) {
      updateAiStatus(changes.geminiApiKey.newValue);
    }
  });

  chrome.storage.local.onChanged.addListener((changes) => {
    if (changes.skipCount) {
      updateCount(changes.skipCount.newValue, true);
    }
  });
}

// ============================================================
// UI HELPERS
// ============================================================
function updateUI(enabled) {
  if (enabled) {
    statusLabel.textContent = '⚡ Đang bật';
    statusLabel.classList.remove('off');
    statusText.textContent = 'AI đang theo dõi quảng cáo...';
    pulseDot.classList.remove('off');
    statusBar.classList.remove('inactive');
  } else {
    statusLabel.textContent = '⏸ Đã tắt';
    statusLabel.classList.add('off');
    statusText.textContent = 'AutoSkip đang tắt';
    pulseDot.classList.add('off');
    statusBar.classList.add('inactive');
  }
}

function updateCount(count, animate = false) {
  skipCountEl.textContent = count;
  const seconds = count * SECONDS_PER_AD;
  if (seconds < 60) {
    timeSavedEl.textContent = seconds + 's';
  } else if (seconds < 3600) {
    timeSavedEl.textContent = Math.floor(seconds / 60) + 'p ' + (seconds % 60) + 's';
  } else {
    timeSavedEl.textContent = Math.floor(seconds / 3600) + 'h ' + Math.floor((seconds % 3600) / 60) + 'p';
  }

  if (animate) {
    skipCountEl.classList.remove('bump');
    void skipCountEl.offsetWidth;
    skipCountEl.classList.add('bump');
  }
}

function updateAiStatus(apiKey) {
  if (apiKey && apiKey.length > 10) {
    aiStatus.textContent = 'Đã kết nối';
    aiStatus.classList.add('active');
  } else {
    aiStatus.textContent = 'Chưa kết nối';
    aiStatus.classList.remove('active');
  }
}

// ============================================================
// EVENTS
// ============================================================
toggleBtn.addEventListener('change', () => {
  const enabled = toggleBtn.checked;
  updateUI(enabled);
  chrome.runtime.sendMessage({ type: 'TOGGLE_ENABLED', enabled });
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'SET_ENABLED', enabled }).catch(() => {});
    }
  });
});

resetBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'RESET_COUNT' });
  updateCount(0);
  resetBtn.textContent = '✅ Đã đặt lại!';
  setTimeout(() => { resetBtn.textContent = '🔄 Đặt lại'; }, 1500);
});

sitesBtn.addEventListener('click', () => {
  const hidden = sitesList.hidden;
  sitesList.hidden = !hidden;
  sitesBtn.textContent = hidden ? '✖ Đóng lại' : '🌐 Trang hỗ trợ';
});

adTabBtn.addEventListener('change', () => {
  const autoClose = adTabBtn.checked;
  chrome.storage.sync.set({ autoCloseAdTabs: autoClose });
  chrome.runtime.sendMessage({ type: 'SET_AUTO_CLOSE_TABS', autoClose });
});

shieldBtn.addEventListener('change', () => {
  chrome.storage.sync.set({ shieldEnabled: shieldBtn.checked });
});

// ============================================================
// GEMINI API KEY
// ============================================================
saveKeyBtn.addEventListener('click', () => {
  const key = apiKeyInput.value.trim();

  // Nếu user chỉ thấy mask (••••) thì không lưu lại
  if (key.startsWith('••')) return;

  if (!key) {
    // Xoá key
    chrome.storage.sync.set({ geminiApiKey: '' });
    updateAiStatus('');
    apiKeyInput.value = '';
    saveKeyBtn.textContent = '✅';
    setTimeout(() => { saveKeyBtn.textContent = '💾'; }, 1500);
    return;
  }

  // Validate key - chỉ cần có độ dài hợp lý
  if (key.length < 10) {
    apiKeyInput.style.borderColor = '#ff4d6d';
    apiKeyInput.setAttribute('placeholder', 'Key quá ngắn!');
    setTimeout(() => {
      apiKeyInput.style.borderColor = '';
      apiKeyInput.setAttribute('placeholder', 'Dán Gemini API Key...');
    }, 2000);
    return;
  }

  // Lưu key
  chrome.storage.sync.set({ geminiApiKey: key }, () => {
    updateAiStatus(key);
    apiKeyInput.value = '••••••••' + key.slice(-6);
    saveKeyBtn.textContent = '✅';
    setTimeout(() => { saveKeyBtn.textContent = '💾'; }, 1500);
  });
});

// Focus input → clear mask để user paste key mới
apiKeyInput.addEventListener('focus', () => {
  if (apiKeyInput.value.startsWith('••')) {
    apiKeyInput.value = '';
    apiKeyInput.type = 'text';
  }
});

apiKeyInput.addEventListener('blur', () => {
  apiKeyInput.type = 'password';
  // Nếu user không nhập gì → hiện lại mask cũ
  if (!apiKeyInput.value) {
    chrome.storage.sync.get({ geminiApiKey: '' }, (data) => {
      if (data.geminiApiKey) {
        apiKeyInput.value = '••••••••' + data.geminiApiKey.slice(-6);
      }
    });
  }
});

// ============================================================
// START
// ============================================================
document.addEventListener('DOMContentLoaded', init);
