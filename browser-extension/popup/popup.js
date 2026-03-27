// 购物车同步 - Popup Script
// 直接与内容脚本通信，不依赖 service worker

const STORAGE_KEYS = {
  CART_ITEMS: 'pendingCartItems',
  IMPORT_BATCH_LATEST: 'import_batch_latest',
  SYSTEM_CONFIG: 'systemConfig',
};

const DEFAULT_SYSTEM_CONFIG = {
  // 开发环境默认（会自动检测当前打开的页面）
  systemUrl: 'http://localhost:5173',
  reagentSiteUrl: 'https://reagent.bjmu.edu.cn',
};

let systemConfig = { ...DEFAULT_SYSTEM_CONFIG };
const orderTypeDetectionApi = globalThis.OrderTypeDetection;
if (!orderTypeDetectionApi) {
  throw new Error('订单类型识别模块加载失败');
}
const {
  detectOrderClassification,
  extractFieldByLabels,
  extractLeadingSpecificationValue,
  normalizePageText,
} = orderTypeDetectionApi;

const BATCH_TTL_MS = 2 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15000;
const DETAIL_FETCH_CONCURRENCY = 3;
const DETAIL_REQUEST_TIMEOUT_MS = 3000;

function isNoReceiverError(error) {
  return String(error?.message || '').includes('Receiving end does not exist');
}

async function sendMessageWithAutoInject(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    if (!isNoReceiverError(error)) {
      throw error;
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/script.js'],
    });

    return await chrome.tabs.sendMessage(tabId, message);
  }
}

async function sendRuntimeMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.success) {
    throw new Error(response?.error || '扩展后台通信失败');
  }
  return response;
}

function isCartPageUrl(url) {
  const pageParamRegex = /[?&]page=gwc/i;
  return pageParamRegex.test(url || '');
}

async function resolveSystemUrl() {
  return systemConfig.systemUrl;
}

function parseHttpUrl(urlValue) {
  try {
    const parsed = new URL(urlValue);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null;
    }
    if (!parsed.hostname) {
      return null;
    }
    if (parsed.username || parsed.password) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timerId = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    globalThis.clearTimeout(timerId);
  }
}

async function mapWithConcurrencyLimit(items, limit, mapper) {
  const results = new Array(items.length).fill(null);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      const item = items[currentIndex];
      const mapped = await mapper(item, currentIndex);
      results[currentIndex] = mapped ?? null;
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results.filter((item) => item !== null);
}

function generateBatchId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

async function cleanupExpiredBatches() {
  const data = await chrome.storage.local.get([STORAGE_KEYS.IMPORT_BATCH_LATEST]);
  const payload = data?.[STORAGE_KEYS.IMPORT_BATCH_LATEST];
  if (!payload) {
    return;
  }

  const createdAt = payload?.created_at ? Date.parse(payload.created_at) : Number.NaN;
  if (Number.isNaN(createdAt) || Date.now() - createdAt > BATCH_TTL_MS) {
    await chrome.storage.local.remove([STORAGE_KEYS.IMPORT_BATCH_LATEST]);
  }
}

function createBasicItem(productId, detailFetchStatus = 'fallback') {
  return {
    name: '未知',
    english_name: '',
    specification: '',
    quantity: 1,
    price: 0,
    brand: '',
    cas_number: '',
    alias: '',
    product_number: '',
    product_id: productId || '',
    detail_url: '',
    is_hazardous: false,
    detail_fetch_status: detailFetchStatus,
    suggested_order_type: 'consumable',
    classification_reason: '未识别到详情页信息，默认归为耗材',
  };
}

function isTimeoutError(error) {
  return error?.name === 'AbortError';
}

async function saveCartItemsToStorage(items) {
  const data = {
    items,
    orderType: 'mixed',
    timestamp: Date.now(),
  };
  await chrome.storage.local.set({ [STORAGE_KEYS.CART_ITEMS]: data });
}

async function saveImportBatch(items) {
  await cleanupExpiredBatches();

  const batchId = generateBatchId();
  const normalizedItems = items.map((item) => {
    const classification = detectOrderClassification(item);
    return {
      ...item,
      cas_number: classification.cas_number || item.cas_number || '',
      suggested_order_type: classification.suggested_order_type,
      order_type: classification.order_type,
      classification_reason: classification.classification_reason,
      selected: true,
    };
  });

  const payload = {
    batch_id: batchId,
    items: normalizedItems,
    created_at: new Date().toISOString(),
  };

  // 使用单一 key 覆盖旧批次，避免长期累积。
  await chrome.storage.local.set({ [STORAGE_KEYS.IMPORT_BATCH_LATEST]: payload });
  return batchId;
}

function sanitizeExtractedValue(value) {
  return String(value || '')
    .replaceAll('\u00a0', ' ')
    .replace(/^\s*[:：-]\s*/, '')
    .trim();
}

function extractFieldFromHtml(html, pattern) {
  const match = pattern.exec(html);
  return sanitizeExtractedValue(match?.[1] || '');
}

function extractFieldFromLines(pageText, labels) {
  return extractFieldByLabels(pageText, labels);
}

function parseProductDetail(html) {
  const pageText = normalizePageText(html);
  // 表格结构固定，直接匹配 td-2 中的内容
  // 注意：</td> 和 <td> 之间可能有换行和空格
  const name = extractFieldFromHtml(html, /中文名称：<\/td>[\s\S]*?<td[^>]*>([^<]*)<\/td>/) || '未知';
  const englishName = extractFieldFromHtml(html, /英文名称：<\/td>[\s\S]*?<td[^>]*>([^<]*)<\/td>/) || '';
  const brand = extractFieldFromHtml(html, /品牌：<\/td>[\s\S]*?<td[^>]*>([^<]*)<\/td>/) || '';
  const specificationRaw = extractFieldFromHtml(html, /包装规格：<\/td>[\s\S]*?<td[^>]*>([^<]*)<\/td>/) || '';
  const productNumber =
    extractFieldFromHtml(html, /货号：<\/td>[\s\S]*?<td[^>]*>([^<]*)<\/td>/) ||
    extractFieldFromLines(pageText, ['货号', '产品编号', '订货号']) ||
    '';
  const classification = detectOrderClassification({
    name,
    english_name: englishName,
    specification: specificationRaw,
    brand,
    product_number: productNumber,
    detail_text: pageText,
    detail_html: html,
  });

  const specification = extractLeadingSpecificationValue(specificationRaw, {
    ignoreLeadingLetters: classification.suggested_order_type === 'reagent',
  });

  return {
    name: name.trim(),
    english_name: englishName.trim(),
    specification: specification.trim(),
    brand: brand.trim(),
    cas_number: classification.cas_number,
    product_number: productNumber.trim(),
    alias: '',
    suggested_order_type: classification.suggested_order_type,
    classification_reason: classification.classification_reason,
  };
}

async function findCartTab() {
  const response = await sendRuntimeMessage({ type: 'RESOLVE_CART_TAB' });
  return response.tab || null;
}

async function fetchProductDetail(detailUrl) {
  if (!detailUrl) {
    return createBasicItem('', 'missing_url');
  }

  try {
    const response = await fetchWithTimeout(detailUrl, {}, DETAIL_REQUEST_TIMEOUT_MS);
    if (!response.ok) {
      return createBasicItem('', 'http_error');
    }
    const html = await response.text();
    return {
      ...parseProductDetail(html),
      detail_fetch_status: 'success',
    };
  } catch (error) {
    console.error('[Popup] 获取详情页失败:', error);
    if (isTimeoutError(error)) {
      return createBasicItem('', 'timeout');
    }
    return createBasicItem('', 'error');
  }
}

async function loadSystemConfig() {
  try {
    const data = await chrome.storage.local.get([STORAGE_KEYS.SYSTEM_CONFIG]);
    if (data?.[STORAGE_KEYS.SYSTEM_CONFIG]) {
      systemConfig = { ...DEFAULT_SYSTEM_CONFIG, ...data[STORAGE_KEYS.SYSTEM_CONFIG] };
    }
  } catch (error) {
    console.warn('[Popup] 加载配置失败，使用默认配置:', error);
  }
}

async function getSiteTheme() {
  try {
    const targetTab = await findCartTab();
    if (!targetTab?.id) {
      return null;
    }
    const response = await sendMessageWithAutoInject(targetTab.id, { action: 'GET_THEME' });
    return response?.success ? response.data : null;
  } catch (error) {
    console.warn('[Popup] 获取网站主题失败:', error);
    return null;
  }
}

// 动态注入脚本检测系统主题（用户自定义域名）
async function getSystemTheme() {
  try {
    // 查找系统 URL 对应的标签页
    const tabs = await chrome.tabs.query({ url: `${systemConfig.systemUrl}/*` });
    const targetTab = tabs?.[0];
    if (!targetTab?.id) {
      return null;
    }

    // 动态注入脚本获取主题 - 只读取 localStorage
    const results = await chrome.scripting.executeScript({
      target: { tabId: targetTab.id },
      func: () => {
        const appUiRaw = localStorage.getItem('app-ui');
        if (!appUiRaw) {
          return null;
        }

        try {
          const appUi = JSON.parse(appUiRaw);
          const appUiTheme = appUi?.theme;
          if (appUiTheme === 'dark') {
            return { darkMode: true };
          }
          if (appUiTheme === 'light') {
            return { darkMode: false };
          }
        } catch {
          // ignore malformed app-ui
        }
        return null;
      }
    });

    if (results?.[0]?.result) {
      return results[0].result;
    }
    return null;
  } catch (error) {
    console.warn('[Popup] 获取系统主题失败:', error);
    return null;
  }
}

// 立即初始化，避免 DOMContentLoaded 不触发
(async function init() {
  await loadSystemConfig();

  const mainSection = document.getElementById('mainSection');
  const previewSection = document.getElementById('previewSection');
  const configSection = document.getElementById('configSection');
  const fetchBtn = document.getElementById('fetchBtn');
  const targetStatus = document.getElementById('targetStatus');
  const result = document.getElementById('result');
  const itemList = document.getElementById('itemList');
  const previewCount = document.getElementById('previewCount');
  const selectAll = document.getElementById('selectAll');
  const backBtn = document.getElementById('backBtn');
  const importBtn = document.getElementById('importBtn');
  const configBtn = document.getElementById('configBtn');
  const configBackBtn = document.getElementById('configBackBtn');
  const configSaveBtn = document.getElementById('configSaveBtn');
  const systemUrlInput = document.getElementById('systemUrl');
  const reagentSiteUrlInput = document.getElementById('reagentSiteUrl');
  const siteThemeStatus = document.getElementById('siteThemeStatus');

  let cartItems = [];

  async function checkTargetStatus() {
    try {
      const targetTab = await findCartTab();
      if (targetTab) {
        targetStatus.textContent = '已连接';
        targetStatus.className = 'badge badge-success';
        fetchBtn.disabled = false;
        return targetTab;
      }

      targetStatus.textContent = '请先打开购物车页面';
      targetStatus.className = 'badge badge-warning';
      fetchBtn.disabled = true;
      return null;
    } catch (error) {
      console.error('[Popup] 检查失败:', error);
      targetStatus.textContent = '检查失败';
      targetStatus.className = 'badge badge-error';
      fetchBtn.disabled = true;
      return null;
    }
  }

  function renderItems() {
    itemList.innerHTML = '';

    cartItems.forEach((item, index) => {
      const card = document.createElement('div');
      card.className = 'item-card selected';
      card.dataset.index = String(index);

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'checkbox';
      checkbox.checked = true;

      // 卡片任意区域点击均可切换选中状态
      card.addEventListener('click', (e) => {
        // 如果点击的是标题链接，不触发切换
        if (e.target.closest('a')) return;

        // 如果点击的不是复选框本身，则手动切换复选框的状态
        if (e.target !== checkbox) {
          checkbox.checked = !checkbox.checked;
        }

        card.classList.toggle('selected', checkbox.checked);
        updateCount();
      });

      const nameDiv = document.createElement('div');
      nameDiv.className = 'item-name';
      if (item.detail_url) {
        const link = document.createElement('a');
        link.href = item.detail_url;
        link.target = '_blank';
        link.textContent = item.name || '查看详情';
        nameDiv.appendChild(link);
      } else {
        nameDiv.textContent = item.name || '未知商品';
      }

      const header = document.createElement('div');
      header.className = 'item-header';
      header.appendChild(checkbox);
      header.appendChild(nameDiv);

      const body = document.createElement('div');
      body.className = 'item-body';
      const bodyText = document.createElement('span');
      bodyText.className = 'item-body-text';
      bodyText.textContent = item.cas_number ? `CAS: ${item.cas_number}` : 'CAS: 无CAS';
      body.appendChild(bodyText);

      if (item.detail_fetch_status === 'timeout') {
        const timeoutBadge = document.createElement('span');
        timeoutBadge.className = 'item-status-badge item-status-timeout';
        timeoutBadge.textContent = '超时';
        body.appendChild(timeoutBadge);
      }

      card.appendChild(header);
      card.appendChild(body);
      itemList.appendChild(card);
    });
  }

  function updateCount() {
    const checked = itemList.querySelectorAll('.item-card.selected').length;
    const timeoutCount = cartItems.filter((item) => item.detail_fetch_status === 'timeout').length;
    const timeoutText = timeoutCount > 0 ? ` · ${timeoutCount} 项详情超时` : '';
    previewCount.textContent = `已选择 ${checked} / ${cartItems.length} 项${timeoutText}`;
    importBtn.textContent = `开始导入 (${checked})`;
    importBtn.disabled = checked === 0;
  }

  function toggleSelectAll() {
    const checked = selectAll.checked;
    itemList.querySelectorAll('.item-card').forEach((card) => {
      const checkbox = card.querySelector('.checkbox');
      if (checkbox) {
        checkbox.checked = checked;
      }
      card.classList.toggle('selected', checked);
    });
    updateCount();
  }

  function showMainSection() {
    previewSection.classList.add('hidden');
    configSection.classList.add('hidden');
    mainSection.classList.remove('hidden');
    fetchBtn.disabled = false;
    fetchBtn.textContent = '获取购物车';
    result.className = 'message';
    result.textContent = '';
  }

  function showConfigSection() {
    mainSection.classList.add('hidden');
    previewSection.classList.add('hidden');
    configSection.classList.remove('hidden');

    // 填充当前配置
    systemUrlInput.value = systemConfig.systemUrl;
    reagentSiteUrlInput.value = systemConfig.reagentSiteUrl;

    // 检测网站主题
    detectSiteTheme();
  }

  async function detectSiteTheme() {
    siteThemeStatus.textContent = '检测中...';
    siteThemeStatus.className = 'badge badge-info';

    // 只检测系统 URL 的主题
    const theme = await getSystemTheme();

    if (theme) {
      if (theme.darkMode === true) {
        siteThemeStatus.textContent = '🌙 深色模式';
        siteThemeStatus.className = 'badge badge-secondary';
        // 同步插件深色模式
        document.body.classList.add('dark-mode');
      } else if (theme.darkMode === false) {
        siteThemeStatus.textContent = '☀️ 浅色模式';
        siteThemeStatus.className = 'badge badge-warning';
        // 同步插件浅色模式
        document.body.classList.remove('dark-mode');
      }
    } else {
      siteThemeStatus.textContent = '请先打开系统网站';
      siteThemeStatus.className = 'badge badge-error';
    }
  }

  async function saveConfig() {
    const url = systemUrlInput.value.trim();
    const reagentSiteUrl = reagentSiteUrlInput.value.trim() || DEFAULT_SYSTEM_CONFIG.reagentSiteUrl;

    const parsedSystemUrl = parseHttpUrl(url);
    if (!parsedSystemUrl) {
      alert('请输入有效的系统 URL');
      return;
    }

    const parsedReagentSiteUrl = parseHttpUrl(reagentSiteUrl);
    if (!parsedReagentSiteUrl) {
      alert('请输入有效的试剂网站 URL');
      return;
    }

    const newConfig = {
      systemUrl: parsedSystemUrl.origin,
      reagentSiteUrl: parsedReagentSiteUrl.origin,
    };

    try {
      await chrome.storage.local.set({ [STORAGE_KEYS.SYSTEM_CONFIG]: newConfig });
      systemConfig = { ...DEFAULT_SYSTEM_CONFIG, ...newConfig };
      showMainSection();
      result.className = 'message message-success show';
      result.textContent = '配置已保存';
      setTimeout(() => {
        result.className = 'message';
        result.textContent = '';
      }, 2000);
    } catch (error) {
      alert('保存失败: ' + error.message);
    }
  }

  function showPreview() {
    mainSection.classList.add('hidden');
    previewSection.classList.remove('hidden');
    renderItems();
    updateCount();
  }

  async function fetchCart() {
    fetchBtn.disabled = true;
    fetchBtn.innerHTML = '<span class="loading"></span>获取中...';
    result.className = 'message message-info show';
    result.textContent = '正在获取购物车数据...';

    try {
      const targetTab = await findCartTab();
      if (!targetTab) {
        throw new Error('请先打开试剂平台的购物车页面');
      }

      const response = await sendMessageWithAutoInject(targetTab.id, { action: 'GET_CART' });
      if (!response?.success) {
        throw new Error(response?.error || '获取购物车数据失败');
      }

      const cartItemsRaw = response.data;
      if (!Array.isArray(cartItemsRaw) || cartItemsRaw.length === 0) {
        result.className = 'message message-info show';
        result.textContent = '购物车为空或无已提交订单';
        fetchBtn.disabled = false;
        fetchBtn.textContent = '获取购物车';
        return;
      }

      result.textContent = `获取到 ${cartItemsRaw.length} 个商品，正在获取详情...`;

      const items = await mapWithConcurrencyLimit(
        cartItemsRaw,
        DETAIL_FETCH_CONCURRENCY,
        async (cartItem) => {
          try {
            const detail = await fetchProductDetail(cartItem.detailUrl);
            detail.quantity = cartItem.quantity;
            detail.price = cartItem.price;
            detail.product_id = cartItem.productId;
            detail.detail_url = cartItem.detailUrl;
            detail.is_hazardous = cartItem.is_dangerous || false;
            return detail;
          } catch (error) {
            console.error('[Popup] 获取详情失败:', cartItem.productId, error);
            return null;
          }
        }
      );

      cartItems = items;
      if (cartItems.length === 0) {
        result.className = 'message message-error show';
        result.textContent = '无法获取产品详情';
        fetchBtn.disabled = false;
        fetchBtn.textContent = '获取购物车';
        return;
      }

      showPreview();
    } catch (error) {
      console.error('[Popup] 获取失败:', error);
      result.className = 'message message-error show';
      result.textContent = error.message || '获取失败，请重试';
      fetchBtn.disabled = false;
      fetchBtn.textContent = '获取购物车';
    }
  }

  async function importSelected() {
    const selectedItems = [];
    itemList.querySelectorAll('.item-card.selected').forEach((card) => {
      const index = Number.parseInt(card.dataset.index, 10);
      if (!Number.isNaN(index)) {
        selectedItems.push(cartItems[index]);
      }
    });

    if (selectedItems.length === 0) {
      alert('请至少选择一个商品');
      return;
    }

    try {
      await saveCartItemsToStorage(selectedItems);
      const batchId = await saveImportBatch(selectedItems);
      const systemUrl = await resolveSystemUrl();
      const importUrl = `${systemUrl}/cart-import?import=true&batch_id=${encodeURIComponent(batchId)}`;

      result.className = 'message message-info show';
      result.textContent = '正在跳转到系统页面...';
      await chrome.tabs.create({ url: importUrl });
    } catch (error) {
      console.error('[Popup] 导入失败:', error);
      result.className = 'message message-error show';
      result.textContent = `导入失败: ${error.message}`;
    }
  }

  await checkTargetStatus();

  // 初始化时自动检测并同步主题
  (async () => {
    const theme = await getSystemTheme();
    if (theme) {
      if (theme.darkMode === true) {
        document.body.classList.add('dark-mode');
      } else {
        document.body.classList.remove('dark-mode');
      }
    }
  })();

  try {
    const targetTab = await findCartTab();
    if (targetTab) {
      await sendMessageWithAutoInject(targetTab.id, { action: 'ping' });
    }
  } catch (error) {
    console.warn('[Popup] ping 失败:', error?.message || error);
  }

  fetchBtn.addEventListener('click', fetchCart);
  selectAll.addEventListener('change', toggleSelectAll);
  backBtn.addEventListener('click', showMainSection);
  importBtn.addEventListener('click', importSelected);
  configBtn.addEventListener('click', showConfigSection);
  configBackBtn.addEventListener('click', showMainSection);
  configSaveBtn.addEventListener('click', saveConfig);
})();
