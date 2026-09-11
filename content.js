/**
 * AutoSkip – Content Script
 * Tự động phát hiện và click nút bỏ qua quảng cáo.
 * Chạy trên tất cả các tab, kể cả khi tab đang ở nền.
 */

// IIFE – bao toàn bộ trong function scope
// Đảm bảo const/let không bao giờ bị re-declare dù bị inject nhiều lần
(function () {
  if (window.__autoskip_loaded__) return;
  window.__autoskip_loaded__ = true;


// ============================================================
// CẤU HÌNH – Danh sách selector nút skip trên các trang
// ============================================================
var SKIP_SELECTORS = [
  // YouTube
  '.ytp-skip-ad-button',
  '.ytp-ad-skip-button',
  '.ytp-ad-skip-button-modern',
  'button.ytp-ad-skip-button',
  '.videoAdUiSkipButton',
  'button[class*="ytp-ad-skip-button"]',
  'button[id^="skip-button"]',
  // Facebook / Instagram
  '[aria-label="Skip Ad"]',
  '[aria-label="Bỏ qua quảng cáo"]',
  // TikTok
  '.tt-feed-ad-skip',
  '[data-e2e="video-ad-skip"]',
  // Twitch
  '.tw-button[data-a-target="close-button"]',
  // JW Player
  '.jw-skip',
  '.jw-skip-container button',
  '.jw-skipknob',
  // VideoJS
  '.vjs-skip-button',
  // DailyMotion
  '.skip_btn',
  // Vimeo
  '[data-testid="close-overlay"]',
  // Generic patterns (chỉ nhắm vào button hoặc phần tử có role="button")
  'button[class*="skip"]',
  'div[class*="skip"][role="button"]',
  'span[class*="skip"][role="button"]',
  'a[class*="skip"]',
];

// Selector phát hiện quảng cáo đang chạy (để fast-forward)
var AD_PLAYING_SELECTORS = [
  '.ad-showing',
  '.ytp-ad-player-overlay',
  '[class*="ad-badge"]',
  '.videoAdUi',
  '[data-ad-status="showing"]',
];

// ============================================================
// CẤU HÌNH – Nút ĐÓNG popup/overlay quảng cáo
// ============================================================
var CLOSE_BTN_SELECTORS = [
  // === SELECTOR CỤ THỂ ĐÃ XÁC NHẬN HOẠT ĐỘNG ===
  '.popup-icon-close',   // animevietsub.li UK88 popup
  '[class*="popup-icon"]',
  '[class*="ads-banner"] [class*="close"]',
  // === ĐẶC BIỆT: trang anime/phim Việt Nam ===
  // Popup có nút ✕ đỏ kiểu inline-style position fixed/absolute
  'div[style*="position: fixed"] [class*="close"]',
  'div[style*="position:fixed"] [class*="close"]',
  'div[style*="z-index"] [class*="close"]',
  // Nút ✕ là thẻ con trực tiếp trong popup overlay
  '.popup > .close', '.popup > button', '.popup > span',
  '.modal > .close', '.modal > button',
  '.overlay > .close', '.overlay > button',
  // Class thường gặp trên các trang phím/anime
  '.close-icon', '.icon-close', '.btn-x',
  '.close-x', '.x-close', '.pop-close',
  '.layer-close', '.lightbox-close',
  '.fancybox-close', '.fancybox-button--close',
  '.mfp-close',        // Magnific Popup
  '.venobox_close',    // VenoBox
  '.tinybox-close',
  '.pup-close',
  // === GENERIC ===
  '[class*="close"][class*="ad"]',
  '[class*="ad"][class*="close"]',
  '[id*="close"][class*="ad"]',
  '[class*="popup"][class*="close"]',
  '[class*="overlay"][class*="close"]',
  '[class*="modal"][class*="close"]',
  '[class*="banner"][class*="close"]',
  '[class*="btn-close"]',
  '[class*="close-btn"]',
  '[class*="closeBtn"]',
  '[class*="closeButton"]',
  '[class*="close_btn"]',
  '[class*="close_button"]',
  '[class*="dismiss"]',
  '[aria-label*="close" i]',
  '[aria-label*="đóng" i]',
  '[aria-label*="tắt" i]',
  '[title*="close" i]',
  '[title*="đóng" i]',
  'button[class*="close"]',
  'span[class*="close"][role="button"]',
  'div[class*="close"][role="button"]',
  'a[class*="close"]',
  '.popup-close', '.ad-close', '.ads-close',
  '.close-popup', '.close-ad', '.close-ads',
  '.ad-overlay-close',
  '.popup-overlay .close',
  '.advertising .close',
  '[class*="quangcao"] [class*="close"]',
  '[class*="qc"] [class*="close"]',
  '.iframe-close', '.iframe-ad-close',
];

// Từ khóa nhận dạng quảng cáo trong text/class/id của element cha
var AD_KEYWORDS = [
  'quảng cáo', 'quang cao', 'advertisement', 'advertise',
  'sponsor', 'promo', 'ads', 'ad-', '-ad', '_ad', 'ad_',
  'popup', 'pop-up', 'pop_up', 'overlay', 'modal',
  'banner', 'interstitial',
  // Các nhà cái phổ biến
  'uk88', 'red88', 'hay.win', 'hayvl', 'win79',
  'fb88', 'w88', 'fun88', 'bet88', 'cf68',
  '789bet', 'hi88', 'bet', 'casino', 'cá cược',
  // Trang phim/anime Việt Nam
  'cakhia', 'xemphim', 'phimmoi', 'bilutv',
  'animehay', 'animevietsub', 'vuighe', 'motphim',
];


// Selector video element
var VIDEO_SELECTOR = 'video';

// ============================================================
// STATE
// ============================================================
var isEnabled = true;
var skipCount = 0;
var observerActive = false;
var checkInterval = null;
var pendingSkip = false;
var pendingClose = false;   // Tránh queue nhiều close popup cùng lúc
var hiddenOverlays = [];    // Danh sách overlay đã ẩn để re-hide nếu site bật lại


// ============================================================
// HELPER – Delay ngẫu nhiên (ms)
// ============================================================
function randomDelay(minMs = 1000, maxMs = 2000) {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

// ============================================================
// STORAGE – đọc cài đặt từ chrome.storage
// ============================================================
function loadSettings() {
  chrome.storage.sync.get({ enabled: true, skipCount: 0 }, (data) => {
    isEnabled = data.enabled;
    skipCount = data.skipCount;
    if (isEnabled && !observerActive) {
      startObserver();
      startInterval();
    } else if (!isEnabled) {
      stopInterval();
    }
  });
}

// ============================================================
// CORE – Tìm và click nút skip
// ============================================================
function trySkip() {
  if (!isEnabled) return false;
  if (pendingSkip) return false; // Đang đợi delay, không queue thêm

  for (var si = 0; si < SKIP_SELECTORS.length; si++) {
    var btn = document.querySelector(SKIP_SELECTORS[si]);
    if (btn && isVisible(btn)) {
      pendingSkip = true;
      // Giảm delay xuống 100-300ms để skip nhanh hơn trên YouTube
      var delay = randomDelay(100, 300);
      console.log('[AutoSkip] ⏳ Phát hiện nút skip, sẽ click sau ' + delay + 'ms...');

      (function(b) {
        setTimeout(function() {
          // Kiểm tra lại nút còn tồn tại sau delay
          if (isEnabled && isVisible(b)) {
            clickElement(b);
            skipCount++;
            saveCount();
            notifyBackground();
          } else {
            console.log('[AutoSkip] ⚠ Nút skip đã biến mất trước khi click.');
          }
          pendingSkip = false;
        }, delay);
      })(btn);

      return true; // Báo đã phát hiện (dù chưa click ngay)
    }
  }
  return false;
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
    // Thử nhiều cách click để đảm bảo hoạt động kể cả khi tab ở nền
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    el.click();
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    console.log('[AutoSkip] ✅ Đã bỏ qua quảng cáo!', el);
  } catch (e) {
    console.error('[AutoSkip] Lỗi click:', e);
  }
}

// Fast-forward quảng cáo không có nút skip (vd: quảng cáo ngắn trên YouTube không skip được)
function tryFastForwardAd() {
  if (!isEnabled) return;
  var adShowing = false;
  for (var i = 0; i < AD_PLAYING_SELECTORS.length; i++) {
    if (document.querySelector(AD_PLAYING_SELECTORS[i])) {
      adShowing = true;
      break;
    }
  }
  if (!adShowing) return;

  var video = document.querySelector(VIDEO_SELECTOR);
  if (video && !video.ended && isFinite(video.duration) && video.duration > 0) {
    // Tua nhanh tức thì đến gần cuối video quảng cáo (chừa 0.1s để YouTube ghi nhận xem xong)
    if (video.currentTime < video.duration - 0.5) {
      var hasSkipBtn = false;
      for (var j = 0; j < SKIP_SELECTORS.length; j++) {
        if (document.querySelector(SKIP_SELECTORS[j])) { hasSkipBtn = true; break; }
      }
      
      if (!hasSkipBtn) {
        console.log('[AutoSkip] ⏩ Tua nhanh quảng cáo video...');
        video.currentTime = video.duration - 0.1;
        video.playbackRate = 16;
        video.muted = true;
      }
    } else {
      // Có nút skip rồi hoặc sắp hết, reset tốc độ
      video.playbackRate = 1;
    }
  }
}

// ============================================================
// CLOSE / HIDE POPUP AD
// ============================================================

// Ẩn vĩnh viễn 1 element và theo dõi nếu site cố show lại
function permanentlyHide(el) {
  function applyHide(e) {
    e.style.setProperty('display',        'none',  'important');
    e.style.setProperty('visibility',     'hidden','important');
    e.style.setProperty('pointer-events', 'none',  'important');
    e.style.setProperty('opacity',        '0',     'important');
  }
  applyHide(el);
  hiddenOverlays.push(el);

  // Theo dõi nếu site cố bật lại qua style/class
  var obs = new MutationObserver(function() { applyHide(el); });
  obs.observe(el, { attributes: true, attributeFilter: ['style','class'] });
  console.log('[AutoSkip] 🔒 Đã khoá ẩn overlay:', el);
}

// Tìm fixed/absolute ancestor gần nhất của 1 element
function findFixedAncestor(el) {
  var cur = el.parentElement;
  for (var i = 0; i < 10 && cur && cur !== document.body; i++, cur = cur.parentElement) {
    var pos = window.getComputedStyle(cur).position;
    if (pos === 'fixed' || pos === 'absolute') return cur;
  }
  return null;
}

// Re-hide các overlay đã biết nếu site bật lại
function reHideKnown() {
  for (var i = 0; i < hiddenOverlays.length; i++) {
    var el = hiddenOverlays[i];
    if (el && window.getComputedStyle(el).display !== 'none') {
      el.style.setProperty('display', 'none', 'important');
    }
  }
}

// Chiến lược 1: Click nút close → sau đó ẩn container cha
function tryClosePopupAd() {
  if (!isEnabled) return false;
  if (pendingClose) return false;

  // Re-hide các overlay đã biết trước
  reHideKnown();

  for (var si = 0; si < CLOSE_BTN_SELECTORS.length; si++) {
    var btn;
    try { btn = document.querySelector(CLOSE_BTN_SELECTORS[si]); } catch(e) { continue; }
    if (!btn || !isVisible(btn)) continue;
    if (!isLikelyAdCloseBtn(btn)) continue;

    // Tìm container fixed ancestor để ẩn luôn
    var container = findFixedAncestor(btn) || btn.parentElement;

    pendingClose = true;
    var delay = randomDelay(1000, 2000);
    console.log('[AutoSkip] ⏳ Phát hiện nút close QC, click sau ' + delay + 'ms', btn);

    (function(b, c) {
      setTimeout(function() {
        if (!isEnabled) { pendingClose = false; return; }
        // Click nút close
        if (isVisible(b)) clickElement(b);
        // Ẩn vĩnh viễn container cha
        if (c) permanentlyHide(c);
        skipCount++;
        saveCount();
        notifyBackground();
        console.log('[AutoSkip] ✅ Đã đóng + khoá popup!');
        pendingClose = false;
      }, delay);
    })(btn, container);

    return true;
  }

  // Chiến lược 2 & 3 – ẩn overlay trực tiếp
  return tryHideAdOverlay();
}


// Chiến lược 2: dùng elementsFromPoint() – lấy element nào đang CHE màn hình
function tryHideAdOverlay() {
  if (!isEnabled) return false;
  if (pendingClose) return false;

  // Kiểm tra nhiều điểm trên màn hình để bắt popup
  var points = [
    [window.innerWidth * 0.5,  window.innerHeight * 0.4],  // Trung tâm
    [window.innerWidth * 0.5,  window.innerHeight * 0.6],
    [window.innerWidth * 0.3,  window.innerHeight * 0.5],
    [window.innerWidth * 0.7,  window.innerHeight * 0.5],
  ];

  var seen = {};

  for (var pi = 0; pi < points.length; pi++) {
    var hits = document.elementsFromPoint(points[pi][0], points[pi][1]);
    for (var hi = 0; hi < hits.length && hi < 8; hi++) {
      var el = hits[hi];
      if (!el || el === document.documentElement || el === document.body) continue;
      if (el.id === '__autoskip_toast__') continue;
      var uid = el.tagName + (el.className || '') + (el.id || '');
      if (seen[uid]) continue;
      seen[uid] = true;

      var st = window.getComputedStyle(el);
      var pos = st.position;
      if (pos !== 'fixed' && pos !== 'absolute') continue;

      var zIdx = parseInt(st.zIndex, 10) || 0;
      if (zIdx < 5) continue;

      if (!isVisible(el)) continue;

      var rect = el.getBoundingClientRect();
      if (rect.width < 80 || rect.height < 80) continue;
      // Bỏ qua thanh nav/footer ở đáy
      if (rect.top > window.innerHeight * 0.85 && rect.height < 120) continue;

      var area = (rect.width * rect.height) / (window.innerWidth * window.innerHeight);
      if (area < 0.03) continue;

      // Tìm nút close bên trong
      var closeBtn = findVisualCloseBtn(el);

      pendingClose = true;
      var delay = randomDelay(1000, 2000);

      (function(overlay, cb) {
        setTimeout(function() {
          if (!isEnabled) { pendingClose = false; return; }
          if (cb && isVisible(cb)) {
            clickElement(cb);
            console.log('[AutoSkip] ✅ Click close (elementsFromPoint):', cb);
          } else {
            overlay.style.setProperty('display', 'none', 'important');
            overlay.style.setProperty('visibility', 'hidden', 'important');
            overlay.style.setProperty('pointer-events', 'none', 'important');
            console.log('[AutoSkip] ✅ Ẩn overlay (elementsFromPoint):', overlay);
          }
          skipCount++;
          saveCount();
          notifyBackground();
          pendingClose = false;
        }, delay);
      })(el, closeBtn);

      return true;
    }
  }
  return false;
}

/**
 * Tìm nút close bên trong overlay hoàn toàn bằng ký tự + vị trí góc.
 * Không dùng class name hay id.
 */
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
    if (r.width > 80 || r.height > 80) continue; // Phải là element nhỏ

    var st = window.getComputedStyle(el);
    var text = (el.textContent || '').trim();
    var hasCursor = st.cursor === 'pointer';
    var isBtn = el.tagName === 'BUTTON' || el.tagName === 'A' ||
                el.getAttribute('role') === 'button' || el.onclick !== null;
    var isCloseText = CLOSE_RE.test(text) && text.length <= 3;

    // Vị trí góc: gần 4 góc của overlay
    var inTopRight = r.right  >= overlayRect.right  - overlayRect.width  * 0.3 &&
                     r.top    <= overlayRect.top     + overlayRect.height * 0.3;
    var inTopLeft  = r.left   <= overlayRect.left    + overlayRect.width  * 0.3 &&
                     r.top    <= overlayRect.top     + overlayRect.height * 0.3;
    var inAnyCorner = inTopRight || inTopLeft;

    var priority = -1;
    if (isCloseText && (hasCursor || isBtn)) priority = 4; // Tốt nhất
    else if (isCloseText && inAnyCorner)    priority = 3;
    else if (inAnyCorner && (hasCursor || isBtn)) priority = 2;
    else if (isCloseText)                   priority = 1;
    else if (inAnyCorner && hasCursor)      priority = 0;

    if (priority > bestPriority) {
      bestPriority = priority;
      best = el;
    }
  }
  return best;
}






/**
 * Kiểm tra xem nút có phải là nút đóng quảng cáo không
 * bằng cách leo lên cây DOM tối đa 6 cấp để tìm từ khóa quảng cáo.
 */
function isLikelyAdCloseBtn(btn) {
  // Text của bản thân nút
  var btnText = (btn.textContent || '').toLowerCase();
  var btnHtml = (btn.outerHTML || '').toLowerCase();


  // Nếu text nút chỉ là ký tự đóng (×, ✕, x) thì leo lên tìm cha
  var isIconOnly = /^[\s×✕✖✘x❌√\*]*$/.test(btnText) || btnText.length <= 3;

  // Kiểm tra bản thân nút có từ khóa ad không
  for (var i0 = 0; i0 < AD_KEYWORDS.length; i0++) {
    if (btnHtml.includes(AD_KEYWORDS[i0])) return true;
  }

  // Leo lên tối đa 8 cấp cha để tìm từ khóa
  if (isIconOnly) {
    var el = btn.parentElement;
    for (var i = 0; i < 8 && el; i++, el = el.parentElement) {
      var info = [
        el.className || '',
        el.id || '',
        (el.getAttribute('data-type') || ''),
        (el.getAttribute('data-ad') || ''),
        (el.getAttribute('href') || ''),
      ].join(' ').toLowerCase();

      for (var j = 0; j < AD_KEYWORDS.length; j++) {
        if (info.includes(AD_KEYWORDS[j])) return true;
      }

      // Kiểm tra vị trí: popup thường fixed/absolute + z-index cao
      var st = window.getComputedStyle(el);
      var zIndex = parseInt(st.zIndex, 10);
      var pos = st.position;
      if ((pos === 'fixed' || pos === 'absolute') && zIndex > 10) {
        return true;
      }

      // Kiểm tra kích thước: popup che nhiều hơn 20% màn hình
      if (pos === 'fixed' || pos === 'absolute') {
        var rect = el.getBoundingClientRect();
        var coverArea = (rect.width * rect.height) / (window.innerWidth * window.innerHeight);
        if (coverArea > 0.15) return true; // che > 15% màn hình
      }
    }
  }

  return false;
}


// ============================================================
// OBSERVER – Theo dõi DOM thay đổi (quan trọng cho SPA như YouTube)
// ============================================================
let mutationObserver = null;

function startObserver() {
  if (observerActive) return;
  observerActive = true;

  mutationObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0 || mutation.attributeName) {
        const skipped = trySkip();
        if (!skipped) tryClosePopupAd();
        if (!skipped) tryFastForwardAd();
      }
    }
  });

  mutationObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'aria-label'],
  });

  console.log('[AutoSkip] 👁 MutationObserver đang chạy.');
}

// ============================================================
// INTERVAL – Kiểm tra định kỳ (backup cho trường hợp observer bị miss)
// ============================================================
function startInterval() {
  if (checkInterval) return;
  checkInterval = setInterval(() => {
    if (!isContextValid()) { safeStop(); return; }
    const skipped = trySkip();
    if (!skipped) tryClosePopupAd();
    if (!skipped) tryFastForwardAd();
  }, 300); // Kiểm tra mỗi 300ms
}

function stopInterval() {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
}

// ============================================================
// KIỂM TRA CONTEXT HỢP LỆ
// ============================================================
function isContextValid() {
  try {
    // chrome.runtime.id bị undefined khi extension bị reload/invalidate
    return !!(chrome && chrome.runtime && chrome.runtime.id);
  } catch (e) {
    return false;
  }
}

function safeStop() {
  // Tự dừng khi context bị hủy – tránh lỗi "Extension context invalidated"
  stopInterval();
  try {
    if (mutationObserver) mutationObserver.disconnect();
    if (navObserver) navObserver.disconnect();
  } catch(e) {}
  observerActive = false;
}

// ============================================================
// THÔNG BÁO
// ============================================================
function saveCount() {
  if (!isContextValid()) return;
  try { chrome.storage.sync.set({ skipCount: skipCount }); } catch(e) {}
}

function notifyBackground() {
  if (!isContextValid()) return;
  try {
    chrome.runtime.sendMessage({ type: 'AD_SKIPPED', count: skipCount });
  } catch (e) {}
}

// ============================================================
// LẮNG NGHE THAY ĐỔI TỪ POPUP / BACKGROUND
// ============================================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SET_ENABLED') {
    isEnabled = message.enabled;
    if (isEnabled) {
      startObserver();
      startInterval();
    } else {
      stopInterval();
      // Reset video speed nếu đang tua nhanh
      const video = document.querySelector('video');
      if (video) video.playbackRate = 1;
    }
    // Hiện toast thông báo
    showToast(isEnabled);
    sendResponse({ ok: true });
  }
  if (message.type === 'GET_STATUS') {
    sendResponse({ enabled: isEnabled, skipCount });
  }
  return true;
});

// ============================================================
// TOAST NOTIFICATION
// ============================================================
function showToast(enabled) {
  const existing = document.getElementById('__autoskip_toast__');
  if (existing) existing.remove();

  const wrap = document.createElement('div');
  wrap.id = '__autoskip_toast__';
  wrap.style.cssText = [
    'position:fixed', 'bottom:28px', 'right:28px',
    'z-index:2147483647', 'pointer-events:none', 'user-select:none',
  ].join(';');

  wrap.innerHTML = `
    <div id="__autoskip_toast_inner__" style="
      display:flex; align-items:center; gap:12px;
      padding:14px 20px; border-radius:14px;
      background:${ enabled
        ? 'linear-gradient(135deg,rgba(0,198,255,.15),rgba(123,47,247,.25))'
        : 'rgba(20,20,35,.93)' };
      border:1px solid ${ enabled ? 'rgba(123,47,247,.5)' : 'rgba(255,255,255,.1)' };
      backdrop-filter:blur(16px); -webkit-backdrop-filter:blur(16px);
      box-shadow:0 8px 32px rgba(0,0,0,.5)${ enabled ? ',0 0 20px rgba(123,47,247,.3)' : '' };
      font-family:Inter,-apple-system,sans-serif;
      animation:__as_in .3s cubic-bezier(.4,0,.2,1) forwards;
    ">
      <span style="font-size:20px">${ enabled ? '⚡' : '⏸' }</span>
      <div>
        <div style="font-size:13px;font-weight:700;color:${ enabled ? '#00c6ff' : '#9da8c0' }">
          AutoSkip ${ enabled ? 'ĐÃ BẬT' : 'ĐÃ TẮT' }
        </div>
        <div style="font-size:11px;font-weight:400;color:#9da8c0;margin-top:2px">
          ${ enabled ? 'Đang tự động bỏ qua quảng cáo' : 'Nhấn icon để bật lại' }
        </div>
      </div>
    </div>
  `;

  const style = document.createElement('style');
  style.textContent = `
    @keyframes __as_in  { from{opacity:0;transform:translateY(16px) scale(.95)} to{opacity:1;transform:translateY(0) scale(1)} }
    @keyframes __as_out { from{opacity:1;transform:translateY(0) scale(1)} to{opacity:0;transform:translateY(16px) scale(.95)} }
  `;
  document.head.appendChild(style);
  document.body.appendChild(wrap);

  setTimeout(() => {
    const inner = document.getElementById('__autoskip_toast_inner__');
    if (inner) inner.style.animation = '__as_out .3s cubic-bezier(.4,0,.2,1) forwards';
    setTimeout(() => wrap.remove(), 350);
  }, 2500);
}

// ============================================================
// KHỞI ĐỘNG
// ============================================================
loadSettings();

// Khởi động lại khi trang SPA navigate (YouTube dùng pushState)
var lastUrl = location.href;
var navObserver = new MutationObserver(function() {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    setTimeout(() => {
      pendingSkip = false; // Reset khi navigate trang mới
      trySkip();
      tryFastForwardAd();
    }, 500);
  }
});
navObserver.observe(document, { subtree: true, childList: true });

})(); // đóng IIFE
