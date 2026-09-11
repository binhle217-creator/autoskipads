/**
 * AutoSkip – Popup Script
 * Giao tiếp với background và content scripts để bật/tắt,
 * hiện thống kê, và quản lý cài đặt.
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

// Ước tính 30 giây mỗi quảng cáo skip
const SECONDS_PER_AD = 30;

// ============================================================
// INIT – Load trạng thái từ storage
// ============================================================
function init() {
  chrome.storage.sync.get({ enabled: true, skipCount: 0 }, (data) => {
    toggleBtn.checked = data.enabled;
    updateUI(data.enabled);
    updateCount(data.skipCount);
  });

  // Lắng nghe thay đổi real-time (khi content script skip quảng cáo)
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.skipCount) {
      updateCount(changes.skipCount.newValue, true);
    }
    if (changes.enabled !== undefined) {
      toggleBtn.checked = changes.enabled.newValue;
      updateUI(changes.enabled.newValue);
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
    statusText.textContent = 'Đang theo dõi quảng cáo...';
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
    void skipCountEl.offsetWidth; // reflow
    skipCountEl.classList.add('bump');
  }
}

// ============================================================
// EVENTS
// ============================================================
toggleBtn.addEventListener('change', () => {
  const enabled = toggleBtn.checked;
  updateUI(enabled);

  // Gửi lệnh đến background
  chrome.runtime.sendMessage({ type: 'TOGGLE_ENABLED', enabled });

  // Gửi trực tiếp đến tab đang active
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'SET_ENABLED', enabled }).catch(() => {});
    }
  });
});

resetBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'RESET_COUNT' });
  updateCount(0);

  // Animation feedback
  resetBtn.textContent = '✅ Đã đặt lại!';
  setTimeout(() => { resetBtn.textContent = '🔄 Đặt lại'; }, 1500);
});

sitesBtn.addEventListener('click', () => {
  const hidden = sitesList.hidden;
  sitesList.hidden = !hidden;
  sitesBtn.textContent = hidden ? '✖ Đóng lại' : '🌐 Trang hỗ trợ';
});

// ============================================================
// START
// ============================================================
document.addEventListener('DOMContentLoaded', init);
