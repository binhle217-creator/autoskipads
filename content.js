/**
 * AutoSkip – Content Script (Trang khác, KHÔNG phải YouTube)
 * Xử lý: phát hiện popup/overlay → gọi AI phân loại → đóng nếu là QC.
 * YouTube được xử lý riêng bởi youtube.js
 */

(function () {
  if (window.__autoskip_loaded__) return;
  window.__autoskip_loaded__ = true;

// ============================================================
// CẤU HÌNH – Selector nút close đã biết chắc chắn
// ============================================================
var KNOWN_CLOSE_SELECTORS = [
  '.popup-icon-close',
  '[class*="popup-icon"]',
  '[class*="ads-banner"] [class*="close"]',
];

// Từ khóa chặn cứng (không cần AI): cờ bạc, cá cược, 18+
var BLACK_KEYWORDS = [
  'bet', 'casino', '88', 'win', 'rikvip', 'hitclub', 'ku', 'thabet', 'kubet', 
  'sex', 'porn', 'xnxx', 'xvideos', 
  'ads', 'banner', 'qc'
];

// ============================================================
// STATE
// ============================================================
var isEnabled = true;
var skipCount = 0;
var observerActive = false;
var checkInterval = null;
var pendingClassify = false;  // Đang chờ AI trả lời
var hiddenOverlays = [];      // Overlay đã ẩn
var classifiedElements = new WeakSet(); // Element đã xử lý, không classify lại
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
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    el.click();
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    console.log('[AutoSkip] ✅ Đã đóng quảng cáo!', el);
  } catch (e) {
    console.error('[AutoSkip] Lỗi click:', e);
  }
}

function isContextValid() {
  try { return !!(chrome && chrome.runtime && chrome.runtime.id); }
  catch (e) { return false; }
}

function saveCount() {
  if (!isContextValid()) return;
  try { chrome.storage.local.set({ skipCount: skipCount }); } catch(e) {}
}

function notifyBackground() {
  if (!isContextValid()) return;
  try { chrome.runtime.sendMessage({ type: 'AD_SKIPPED', count: skipCount }); } catch (e) {}
}

// ============================================================
// ẨN VĨNH VIỄN OVERLAY
// ============================================================
function permanentlyHide(el) {
  function applyHide(e) {
    e.style.setProperty('display',        'none',  'important');
    e.style.setProperty('visibility',     'hidden','important');
    e.style.setProperty('pointer-events', 'none',  'important');
    e.style.setProperty('opacity',        '0',     'important');
  }
  applyHide(el);
  hiddenOverlays.push(el);
  var obs = new MutationObserver(function() { applyHide(el); });
  obs.observe(el, { attributes: true, attributeFilter: ['style','class'] });
  console.log('[AutoSkip] 🔒 Khoá ẩn overlay:', el);
}

function findFixedAncestor(el) {
  var cur = el.parentElement;
  for (var i = 0; i < 10 && cur && cur !== document.body; i++, cur = cur.parentElement) {
    var pos = window.getComputedStyle(cur).position;
    if (pos === 'fixed' || pos === 'absolute') return cur;
  }
  return null;
}

function reHideKnown() {
  for (var i = 0; i < hiddenOverlays.length; i++) {
    var el = hiddenOverlays[i];
    if (el && window.getComputedStyle(el).display !== 'none') {
      el.style.setProperty('display', 'none', 'important');
    }
  }
}

// ============================================================
// TÌM NÚT CLOSE TRỰC QUAN (ký tự ×, X + vị trí góc)
// ============================================================
function findVisualCloseBtn(overlay) {
  var CLOSE_RE = /^[\s×✕✖✗✘❌xX\u00d7\u2715\u2716\u2717\u2718]*$/;
  var overlayRect = overlay.getBoundingClientRect();
  var all = overlay.querySelectorAll('*');
  var best = null;
  var bestPriority = -1;

  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    if (!isVisible(el)) continue;

    var r = el.getBoundingClientRect();
    if (r.width > 80 || r.height > 80) continue;

    var st = window.getComputedStyle(el);
    var text = (el.textContent || '').trim();
    var hasCursor = st.cursor === 'pointer';
    var isBtn = el.tagName === 'BUTTON' || el.tagName === 'A' ||
                el.getAttribute('role') === 'button' || el.onclick !== null;
    var isCloseText = CLOSE_RE.test(text) && text.length <= 3;

    var inTopRight = r.right >= overlayRect.right - overlayRect.width * 0.3 &&
                     r.top   <= overlayRect.top + overlayRect.height * 0.3;
    var inTopLeft  = r.left  <= overlayRect.left + overlayRect.width * 0.3 &&
                     r.top   <= overlayRect.top + overlayRect.height * 0.3;
    var inAnyCorner = inTopRight || inTopLeft;

    var priority = -1;
    if (isCloseText && (hasCursor || isBtn)) priority = 4;
    else if (isCloseText && inAnyCorner)     priority = 3;
    else if (inAnyCorner && (hasCursor || isBtn)) priority = 2;
    else if (isCloseText)                    priority = 1;
    else if (inAnyCorner && hasCursor)       priority = 0;

    if (priority > bestPriority) {
      bestPriority = priority;
      best = el;
    }
  }
  return best;
}

// ============================================================
// BƯỚC 1: CLICK BẰNG TEXT HOẶC SELECTOR ĐÃ BIẾT (không cần AI)
// ============================================================
function tryCloseKnown() {
  if (!isEnabled) return false;

  reHideKnown();

  // 1.1 Tìm bằng text (rất phổ biến trên các web phim như Motchill, xoilac...)
  var skipTexts = ['bỏ qua', 'tắt qc', 'đóng qc', 'skip ad', 'skip ads', 'đóng quảng cáo'];
  var buttons = document.querySelectorAll('button, a, div[role="button"], span[role="button"], [class*="btn"], [class*="skip"], [class*="close"]');
  for (var k = 0; k < buttons.length; k++) {
    var el = buttons[k];
    if (!isVisible(el)) continue;
    
    var text = (el.textContent || '').trim().toLowerCase();
    // Chống bấm nhầm nút điều hướng
    if (text.indexOf('điều hướng') !== -1 || text.indexOf('navigation') !== -1) continue;

    for (var j = 0; j < skipTexts.length; j++) {
      if (text.indexOf(skipTexts[j]) !== -1 && text.length < 25) {
        var container = findFixedAncestor(el);
        clickElement(el);
        if (container) permanentlyHide(container);
        skipCount++;
        saveCount();
        notifyBackground();
        console.log('[AutoSkip] ✅ Đóng (nhận diện qua text):', text, el);
        return true;
      }
    }
  }

  // 1.2 Tìm bằng selector css
  for (var i = 0; i < KNOWN_CLOSE_SELECTORS.length; i++) {
    var btn;
    try { btn = document.querySelector(KNOWN_CLOSE_SELECTORS[i]); } catch(e) { continue; }
    if (!btn || !isVisible(btn)) continue;

    var container = findFixedAncestor(btn) || btn.parentElement;
    clickElement(btn);
    if (container) permanentlyHide(container);
    skipCount++;
    saveCount();
    notifyBackground();
    console.log('[AutoSkip] ✅ Đóng (selector đã biết):', btn);
    return true;
  }
  return false;
}

// ============================================================
// BƯỚC 2: QUÉT ELEMENT ĐÁNG NGỜ → GỌI AI PHÂN LOẠI
// ============================================================
function scanAndClassify() {
  if (!isEnabled || pendingClassify) return;

  // Lấy element che giữa màn hình
  var points = [
    [window.innerWidth * 0.5,  window.innerHeight * 0.5],
    [window.innerWidth * 0.5,  window.innerHeight * 0.35],
    [window.innerWidth * 0.3,  window.innerHeight * 0.5],
    [window.innerWidth * 0.7,  window.innerHeight * 0.5],
  ];

  // THÊM: Quét ngay chính giữa tất cả các video/iframe trên trang
  var mediaEls = document.querySelectorAll('video, iframe');
  for (var m = 0; m < mediaEls.length; m++) {
    var rect = mediaEls[m].getBoundingClientRect();
    if (rect.width > 150 && rect.height > 100) {
      points.push([rect.left + rect.width * 0.5, rect.top + rect.height * 0.5]);
      points.push([rect.left + rect.width * 0.5, rect.top + rect.height * 0.2]); // Góc trên video
    }
  }

  var candidates = [];
  var seen = {};

  for (var pi = 0; pi < points.length; pi++) {
    var px = points[pi][0], py = points[pi][1];
    if (px < 0 || py < 0 || px > window.innerWidth || py > window.innerHeight) continue;
    
    var hits = document.elementsFromPoint(px, py);
    for (var hi = 0; hi < hits.length && hi < 8; hi++) {
      var el = hits[hi];
      if (!el || el === document.documentElement || el === document.body) continue;
      if (el.id === '__autoskip_toast__' || el.tagName === 'VIDEO') continue;
      if (classifiedElements.has(el)) continue;

      var uid = el.tagName + (el.className || '').toString().substring(0, 30) + (el.id || '');
      if (seen[uid]) continue;
      seen[uid] = true;

      var st = window.getComputedStyle(el);
      var pos = st.position;
      if (pos !== 'fixed' && pos !== 'absolute') continue;

      // Xử lý z-index (nhiều trang dùng position fixed nhưng z-index = auto)
      var zIdxVal = st.zIndex === 'auto' ? 999 : (parseInt(st.zIndex, 10) || 0);
      // Nếu là absolute thì thường cần z-index cao để làm overlay, fixed thì chắc chắn là overlay
      if (pos === 'absolute' && zIdxVal < 5) continue;
      
      var zIdx = zIdxVal; // để dùng cho sort phía sau
      if (!isVisible(el)) continue;

      var elRect = el.getBoundingClientRect();
      if (elRect.width < 50 || elRect.height < 50) continue; // Hạ kích thước tối thiểu

      var area = (elRect.width * elRect.height) / (window.innerWidth * window.innerHeight);
      if (area < 0.01) continue; // Phải che > 1% màn hình (quảng cáo trong video có thể nhỏ)

      candidates.push({ el: el, rect: elRect, zIdx: zIdx, pos: pos, area: area });
    }
  }

  if (candidates.length === 0) return;

  // Sắp xếp theo z-index cao nhất (overlay trên cùng)
  candidates.sort(function(a, b) { return b.zIdx - a.zIdx; });

  // Lấy candidate nghi ngờ nhất
  var top = candidates[0];
  classifyWithAI(top.el, top.rect);
}

// ============================================================
// GỌI AI QUA BACKGROUND SCRIPT
// ============================================================
function classifyWithAI(el, rect) {
  if (!isContextValid()) return;
  pendingClassify = true;
  classifiedElements.add(el);

  // Thu thập thông tin text
  var info = {
    tag: el.tagName,
    classes: (el.className || '').toString().substring(0, 100),
    id: el.id || '',
    text: (el.textContent || '').substring(0, 150).replace(/\s+/g, ' ').trim(),
    src: el.src ? el.src.substring(0, 150) : '',
    position: window.getComputedStyle(el).position,
    zIndex: window.getComputedStyle(el).zIndex,
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    pageUrl: location.hostname,
  };

  console.log('[AutoSkip] 🤖 Gửi AI phân loại (text):', info);

  try {
    chrome.runtime.sendMessage({ type: 'CLASSIFY_AD_TEXT', info: info }, function(result) {
      if (chrome.runtime.lastError) {
        pendingClassify = false;
        return;
      }

      if (!result) {
        pendingClassify = false;
        return;
      }

      console.log('[AutoSkip] 🤖 AI trả lời:', result);

      if (result.isAd && result.confidence >= 0.8) {
        // Chắc chắn là QC → đóng ngay
        handleAdElement(el);
        pendingClassify = false;
      } else if (result.isAd && result.confidence >= 0.4) {
        // Không chắc → chụp screenshot gửi ảnh
        classifyWithImage(el);
      } else {
        // Không phải QC
        console.log('[AutoSkip] ✓ AI nói không phải QC (confidence:', result.confidence, ')');
        pendingClassify = false;
      }
    });
  } catch(e) {
    pendingClassify = false;
  }
}

function classifyWithImage(el) {
  try {
    // Chụp screenshot bằng html2canvas fallback: dùng canvas API
    // Vì content script không có quyền chụp màn hình,
    // ta gửi lại thông tin chi tiết hơn (innerHTML snippet) thay vì ảnh
    var htmlSnippet = el.outerHTML.substring(0, 500);
    var childTexts = [];
    var children = el.querySelectorAll('*');
    for (var i = 0; i < children.length && i < 20; i++) {
      var t = (children[i].textContent || '').trim();
      if (t.length > 2 && t.length < 100) childTexts.push(t);
    }

    var enrichedInfo = {
      tag: el.tagName,
      classes: (el.className || '').toString().substring(0, 150),
      id: el.id || '',
      text: childTexts.join(' | ').substring(0, 300),
      htmlSnippet: htmlSnippet,
      position: window.getComputedStyle(el).position,
      zIndex: window.getComputedStyle(el).zIndex,
      width: Math.round(el.getBoundingClientRect().width),
      height: Math.round(el.getBoundingClientRect().height),
      pageUrl: location.hostname,
      note: 'PHÂN TÍCH KỸ HƠN – đây là lần gọi thứ 2, lần 1 chưa chắc chắn',
    };

    console.log('[AutoSkip] 🤖 Gửi AI phân loại lần 2 (chi tiết):', enrichedInfo);

    chrome.runtime.sendMessage({ type: 'CLASSIFY_AD_TEXT', info: enrichedInfo }, function(result) {
      if (chrome.runtime.lastError || !result) {
        pendingClassify = false;
        return;
      }

      console.log('[AutoSkip] 🤖 AI trả lời (lần 2):', result);

      if (result.isAd && result.confidence >= 0.6) {
        handleAdElement(el);
      } else {
        console.log('[AutoSkip] ✓ AI xác nhận không phải QC.');
      }
      pendingClassify = false;
    });
  } catch(e) {
    pendingClassify = false;
  }
}

// ============================================================
// XỬ LÝ ELEMENT ĐƯỢC AI XÁC NHẬN LÀ QC
// ============================================================
function handleAdElement(el) {
  var closeBtn = findVisualCloseBtn(el);

  var delay = randomDelay(500, 1200);
  console.log('[AutoSkip] 🎯 AI xác nhận QC, xử lý sau ' + delay + 'ms...');

  setTimeout(function() {
    if (!isEnabled) return;
    if (closeBtn && isVisible(closeBtn)) {
      clickElement(closeBtn);
    }
    permanentlyHide(el);
    skipCount++;
    saveCount();
    notifyBackground();
    console.log('[AutoSkip] ✅ Đã đóng popup (AI confirmed)!');
  }, delay);
}

// ============================================================
// BỘ LỌC CROSS-ORIGIN (Cờ bạc, 18+)
// ============================================================
function isCrossOrigin(targetUrl) {
  if (!targetUrl) return false;
  if (targetUrl.startsWith('data:') || targetUrl.startsWith('blob:') || targetUrl.startsWith('javascript:')) return false;
  if (targetUrl.startsWith('/')) return false; // Relative url
  
  try {
    var urlObj = new URL(targetUrl);
    // Nếu domain khác với domain của trang hiện tại (và không phải subdomain trực tiếp)
    var currentHost = window.location.hostname.replace('www.', '');
    var targetHost = urlObj.hostname.replace('www.', '');
    
    if (targetHost === currentHost || targetHost.endsWith('.' + currentHost)) {
      return false;
    }
    return true; // Khác tên miền
  } catch (e) {
    return false;
  }
}

function scanAndBlockMedia() {
  if (!isEnabled) return;
  
  // Lấy tất cả ảnh, video, iframe, thẻ a
  var elements = document.querySelectorAll('img, video, iframe, a');
  for (var i = 0; i < elements.length; i++) {
    var el = elements[i];
    if (hiddenOverlays.indexOf(el) !== -1 || classifiedElements.has(el)) continue;

    var link = el.src || el.href || '';
    if (!isCrossOrigin(link)) continue; // Bỏ qua nếu cùng tên miền

    var tag = el.tagName.toLowerCase();
    var className = (el.className || '').toString().toLowerCase();
    var idName = (el.id || '').toLowerCase();
    var linkLower = link.toLowerCase();
    
    // Kiểm tra xem có chứa từ khoá cờ bạc/18+ không
    var hasBlackKeyword = false;
    for (var k = 0; k < BLACK_KEYWORDS.length; k++) {
      var kw = BLACK_KEYWORDS[k];
      if (linkLower.indexOf(kw) !== -1 || className.indexOf(kw) !== -1 || idName.indexOf(kw) !== -1) {
        hasBlackKeyword = true;
        break;
      }
    }

    if (hasBlackKeyword) {
      // Ẩn / Chặn ngay lập tức
      var container = findFixedAncestor(el) || el;
      if (tag === 'iframe' || tag === 'video' || tag === 'img') {
        el.src = ''; // Chặn load media
      }
      permanentlyHide(container);
      classifiedElements.add(el);
      console.log('[AutoSkip] 🚫 Đã chặn nội dung rác chéo tên miền:', link);
    }
  }
}

// ============================================================
// MAIN LOOP – chạy mỗi 500ms
// ============================================================
function mainCheck() {
  if (!isEnabled) return;

  // Bước 1: Lọc quảng cáo nhúng chéo tên miền (rác/cờ bạc)
  scanAndBlockMedia();

  // Bước 2: thử selector đã biết (nhanh, không cần AI)
  var closed = tryCloseKnown();

  // Bước 3: nếu không có selector biết → quét popup overlay + gọi AI
  if (!closed) {
    scanAndClassify();
  }
}

// ============================================================
// OBSERVER
// ============================================================
function startObserver() {
  if (observerActive) return;
  observerActive = true;

  mutationObserver = new MutationObserver(function(mutations) {
    for (var m = 0; m < mutations.length; m++) {
      if (mutations[m].addedNodes.length > 0) {
        // Khi có element mới → check ngay
        setTimeout(mainCheck, 200);
        break;
      }
    }
  });

  mutationObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  console.log('[AutoSkip] 👁 MutationObserver đang chạy (AI mode).');
}

// ============================================================
// INTERVAL – backup check mỗi 2 giây (giảm tần suất vì có AI)
// ============================================================
function startInterval() {
  if (checkInterval) return;
  checkInterval = setInterval(function() {
    if (!isContextValid()) { safeStop(); return; }
    mainCheck();
  }, 2000);
}

function stopInterval() {
  if (checkInterval) { clearInterval(checkInterval); checkInterval = null; }
}

function safeStop() {
  stopInterval();
  try { if (mutationObserver) mutationObserver.disconnect(); } catch(e) {}
  observerActive = false;
}

// ============================================================
// STORAGE
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
  var desc = enabled ? 'AI đang theo dõi quảng cáo' : 'Nhấn icon để bật lại';

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

// Chỉ chạy khi tab đang visible
document.addEventListener('visibilitychange', function() {
  if (document.hidden) {
    stopInterval();
  } else {
    if (isEnabled) startInterval();
  }
});

if (document.hidden) stopInterval();

console.log('[AutoSkip] 🤖 Module AI (non-YouTube) đã khởi động.');

})(); // đóng IIFE
