// 北大医学部购物车同步 - Service Worker
// 处理跨标签页通信和后端API调用

const TARGET_URL_PATTERN = 'https://reagent.bjmu.edu.cn/*';
const TARGET_BASE_URL = 'https://reagent.bjmu.edu.cn';
// 使用相对路径，浏览器扩展会自动使用当前页面或 manifest 中配置的 host
const SYSTEM_API_BASE = '';

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

  if (message.type === 'SYNC_TO_SYSTEM') {
    syncToSystem(message.items, message.order_type)
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'CHECK_TARGET_TAB') {
    checkTargetTab()
      .then(tab => sendResponse({ success: true, exists: !!tab, tabId: tab?.id }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  sendResponse({ success: false, error: '未知消息类型' });
  return false;
});

// 从目标网站获取购物车数据
async function getCartDataFromTargetSite() {
  console.log('[Background] 开始获取购物车数据...');

  const tabs = await chrome.tabs.query({ url: TARGET_URL_PATTERN });
  console.log('[Background] 找到标签页:', tabs.length);

  const targetTab = tabs.find(tab => tab.url && tab.url.includes('page=gwc'));
  console.log('[Background] 目标标签页:', targetTab);

  if (!targetTab) {
    throw new Error('请先打开北大医学部试剂平台的购物车页面');
  }

  console.log('[Background] 向内容脚本发送消息...');
  const response = await chrome.tabs.sendMessage(targetTab.id, { action: 'GET_CART' });
  console.log('[Background] 内容脚本响应:', response);

  if (!response || !response.success) {
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
  const url = `${TARGET_BASE_URL}/Front.aspx?page=cpxq&param=${productId}`;
  console.log('[Background] 请求详情页:', url);

  try {
    // 使用fetch需要目标网站在host_permissions中
    const response = await fetch(url);
    console.log('[Background] 详情页响应状态:', response.status);

    if (!response.ok) {
      console.log('[Background] HTTP错误，返回基本信息');
      return createBasicItem(productId);
    }

    const html = await response.text();
    console.log('[Background] 详情页HTML长度:', html.length);

    const detail = parseProductDetail(html, productId);
    console.log('[Background] 解析结果:', detail);
    return detail;
  } catch (error) {
    console.error('[Background] 请求失败:', error);
    return createBasicItem(productId);
  }
}

// 创建基本信息
function createBasicItem(productId) {
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
    detail_url: `${TARGET_BASE_URL}/Front.aspx?page=cpxq&param=${productId}`
  };
}

// 解析产品详情页面
function parseProductDetail(html, productId) {
  let name = '';
  let englishName = '';
  let brand = '';
  let specification = '';
  let casNumber = '';
  let purity = '';
  let price = 0;

  // 尝试多种方式获取产品名称
  // 从li元素中获取 - 检查所有li
  const liMatches = html.match(/<li[^>]*>[^<]*中文名称[^<]*<[^>]*>([^<]+)<\/li>/gi);
  if (liMatches && liMatches.length > 0) {
    const match = liMatches[0].match(/>([^<]+)<\/li>/);
    if (match) {
      name = match[1].trim();
    }
  }

  // 从页面标题获取
  if (!name) {
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    if (titleMatch) {
      name = titleMatch[1].split('-')[0].trim();
    }
  }

  // 英文名称
  const enMatch = html.match(/英文名称[^:]*[:：][^<]*<[^>]*>([^<]+)</i);
  if (enMatch) {
    englishName = enMatch[1].trim();
  }

  // 品牌
  const brandMatch = html.match(/品牌[^:]*[:：][^<]*<[^>]*>([^<]+)</i);
  if (brandMatch) {
    brand = brandMatch[1].trim();
  }

  // 包装规格
  const specMatch = html.match(/包装规格[^:]*[:：][^<]*<[^>]*>([^<]+)</i);
  if (specMatch) {
    specification = specMatch[1].trim();
  }

  // CAS号
  const casMatch = html.match(/casno[：:]\s*(\d{2,7}-\d{2}-\d)/i);
  if (casMatch) {
    casNumber = casMatch[1].trim();
  }

  // 纯度
  const purityMatch = html.match(/纯度[^:]*[:：][^<]*<[^>]*>([^<]+)</i);
  if (purityMatch) {
    purity = purityMatch[1].trim();
  }

  // 单价 - 匹配 "单价" 后面的数字
  const priceMatch = html.match(/单价[^:]*[:：][^¥￥]*[¥￥]?\s*(\d+\.?\d*)/i);
  if (priceMatch) {
    price = parseFloat(priceMatch[1]);
  }

  // 供货商
  if (!brand) {
    const supplierMatch = html.match(/供货商[^:]*[:：][^<]*<[^>]*>([^<]+)</i);
    if (supplierMatch) {
      brand = supplierMatch[1].trim();
    }
  }

  // 组合规格
  if (!specification && purity) {
    specification = purity;
  }

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
    detail_url: `${TARGET_BASE_URL}/Front.aspx?page=cpxq&param=${productId}`
  };
}

// 同步数据到本地系统
async function syncToSystem(items, orderType = 'consumable') {
  try {
    const response = await fetch(`${SYSTEM_API_BASE}/api/cart-sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ items, order_type: orderType })
    });

    if (!response.ok) {
      throw new Error(`API请求失败: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('[Background] 同步失败:', error);
    throw error;
  }
}

// 检查目标标签页
async function checkTargetTab() {
  const tabs = await chrome.tabs.query({ url: TARGET_URL_PATTERN });
  return tabs.find(tab => tab.url && tab.url.includes('page=gwc'));
}

console.log('[Background] Service Worker 加载完成');
