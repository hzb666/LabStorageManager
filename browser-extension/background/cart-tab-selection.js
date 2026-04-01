(function initCartTabSelection(root) {
  function isCartPageUrl(url) {
    return /[?&]page=gwc/i.test(String(url || ''));
  }

  function normalizeTimestamp(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  function selectPreferredCartTab(tabs, activityByTabId) {
    const cartTabs = Array.isArray(tabs) ? tabs.filter((tab) => isCartPageUrl(tab?.url)) : [];
    if (cartTabs.length === 0) {
      return null;
    }

    const trackedTabs = cartTabs
      .map((tab, index) => ({
        tab,
        index,
        activityAt: normalizeTimestamp(activityByTabId?.[tab.id]),
        lastAccessed: normalizeTimestamp(tab?.lastAccessed),
      }))
      .sort((left, right) => {
        if (right.activityAt !== left.activityAt) {
          return right.activityAt - left.activityAt;
        }

        const rightActive = right.tab?.active ? 1 : 0;
        const leftActive = left.tab?.active ? 1 : 0;
        if (rightActive !== leftActive) {
          return rightActive - leftActive;
        }

        if (right.lastAccessed !== left.lastAccessed) {
          return right.lastAccessed - left.lastAccessed;
        }

        return left.index - right.index;
      });

    return trackedTabs[0]?.tab ?? null;
  }

  const api = {
    isCartPageUrl,
    selectPreferredCartTab,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    return;
  }

  root.CartTabSelection = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
