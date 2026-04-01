// 购物车同步 - Service Worker
// 处理跨标签页通信和后端API调用

importScripts('cart-tab-selection.js');
importScripts('../shared/site-config.js');

const REQUEST_TIMEOUT_MS = 15000;
const cartTabActivityById = Object.create(null);

const { isCartPageUrl, selectPreferredCartTab } = globalThis.CartTabSelection;
const {
  DEFAULT_SYSTEM_CONFIG,
  SYSTEM_CONFIG_STORAGE_KEY,
  buildProductDetailUrl,
  buildSiteUrlPattern,
  normalizeExtensionConfig,
} = globalThis.ExtensionSiteConfig;
let trackedCartUrlPattern = null;

console.log('[Background] Service Worker 加载中...');

// 监听来自popup或内容脚本的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Background] 收到消息:', message.type);

  if (message.type === 'GET_CART_DATA') {
    getCartDataFromTargetSite()
      .then(data => {
        console.log('[Background] GET_CART_DATA 成功:', data);
        sendResponse({ success: true, data });
      })
      .catch(error => {
        console.error('[Background] GET_CART_DATA 失败:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (message.type === 'CHECK_TARGET_TAB') {
    checkTargetTab()
      .then(tab => sendResponse({ success: true, exists: !!tab, tabId: tab?.id }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'RESOLVE_CART_TAB') {
    resolveCartTab()
      .then((tab) => sendResponse({ success: true, tab: tab || null }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  sendResponse({ success: false, error: '未知消息类型' });
  return false;
});

function trackCartTabActivity(details) {
  if (!Number.isInteger(details.tabId) || details.tabId < 0) {
    return;
  }

  chrome.tabs.get(details.tabId, (tab) => {
    if (chrome.runtime.lastError || !isCartPageUrl(tab?.url)) {
      return;
    }

    cartTabActivityById[details.tabId] = Date.now();
  });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  delete cartTabActivityById[tabId];
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) {
    return;
  }

  if (isCartPageUrl(changeInfo.url)) {
    cartTabActivityById[tabId] = Date.now();
    return;
  }

  delete cartTabActivityById[tabId];
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes[SYSTEM_CONFIG_STORAGE_KEY]) {
    return;
  }

  void syncCartRequestTracking();
});

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timerId = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    globalThis.clearTimeout(timerId);
  }
}

async function getSystemConfig() {
  const data = await chrome.storage.local.get([SYSTEM_CONFIG_STORAGE_KEY]);
  return normalizeExtensionConfig(
    data?.[SYSTEM_CONFIG_STORAGE_KEY],
    DEFAULT_SYSTEM_CONFIG
  );
}

async function syncCartRequestTracking() {
  const config = await getSystemConfig();
  const nextPattern = buildSiteUrlPattern(config.reagentSiteUrl);

  if (
    trackedCartUrlPattern === nextPattern &&
    chrome.webRequest.onBeforeRequest.hasListener(trackCartTabActivity)
  ) {
    return;
  }

  if (chrome.webRequest.onBeforeRequest.hasListener(trackCartTabActivity)) {
    chrome.webRequest.onBeforeRequest.removeListener(trackCartTabActivity);
  }

  chrome.webRequest.onBeforeRequest.addListener(
    trackCartTabActivity,
    { urls: [nextPattern] }
  );
  trackedCartUrlPattern = nextPattern;
}

async function resolveCartTab() {
  const config = await getSystemConfig();
  const tabs = await chrome.tabs.query({ url: buildSiteUrlPattern(config.reagentSiteUrl) });
  return selectPreferredCartTab(tabs, cartTabActivityById);
}

// 从目标网站获取购物车数据
async function getCartDataFromTargetSite() {
  console.log('[Background] 开始获取购物车数据...');

  const targetTab = await resolveCartTab();
  console.log('[Background] 目标标签页:', targetTab);

  if (!targetTab) {
    throw new Error('请先打开试剂平台的购物车页面');
  }

  console.log('[Background] 向内容脚本发送消息...');
  const response = await chrome.tabs.sendMessage(targetTab.id, { action: 'GET_CART' });
  console.log('[Background] 内容脚本响应:', response);

  if (!response?.success) {
    throw new Error(response?.error || '获取购物车数据失败');
  }

  const cartItems = response.data;
  console.log('[Background] 购物车数据:', cartItems);

  if (!cartItems || cartItems.length === 0) {
    return [];
  }

  // 获取每个产品的详情
  const items = [];
  for (const cartItem of cartItems) {
    console.log('[Background] 获取产品详情:', cartItem.productId);
    try {
      const detail = await fetchProductDetail(cartItem.productId);
      if (detail) {
        detail.quantity = cartItem.quantity;
        items.push(detail);
        console.log('[Background] 产品详情获取成功:', detail.name);
      }
    } catch (error) {
      console.error('[Background] 获取产品详情失败:', cartItem.productId, error);
    }
  }

  console.log('[Background] 最终商品列表:', items);
  return items;
}

// 获取产品详情
async function fetchProductDetail(productId) {
  const config = await getSystemConfig();
  const url = buildProductDetailUrl(config.reagentSiteUrl, productId);
  console.log('[Background] 请求详情页:', url);

  try {
    // 使用fetch需要目标网站在host_permissions中
    const response = await fetchWithTimeout(url);
    console.log('[Background] 详情页响应状态:', response.status);

    if (!response.ok) {
      console.log('[Background] HTTP错误，返回基本信息');
      return createBasicItem(productId, config.reagentSiteUrl);
    }

    const html = await response.text();
    console.log('[Background] 详情页HTML长度:', html.length);

    const detail = parseProductDetail(html, productId, config.reagentSiteUrl);
    console.log('[Background] 解析结果:', detail);
    return detail;
  } catch (error) {
    console.error('[Background] 请求失败:', error);
    return createBasicItem(productId, config.reagentSiteUrl);
  }
}

// 创建基本信息
function createBasicItem(productId, reagentSiteUrl) {
  return {
    name: `查看产品详情`,
    english_name: '',
    specification: '',
    quantity: 1,
    price: 0,
    brand: '',
    cas_number: '',
    alias: '',
    product_id: productId,
    detail_url: buildProductDetailUrl(reagentSiteUrl, productId)
  };
}

function matchFirstGroup(html, pattern) {
  return html.match(pattern)?.[1]?.trim() || '';
}

// 解析产品详情页面
function parseProductDetail(html, productId, reagentSiteUrl) {
  let name = '';
  const liMatches = html.match(/<li[^>]*>[^<]*中文名称[^<]*<[^>]*>([^<]+)<\/li>/gi);
  if (liMatches?.length) {
    name = liMatches[0].match(/>([^<]+)<\/li>/)?.[1]?.trim() || '';
  }

  if (!name) {
    name = html.match(/<title>([^<]+)<\/title>/i)?.[1]?.split('-')[0]?.trim() || '';
  }

  const englishName = matchFirstGroup(html, /英文名称[^:]*[:：][^<]*<[^>]*>([^<]+)</i);
  const casNumber = matchFirstGroup(html, /casno[：:]\s*(\d{2,7}-\d{2}-\d)/i);
  const purity = matchFirstGroup(html, /纯度[^:]*[:：][^<]*<[^>]*>([^<]+)</i);
  const price = Number.parseFloat(
    html.match(/单价[^:]*[:：][^¥￥]*[¥￥]?\s*(\d+\.?\d*)/i)?.[1] || '0'
  ) || 0;

  let brand = matchFirstGroup(html, /品牌[^:]*[:：][^<]*<[^>]*>([^<]+)</i);
  if (!brand) {
    brand = matchFirstGroup(html, /供货商[^:]*[:：][^<]*<[^>]*>([^<]+)</i);
  }

  const rawSpecification = matchFirstGroup(html, /包装规格[^:]*[:：][^<]*<[^>]*>([^<]+)</i);
  const specification = rawSpecification || purity;

  return {
    name: name || `产品ID: ${productId}`,
    english_name: englishName || '',
    specification: specification || '',
    quantity: 1,
    price: price,
    brand: brand || '',
    cas_number: casNumber || '',
    alias: '',
    product_id: productId,
    detail_url: buildProductDetailUrl(reagentSiteUrl, productId)
  };
}

// 检查目标标签页
async function checkTargetTab() {
  return resolveCartTab();
}

void syncCartRequestTracking();

console.log('[Background] Service Worker 加载完成');
