/**
 * AutoSkip – YouTube Module
 * Chỉ chạy trên youtube.com
 * Xử lý: skip ads, fast-forward ads, mute ads
 */

(function () {
  if (window.__autoskip_yt_loaded__) return;
  window.__autoskip_yt_loaded__ = true;

// ============================================================
// CẤU HÌNH YouTube
// ============================================================
var YT_SKIP_SELECTORS = [
  // Nút skip chính
  '.ytp-skip-ad-button',
  '.ytp-ad-skip-button',
  '.ytp-ad-skip-button-modern',
  'button.ytp-ad-skip-button',
  '.videoAdUiSkipButton',
  'button[class*="ytp-ad-skip"]',
  'button[id^="skip-button"]',
  // Container chứa nút skip
  '.ytp-ad-skip-button-slot button',
  '.ytp-ad-skip-button-slot',
  '.ytp-ad-skip-button-container button',
  '.ytp-ad-skip-button-container',
  // Selector aria (bỏ các selector dùng * dễ gây nhầm lẫn với nút accessibility)
  '[aria-label="Skip ad"]',
  '[aria-label="Bỏ qua quảng cáo"]',
  // Selector mới YouTube 2024-2026
  '.ytp-ad-skip-button-modern .ytp-ad-button-text',
  'div[class*="skip-ad"] button',
  'div[class*="skip-ad"]',
  '.ad-skip-button',
];

var YT_AD_PLAYING_SELECTORS = [
  '.ad-showing',
  '.ytp-ad-player-overlay',
  '[class*="ad-badge"]',
  '.videoAdUi',
  '[data-ad-status="showing"]',
];

var VIDEO_SELECTOR = 'video';

// Text để nhận diện nút skip (đa ngôn ngữ)
var SKIP_TEXT_PATTERNS = ['bỏ qua', 'skip', 'skip ad', 'skip ads', 'passer'];

// ============================================================
// STATE
// ============================================================
var isEnabled = true;
var skipCount = 0;
var pendingSkip = false;
var checkInterval = null;
var observerActive = false;
var mutationObserver = null;

// ============================================================
// HELPERS
// ============================================================
function randomDelay(minMs, maxMs) {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

function isVisible(el) {
  if (!el) return false;
  var rect = el.getBoundingClientRect();
  var style = window.getComputedStyle(el);
  return (
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.opacity !== '0' &&
    (rect.width > 0 || rect.height > 0)
  );
}

function clickElement(el) {
  try {
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    el.click();
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    console.log('[AutoSkip YT] ✅ Đã bỏ qua quảng cáo!', el);
  } catch (e) {
    console.error('[AutoSkip YT] Lỗi click:', e);
  }
}

function isContextValid() {
  try {
    return !!(chrome && chrome.runtime && chrome.runtime.id);
  } catch (e) {
    return false;
  }
}

function saveCount() {
  if (!isContextValid()) return;
  try { chrome.storage.local.set({ skipCount: skipCount }); } catch(e) {}
}

function notifyBackground() {
  if (!isContextValid()) return;
  try {
    chrome.runtime.sendMessage({ type: 'AD_SKIPPED', count: skipCount });
  } catch (e) {}
}

// ============================================================
// TÌM NÚT SKIP BẰNG TEXT (fallback cực mạnh khi bị obfuscate)
// ============================================================
function findSkipByText() {
  var player = document.querySelector('#movie_player') || document.querySelector('.html5-video-player');
  if (!player) return null;

  var btn = null;

  function isButtonLike(el) {
    if (!el) return false;
    var tag = el.tagName;
    if (tag === 'BUTTON' || tag === 'A') return true;
    if (el.getAttribute('role') === 'button') return true;
    if (el.onclick) return true;
    try {
      if (window.getComputedStyle(el).cursor === 'pointer') return true;
    } catch (e) {}
    return false;
  }

  function getClickableParent(el) {
    var parent = el;
    for (var k = 0; k < 5 && parent && parent !== player; k++, parent = parent.parentElement) {
      if (isButtonLike(parent)) return parent;
    }
    return el; // Trả về chính nó nếu không thấy cha nào khả nghi
  }

  // 1. Quét toàn bộ TextNode (Không quan tâm YouTube dùng thẻ gì)
  var walker = document.createTreeWalker(player, NodeFilter.SHOW_TEXT, null, false);
  var node;
  while ((node = walker.nextNode())) {
    var text = (node.nodeValue || '').trim().toLowerCase();
    if (text.length < 3 || text.length > 30) continue;
    if (text.indexOf('điều hướng') !== -1 || text.indexOf('navigation') !== -1) continue;

    for (var j = 0; j < SKIP_TEXT_PATTERNS.length; j++) {
      if (text.indexOf(SKIP_TEXT_PATTERNS[j]) !== -1) {
        var el = node.parentElement;
        if (isVisible(el)) {
          btn = getClickableParent(el);
          console.log('[AutoSkip YT] 🔍 Tìm thấy nút skip (TextNode):', text, btn);
          return btn;
        }
      }
    }
  }

  // 2. Quét Aria-Label (Trường hợp nút ẩn text nhưng dùng aria-label)
  var arias = player.querySelectorAll('[aria-label]');
  for (var i = 0; i < arias.length; i++) {
    var elAria = arias[i];
    if (!isVisible(elAria)) continue;
    var ariaText = (elAria.getAttribute('aria-label') || '').trim().toLowerCase();
    if (ariaText.indexOf('điều hướng') !== -1 || ariaText.indexOf('navigation') !== -1) continue;

    for (var m = 0; m < SKIP_TEXT_PATTERNS.length; m++) {
      if (ariaText.indexOf(SKIP_TEXT_PATTERNS[m]) !== -1 && ariaText.length < 30) {
        btn = getClickableParent(elAria);
        console.log('[AutoSkip YT] 🔍 Tìm thấy nút skip (Aria):', ariaText, btn);
        return btn;
      }
    }
  }

  return null;
}

// ============================================================
// CORE – Click nút Skip
// ============================================================
function trySkip() {
  if (!isEnabled) return false;
  if (pendingSkip) return false;

  // Bước 1: Tìm bằng selector
  var btn = null;
  for (var i = 0; i < YT_SKIP_SELECTORS.length; i++) {
    var found = document.querySelector(YT_SKIP_SELECTORS[i]);
    if (found && isVisible(found)) {
      btn = found;
      break;
    }
  }

  // Bước 2: Fallback - tìm bằng text "Bỏ qua" / "Skip"
  if (!btn) {
    btn = findSkipByText();
  }

  if (btn) {
    pendingSkip = true;
    var delay = randomDelay(100, 300);
    console.log('[AutoSkip YT] ⏳ Phát hiện nút skip, click sau ' + delay + 'ms...');

    (function(b) {
      setTimeout(function() {
        if (isEnabled && isVisible(b)) {
          clickElement(b);
          skipCount++;
          saveCount();
          notifyBackground();
        } else {
          console.log('[AutoSkip YT] ⚠ Nút skip đã biến mất.');
        }
        pendingSkip = false;
      }, delay);
    })(btn);

    return true;
  }

  return false;
}

// ============================================================
// CORE – Tua nhanh MỌI quảng cáo (Bypass chế độ chặn click)
// ============================================================
function tryFastForwardAd() {
  if (!isEnabled) return;
  
  var adShowing = false;
  for (var i = 0; i < YT_AD_PLAYING_SELECTORS.length; i++) {
    if (document.querySelector(YT_AD_PLAYING_SELECTORS[i])) {
      adShowing = true;
      break;
    }
  }
  if (!adShowing) return;

  var video = document.querySelector(VIDEO_SELECTOR);
  if (video && !video.ended && isFinite(video.duration) && video.duration > 0) {
    // Nếu video còn dài hơn 0.5s -> Ép tua nhanh đến sát cuối (0.1s)
    if (video.currentTime < video.duration - 0.5) {
      console.log('[AutoSkip YT] ⏩ Ép tua nhanh quảng cáo...');
      video.currentTime = video.duration - 0.1;
      video.playbackRate = 16;
      video.muted = true;
    } else {
      video.playbackRate = 1;
    }
  }
}

// ============================================================
// OBSERVER – Theo dõi DOM (YouTube là SPA, dùng pushState)
// ============================================================
function startObserver() {
  if (observerActive) return;
  observerActive = true;

  mutationObserver = new MutationObserver(function(mutations) {
    for (var m = 0; m < mutations.length; m++) {
      if (mutations[m].addedNodes.length > 0 || mutations[m].attributeName) {
        trySkip();
        tryFastForwardAd();
        break;
      }
    }
  });

  mutationObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style'],
  });

  console.log('[AutoSkip YT] 👁 MutationObserver đang chạy.');
}

// ============================================================
// INTERVAL – Backup check mỗi 300ms
// ============================================================
function startInterval() {
  if (checkInterval) return;
  checkInterval = setInterval(function() {
    if (!isContextValid()) { safeStop(); return; }
    trySkip();
    tryFastForwardAd();
  }, 300);
}

function stopInterval() {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
}

function safeStop() {
  stopInterval();
  try {
    if (mutationObserver) mutationObserver.disconnect();
  } catch(e) {}
  observerActive = false;
}

// ============================================================
// STORAGE – đọc cài đặt
// ============================================================
function loadSettings() {
  chrome.storage.sync.get({ enabled: true }, function(syncData) {
    isEnabled = syncData.enabled;
    chrome.storage.local.get({ skipCount: 0 }, function(localData) {
      skipCount = localData.skipCount;
      if (isEnabled && !observerActive) {
        startObserver();
        startInterval();
      } else if (!isEnabled) {
        stopInterval();
      }
    });
  });
}

// ============================================================
// LẮNG NGHE TỪ POPUP / BACKGROUND
// ============================================================
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (message.type === 'SET_ENABLED') {
    isEnabled = message.enabled;
    if (isEnabled) {
      startObserver();
      startInterval();
    } else {
      stopInterval();
      var video = document.querySelector('video');
      if (video) video.playbackRate = 1;
    }
    showToast(isEnabled);
    sendResponse({ ok: true });
  }
  if (message.type === 'GET_STATUS') {
    sendResponse({ enabled: isEnabled, skipCount: skipCount });
  }
  return true;
});

// ============================================================
// TOAST
// ============================================================
function showToast(enabled) {
  var existing = document.getElementById('__autoskip_toast__');
  if (existing) existing.remove();

  var wrap = document.createElement('div');
  wrap.id = '__autoskip_toast__';
  wrap.style.cssText = 'position:fixed;bottom:28px;right:28px;z-index:2147483647;pointer-events:none;user-select:none;';

  var bg = enabled
    ? 'linear-gradient(135deg,rgba(0,198,255,.15),rgba(123,47,247,.25))'
    : 'rgba(20,20,35,.93)';
  var border = enabled ? 'rgba(123,47,247,.5)' : 'rgba(255,255,255,.1)';
  var shadow = '0 8px 32px rgba(0,0,0,.5)' + (enabled ? ',0 0 20px rgba(123,47,247,.3)' : '');
  var icon = enabled ? '⚡' : '⏸';
  var color = enabled ? '#00c6ff' : '#9da8c0';
  var title = enabled ? 'AutoSkip ĐÃ BẬT' : 'AutoSkip ĐÃ TẮT';
  var desc = enabled ? 'YouTube – Đang tự động skip quảng cáo' : 'Nhấn icon để bật lại';

  wrap.innerHTML =
    '<div id="__autoskip_toast_inner__" style="' +
    'display:flex;align-items:center;gap:12px;padding:14px 20px;border-radius:14px;' +
    'background:' + bg + ';border:1px solid ' + border + ';' +
    'backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);' +
    'box-shadow:' + shadow + ';font-family:Inter,-apple-system,sans-serif;' +
    'animation:__as_in .3s cubic-bezier(.4,0,.2,1) forwards;">' +
    '<span style="font-size:20px">' + icon + '</span>' +
    '<div><div style="font-size:13px;font-weight:700;color:' + color + '">' + title + '</div>' +
    '<div style="font-size:11px;font-weight:400;color:#9da8c0;margin-top:2px">' + desc + '</div></div></div>';

  var style = document.createElement('style');
  style.textContent =
    '@keyframes __as_in{from{opacity:0;transform:translateY(16px) scale(.95)}to{opacity:1;transform:translateY(0) scale(1)}}' +
    '@keyframes __as_out{from{opacity:1;transform:translateY(0) scale(1)}to{opacity:0;transform:translateY(16px) scale(.95)}}';
  document.head.appendChild(style);
  document.body.appendChild(wrap);

  setTimeout(function() {
    var inner = document.getElementById('__autoskip_toast_inner__');
    if (inner) inner.style.animation = '__as_out .3s cubic-bezier(.4,0,.2,1) forwards';
    setTimeout(function() { wrap.remove(); }, 350);
  }, 2500);
}

// ============================================================
// KHỞI ĐỘNG
// ============================================================
loadSettings();

// Lắng nghe khi YouTube navigate (SPA)
var lastUrl = location.href;
var navObserver = new MutationObserver(function() {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    setTimeout(function() {
      pendingSkip = false;
      trySkip();
      tryFastForwardAd();
    }, 500);
  }
});
navObserver.observe(document, { subtree: true, childList: true });

console.log('[AutoSkip YT] 🎬 Module YouTube đã khởi động.');

})(); // đóng IIFE
