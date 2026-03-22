// 北大医学部购物车同步 - Popup Script
// 直接与内容脚本通信，不依赖 service worker

const SYSTEM_URL_CANDIDATES = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
];

const STORAGE_KEYS = {
  CART_ITEMS: 'pendingCartItems',
  IMPORT_BATCH_LATEST: 'import_batch_latest',
};

const BATCH_TTL_MS = 2 * 60 * 60 * 1000;

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

function extractFirstCasNumber(input) {
  const match = /\b\d{2,7}-\d{2}-\d\b/.exec(String(input || ''));
  return match ? match[0] : '';
}

function detectOrderType(casNumber) {
  return extractFirstCasNumber(casNumber) ? 'reagent' : 'consumable';
}

function isCartPageUrl(url) {
  const pageParamRegex = /[?&]page=gwc(?:&|$)/i;
  return pageParamRegex.test(url || '');
}

async function resolveSystemUrl() {
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const activeUrl = activeTab?.url || '';

  const matched = SYSTEM_URL_CANDIDATES.find((baseUrl) => activeUrl.startsWith(baseUrl));
  if (matched) {
    return matched;
  }

  for (const baseUrl of SYSTEM_URL_CANDIDATES) {
    const [tab] = await chrome.tabs.query({ url: `${baseUrl}/*` });
    if (tab?.id) {
      return baseUrl;
    }
  }

  return SYSTEM_URL_CANDIDATES[0];
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

function createBasicItem(productId) {
  return {
    name: '查看产品详情',
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
  };
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
  const normalizedItems = items.map((item) => ({
    ...item,
    order_type: detectOrderType(item.cas_number),
    selected: true,
  }));

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
  const lines = String(pageText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const label of labels) {
    const found = lines.find((line) => line.toLowerCase().startsWith(label.toLowerCase()));
    if (found) {
      return sanitizeExtractedValue(found.slice(label.length));
    }
  }

  return '';
}

function extractLeadingSpecificationValue(specificationText) {
  const source = sanitizeExtractedValue(specificationText);
  if (!source) {
    return '';
  }

  const start = /^\d+(?:\.\d+)?\s*/.exec(source);
  if (!start) {
    return source;
  }

  let result = start[0];
  let index = result.length;

  while (index < source.length) {
    const char = source[index];
    if (/[A-Za-zμµ]/.test(char)) {
      result += char;
      index += 1;
      continue;
    }

    if (/\s/.test(char)) {
      const next = source[index + 1] || '';
      if (/[A-Za-zμµ]/.test(next)) {
        result += char;
        index += 1;
        continue;
      }
    }

    // 字母段结束后，遇到汉字、斜杠、数字等后缀信息即停止。
    break;
  }

  return sanitizeExtractedValue(result) || source;
}

function extractCasFromDoc(doc) {
  const candidates = [];
  const labelRegex = /(cas\s*no|casno|cas号|cas)/i;

  doc.querySelectorAll('td,th,li,div,span,p').forEach((element) => {
    const text = (element.textContent || '').replaceAll(/\s+/g, ' ').trim();
    if (!text || !labelRegex.test(text)) {
      return;
    }
    candidates.push(text);
    if (element.nextElementSibling?.textContent) {
      candidates.push(element.nextElementSibling.textContent);
    }
    if (element.parentElement?.textContent) {
      candidates.push(element.parentElement.textContent);
    }
  });

  for (const candidate of candidates) {
    const extracted = extractFirstCasNumber(candidate);
    if (extracted) {
      return extracted;
    }
  }

  return '';
}

function parseProductDetail(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const pageText = (doc.body?.innerText || '').replaceAll('\u00a0', ' ');

  const titleName = extractFieldFromHtml(html, /<title>([^<]+)<\/title>/i).split('-')[0].trim();
  const name =
    extractFieldFromHtml(html, /品名<span[^>]*class="pl50"[^>]*>([^<]+)<\/span>/i) ||
    extractFieldFromHtml(html, /中文名称[：:][^<]*<td[^>]*>([^<]+)<\/td>/i) ||
    extractFieldFromLines(pageText, ['品名', '中文名称']) ||
    titleName ||
    '未知产品';

  const englishName =
    extractFieldFromHtml(html, /英文名称[：:][^<]*<td[^>]*>([^<]+)<\/td>/i) ||
    extractFieldFromLines(pageText, ['英文名称']);

  const brand =
    extractFieldFromHtml(html, /品牌<span[^>]*class="pl50"[^>]*>([^<]+)<\/span>/i) ||
    extractFieldFromHtml(html, /供货商[：:][^<]*<td[^>]*>([^<]+)<\/td>/i) ||
    extractFieldFromLines(pageText, ['品牌']);

  const specificationRaw =
    extractFieldFromHtml(html, /包装规格<span[^>]*class="pl20"[^>]*>([^<]+)<\/span>/i) ||
    extractFieldFromHtml(html, /纯度[：:][^<]*<td[^>]*>([^<]+)<\/td>/i) ||
    extractFieldFromLines(pageText, ['包装规格']);

  const specification = extractLeadingSpecificationValue(specificationRaw);

  const productNumber =
    extractFieldFromHtml(html, /货号<span[^>]*class="pl50"[^>]*>([^<]+)<\/span>/i) ||
    extractFieldFromLines(pageText, ['货号']);

  const casNumber =
    extractFirstCasNumber(extractFieldFromHtml(html, /casno[：:][^<]*<td[^>]*>([^<]+)<\/td>/i)) ||
    extractCasFromDoc(doc) ||
    extractFirstCasNumber(pageText);

  return {
    name,
    english_name: englishName || '',
    specification: specification || '',
    brand: brand || '',
    cas_number: casNumber || '',
    product_number: productNumber || '',
    alias: '',
  };
}

async function findCartTab() {
  const tabs = await chrome.tabs.query({ url: 'https://reagent.bjmu.edu.cn/*' });
  return tabs.find((tab) => isCartPageUrl(tab.url));
}

async function fetchProductDetail(detailUrl) {
  if (!detailUrl) {
    return createBasicItem('');
  }

  try {
    const response = await fetch(detailUrl);
    if (!response.ok) {
      return createBasicItem('');
    }
    const html = await response.text();
    return parseProductDetail(html);
  } catch (error) {
    console.error('[Popup] 获取详情页失败:', error);
    return createBasicItem('');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
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
      checkbox.addEventListener('change', () => {
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
        link.style.color = '#0066cc';
        link.style.textDecoration = 'underline';
        link.style.cursor = 'pointer';
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
      body.textContent = item.cas_number ? `CAS: ${item.cas_number}` : 'CAS: 无CAS';

      card.appendChild(header);
      card.appendChild(body);
      itemList.appendChild(card);
    });
  }

  function updateCount() {
    const checked = itemList.querySelectorAll('.item-card.selected').length;
    previewCount.textContent = `已选择 ${checked} / ${cartItems.length} 项`;
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
    mainSection.classList.remove('hidden');
    fetchBtn.disabled = false;
    fetchBtn.textContent = '获取购物车';
    result.className = 'message';
    result.textContent = '';
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
        throw new Error('请先打开北大医学部试剂平台的购物车页面');
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

      const items = [];
      for (const cartItem of cartItemsRaw) {
        try {
          const detail = await fetchProductDetail(cartItem.detailUrl);
          detail.quantity = cartItem.quantity;
          detail.price = cartItem.price;
          detail.product_id = cartItem.productId;
          detail.detail_url = cartItem.detailUrl;
          detail.is_hazardous = cartItem.is_dangerous || false;
          items.push(detail);
        } catch (error) {
          console.error('[Popup] 获取详情失败:', cartItem.productId, error);
        }
      }

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
});
