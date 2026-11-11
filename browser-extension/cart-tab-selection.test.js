const assert = require('node:assert/strict');
const test = require('node:test');
const { isCartPageUrl, selectPreferredCartTab } = require('./background/cart-tab-selection.js');

test('only an exact cart page parameter is recognized', () => {
  assert.equal(isCartPageUrl('https://reagent.example/Front.aspx?page=gwc'), true);
  assert.equal(isCartPageUrl('https://reagent.example/Front.aspx?PAGE=GWC&other=1'), true);
  for (const url of [
    null, '', 'not a url', 'https://reagent.example/Front.aspx?page=gwc_history',
    'https://reagent.example/login?return=Front.aspx?page=gwc',
    'https://reagent.example/Front.aspx#?page=gwc',
    'file:///Front.aspx?page=gwc',
  ]) assert.equal(isCartPageUrl(url), false, String(url));
});

test('cart selection keeps prioritizing the most recently used real cart', () => {
  const tabs = [
    { id: 1, url: 'https://reagent.example/Front.aspx?page=gwc', active: true },
    { id: 2, url: 'https://reagent.example/Front.aspx?page=gwc', active: false },
    { id: 3, url: 'https://reagent.example/Front.aspx?page=gwc_history', active: true },
  ];
  assert.equal(selectPreferredCartTab(tabs, { 2: 100, 3: 200 }).id, 2);
  assert.equal(selectPreferredCartTab(tabs, {}).id, 1);
  assert.equal(selectPreferredCartTab(tabs.slice(2), {}), null);
});
