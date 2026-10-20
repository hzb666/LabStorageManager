// 购物车同步弹窗脚本。

const STORAGE_KEYS = {
  IMPORT_BATCH_LATEST: 'import_batch_latest',
};

const extensionConfigApi = globalThis.ExtensionSiteConfig;
if (!extensionConfigApi) {
  throw new Error('扩展环境配置加载失败');
}
const { DEFAULT_SYSTEM_CONFIG } = extensionConfigApi;
const systemConfig = DEFAULT_SYSTEM_CONFIG;

const orderTypeDetectionApi = globalThis.OrderTypeDetection;
if (!orderTypeDetectionApi) {
  throw new Error('订单类型识别模块加载失败');
}
const {
  detectOrderClassification,
  extractFieldByLabels,
  extractLeadingSpecificationValue,
  normalizePageText,
  splitConsumableNameAndSpecification,
} = orderTypeDetectionApi;

const RUNTIME_MESSAGE_TIMEOUT_MS = 5000;
const DETAIL_FETCH_CONCURRENCY = 3;
const DETAIL_REQUEST_TIMEOUT_MS = 3000;

function isNoReceiverError(error) {
  return String(error?.message || '').includes('Receiving end does not exist');
}

async function waitForMessageResponse(request, timeoutMessage) {
  let timeoutId;
  try {
    return await Promise.race([
      request,
      new Promise((_, reject) => {
        timeoutId = globalThis.setTimeout(
          () => reject(new Error(timeoutMessage)),
          RUNTIME_MESSAGE_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

async function sendMessageWithAutoInject(tabId, message) {
  try {
    return await waitForMessageResponse(
      chrome.tabs.sendMessage(tabId, message),
      '购物车页面响应超时，请刷新购物车页面后重试',
    );
  } catch (error) {
    if (!isNoReceiverError(error)) {
      throw error;
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/script.js'],
    });

    return await waitForMessageResponse(
      chrome.tabs.sendMessage(tabId, message),
      '购物车页面响应超时，请刷新购物车页面后重试',
    );
  }
}

async function sendRuntimeMessage(message) {
  const response = await waitForMessageResponse(
    chrome.runtime.sendMessage(message),
    '扩展后台响应超时，请重新加载插件',
  );
  if (!response?.success) {
    throw new Error(response?.error || '扩展后台通信失败');
  }
  return response;
}

function isCartPageUrl(url) {
  const pageParamRegex = /[?&]page=gwc/i;
  return pageParamRegex.test(url || '');
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
    suggested_order_type: 'pending',
    order_type: 'pending',
    classification_reason: '请确认订单类型',
  };
}

function createCartPreviewItem(item) {
  return {
    ...createBasicItem(item.productId, 'pending'),
    name: item.name?.trim() || `商品 ${item.productId}`,
    quantity: item.quantity,
    price: item.price,
    product_id: item.productId,
    detail_url: item.detailUrl,
    is_hazardous: Boolean(item.is_dangerous),
  };
}

function mergeCartItemDetail(item, detail) {
  const detailName = detail.name?.trim();
  return {
    ...item,
    ...detail,
    name: detailName && detailName !== '未知' ? detailName : item.name,
    quantity: item.quantity,
    price: item.price,
    product_id: item.product_id,
    detail_url: item.detail_url,
    is_hazardous: item.is_hazardous,
  };
}

function isTimeoutError(error) {
  return error?.name === 'AbortError';
}

async function saveImportBatch(items) {
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

function parseProductDetail(html) {
  const pageText = normalizePageText(html);
  // 表格结构固定，直接匹配 td-2 中的内容。
  const name = extractFieldFromHtml(html, /中文名称：<\/td>[\s\S]*?<td[^>]*>([^<]*)<\/td>/) || '未知';
  const englishName = extractFieldFromHtml(html, /英文名称：<\/td>[\s\S]*?<td[^>]*>([^<]*)<\/td>/) || '';
  const brand = extractFieldFromHtml(html, /品牌：<\/td>[\s\S]*?<td[^>]*>([^<]*)<\/td>/) || '';
  const specificationRaw = extractFieldFromHtml(html, /包装规格：<\/td>[\s\S]*?<td[^>]*>([^<]*)<\/td>/) || '';
  const productNumber =
    extractFieldFromHtml(html, /货号：<\/td>[\s\S]*?<td[^>]*>([^<]*)<\/td>/) ||
    extractFieldByLabels(pageText, ['货号', '产品编号', '订货号']) ||
    '';
  const classification = detectOrderClassification({
    detail_fetch_status: name !== '未知' || englishName || specificationRaw || brand || productNumber
      ? 'success'
      : 'no_details',
    name,
    english_name: englishName,
    specification: specificationRaw,
    brand,
    product_number: productNumber,
    detail_text: pageText,
    detail_html: html,
  });

  const extractedSpecification = extractLeadingSpecificationValue(specificationRaw, {
    ignoreLeadingLetters: classification.suggested_order_type === 'reagent',
  });
  const parsedFields = classification.suggested_order_type !== 'reagent'
    ? splitConsumableNameAndSpecification(name, extractedSpecification)
    : { name, specification: extractedSpecification };

  return {
    name: parsedFields.name.trim(),
    english_name: englishName.trim(),
    specification: parsedFields.specification.trim(),
    brand: brand.trim(),
    cas_number: classification.cas_number,
    product_number: productNumber.trim(),
    alias: '',
    detail_fetch_status: classification.suggested_order_type === 'pending' ? 'no_details' : 'success',
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

  const controller = new AbortController();
  const timerId = globalThis.setTimeout(() => controller.abort(), DETAIL_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(detailUrl, { signal: controller.signal });
    if (!response.ok) {
      return createBasicItem('', 'http_error');
    }
    const html = await response.text();
    return parseProductDetail(html);
  } catch (error) {
    console.error('[Popup] 获取详情页失败:', error);
    if (isTimeoutError(error)) {
      return createBasicItem('', 'timeout');
    }
    return createBasicItem('', 'error');
  } finally {
    globalThis.clearTimeout(timerId);
  }
}

// 动态注入脚本检测系统主题。
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
          // 忽略损坏的 app-ui 数据
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
  const mainSection = document.getElementById('mainSection');
  const previewSection = document.getElementById('previewSection');
  const fetchBtn = document.getElementById('fetchBtn');
  const targetStatus = document.getElementById('targetStatus');
  const result = document.getElementById('result');
  const itemList = document.getElementById('itemList');
  const previewCount = document.getElementById('previewCount');
  const selectAll = document.getElementById('selectAll');
  const backBtn = document.getElementById('backBtn');
  const importBtn = document.getElementById('importBtn');
  const previewResult = document.getElementById('previewResult');

  let cartItems = [];
  let operation = 'idle';

  async function checkTargetStatus() {
    try {
      const targetTab = await findCartTab();
      if (targetTab) {
        targetStatus.textContent = '已连接';
        targetStatus.className = 'badge badge-success';
        return targetTab;
      }

      targetStatus.textContent = '请先打开购物车页面';
      targetStatus.className = 'badge badge-warning';
      return null;
    } catch (error) {
      console.error('[Popup] 检查失败:', error);
      targetStatus.textContent = '检查失败';
      targetStatus.className = 'badge badge-error';
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
        if (operation !== 'idle') return;
        // 如果点击的是标题链接，不触发切换
        if (e.target.closest('a')) return;

        // 点击卡片空白区域时手动切换复选框状态
        if (e.target !== checkbox) {
          checkbox.checked = !checkbox.checked;
        }

        card.classList.toggle('selected', checkbox.checked);
        renderControls();
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
      bodyText.textContent = `数量: ${item.quantity} · 单价: ¥${item.price}`;
      body.appendChild(bodyText);

      card.appendChild(header);
      card.appendChild(body);
      itemList.appendChild(card);
    });
  }

  function renderControls() {
    const busy = operation !== 'idle';
    const checked = itemList.querySelectorAll('.item-card.selected').length;
    previewCount.textContent = `已选择 ${checked} / ${cartItems.length} 项`;
    selectAll.checked = checked > 0 && checked === cartItems.length;
    selectAll.indeterminate = checked > 0 && checked < cartItems.length;
    importBtn.innerHTML = operation === 'importing'
      ? '<span class="loading"></span>正在获取详情...'
      : `开始导入 (${checked})`;
    fetchBtn.innerHTML = operation === 'fetching'
      ? '<span class="loading"></span>获取中...'
      : '获取购物车';
    importBtn.disabled = busy || checked === 0;
    selectAll.disabled = busy;
    backBtn.disabled = busy;
    fetchBtn.disabled = busy;
    itemList.inert = busy;
    itemList.setAttribute('aria-busy', String(busy));
    itemList.querySelectorAll('.checkbox').forEach((checkbox) => { checkbox.disabled = busy; });
  }

  function setOperation(value) {
    operation = value;
    renderControls();
  }

  function toggleSelectAll() {
    if (operation !== 'idle') return;
    const checked = selectAll.checked;
    itemList.querySelectorAll('.item-card').forEach((card) => {
      const checkbox = card.querySelector('.checkbox');
      if (checkbox) {
        checkbox.checked = checked;
      }
      card.classList.toggle('selected', checked);
    });
    renderControls();
  }

  function showMainSection() {
    if (operation !== 'idle') return;
    previewSection.classList.add('hidden');
    mainSection.classList.remove('hidden');
    renderControls();
    result.className = 'message';
    result.textContent = '';
  }

  function showPreview() {
    mainSection.classList.add('hidden');
    previewSection.classList.remove('hidden');
    previewResult.className = 'message';
    previewResult.textContent = '';
    renderItems();
    renderControls();
  }

  async function fetchCart() {
    if (operation !== 'idle') return;
    setOperation('fetching');
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
        return;
      }

      cartItems = cartItemsRaw.map(createCartPreviewItem);
      showPreview();
    } catch (error) {
      console.error('[Popup] 获取失败:', error);
      result.className = 'message message-error show';
      result.textContent = error.message || '获取失败，请重试';
    } finally {
      setOperation('idle');
    }
  }

  async function importSelected() {
    if (operation !== 'idle') return;
    const selectedItems = [];
    itemList.querySelectorAll('.item-card.selected').forEach((card) => {
      const index = Number.parseInt(card.dataset.index, 10);
      if (Number.isInteger(index) && cartItems[index]) {
        selectedItems.push({ ...cartItems[index] });
      }
    });

    if (selectedItems.length === 0) {
      alert('请至少选择一个商品');
      return;
    }

    setOperation('importing');
    previewResult.className = 'message message-info show';
    previewResult.textContent = `正在获取详情（0/${selectedItems.length}）...`;
    let completed = 0;
    try {
      const detailedItems = await mapWithConcurrencyLimit(
        selectedItems,
        DETAIL_FETCH_CONCURRENCY,
        async (item) => {
          const detail = await fetchProductDetail(item.detail_url);
          completed += 1;
          previewResult.textContent = `正在获取详情（${completed}/${selectedItems.length}）...`;
          return mergeCartItemDetail(item, detail);
        },
      );
      const batchId = await saveImportBatch(detailedItems);
      const importUrl = `${systemConfig.systemUrl}/cart-import?import=true&batch_id=${encodeURIComponent(batchId)}`;

      previewResult.textContent = '正在打开导入页面...';
      await chrome.tabs.create({ url: importUrl });
    } catch (error) {
      console.error('[Popup] 导入失败:', error);
      previewResult.className = 'message message-error show';
      previewResult.textContent = `导入失败: ${error.message}`;
    } finally {
      setOperation('idle');
    }
  }

  fetchBtn.addEventListener('click', fetchCart);
  selectAll.addEventListener('change', toggleSelectAll);
  backBtn.addEventListener('click', showMainSection);
  importBtn.addEventListener('click', importSelected);

  renderControls();
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
})();
