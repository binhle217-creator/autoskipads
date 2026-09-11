/**
 * AutoSkip – Background Service Worker
 * Quản lý trạng thái, nhận thông báo từ content script,
 * và đảm bảo content script được inject đúng cách.
 */

'use strict';

// ============================================================
// HELPERS: Cập nhật giao diện Icon (Badge, Title, Trạng thái)
// ============================================================
function updateIconVisuals(enabled, tabId = null) {
  const badgeText = enabled ? '' : 'OFF';
  const badgeColor = '#666666';
  const title = enabled ? 'AutoSkip: Đang bật (Nhấn để tắt)' : 'AutoSkip: Đang tắt (Nhấn để bật)';

  const options = { title };

  if (tabId) {
    chrome.action.setTitle({ ...options, tabId });
    chrome.action.setBadgeText({ text: badgeText, tabId });
    if (badgeText) {
      chrome.action.setBadgeBackgroundColor({ color: badgeColor, tabId });
    }
  } else {
    chrome.action.setTitle(options);
    chrome.action.setBadgeText({ text: badgeText });
    if (badgeText) {
      chrome.action.setBadgeBackgroundColor({ color: badgeColor });
    }
  }
}

// Helper để gửi trạng thái đến tất cả các tab
function broadcastStateToTabs(enabled) {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'SET_ENABLED', enabled }).catch(() => {});
        updateIconVisuals(enabled, tab.id);
      }
    }
  });
}

// ============================================================
// CÀI ĐẶT MẶC ĐỊNH khi extension được cài lần đầu
// ============================================================
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.set({
    enabled: true,
    skipCount: 0,
  });
  updateIconVisuals(true);
  console.log('[AutoSkip BG] Extension đã được cài đặt.');
});

// Khởi tạo trạng thái icon khi service worker khởi động
chrome.storage.sync.get({ enabled: true }, (data) => {
  updateIconVisuals(data.enabled);
});

// ============================================================
// XỬ LÝ SỰ KIỆN CLICK VÀO ICON EXTENSION (Toggle Bật/Tắt)
// ============================================================
chrome.action.onClicked.addListener((tab) => {
  chrome.storage.sync.get({ enabled: true }, (data) => {
    const newEnabled = !data.enabled;
    chrome.storage.sync.set({ enabled: newEnabled }, () => {
      updateIconVisuals(newEnabled);
      broadcastStateToTabs(newEnabled);
    });
  });
});

// ============================================================
// SHORTCUT Alt+Shift+S – Mở popup.html dưới dạng cửa sổ nhỏ
// ============================================================
chrome.commands.onCommand.addListener((command) => {
  if (command === 'open-popup') {
    chrome.windows.create({
      url: chrome.runtime.getURL('popup.html'),
      type: 'popup',
      width: 360,
      height: 480,
      focused: true,
    });
  }
});

// ============================================================
// NHẬN THÔNG BÁO TỪ CONTENT SCRIPT / POPUP
// ============================================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'AD_SKIPPED') {
    // Cập nhật badge số lần đã skip
    chrome.storage.sync.get({ skipCount: 0, enabled: true }, (data) => {
      const newCount = data.skipCount + 1;
      chrome.storage.sync.set({ skipCount: newCount });

      // Hiện badge trên icon extension nếu đang bật
      const tabId = sender?.tab?.id;
      if (tabId && data.enabled) {
        chrome.action.setBadgeText({ text: String(newCount > 999 ? '999+' : newCount), tabId });
        chrome.action.setBadgeBackgroundColor({ color: '#7b2ff7', tabId });
      }
    });
    sendResponse({ ok: true });
  }

  if (message.type === 'TOGGLE_ENABLED') {
    const { enabled } = message;
    chrome.storage.sync.set({ enabled }, () => {
      updateIconVisuals(enabled);
      broadcastStateToTabs(enabled);
    });
    sendResponse({ ok: true });
  }

  if (message.type === 'RESET_COUNT') {
    chrome.storage.sync.set({ skipCount: 0 });
    // Cập nhật lại giao diện badge trên tất cả tab
    chrome.storage.sync.get({ enabled: true }, (data) => {
      chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
          if (tab.id) {
            updateIconVisuals(data.enabled, tab.id);
          }
        }
      });
    });
    sendResponse({ ok: true });
  }

  return true; // Giữ message channel mở cho async response
});

// ============================================================
// TỰ ĐỘNG INJECT content.js vào tab mới nếu cần
// (backup cho trường hợp extension vừa được bật lại)
// ============================================================
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    if (tab.url.startsWith('http://') || tab.url.startsWith('https://')) {
      // Chỉ cập nhật icon, KHÔNG inject lại content.js (manifest đã lo)
      chrome.storage.sync.get({ enabled: true }, (data) => {
        updateIconVisuals(data.enabled, tabId);
      });
    }
  }
});

console.log('[AutoSkip BG] Service worker đang chạy.');
