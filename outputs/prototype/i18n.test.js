const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync, readdirSync} = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadRuntime(savedLanguage) {
  const storage = new Map();
  if (savedLanguage) storage.set('resource-commons-language', savedLanguage);
  const window = {addEventListener() {}, dispatchEvent() {}};
  const context = vm.createContext({
    window,
    localStorage: {getItem:key=>storage.get(key), setItem:(key,value)=>storage.set(key,value)},
    document: {readyState:'loading', addEventListener() {}, documentElement:{}, querySelectorAll:()=>[]},
    CustomEvent: class {},
    Node: {ELEMENT_NODE:1, TEXT_NODE:3}
  });
  const execute = file => vm.runInContext(readFileSync(path.join(__dirname, file), 'utf8'), context);
  for (const file of readdirSync(path.join(__dirname, 'locales'))) execute(path.join('locales', file));
  execute('i18n.js');
  return {packs:window.RCLocales, runtime:window.RCI18n, storage};
}

test('every language pack supplies all three translations and preserves template arguments', () => {
  const {packs} = loadRuntime();
  const slots = str => [...new Set(str.match(/\{\d+\}/g) || [])].sort();
  for (const pack of packs) {
    for (const [source, values] of [...Object.entries(pack.strings || {}), ...(pack.patterns || [])]) {
      assert.equal(values.length, 3, source);
      for (const value of values) {
        assert.ok(typeof value === 'string' && value.trim(), source);
        assert.deepEqual(slots(value), slots(source), source);
      }
    }
  }
});

test('changing the interface language preserves raw names in formatted messages', () => {
  const {runtime, storage} = loadRuntime('zh-CN');
  assert.equal(runtime.language, 'zh-CN');
  assert.notEqual(runtime.t('My inventory'), 'My inventory');
  for (const tag of ['de','es','en','zh-CN']) {
    runtime.setLanguage(tag);
    assert.equal(storage.get('resource-commons-language'), tag);
    assert.equal(runtime.format('Shared with {0}.', 'Groups').includes('Groups'), true);
  }
  runtime.setLanguage('unknown');
  assert.equal(runtime.language, 'zh-CN');
  assert.equal(loadRuntime('unknown').runtime.language, 'en');
});
