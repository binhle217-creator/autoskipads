/**
 * AutoSkip – Background Service Worker (ES Module)
 * Quản lý trạng thái, nhận request phân loại AI từ content script,
 * phát hiện và xử lý tab quảng cáo mới mở.
 */

import { classifyByText, classifyByImage, classifyUrl } from './gemini.js';

// ============================================================
// STATE
// ============================================================
var autoCloseAdTabs = false;

// ============================================================
// HELPERS
// ============================================================
function updateIconVisuals(enabled, tabId = null) {
  const badgeText = enabled ? '' : 'OFF';
  const badgeColor = '#666666';
  const title = enabled ? 'AutoSkip: Đang bật' : 'AutoSkip: Đang tắt';
  const options = { title };

  if (tabId) {
    chrome.action.setTitle({ ...options, tabId }).catch(() => {});
    chrome.action.setBadgeText({ text: badgeText, tabId }).catch(() => {});
    if (badgeText) chrome.action.setBadgeBackgroundColor({ color: badgeColor, tabId }).catch(() => {});
  } else {
    chrome.action.setTitle(options).catch(() => {});
    chrome.action.setBadgeText({ text: badgeText }).catch(() => {});
    if (badgeText) chrome.action.setBadgeBackgroundColor({ color: badgeColor }).catch(() => {});
  }
}

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
// CÀI ĐẶT MẶC ĐỊNH
// ============================================================
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get({ geminiApiKey: '' }, (existing) => {
    // Giữ lại API key nếu đã có
    chrome.storage.sync.set({
      enabled: true,
      autoCloseAdTabs: false,
      geminiApiKey: existing.geminiApiKey || '',
    });
    chrome.storage.local.set({ skipCount: 0 });
  });
  updateIconVisuals(true);
  console.log('[AutoSkip BG] Extension đã được cài đặt.');
});

// Khởi tạo trạng thái khi service worker khởi động
chrome.storage.sync.get({ enabled: true, autoCloseAdTabs: false }, (data) => {
  updateIconVisuals(data.enabled);
  autoCloseAdTabs = data.autoCloseAdTabs;
});

// ============================================================
// CLICK ICON TOGGLE
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
// SHORTCUT Alt+Shift+S
// ============================================================
chrome.commands.onCommand.addListener((command) => {
  if (command === 'open-popup') {
    chrome.windows.create({
      url: chrome.runtime.getURL('popup.html'),
      type: 'popup',
      width: 360,
      height: 560,
      focused: true,
    });
  }
});

// ============================================================
// NHẬN MESSAGE TỪ CONTENT SCRIPT / POPUP
// ============================================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // --- Content script báo đã skip ---
  if (message.type === 'AD_SKIPPED') {
    chrome.storage.local.get({ skipCount: 0, enabled: true }, (data) => {
      const newCount = data.skipCount + 1;
      chrome.storage.local.set({ skipCount: newCount });
      const tabId = sender?.tab?.id;
      if (tabId && data.enabled) {
        chrome.action.setBadgeText({ text: String(newCount > 999 ? '999+' : newCount), tabId }).catch(() => {});
        chrome.action.setBadgeBackgroundColor({ color: '#7b2ff7', tabId }).catch(() => {});
      }
    });
    sendResponse({ ok: true });
  }

  // --- Popup toggle ---
  if (message.type === 'TOGGLE_ENABLED') {
    const { enabled } = message;
    chrome.storage.sync.set({ enabled }, () => {
      updateIconVisuals(enabled);
      broadcastStateToTabs(enabled);
    });
    sendResponse({ ok: true });
  }

  // --- Popup toggle chặn tab QC ---
  if (message.type === 'SET_AUTO_CLOSE_TABS') {
    autoCloseAdTabs = message.autoClose;
    chrome.storage.sync.set({ autoCloseAdTabs: message.autoClose });
    console.log('[AutoSkip BG] Chặn tab QC:', autoCloseAdTabs ? 'BẬT' : 'TẮT');
    sendResponse({ ok: true });
  }

  // --- Reset bộ đếm ---
  if (message.type === 'RESET_COUNT') {
    chrome.storage.local.set({ skipCount: 0 });
    chrome.storage.sync.get({ enabled: true }, (data) => {
      chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
          if (tab.id) updateIconVisuals(data.enabled, tab.id);
        }
      });
    });
    sendResponse({ ok: true });
  }

  // --- AI: Phân loại element bằng text ---
  if (message.type === 'CLASSIFY_AD_TEXT') {
    classifyByText(message.info).then((result) => {
      sendResponse(result);
    }).catch((err) => {
      console.error('[AutoSkip BG] classifyByText error:', err);
      sendResponse({ isAd: false, confidence: 0, reason: 'error' });
    });
    return true; // async response
  }

  // --- AI: Phân loại element bằng ảnh ---
  if (message.type === 'CLASSIFY_AD_IMAGE') {
    classifyByImage(message.base64Image).then((result) => {
      sendResponse(result);
    }).catch((err) => {
      console.error('[AutoSkip BG] classifyByImage error:', err);
      sendResponse({ isAd: false, confidence: 0, reason: 'error' });
    });
    return true;
  }

  return true;
});

// ============================================================
// PHÁT HIỆN TAB MỚI MỞ BỞI WEBSITE
// Giữ focus ở tab gốc → AI phân loại URL → nếu QC thì hỏi user
// ============================================================
var pendingAdTabs = {};

chrome.tabs.onCreated.addListener((newTab) => {
  if (!autoCloseAdTabs) return;
  if (!newTab.openerTabId) return;

  // Giữ focus ở tab gốc ngay lập tức
  chrome.tabs.update(newTab.openerTabId, { active: true });

  // Đợi tab mới load để lấy URL
  setTimeout(async () => {
    try {
      const tab = await chrome.tabs.get(newTab.id);
      if (!tab) return;

      var url = tab.url || tab.pendingUrl || '';
      if (!url || url === 'about:blank') return;
      if (url.startsWith('chrome://') || url.startsWith('chrome-extension://')) return;

      const openerTab = await chrome.tabs.get(newTab.openerTabId);
      if (!openerTab) return;

      var openerHost = '';
      try { openerHost = new URL(openerTab.url).hostname; } catch(e) {}
      var newHost = '';
      try { newHost = new URL(url).hostname; } catch(e) {}

      // Cùng domain → bỏ qua
      if (openerHost && newHost && openerHost === newHost) return;

      // Gọi AI phân loại URL
      const aiResult = await classifyUrl({
        url: url,
        openerUrl: openerTab.url || '',
        title: tab.title || '',
      });

      console.log('[AutoSkip BG] AI phân loại tab:', url, aiResult);

      // Chỉ hỏi user nếu AI nghi ngờ là QC (confidence >= 0.5)
      if (!aiResult.isAd || aiResult.confidence < 0.5) {
        console.log('[AutoSkip BG] AI nói không phải QC, bỏ qua.');
        return;
      }

      // Hiện notification hỏi user
      var shortUrl = newHost || url.substring(0, 40);
      var notifId = 'adtab_' + newTab.id + '_' + Date.now();
      pendingAdTabs[notifId] = { tabId: newTab.id, url: url };

      chrome.notifications.create(notifId, {
        type: 'basic',
        iconUrl: 'icon128.png',
        title: '🚫 AutoSkip – Phát hiện tab QC',
        message: 'AI nhận diện: ' + shortUrl + ' (' + Math.round(aiResult.confidence * 100) + '% QC)\nĐóng tab này?',
        buttons: [
          { title: '❌ Đóng tab' },
          { title: '✅ Giữ lại' }
        ],
        priority: 2,
        requireInteraction: true,
      });

    } catch (err) {
      console.error('[AutoSkip BG] Tab detection error:', err);
    }
  }, 800);
});

// Xử lý button click trên notification
chrome.notifications.onButtonClicked.addListener((notifId, btnIndex) => {
  var info = pendingAdTabs[notifId];
  if (!info) return;

  if (btnIndex === 0) {
    chrome.tabs.remove(info.tabId, () => {
      if (chrome.runtime.lastError) return;
      console.log('[AutoSkip BG] ✅ User đóng tab:', info.url);
    });
  } else {
    console.log('[AutoSkip BG] ℹ️ User giữ tab:', info.url);
  }
  chrome.notifications.clear(notifId);
  delete pendingAdTabs[notifId];
});

chrome.notifications.onClosed.addListener((notifId) => {
  delete pendingAdTabs[notifId];
});

// ============================================================
// CẬP NHẬT ICON cho tab mới
// ============================================================
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    if (tab.url.startsWith('http://') || tab.url.startsWith('https://')) {
      chrome.storage.sync.get({ enabled: true }, (data) => {
        updateIconVisuals(data.enabled, tabId);
      });
    }
  }
});

console.log('[AutoSkip BG] Service worker (module) đang chạy.');
