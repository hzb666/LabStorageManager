const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function element(tagName = 'div') {
  const node = {
    tagName, children: [], className: '', dataset: {}, checked: false, disabled: false,
    listeners: {}, attributes: {}, text: '',
    appendChild(child) { this.children.push(child); },
    addEventListener(type, listener) { this.listeners[type] = listener; },
    setAttribute(name, value) { this.attributes[name] = value; },
    closest(selector) { return this.tagName === selector ? this : null; },
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; },
    querySelectorAll(selector) {
      const classes = selector.split('.').filter(Boolean);
      return this.children.flatMap((child) => [
        ...(classes.every((name) => child.classList.contains(name)) ? [child] : []),
        ...child.querySelectorAll(selector),
      ]);
    },
    get textContent() { return this.text || this.children.map((child) => child.textContent).join(''); },
    set textContent(value) { this.text = value; this.children = []; },
    set innerHTML(value) { this.text = value; this.children = []; },
  };
  node.classList = {
    contains: (name) => node.className.split(' ').includes(name),
    add(name) { if (!this.contains(name)) node.className = `${node.className} ${name}`.trim(); },
    remove(name) { node.className = node.className.split(' ').filter((value) => value !== name).join(' '); },
    toggle(name, value) { if (value) this.add(name); else this.remove(name); },
  };
  return node;
}

const basicItems = Array.from({ length: 5 }, (_, index) => ({
  productId: String(index + 1), cartItemId: String(index + 10), name: `商品名称 ${index + 1}`,
  quantity: index + 2, price: 12.5 + index, detailUrl: `https://reagent.example/detail/${index + 1}`,
  is_dangerous: index === 0,
}));

async function popupHarness(items = basicItems) {
  const elements = Object.fromEntries([
    'mainSection', 'previewSection', 'fetchBtn', 'targetStatus', 'result', 'itemList',
    'previewCount', 'selectAll', 'backBtn', 'importBtn', 'previewResult',
  ].map((id) => [id, element()]));
  elements.previewSection.className = 'hidden';
  const saved = {};
  const storageWrites = [];
  const opened = [];
  const context = vm.createContext({
    console: { error() {}, warn() {} }, URL, AbortController, crypto: globalThis.crypto,
    setTimeout: (callback, delay) => setTimeout(callback, delay === 3000 ? 30 : delay), clearTimeout,
    alert: (message) => { throw new Error(message); },
    ExtensionSiteConfig: { DEFAULT_SYSTEM_CONFIG: { systemUrl: 'https://inventory.example' } },
    OrderTypeDetection: require('./popup/order-type-detection.js'),
    document: {
      getElementById: (id) => elements[id], createElement: element, body: element('body'),
    },
    chrome: {
      runtime: { sendMessage: async () => ({ success: true, tab: { id: 7 } }) },
      tabs: {
        sendMessage: async (_tab, message) => ({ success: true, data: message.action === 'GET_CART' ? items : 'pong' }),
        query: async () => [],
        create: async (options) => { opened.push(options); },
      },
      storage: { local: {
        get: async () => saved,
        set: async (data) => {
          storageWrites.push(Object.keys(data));
          Object.assign(saved, JSON.parse(JSON.stringify(data)));
        },
        remove: async (keys) => { keys.forEach((key) => delete saved[key]); },
      } },
    },
    fetch: async () => { throw new Error('Unexpected detail request before selection'); },
  });
  await vm.runInContext(fs.readFileSync(path.join(__dirname, 'popup/popup.js'), 'utf8'), context);
  const click = async (node) => node.listeners.click?.({ target: node });
  return { context, elements, saved, storageWrites, opened, click };
}

test('preview reads only basic cart data and shows quantities and prices', async () => {
  const harness = await popupHarness();
  let requests = 0;
  harness.context.fetch = async () => { requests += 1; };
  await harness.click(harness.elements.fetchBtn);
  assert.equal(requests, 0);
  assert.equal(harness.elements.previewSection.classList.contains('hidden'), false);
  assert.equal(harness.elements.itemList.children.length, 5);
  assert.match(harness.elements.itemList.children[0].textContent, /商品名称 1/);
  assert.match(harness.elements.itemList.children[0].textContent, /数量: 2 · 单价: ¥12.5/);
  assert.deepEqual(harness.saved, {});
});

test('import fetches selected details only, caps concurrency and locks selection', async () => {
  const harness = await popupHarness();
  const { elements, click, context } = harness;
  await click(elements.fetchBtn);
  await click(elements.itemList.children[1]);
  const requests = [];
  const pending = [];
  let active = 0;
  let peak = 0;
  context.fetch = (url) => new Promise((resolve) => {
    requests.push(url);
    active += 1;
    peak = Math.max(peak, active);
    pending.push(() => {
      active -= 1;
      resolve({ ok: true, text: async () => '<td>中文名称：</td><td>详细名称</td>' });
    });
  });
  const importing = click(elements.importBtn);
  await new Promise(setImmediate);
  assert.equal(requests.length, 3);
  assert.equal(elements.selectAll.disabled, true);
  assert.equal(elements.backBtn.disabled, true);
  assert.equal(elements.importBtn.disabled, true);
  assert.equal(elements.itemList.inert, true);
  assert.ok(elements.itemList.querySelectorAll('.checkbox').every((checkbox) => checkbox.disabled));
  await click(elements.itemList.children[0]);
  await click(elements.backBtn);
  await click(elements.importBtn);
  assert.equal(elements.itemList.children[0].classList.contains('selected'), true);
  assert.equal(elements.previewSection.classList.contains('hidden'), false);
  pending.splice(0).forEach((finish) => finish());
  await new Promise(setImmediate);
  pending.splice(0).forEach((finish) => finish());
  await importing;
  assert.equal(peak, 3);
  assert.deepEqual(requests, basicItems.filter((_, index) => index !== 1).map((item) => item.detailUrl));
  const imported = harness.saved.import_batch_latest.items;
  assert.deepEqual(imported.map((item) => item.product_id), ['1', '3', '4', '5']);
  assert.equal(imported[0].quantity, 2);
  assert.equal(imported[0].price, 12.5);
  assert.equal(imported[0].is_hazardous, true);
  assert.equal(imported[0].name, '详细名称');
  assert.equal(harness.opened.length, 1);
  assert.deepEqual(harness.storageWrites, [['import_batch_latest']]);
  assert.match(harness.opened[0].url, /\/cart-import\?import=true&batch_id=/);
  assert.equal(elements.backBtn.disabled, false);
  assert.equal(elements.itemList.inert, false);
});

test('failed details preserve basic names and cart values, including body timeouts', async () => {
  const harness = await popupHarness(basicItems.slice(0, 3));
  harness.context.fetch = async (url, { signal }) => {
    if (url.endsWith('/1')) throw new Error('Network Error');
    if (url.endsWith('/2')) return { ok: false };
    return {
      ok: true,
      text: () => new Promise((_, reject) => signal.addEventListener('abort', () => {
        reject(new DOMException('Timed out', 'AbortError'));
      }, { once: true })),
    };
  };
  await harness.click(harness.elements.fetchBtn);
  await harness.click(harness.elements.importBtn);
  const imported = harness.saved.import_batch_latest.items;
  assert.deepEqual(imported.map((item) => item.name), basicItems.slice(0, 3).map((item) => item.name));
  assert.deepEqual(imported.map((item) => item.detail_fetch_status), ['error', 'http_error', 'timeout']);
  assert.ok(imported.every((item) => item.order_type === 'pending' && item.suggested_order_type === 'pending'));
  assert.equal(imported[0].price, 12.5);
  assert.equal(imported[0].quantity, 2);
  assert.equal(imported[0].is_hazardous, true);
});

test('storage failure restores controls and displays the error in the preview', async () => {
  const harness = await popupHarness(basicItems.slice(0, 1));
  harness.context.fetch = async () => ({ ok: true, text: async () => '<html>No detail fields</html>' });
  harness.context.chrome.storage.local.set = async () => { throw new Error('storage full'); };
  await harness.click(harness.elements.fetchBtn);
  await harness.click(harness.elements.importBtn);
  assert.equal(harness.elements.selectAll.disabled, false);
  assert.equal(harness.elements.backBtn.disabled, false);
  assert.equal(harness.elements.importBtn.disabled, false);
  assert.match(harness.elements.previewResult.textContent, /storage full/);
  assert.equal(harness.elements.previewResult.classList.contains('show'), true);
  assert.equal(harness.opened.length, 0);
});

test('cart fetch locks controls, ignores duplicate actions and restores state on failure', async () => {
  const harness = await popupHarness();
  let finish;
  let calls = 0;
  harness.context.chrome.tabs.sendMessage = () => {
    calls += 1;
    return new Promise((resolve) => { finish = resolve; });
  };
  const fetching = harness.click(harness.elements.fetchBtn);
  await new Promise(setImmediate);
  assert.equal(harness.elements.fetchBtn.disabled, true);
  assert.equal(harness.elements.importBtn.disabled, true);
  await harness.click(harness.elements.fetchBtn);
  await harness.click(harness.elements.importBtn);
  assert.equal(calls, 1);
  finish({ success: false, error: 'cart unavailable' });
  await fetching;
  assert.equal(harness.elements.fetchBtn.disabled, false);
  assert.equal(harness.elements.fetchBtn.textContent, '获取购物车');
  assert.equal(harness.elements.importBtn.disabled, true);
  assert.match(harness.elements.result.textContent, /cart unavailable/);
});

test('selection controls stay consistent after deselecting and selecting all', async () => {
  const harness = await popupHarness();
  const { elements } = harness;
  await harness.click(elements.fetchBtn);
  await harness.click(elements.itemList.children[0]);
  assert.equal(elements.selectAll.indeterminate, true);
  elements.selectAll.checked = false;
  elements.selectAll.listeners.change();
  assert.equal(elements.selectAll.indeterminate, false);
  assert.equal(elements.importBtn.disabled, true);
  elements.selectAll.checked = true;
  elements.selectAll.listeners.change();
  assert.equal(elements.itemList.querySelectorAll('.item-card.selected').length, basicItems.length);
  assert.equal(elements.importBtn.disabled, false);
});

test('content script returns submitted names and a product ID fallback without fetching', () => {
  let listener;
  const cartRows = [
    { id: 'cpdiv10', textContent: '已提交 危险品', name: '  乙醇\n  500 mL  ', product: '1' },
    { id: 'cpdiv11', textContent: '未提交', name: 'ignore', product: '2' },
    { id: 'cpdiv12', textContent: '已提交', name: ' ', product: '3' },
  ].map((row) => ({
    ...row,
    querySelector: (selector) => selector.includes('page=cpxq') ? {
      textContent: row.name, getAttribute: () => `Front.aspx?page=cpxq&param=${row.product}`,
    } : null,
    querySelectorAll: () => [],
  }));
  const context = vm.createContext({
    URL, console, location: { origin: 'https://reagent.example', hostname: 'reagent.example' },
    document: {
      querySelectorAll: () => cartRows,
      getElementById: (id) => ({ value: id.endsWith('数量') ? '4' : '20.5' }),
    },
    chrome: { runtime: { onMessage: { addListener: (callback) => { listener = callback; } } } },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'content/script.js'), 'utf8'), context);
  let response;
  listener({ action: 'GET_CART' }, {}, (value) => { response = value; });
  assert.equal(response.success, true);
  assert.equal(response.data.length, 2);
  assert.equal(response.data[0].name, '乙醇 500 mL');
  assert.equal(response.data[0].quantity, 4);
  assert.equal(response.data[0].price, 20.5);
  assert.equal(response.data[0].is_dangerous, true);
  assert.equal(response.data[1].name, '商品 3');
});

test('background no longer exposes the full-detail cart entry point', async () => {
  let listener;
  const event = { addListener() {}, hasListener: () => false, removeListener() {} };
  const context = vm.createContext({
    console, URL, importScripts() {},
    fetch: () => { throw new Error('Background must not fetch product details'); },
    CartTabSelection: { isCartPageUrl: () => false, selectPreferredCartTab: () => null },
    ExtensionSiteConfig: {
      DEFAULT_SYSTEM_CONFIG: { systemUrl: 'https://inventory.example', reagentSiteUrl: 'https://reagent.example' },
      buildSiteUrlPattern: (origin) => `${origin}/*`,
    },
    chrome: {
      runtime: { onMessage: { addListener: (callback) => { listener = callback; } } },
      tabs: { onRemoved: event, onUpdated: event }, webRequest: { onBeforeRequest: event },
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'background/service-worker.js'), 'utf8'), context);
  let response;
  assert.equal(listener({ type: 'GET_CART_DATA' }, {}, (value) => { response = value; }), false);
  assert.equal(response.success, false);
  await new Promise(setImmediate);
});
