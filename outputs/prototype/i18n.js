(() => {
  'use strict';
  const languages = [
    {tag: 'en', name: 'English', label: 'Language'},
    {tag: 'zh-CN', name: '简体中文', label: '语言'},
    {tag: 'es', name: 'Español', label: 'Idioma'},
    {tag: 'de', name: 'Deutsch', label: 'Sprache'}
  ];
  const preference = 'resource-commons-language';
  const exact = new Map(), patterns = [];
  const originals = new WeakMap(), originalAttributes = new WeakMap(), bindings = new WeakMap();
  const attributes = ['aria-label', 'placeholder', 'title', 'alt', 'content'];
  const normalize = s => s.trim().replace(/\s+/gu, ' ');
  const blocked = 'script,style,code,pre,[translate="no"],[data-language-picker]';
  const available = tag => languages.some(language => language.tag === tag);
  let selected = 'en';
  try {
    const saved = localStorage.getItem(preference);
    if (available(saved)) selected = saved;
  } catch { /* Storage is optional. */ }

  function registerPattern(template, translations) {
    const parts = normalize(template).split(/(\{\d+\})/g);
    const slots = [];
    const fixed = parts.filter((_, index) => index % 2 === 0).join('');
    if (!fixed.trim() || parts.length < 3) return;
    const expression = parts.map((part, index) => {
      if (index % 2 === 0) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      slots.push(Number(part.slice(1,-1)));
      return '(.+?)';
    }).join('');
    const literals = parts.filter((part,index) => index % 2 === 0 && part.length);
    patterns.push({template: new RegExp('^' + expression + '$', 'u'), literals, slots, translations, weight: fixed.length});
  }
  for (const pack of window.RCLocales || []) {
    for (const [source, translations] of Object.entries(pack.strings || {})) exact.set(normalize(source), translations);
    for (const [source, translations] of pack.patterns || []) {
      exact.set(normalize(source), translations);
      registerPattern(source, translations);
    }
  }
  patterns.sort((a,b) => b.weight - a.weight);

  function substitute(template, args) {
    return template.replace(/\{(\d+)\}/g, (slot,index) => args[index] === undefined ? slot : String(args[index]));
  }
  function translate(value, depth = 0) {
    const original = String(value ?? '');
    if (selected === 'en' || !original.trim()) return original;
    const source = normalize(original);
    const index = languages.findIndex(language => language.tag === selected) - 1;
    let result = exact.get(source)?.[index];
    if (result === undefined && source.length <= 2400 && depth < 3) {
      for (const entry of patterns) {
        if (!entry.literals.every(literal => source.includes(literal))) continue;
        const match = entry.template.exec(source);
        if (!match) continue;
        const args = [];
        entry.slots.forEach((slot, n) => {
          const part = match[n+1];
          args[slot] = translate(part, depth + 1);
        });
        result = substitute(entry.translations[index], args);
        break;
      }
    }
    if (result === undefined) return original;
    return original.match(/^\s*/u)[0] + result + original.match(/\s*$/u)[0];
  }
  const format = (source, ...args) => substitute(translate(source), args);
  function renderBinding(el) {
    const {template, args} = bindings.get(el);
    const value = format(template, ...args);
    if (value !== el.textContent) el.textContent = value;
  }
  function bind(el, template, ...args) {
    bindings.set(el, {template, args});
    renderBinding(el);
  }

  function updateText(node) {
    const parent = node.parentElement;
    if (!parent || !node.data.trim() || parent.closest(blocked + ',textarea') || bindings.has(parent)) return;
    const previous = originals.get(node);
    const source = previous?.rendered === node.data ? previous.source : node.data;
    const rendered = translate(source);
    originals.set(node, {source, rendered});
    if (rendered !== node.data) {
      // Options without a value derive their submitted value from their label.
      if (parent.tagName === 'OPTION' && !parent.hasAttribute('value')) parent.value = source.trim();
      node.data = rendered;
    }
  }
  function updateAttribute(el, attribute) {
    if (!el.hasAttribute(attribute) || (attribute === 'content' && !el.matches('meta[name="description"]'))) return;
    const current = el.getAttribute(attribute);
    let cache = originalAttributes.get(el);
    if (!cache) { cache = new Map(); originalAttributes.set(el, cache); }
    const previous = cache.get(attribute);
    const source = previous?.rendered === current ? previous.source : current;
    const rendered = translate(source);
    cache.set(attribute, {source, rendered});
    if (rendered !== current) el.setAttribute(attribute, rendered);
  }
  function visit(node) {
    if (node.nodeType === Node.TEXT_NODE) { updateText(node); return; }
    if (node.nodeType !== Node.ELEMENT_NODE || node.closest(blocked)) return;
    for (const attr of attributes) updateAttribute(node, attr);
    if (bindings.has(node)) { renderBinding(node); return; }
    for (const child of node.childNodes) visit(child);
  }

  function refreshPickers() {
    const language = languages.find(item => item.tag === selected);
    for (const mount of document.querySelectorAll('[data-language-picker]')) {
      let select = mount.querySelector('select');
      if (!select) {
        mount.classList.add('rc-language');
        const label = document.createElement('label');
        const text = document.createElement('span');
        select = document.createElement('select');
        for (const item of languages) {
          const option = new Option(item.name, item.tag);
          option.lang = item.tag;
          select.add(option);
        }
        select.addEventListener('change', () => setLanguage(select.value));
        label.append(text, select); mount.append(label);
      }
      mount.querySelector('label > span').textContent = language.label;
      select.value = selected;
    }
  }
  function setLanguage(tag, persist = true) {
    if (!available(tag)) return;
    selected = tag;
    if (persist) {
      try { localStorage.setItem(preference, tag); } catch { /* Apply in this tab. */ }
    }
    document.documentElement.lang = tag;
    refreshPickers();
    visit(document.documentElement);
    window.dispatchEvent(new CustomEvent('rc-language-change', {detail:{language:tag}}));
  }
  window.RCI18n = {t:translate, format, bind, unbind:el => bindings.delete(el), setLanguage, get language() {return selected;}};
  // Use the selected interface language for native validation in every browser locale.
  function validationText(control) {
    const state = control.validity;
    if (state.badInput) return translate('Please enter a number.');
    if (state.valueMissing) return translate(control.tagName === 'SELECT' || control.type === 'checkbox' || control.type === 'radio'
      ? 'Please select an option.' : 'Please fill in this field.');
    if (state.tooShort) return format('Use at least {0} characters.', control.minLength);
    if (state.tooLong) return format('Use at most {0} characters.', control.maxLength);
    if (state.rangeUnderflow) return format('Enter a value of at least {0}.', control.min);
    if (state.rangeOverflow) return format('Enter a value of at most {0}.', control.max);
    if (state.patternMismatch) return translate('Use the requested format.');
    return translate('Please enter a valid value.');
  }
  function start() {
    document.addEventListener('invalid', event => {
      const control = event.target;
      if (!control.validity || control.validity.customError || !control.setCustomValidity) return;
      const message = validationText(control);
      control.setCustomValidity(message);
      // Clear the temporary custom error after the browser has displayed it so
      // that later edits, resets and programmatic value changes validate afresh.
      setTimeout(() => {
        if (control.validity.customError && control.validationMessage === message) control.setCustomValidity('');
      }, 0);
    }, true);
    document.documentElement.lang = selected;
    refreshPickers();
    visit(document.documentElement);
    new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'attributes') {
          if (!record.target.closest(blocked)) updateAttribute(record.target, record.attributeName);
        } else if (record.type === 'characterData') {
          updateText(record.target);
        } else {
          for (const node of record.addedNodes) if (node.isConnected) visit(node);
        }
      }
    }).observe(document.documentElement, {
      subtree:true, childList:true, characterData:true, attributes:true, attributeFilter:attributes
    });
  }
  window.addEventListener('storage', e => {
    if (e.key === preference) setLanguage(available(e.newValue) ? e.newValue : 'en', false);
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
  else start();
})();
