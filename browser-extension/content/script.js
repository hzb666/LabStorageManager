// 购物车同步内容脚本。

(function() {
  'use strict';

  const ALLOWED_HAZARD_ICON_HOSTS = new Set([globalThis.location.hostname, 'reagent.bjmu.edu.cn']);

  function isTrustedHazardIconSrc(src) {
    if (!src) {
      return false;
    }
    try {
      const parsed = new URL(src, globalThis.location.origin);
      if (!ALLOWED_HAZARD_ICON_HOSTS.has(parsed.hostname)) {
        return false;
      }
      return /\/images\/wxp\.png$/i.test(parsed.pathname) || /(^|\/)wxp\.png$/i.test(parsed.pathname);
    } catch {
      return false;
    }
  }

  console.log('[Content] 购物车同步插件内容脚本已加载');

  // 监听来自popup的消息
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[Content] 收到消息:', message.action);

    if (message.action === 'ping') {
      console.log('[Content] Ping received');
      sendResponse({ success: true, data: 'pong' });
    }

    if (message.action === 'GET_CART') {
      const cartData = extractCartItems();
      sendResponse({ success: true, data: cartData });
    }

    if (message.action === 'GET_THEME') {
      const theme = getSiteTheme();
      sendResponse({ success: true, data: theme });
    }
  });

  // 获取网站主题状态
  function getSiteTheme() {
    try {
      // 尝试多种常见的深色模式 localStorage key
      const possibleKeys = [
        'darkMode',
        'dark_mode',
        'theme',
        'color-scheme',
        'colorScheme',
        'dark',
        'isDarkMode',
        '__dark_mode',
        'theme_mode'
      ];

      for (const key of possibleKeys) {
        const value = localStorage.getItem(key);
        if (value !== null) {
          // 尝试解析为布尔值
          if (value === 'true' || value === 'dark' || value === 'darkMode') {
            return { darkMode: true, key };
          }
          if (value === 'false' || value === 'light') {
            return { darkMode: false, key };
          }
          // 返回原始值
          return { darkMode: null, key, value };
        }
      }

      // 尝试从 CSS 类名判断
      const isDark = document.documentElement.classList.contains('dark') ||
                     document.documentElement.classList.contains('dark-mode') ||
                     document.documentElement.classList.contains('theme-dark');
      if (isDark) {
        return { darkMode: true, source: 'css-class' };
      }

      // 尝试从 prefers-color-scheme 判断
      const prefersDark = globalThis.matchMedia('(prefers-color-scheme: dark)').matches;
      return { darkMode: prefersDark, source: 'system-preference' };
    } catch (error) {
      return { darkMode: null, error: error?.message || String(error) };
    }
  }

  // 提取已提交订单的基本信息
  function extractCartItems() {
    const items = [];

    // 查找所有购物车商品项
    const cartItems = document.querySelectorAll('div.ssxq1');

    if (cartItems && cartItems.length > 0) {
      cartItems.forEach(item => {
        // 只提取已提交的订单
        const submitted = item.textContent.includes('已提交');
        if (submitted) {
          const data = extractItemBasicInfo(item);
          if (data?.detailUrl) {
            items.push(data);
          }
        }
      });
    }

    console.log('[Content] 提取到已提交订单:', items.length, '条');
    return items;
  }

  // 从商品项中提取基本信息
  function extractItemBasicInfo(element) {
    let productId = '';  // 详情页产品ID (param=xxx)
    let cartItemId = ''; // 购物车项ID (用于获取数量和价格)
    let quantity = 1;
    let price = 0;
    let detailUrl = '';
    let isDangerous = false;  // 是否危险品

    // 1. 获取详情页产品ID - 从链接获取
    const detailLink = element.querySelector('a[href*="page=cpxq"]');
    if (detailLink) {
      const href = detailLink.getAttribute('href');
      const match = href?.match(/param=(\d+)/);
      if (match) {
        productId = match[1];
        detailUrl = `${globalThis.location.origin}/Front.aspx?page=cpxq&param=${productId}`;
      }
    }

    // 2. 获取购物车项 ID，可从元素 ID 或 checkbox value 读取。
    const idMatch = element.id?.match(/cpdiv(\d+)/);
    if (idMatch) {
      cartItemId = idMatch[1];
    }

    // 如果没有，从checkbox value获取
    if (!cartItemId) {
      const checkbox = element.querySelector('input[type="checkbox"][value]');
      if (checkbox) {
        cartItemId = checkbox.value;
      }
    }

    // 3. 获取数量 - 使用购物车项ID
    if (cartItemId) {
      const qtyInput = document.getElementById(`txt_${cartItemId}_数量`);
      if (qtyInput) {
        quantity = Number.parseInt(qtyInput.value, 10) || 1;
      }
    }

    // 4. 获取单价 - 使用购物车项ID
    if (cartItemId) {
      const priceInput = document.getElementById(`txt_${cartItemId}_单价`);
      if (priceInput) {
        price = Number.parseFloat(priceInput.value) || 0;
      }
    }

    // 5. 检测危险品 - 优先图标，再用文本/链接兜底，兼容不同供应商模板
    const dangerousImg = Array.from(element.querySelectorAll('img')).find((img) =>
      isTrustedHazardIconSrc(img.getAttribute('src') || '')
    );
    const textContent = (element.textContent || '').replaceAll(/\s+/g, ' ');
    const hasDangerText = textContent.includes('危险品');
    const hasMsdsLink = !!element.querySelector('a[href*="page=msdsxq"]');
    isDangerous = Boolean(dangerousImg) || hasDangerText || hasMsdsLink;

    console.log('[Content] 提取基本信息: productId=', productId, 'cartItemId=', cartItemId, 'quantity=', quantity, 'price=', price, 'detailUrl=', detailUrl, 'isDangerous=', isDangerous);

    return {
      productId: productId,
      cartItemId: cartItemId,
      quantity: quantity,
      price: price,
      detailUrl: detailUrl,
      is_dangerous: isDangerous
    };
  }
})();
