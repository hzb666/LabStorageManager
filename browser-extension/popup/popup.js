// 北大医学部购物车同步 - Popup Script
// 直接与内容脚本通信，不依赖service worker

// 系统URL配置 - 生产环境修改这里
const SYSTEM_URL = 'http://localhost:8000';
const STORAGE_KEYS = {
  CART_ITEMS: 'pendingCartItems'
};

// 保存待导入的商品数据到storage
async function saveCartItemsToStorage(items, orderType) {
  const data = {
    items: items,
    orderType: orderType,
    timestamp: Date.now()
  };
  await chrome.storage.local.set({ [STORAGE_KEYS.CART_ITEMS]: data });
}

document.addEventListener('DOMContentLoaded', async () => {
  console.log('[Popup] 脚本加载');

  const mainSection = document.getElementById('mainSection');
  const previewSection = document.getElementById('previewSection');
  const fetchBtn = document.getElementById('fetchBtn');
  const targetStatus = document.getElementById('targetStatus');
  const result = document.getElementById('result');
  const orderType = document.getElementById('orderType');
  const itemList = document.getElementById('itemList');
  const previewCount = document.getElementById('previewCount');
  const selectAll = document.getElementById('selectAll');
  const backBtn = document.getElementById('backBtn');
  const importBtn = document.getElementById('importBtn');

  let cartItems = [];

  // 先尝试发送一个测试消息来激活连接
  try {
    const tabs = await chrome.tabs.query({ url: 'https://reagent.bjmu.edu.cn/*' });
    if (tabs.length > 0) {
      await chrome.tabs.sendMessage(tabs[0].id, { action: 'ping' });
      console.log('[Popup] 连接测试成功');
    }
  } catch (e) {
    console.log('[Popup] 连接测试:', e.message);
  }

  // 初始化
  await checkTargetStatus();

  // 事件绑定
  fetchBtn.addEventListener('click', fetchCart);
  selectAll.addEventListener('change', toggleSelectAll);
  backBtn.addEventListener('click', showMainSection);
  importBtn.addEventListener('click', importSelected);

  // 检查目标网站状态
  async function checkTargetStatus() {
    try {
      const tabs = await chrome.tabs.query({ url: 'https://reagent.bjmu.edu.cn/*' });
      const targetTab = tabs.find(tab => tab.url && tab.url.includes('page=gwc'));

      if (targetTab) {
        targetStatus.textContent = '已连接';
        targetStatus.className = 'badge badge-success';
        fetchBtn.disabled = false;
        return targetTab;
      } else {
        targetStatus.textContent = '请先打开购物车页面';
        targetStatus.className = 'badge badge-warning';
        fetchBtn.disabled = true;
        return null;
      }
    } catch (error) {
      console.error('[Popup] 检查失败:', error);
      targetStatus.textContent = '检查失败';
      targetStatus.className = 'badge badge-error';
      return null;
    }
  }

  // 获取购物车数据
  async function fetchCart() {
    fetchBtn.disabled = true;
    fetchBtn.innerHTML = '<span class="loading"></span>获取中...';
    result.className = 'message message-info show';
    result.textContent = '正在获取购物车数据...';

    try {
      // 直接查找目标标签页
      const tabs = await chrome.tabs.query({ url: 'https://reagent.bjmu.edu.cn/*' });
      const targetTab = tabs.find(tab => tab.url && tab.url.includes('page=gwc'));

      if (!targetTab) {
        throw new Error('请先打开北大医学部试剂平台的购物车页面');
      }

      // 直接发送消息给内容脚本
      const response = await chrome.tabs.sendMessage(targetTab.id, { action: 'GET_CART' });
      console.log('[Popup] 内容脚本响应:', response);

      if (!response || !response.success) {
        throw new Error(response?.error || '获取购物车数据失败');
      }

      const cartItemsRaw = response.data;
      console.log('[Popup] 原始购物车数据:', cartItemsRaw);

      if (!cartItemsRaw || cartItemsRaw.length === 0) {
        result.className = 'message message-info show';
        result.textContent = '购物车为空或无已提交订单';
        fetchBtn.disabled = false;
        fetchBtn.textContent = '获取购物车';
        return;
      }

      // 获取每个产品的详情页信息
      result.textContent = `获取到 ${cartItemsRaw.length} 个商品，正在获取详情...`;

      const items = [];
      for (const cartItem of cartItemsRaw) {
        try {
          const detail = await fetchProductDetail(cartItem.detailUrl);
          if (detail) {
            // 数量、价格、危险品标记用购物车的
            detail.quantity = cartItem.quantity;
            detail.price = cartItem.price;
            detail.product_id = cartItem.productId;
            detail.detail_url = cartItem.detailUrl;
            detail.is_dangerous = cartItem.is_dangerous || false;
            items.push(detail);
          }
        } catch (error) {
          console.error('[Popup] 获取详情失败:', cartItem.productId, error);
        }
      }

      cartItems = items;
      console.log('[Popup] 最终商品列表:', cartItems);

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

  // 从标签页获取产品详情 - 通过执行脚本
  async function fetchProductDetailFromTab(tabId, productId) {
    const url = `https://reagent.bjmu.edu.cn/Front.aspx?page=cpxq&param=${productId}`;

    try {
      // 使用fetch获取详情页
      const response = await fetch(url);
      if (!response.ok) {
        return createBasicItem(productId);
      }

      const html = await response.text();
      return parseProductDetail(html, productId);
    } catch (error) {
      console.error('[Popup] 获取详情页失败:', error);
      return createBasicItem(productId);
    }
  }

  // 获取产品详情
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
      product_id: productId || '',
      detail_url: ''
    };
  }

  // 解析产品详情页
  function parseProductDetail(html) {
    let name = '';
    let englishName = '';
    let brand = '';
    let specification = '';
    let casNumber = '';

    console.log('[Popup] 开始解析详情页, HTML长度:', html.length);

    // 从 imginfo 区域获取主要信息
    // 格式: <li>品名<span class="pl50">产品名</span></li>
    const nameMatch = html.match(/品名<span[^>]*class="pl50"[^>]*>([^<]+)<\/span>/i);
    if (nameMatch) {
      name = nameMatch[1].trim();
      console.log('[Popup] 找到品名:', name);
    }

    // 品牌
    const brandMatch = html.match(/品牌<span[^>]*class="pl50"[^>]*>([^<]+)<\/span>/i);
    if (brandMatch) {
      brand = brandMatch[1].trim();
      console.log('[Popup] 找到品牌:', brand);
    }

    // 包装规格
    const specMatch = html.match(/包装规格<span[^>]*class="pl20"[^>]*>([^<]+)<\/span>/i);
    if (specMatch) {
      specification = specMatch[1].trim();
      console.log('[Popup] 找到包装规格:', specification);
    }

    // 尝试从表格中获取更多信息
    // 中文名称
    const cnNameMatch = html.match(/中文名称[：:][^<]*<td[^>]*>([^<]+)<\/td>/i);
    if (cnNameMatch && !name) {
      name = cnNameMatch[1].trim();
    }

    // CAS号 - 从表格
    const casTdMatch = html.match(/casno[：:][^<]*<td[^>]*>([^<]+)<\/td>/i);
    if (casTdMatch) {
      casNumber = casTdMatch[1].trim();
      console.log('[Popup] 找到CAS:', casNumber);
    }

    // 纯度
    const purityMatch = html.match(/纯度[：:][^<]*<td[^>]*>([^<]+)<\/td>/i);
    if (purityMatch) {
      const purity = purityMatch[1].trim();
      if (!specification) {
        specification = purity;
      }
    }

    // 英文名称
    const enTdMatch = html.match(/英文名称[：:][^<]*<td[^>]*>([^<]+)<\/td>/i);
    if (enTdMatch) {
      englishName = enTdMatch[1].trim();
    }

    // 供货商（作为品牌备用）
    const supplierMatch = html.match(/供货商[：:][^<]*<td[^>]*>([^<]+)<\/td>/i);
    if (supplierMatch && !brand) {
      brand = supplierMatch[1].trim();
    }

    // 如果还是没找到，从页面标题获取
    if (!name) {
      const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
      if (titleMatch) {
        name = titleMatch[1].split('-')[0].trim();
      }
    }

    console.log('[Popup] 解析结果: name=', name, 'englishName=', englishName, 'brand=', brand, 'specification=', specification, 'casNumber=', casNumber);

    return {
      name: name || '未知产品',
      english_name: englishName || '',
      specification: specification || '',
      brand: brand || '',
      cas_number: casNumber || '',
      alias: ''
    };
  }

  // 显示预览界面
  function showPreview() {
    mainSection.classList.add('hidden');
    previewSection.classList.remove('hidden');
    renderItems();
    updateCount();
  }

  // 渲染商品列表
  function renderItems() {
    itemList.innerHTML = '';

    cartItems.forEach((item, index) => {
      const card = document.createElement('div');
      card.className = 'item-card selected';
      card.dataset.index = index;

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

      // 商品名称可点击跳转详情页
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
      body.innerHTML = `
        <div class="item-row"><span class="item-label">规格:</span><span class="item-value">${item.specification || '-'}</span></div>
        <div class="item-row"><span class="item-label">数量:</span><span class="item-value">${item.quantity}</span></div>
        <div class="item-row"><span class="item-label">单价:</span><span class="item-value">${item.price ? '¥' + item.price : '-'}</span></div>
        <div class="item-row"><span class="item-label">品牌:</span><span class="item-value">${item.brand || '-'}</span></div>
        ${item.product_id ? `<div class="item-row"><span class="item-label">产品ID:</span><span class="item-value">${item.product_id}</span></div>` : ''}
      `;

      card.appendChild(header);
      card.appendChild(body);
      itemList.appendChild(card);
    });
  }

  // 更新选中计数
  function updateCount() {
    const checked = itemList.querySelectorAll('.item-card.selected').length;
    previewCount.textContent = `已选择 ${checked} / ${cartItems.length} 项`;
    importBtn.textContent = `导入选中 (${checked})`;
    importBtn.disabled = checked === 0;
  }

  // 全选/取消全选
  function toggleSelectAll() {
    const checked = selectAll.checked;
    itemList.querySelectorAll('.item-card').forEach(card => {
      const checkbox = card.querySelector('.checkbox');
      checkbox.checked = checked;
      card.classList.toggle('selected', checked);
    });
    updateCount();
  }

  // 返回主界面
  function showMainSection() {
    previewSection.classList.add('hidden');
    mainSection.classList.remove('hidden');
    fetchBtn.disabled = false;
    fetchBtn.textContent = '获取购物车';
    // 清除消息提示
    result.className = 'message';
    result.textContent = '';
  }

  // 导入选中的商品 - 使用storage传递数据，跳转页面
  async function importSelected() {
    const selectedItems = [];
    itemList.querySelectorAll('.item-card.selected').forEach(card => {
      const index = parseInt(card.dataset.index);
      selectedItems.push(cartItems[index]);
    });

    if (selectedItems.length === 0) {
      alert('请至少选择一个商品');
      return;
    }

    const orderTypeValue = orderType.value;

    try {
      // 保存数据到 storage（解决URL长度限制问题）
      await saveCartItemsToStorage(selectedItems, orderTypeValue);
      console.log('[Popup] 商品数据已保存到storage');

      const targetPage = orderTypeValue === 'reagent' ? '/reagent-orders' : '/consumable-orders';
      const importUrl = `${SYSTEM_URL}${targetPage}?import=true&_t=${Date.now()}`;

      result.className = 'message message-info show';
      result.textContent = `正在跳转到系统页面...`;

      // 打开系统页面
      await chrome.tabs.create({ url: importUrl });
    } catch (error) {
      console.error('[Popup] 导入失败:', error);
      result.className = 'message message-error show';
      result.textContent = '导入失败: ' + error.message;
    }
  }
});
