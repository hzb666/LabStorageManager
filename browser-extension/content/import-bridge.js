// 导入桥接脚本
// 在系统 /import 页面读取扩展存储中的批次数据，并写入页面 localStorage。

(function () {
  'use strict';

  const query = new URLSearchParams(globalThis.location.search);
  const importFlag = query.get('import');
  const batchId = query.get('batch_id');

  if (importFlag !== 'true') {
    return;
  }

  const EXT_STORAGE_KEY = 'import_batch_latest';
  const PAGE_STORAGE_KEY = 'cart_import_batch_latest';
  const TTL_MS = 2 * 60 * 60 * 1000;

  function isExpired(payload) {
    if (!payload?.created_at) {
      return true;
    }
    const createdAt = Date.parse(payload.created_at);
    if (Number.isNaN(createdAt)) {
      return true;
    }
    return Date.now() - createdAt > TTL_MS;
  }

  function cleanupPageCache() {
    try {
      const raw = localStorage.getItem(PAGE_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const payload = JSON.parse(raw);
      if (isExpired(payload)) {
        localStorage.removeItem(PAGE_STORAGE_KEY);
      }
    } catch (error) {
      console.warn('[ImportBridge] 清理页面缓存失败:', error);
      localStorage.removeItem(PAGE_STORAGE_KEY);
    }
  }

  cleanupPageCache();

  chrome.storage.local.get([EXT_STORAGE_KEY], (result) => {
    const payload = result?.[EXT_STORAGE_KEY];
    if (!payload) {
      return;
    }

    if (isExpired(payload)) {
      chrome.storage.local.remove([EXT_STORAGE_KEY]);
      return;
    }

    try {
      localStorage.setItem(PAGE_STORAGE_KEY, JSON.stringify(payload));
      globalThis.postMessage(
        {
          source: 'lab-storage-extension',
          type: 'IMPORT_BATCH_READY',
          batch_id: payload.batch_id || batchId || '',
          storage_key: PAGE_STORAGE_KEY,
        },
        globalThis.location.origin
      );
    } catch (error) {
      console.error('[ImportBridge] 写入页面缓存失败:', error);
    }
  });
})();
