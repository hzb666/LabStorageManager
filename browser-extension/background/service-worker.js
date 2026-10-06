// 购物车同步 - Service Worker
// 处理跨标签页通信和后端API调用

importScripts('cart-tab-selection.js');
importScripts('../shared/generated-config.js');
importScripts('../shared/site-config.js');

const CART_IMPORT_PATH = '/cart-import';
const IMPORT_BRIDGE_FILE = 'content/import-bridge.js';
const cartTabActivityById = Object.create(null);

const { isCartPageUrl, selectPreferredCartTab } = globalThis.CartTabSelection;
const {
  DEFAULT_SYSTEM_CONFIG,
  buildSiteUrlPattern,
} = globalThis.ExtensionSiteConfig;
let trackedCartUrlPattern = null;

// 监听来自popup或内容脚本的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CHECK_TARGET_TAB') {
    resolveCartTab()
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

function isSystemCartImportUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.origin === DEFAULT_SYSTEM_CONFIG.systemUrl
      && parsed.pathname === CART_IMPORT_PATH
      && parsed.searchParams.get('import') === 'true';
  } catch {
    return false;
  }
}

function injectImportBridge(tabId) {
  chrome.scripting.executeScript({
    target: { tabId },
    files: [IMPORT_BRIDGE_FILE],
  }).catch((error) => {
    console.error('[Background] 注入导入桥接脚本失败:', error);
  });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    if (isCartPageUrl(changeInfo.url)) {
      cartTabActivityById[tabId] = Date.now();
    } else {
      delete cartTabActivityById[tabId];
    }
  }

  if (changeInfo.status === 'complete' && isSystemCartImportUrl(tab?.url)) {
    injectImportBridge(tabId);
  }
});

function syncCartRequestTracking() {
  const nextPattern = buildSiteUrlPattern(DEFAULT_SYSTEM_CONFIG.reagentSiteUrl);

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
  const tabs = await chrome.tabs.query({ url: buildSiteUrlPattern(DEFAULT_SYSTEM_CONFIG.reagentSiteUrl) });
  return selectPreferredCartTab(tabs, cartTabActivityById);
}

syncCartRequestTracking();
