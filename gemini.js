/**
 * AutoSkip – Gemini AI Module
 * Giao tiếp với Gemini API để nhận diện quảng cáo chính xác.
 * Được import bởi background.js (ES module).
 */

// ============================================================
// CẤU HÌNH
// ============================================================
const GEMINI_MODEL_TEXT  = 'gemini-3.5-flash-lite';
const GEMINI_MODEL_IMAGE = 'gemini-3.5-flash';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// Rate limiting
const MAX_REQUESTS_PER_MIN = 8; // Giảm xuống 8 cho an toàn (free tier 15 RPM)
let requestTimestamps = [];
let backoffUntil = 0;

// Cache kết quả (key: hash of input → value: result)
const classifyCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 phút

// ============================================================
// HELPERS
// ============================================================
function isRateLimited() {
  const now = Date.now();
  if (now < backoffUntil) {
    return true;
  }
  requestTimestamps = requestTimestamps.filter(t => now - t < 60000);
  return requestTimestamps.length >= MAX_REQUESTS_PER_MIN;
}

function recordRequest() {
  requestTimestamps.push(Date.now());
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return String(hash);
}

function getCached(key) {
  const entry = classifyCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.time > CACHE_TTL) {
    classifyCache.delete(key);
    return null;
  }
  return entry.result;
}

function setCache(key, result) {
  classifyCache.set(key, { result, time: Date.now() });
  // Giới hạn cache size
  if (classifyCache.size > 200) {
    const first = classifyCache.keys().next().value;
    classifyCache.delete(first);
  }
}

async function getApiKey() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ geminiApiKey: '' }, (data) => {
      resolve(data.geminiApiKey || '');
    });
  });
}

// ============================================================
// GỌI GEMINI API
// ============================================================
async function callGemini(model, contents, apiKey) {
  if (!apiKey) {
    console.warn('[AutoSkip AI] Chưa có API key.');
    return null;
  }

  if (isRateLimited()) {
    const waitTime = backoffUntil > Date.now() ? Math.ceil((backoffUntil - Date.now())/1000) : 'vài';
    console.warn(`[AutoSkip AI] Rate limited, bỏ qua. (Chờ ${waitTime}s)`);
    return null;
  }

  recordRequest();

  const url = `${API_BASE}/${model}:generateContent?key=${apiKey}`;
  const MAX_RETRIES = 2;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: contents }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 100,
            responseMimeType: 'application/json',
          },
        }),
      });

      if (!response.ok) {
        if (response.status === 429) {
          console.warn('[AutoSkip AI] ⚠️ Bị giới hạn API (429), tạm dừng gửi request trong 60s.');
          backoffUntil = Date.now() + 60000;
          return null;
        }
        if (response.status === 503 && attempt < MAX_RETRIES) {
          const waitMs = (attempt + 1) * 3000; // 3s, 6s
          console.warn(`[AutoSkip AI] ⏳ Server quá tải (503), thử lại sau ${waitMs/1000}s... (lần ${attempt + 1}/${MAX_RETRIES})`);
          await new Promise(r => setTimeout(r, waitMs));
          continue; // Thử lại
        }
        if (response.status === 503) {
          console.warn('[AutoSkip AI] ⚠️ Server vẫn quá tải sau khi thử lại, tạm dừng 30s.');
          backoffUntil = Date.now() + 30000;
          return null;
        }
        const errText = await response.text();
        console.error('[AutoSkip AI] API error:', response.status, errText);
        return null;
      }

      const data = await response.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

      try {
        return JSON.parse(text);
      } catch {
        console.warn('[AutoSkip AI] Không parse được JSON:', text);
        return null;
      }
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        console.warn(`[AutoSkip AI] ⏳ Lỗi mạng, thử lại... (lần ${attempt + 1}/${MAX_RETRIES})`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      console.error('[AutoSkip AI] Fetch error:', err);
      return null;
    }
  }
  return null;
}

// ============================================================
// PHÂN LOẠI BẰNG TEXT
// ============================================================
export async function classifyByText(info) {
  const apiKey = await getApiKey();
  if (!apiKey) return { isAd: false, confidence: 0, reason: 'no_api_key' };

  // Tạo cache key
  const cacheKey = simpleHash(JSON.stringify(info));
  const cached = getCached(cacheKey);
  if (cached) {
    console.log('[AutoSkip AI] Cache hit (text):', cached);
    return cached;
  }

  const prompt = `Bạn là trình phát hiện quảng cáo. Phân tích thông tin element web sau và xác định đây có phải popup/overlay quảng cáo hay không.

Thông tin element:
- Tag: ${info.tag || 'N/A'}
- Classes: ${info.classes || 'N/A'}
- ID: ${info.id || 'N/A'}
- Nguồn (src): ${info.src || 'N/A'}
- Text bên trong (100 ký tự đầu): ${(info.text || '').substring(0, 100)}
- CSS position: ${info.position || 'N/A'}
- Z-index: ${info.zIndex || 'N/A'}
- Kích thước: ${info.width || '?'}x${info.height || '?'}
- URL trang: ${info.pageUrl || 'N/A'}

Quảng cáo thường là: popup nhà cái (UK88, RED88, bet...), banner khuyến mãi, overlay che nội dung chính.
KHÔNG PHẢI quảng cáo: menu điều hướng, header, footer, sidebar, modal đăng nhập, cookie consent, video player.

Trả lời JSON: {"isAd": true/false, "confidence": 0.0-1.0}`;

  const result = await callGemini(GEMINI_MODEL_TEXT, [{ text: prompt }], apiKey);

  if (result && typeof result.isAd === 'boolean') {
    setCache(cacheKey, result);
    console.log('[AutoSkip AI] Text classify:', result);
    return result;
  }

  return { isAd: false, confidence: 0, reason: 'api_error' };
}

// ============================================================
// PHÂN LOẠI BẰNG ẢNH
// ============================================================
export async function classifyByImage(base64Image) {
  const apiKey = await getApiKey();
  if (!apiKey) return { isAd: false, confidence: 0, reason: 'no_api_key' };

  const cacheKey = simpleHash(base64Image.substring(0, 200));
  const cached = getCached(cacheKey);
  if (cached) {
    console.log('[AutoSkip AI] Cache hit (image):', cached);
    return cached;
  }

  const prompt = `Đây có phải screenshot của popup/overlay quảng cáo trên website không?
Quảng cáo thường là: popup nhà cái, banner khuyến mãi, overlay che nội dung.
KHÔNG PHẢI quảng cáo: nội dung trang web, menu, video player, form đăng nhập.

Trả lời JSON: {"isAd": true/false, "confidence": 0.0-1.0}`;

  const result = await callGemini(GEMINI_MODEL_IMAGE, [
    { text: prompt },
    { inlineData: { mimeType: 'image/png', data: base64Image } },
  ], apiKey);

  if (result && typeof result.isAd === 'boolean') {
    setCache(cacheKey, result);
    console.log('[AutoSkip AI] Image classify:', result);
    return result;
  }

  return { isAd: false, confidence: 0, reason: 'api_error' };
}

// ============================================================
// PHÂN LOẠI URL (cho tab mới mở)
// ============================================================
export async function classifyUrl(urlInfo) {
  const apiKey = await getApiKey();
  if (!apiKey) return { isAd: false, confidence: 0, reason: 'no_api_key' };

  const cacheKey = simpleHash(urlInfo.url || '');
  const cached = getCached(cacheKey);
  if (cached) {
    console.log('[AutoSkip AI] Cache hit (url):', cached);
    return cached;
  }

  const prompt = `Phân tích URL sau và xác định đây có phải trang quảng cáo/spam redirect không.

URL mới mở: ${urlInfo.url}
Mở từ trang: ${urlInfo.openerUrl}
Title tab mới: ${urlInfo.title || 'N/A'}

Quảng cáo: trang nhà cái, cá cược, casino, landing page spam, redirect quảng cáo.
KHÔNG PHẢI quảng cáo: trang web hợp lệ user chủ động mở, link nội bộ, social media, trang tin tức.

Trả lời JSON: {"isAd": true/false, "confidence": 0.0-1.0}`;

  const result = await callGemini(GEMINI_MODEL_TEXT, [{ text: prompt }], apiKey);

  if (result && typeof result.isAd === 'boolean') {
    setCache(cacheKey, result);
    console.log('[AutoSkip AI] URL classify:', result);
    return result;
  }

  return { isAd: false, confidence: 0, reason: 'api_error' };
}
