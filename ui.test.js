'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const E = require('./engine.js');
const D = require('./scene-drafts.js');

// Small dependency-free DOM adapter for the actual app bootstrap. It records
// rendered input values; layout and accessibility remain browser QA concerns.
function renderRequestForm(state, photoDraftUI, options = {}) {
  const nodes = new Map();
  const documentHandlers = new Map(), writes = [];
  nodes.documentHandlers = documentHandlers; nodes.writes = writes;
  function node(selector) {
    if (!nodes.has(selector)) {
      let html = '';
      const element = {
        value: '', textContent: '', listeners: {}, classList: { add() {}, remove() {}, toggle() {} },
        addEventListener(type, callback) { this.listeners[type] = callback; }, setAttribute() {}, focus() {}, showModal() { this.open = true; }, close() { this.open = false; },
        insertAdjacentHTML(_, markup) { this.innerHTML += markup; },
        parentElement: { insertAdjacentHTML() {} },
        get innerHTML() { return html; },
        set innerHTML(value) {
          html = value;
          for (const tag of value.matchAll(/<input\b[^>]*>/g)) {
            const id = /\bid="([^"]+)"/.exec(tag[0]);
            const val = /\bvalue="([^"]*)"/.exec(tag[0]);
            if (id) node('#' + id[1]).value = val ? val[1] : '';
          }
        }
      };
      nodes.set(selector, element);
    }
    return nodes.get(selector);
  }
  const context = {
    document: { querySelector: node, querySelectorAll: () => [], addEventListener(type, callback) { documentHandlers.set(type, callback); } },
    window: { ResourceEngine: E, PhotoDraftData: D, PhotoDraftUI: photoDraftUI, addEventListener() {}, scrollTo() {} },
    location: { hash: options.hash || '#request', protocol: options.protocol || 'file:' },
    localStorage: { getItem: () => JSON.stringify(state), setItem(key, value) { writes.push({ key, value }); } },
    setTimeout, clearTimeout, console, fetch: options.fetch, AbortSignal
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8'), context, { filename: 'app.js' });
  return nodes;
}

test('The form preserves phone specifications and quantities when mixed needs change order', () => {
  for (const phoneFirst of [false, true]) {
    const state = E.seed();
    const phone = { id: 'phone', label: 'Phone support kit', quantity: 2, phoneWidthMm: 76.5, phoneWeightG: 280 };
    const chair = { id: 'chair', label: 'Chair', quantity: 4 };
    state.request.needs = phoneFirst ? [phone, chair] : [chair, phone];
    const nodes = renderRequestForm(state);
    assert.equal(nodes.get('#phone-width').value, '76.5');
    assert.equal(nodes.get('#phone-weight').value, '280');
    const html = nodes.get('#view').innerHTML;
    assert.match(html, /name="qty-chair"[^>]*value="4"/);
    assert.match(html, /name="qty-phone"[^>]*value="2"/);
  }
});

const cloudHealth = { service: 'waicy-resource-commons', backend: 'openai', provider: 'OpenAI(Cloud)', localOnly: false, remoteProcessing: true, modelAvailable: true, model: 'gpt-test', availabilityCheck: 'configuration-only', apiVerified: false };
test('The interface uses cloud health to display OpenAI cost and configuration without treating an existing key as proof of remaining credit', async () => {
  let published;
  const nodes = renderRequestForm(E.seed(), { initialize() {}, updateBackendStatus(status) { published = status; } }, { protocol: 'http:', fetch: async () => ({ ok: true, json: async () => cloudHealth }) });
  await new Promise(resolve => setImmediate(resolve));
  const text = nodes.get('#model-notice').innerHTML;
  assert.match(text, /OpenAI/); assert.match(text, /API charges/); assert.match(text, /live request.*service access and quota/i);
  assert.doesNotMatch(text, /Processed on this device|No paid API|no cloud connection/);
  assert.equal(published.ready, true); assert.equal(published.remoteProcessing, true);
  assert.equal(nodes.get('#ai-request-button').disabled, false);
  assert.match(nodes.get('#ai-request-button').textContent, /OpenAI/);
});

test('When unavailable or connected to a different local service the interface disables AI actions and makes no local processing claim', async () => {
  for (const fetch of [async () => { throw new Error('offline'); }, async () => ({ ok: true, json: async () => ({ ...cloudHealth, service: 'unrelated-service' }) })]) {
    let published;
    const nodes = renderRequestForm(E.seed(), { initialize() {}, updateBackendStatus(status) { published = status; } }, { protocol: 'http:', fetch });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(published.known, false); assert.equal(published.ready, false);
    assert.equal(nodes.get('#ai-request-button').disabled, true);
    assert.match(nodes.get('#model-notice').innerHTML, /No photo or request text is sent/);
    assert.doesNotMatch(nodes.get('#model-notice').innerHTML, /Processed on this device|Local model connected/);
  }
});

test('Local contract backend=local still supports recognition with cloud mode available', async () => {
  let published;
  const nodes = renderRequestForm(E.seed(), { initialize() {}, updateBackendStatus(status) { published = status; } }, { protocol: 'http:', fetch: async () => ({ ok: true, json: async () => ({ ...cloudHealth, backend: 'local', localOnly: true, remoteProcessing: false, model: 'qwen-local' }) }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(published.ready, true); assert.equal(published.backend, 'local');
  assert.match(nodes.get('#model-notice').innerHTML, /processed by your local model/);
  assert.doesNotMatch(nodes.get('#model-notice').innerHTML, /send to OpenAI/);
});
test('Converting photo drafts retains the suggested name and requires users to confirm location, responsibility and sharing permission', () => {
  let handlers;
  const nodes = renderRequestForm(E.seed(), { initialize(options) { handlers = options; }, renderSection() {} });
  handlers.promote({ name: 'Computer on the desk', category: 'electronics', visibleQuantity: null, thumbnail: '', model: 'test-local', uncertainties: ['Condition unknown'], locationHint: 'desk', isSynthetic: null }, { originalImage: 'data:image/jpeg;base64,YWJj' }, () => {});
  assert.equal(nodes.get('#item-name').value, 'Computer on the desk');
  for (const key of ['#item-owner', '#item-place', '#item-at', '#item-share', '#item-condition', '#item-position', '#item-qty']) assert.equal(nodes.get(key).value, '', key + 'A photo cannot confirm these fields');
  assert.match(nodes.get('#item-place').placeholder, /Draft location hint: desk/);
  assert.equal(nodes.get('#item-share').required, true);
});


function clickAction(nodes, dataset) {
  nodes.documentHandlers.get('click')({ target: { closest: () => ({ dataset }) } });
}

test('The inventory has one primary search; switching between drafts and sample inventory leaves records intact', () => {
  const original = E.seed(), calls = [];
  const nodes = renderRequestForm(original, {
    initialize() {}, summary: () => ({ total: 8, pending: 8 }),
    renderSection(container, options) { calls.push(options); }, setQuery(query) { calls.push({ searched: query }); }
  }, { hash: '#inventory' });
  const html = nodes.get('#view').innerHTML;
  assert.match(html, /Photo drafts <span>8<\/span>/);
  assert.match(html, /Demo inventory <span>10<\/span>/);
  assert.equal((html.match(/type="search"/g) || []).length, 1);
  assert.match(html, /id="photo-draft-section" hidden/);
  clickAction(nodes, { action: 'library-tab', tab: 'drafts' });
  assert.match(nodes.get('#view').innerHTML, /id="confirmed-inventory" hidden/);
  assert.doesNotMatch(html, /KNOW WHAT|summary-strip|RESOURCE COMMONS/);
  const writesBefore = nodes.writes.length;
  nodes.get('#inventory-search').listeners.input({ target: { value: 'desk' } });
  assert.equal(calls.at(-1).searched, 'desk');
  clickAction(nodes, { action: 'library-tab', tab: 'inventory' });
  assert.match(nodes.get('#view').innerHTML, /id="photo-draft-section" hidden/);
  assert.doesNotMatch(nodes.get('#view').innerHTML, /id="confirmed-inventory" hidden/);
  assert.match(nodes.get('#view').innerHTML, /owner’s approval before borrowing/);
  nodes.get('#inventory-search').listeners.input({ target: { value: 'nonexistent item' } });
  assert.match(nodes.get('#inventory-grid').innerHTML, /No matching items/);
  clickAction(nodes, { action: 'library-tab', tab: 'drafts' });
  assert.equal(calls.at(-1).query, 'nonexistent item');
  assert.equal(nodes.writes.length, writesBefore, 'Browsing, searching and switching sections cannot reset or write inventory');
  assert.deepEqual(JSON.parse(nodes.writes[0].value), original);
});

test('The initial notice covers uploads and billing, with complete connection details available on demand', async () => {
  const nodes = renderRequestForm(E.seed(), { initialize() {}, updateBackendStatus() {} }, { protocol: 'http:', fetch: async () => ({ ok: true, json: async () => cloudHealth }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(nodes.get('#service-summary').textContent, /Cloud recognition.*upload.*charges/i);
  assert.match(nodes.get('#model-notice').innerHTML, /live request.*service access and quota/i);
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.match(html, /<details class="service-disclosure">/);
  assert.match(html, /Simulated inventory and approvals/);
  assert.equal((html.match(/data-nav="/g) || []).length, 3);
  assert.match(html, /href="groups.html"/);
  assert.doesNotMatch(html, /<h1[^>]*>Resource Commons<\/h1>/i);
});

test('All explicitly sized text is at least 14 px with clear rules for mobile navigation and hidden sections', () => {
  const css = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8');
  const sizes = [...css.matchAll(/font-size:\s*([\d.]+)px/g)].map(match => Number(match[1]));
  assert.ok(sizes.length > 30);
  assert.ok(sizes.every(size => size >= 14), 'Secondary copy, labels and mobile text must remain at least 14 px');
  assert.match(css, /\[hidden\]\{display:none!important\}/);
  assert.match(css, /@media\(max-width:720px\)/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /focus-visible/);
});

test('The request page leads with purpose, offers examples and matching details on demand, and keeps important conditions visible', async () => {
  const nodes = renderRequestForm(E.seed(), { initialize() {}, updateBackendStatus() {} }, { protocol: 'http:', fetch: async () => ({ ok: true, json: async () => cloudHealth }) });
  await new Promise(resolve => setImmediate(resolve));
  const html = nodes.get('#view').innerHTML;
  assert.match(html, /<details class="preset-picker"><summary>Demo scenario: /);
  assert.match(html, /<details class="details request-guidance">/);
  assert.doesNotMatch(html, /<aside|Finding the item<br>is the first step/);
  assert.ok(html.indexOf('id="request-purpose"') < html.indexOf('id="request-title"'));
  for (const id of ['request-start', 'request-end', 'phone-width', 'phone-weight']) assert.match(html, new RegExp('id="' + id + '"'));
  assert.match(nodes.get('#request-ai-summary').textContent, /Request text goes to\s+OpenAI.*Charges may apply.*Review the suggested fields/i);
});

function openInventory(state = E.seed()) {
  const nodes = renderRequestForm(state, { initialize() {}, renderSection() {} }, { hash: '#inventory' });
  clickAction(nodes, { action: 'library-tab', tab: 'inventory' });
  return nodes;
}
function shownItemIds(nodes) {
  return [...nodes.get('#inventory-grid').innerHTML.matchAll(/data-action="view-item" data-id="([^"]+)"/g)].map(match => match[1]);
}
function chooseInventoryLocation(nodes, location) {
  nodes.get('#inventory-location').listeners.change({ target: { value: location } });
}
function searchInventory(nodes, value) {
  nodes.get('#inventory-search').listeners.input({ target: { value } });
}

test('Location filtering uses confirmed locations, groups shelves within each cabinet, and keeps location predictions separate', () => {
  const original = E.seed();
  original.items.find(i => i.id === 'c1').lastConfirmed.place = 'Equipment cabinet A \uFF0F Accessory box';
  const moving = original.items.find(i => i.id === 's2');
  moving.history.push({ place: 'Rehearsal room / Equipment cart', at: '2026-11-03T17:00', kind: 'activity' });
  const nodes = openInventory(original), writesBefore = nodes.writes.length;
  const html = nodes.get('#view').innerHTML;
  assert.equal((html.match(/<option value="Equipment cabinet A"/g) || []).length, 1, 'Multiple shelves of the same cabinet share a location filter');
  assert.doesNotMatch(html, /<option[^>]*Rehearsal room/, 'A location inferred from activity cannot become the last confirmed location');
  chooseInventoryLocation(nodes, 'Equipment cabinet A');
  assert.deepEqual(shownItemIds(nodes), ['s1', 't1', 'c1']);
  chooseInventoryLocation(nodes, 'Activity room');
  assert.deepEqual(shownItemIds(nodes), ['s2']);
  assert.match(nodes.get('#inventory-grid').innerHTML, /Last confirmed location.*Activity room \/ Blue storage bin/);
  assert.doesNotMatch(nodes.get('#inventory-grid').innerHTML, /Rehearsal room/);
  assert.equal(nodes.writes.length, writesBefore);
  assert.deepEqual(JSON.parse(nodes.writes[0].value), E.validateState(original));
});

test('Location, text and sharing filters work together and clearing restores all items without changing inventory', () => {
  const original = E.seed(), nodes = openInventory(original), writesBefore = nodes.writes.length;
  chooseInventoryLocation(nodes, 'Equipment cabinet A');
  searchInventory(nodes, 'Lin');
  clickAction(nodes, { action: 'filter', filter: 'shareable' });
  assert.deepEqual(shownItemIds(nodes), ['s1', 't1', 'c1']);
  searchInventory(nodes, 'phone');
  assert.deepEqual(shownItemIds(nodes), ['s1', 'c1']);
  clickAction(nodes, { action: 'filter', filter: 'private' });
  assert.deepEqual(shownItemIds(nodes), []);
  assert.match(nodes.get('#inventory-grid').innerHTML, /Clear filters/);
  assert.equal(nodes.get('#result-line').textContent, '0 items');
  clickAction(nodes, { action: 'clear-filters' });
  assert.deepEqual(shownItemIds(nodes), original.items.map(i => i.id));
  assert.equal(nodes.get('#inventory-search').value, '');
  assert.equal(nodes.get('#result-line').textContent, '10 items');
  assert.equal(nodes.writes.length, writesBefore);
});

test('List and photo views retain current filters; opening and closing details leaves inventory and edit forms unchanged', () => {
  const nodes = openInventory(), writesBefore = nodes.writes.length;
  chooseInventoryLocation(nodes, 'Equipment cabinet A');
  searchInventory(nodes, 'phone');
  clickAction(nodes, { action: 'layout', layout: 'photos' });
  assert.deepEqual(shownItemIds(nodes), ['s1', 'c1']);
  assert.equal(nodes.get('#inventory-search').value, 'phone');
  assert.match(nodes.get('#view').innerHTML, /value="Equipment cabinet A" selected/);
  assert.match(nodes.get('#inventory-grid').className, /inventory-photos/);
  clickAction(nodes, { action: 'view-item', id: 'c1' });
  const details = nodes.get('#modal-content').innerHTML;
  assert.equal(nodes.get('#modal').open, true);
  assert.match(details, /Item details/);
  assert.match(details, /Maximum clamp width \(mm\)<\/dt><dd>Needs verification<\/dd>/);
  assert.match(details, /data-action="edit-item"[^>]*>Edit record/);
  assert.doesNotMatch(details, /<form|id="item-form"/);
  clickAction(nodes, { action: 'close-modal' });
  assert.equal(nodes.get('#modal').open, false);
  clickAction(nodes, { action: 'layout', layout: 'list' });
  assert.deepEqual(shownItemIds(nodes), ['s1', 'c1']);
  assert.match(nodes.get('#inventory-grid').className, /inventory-list/);
  assert.equal(nodes.writes.length, writesBefore);
});

test('Item details distinguish inferred and confirmed locations and retain private or requestable status until a request is approved', () => {
  const original = E.seed(), moving = original.items.find(i => i.id === 's2');
  moving.history.push({ place: 'Rehearsal room / Equipment cart', at: '2026-11-03T17:00', kind: 'activity' });
  const nodes = openInventory(original), writesBefore = nodes.writes.length;
  clickAction(nodes, { action: 'view-item', id: 's2' });
  let details = nodes.get('#modal-content').innerHTML;
  assert.match(details, /<dt>Last confirmed<\/dt><dd>Activity room \/ Blue storage bin/);
  assert.match(details, /<strong>Suggested location · Unconfirmed<\/strong>[\s\S]*<li>Rehearsal room \/ Equipment cart<\/li>/);
  assert.match(details, /May have moved/);
  assert.match(details, />Open to requests</);
  assert.match(details, /Each booking needs the owner’s approval/);
  assert.match(details, /Available quantity depends on the requested dates/);
  assert.doesNotMatch(details, /Demo approval/);
  clickAction(nodes, { action: 'close-modal' });
  clickAction(nodes, { action: 'view-item', id: 's3' });
  details = nodes.get('#modal-content').innerHTML;
  assert.match(details, /Private/);
  assert.doesNotMatch(details, />Open to requests<|Demo approval|data-action="approve"/);
  assert.equal(nodes.writes.length, writesBefore);
});

test('Converting a public photo example preserves its source, illustration and attribution, leaving confirmation fields empty', () => {
  let handlers;
  const nodes = renderRequestForm(E.seed(), { initialize(options) { handlers = options; }, renderSection() {} });
  const originalImage = 'data:image/jpeg;base64,YWJj', thumbnail = 'data:image/jpeg;base64,ZGVm';
  const publicPhoto = { author: 'Alan Quirván', pageUrl: 'https://www.pexels.com/photo/laptop-notebooks-and-pens-on-white-desk-14541073/', licenseUrl: 'https://www.pexels.com/license/' };
  handlers.promote({ name:'Computer in the photo', category:'electronics', visibleQuantity:1, thumbnail, model:'Manual annotations. No call to  AI', uncertainties:[], locationHint:'', isSynthetic:true }, { source:'public-photo-demo', originalImage, publicPhoto }, () => {});
  assert.match(nodes.get('#modal-content').innerHTML, new RegExp('src="' + originalImage + '"'));
  assert.doesNotMatch(nodes.get('#modal-content').innerHTML, new RegExp('src="' + thumbnail + '"'));
  for (const key of ['#item-owner','#item-place','#item-share','#item-condition']) assert.equal(nodes.get(key).value,'');
});
