/* Text-only UI translations. Catalog selection happens at build time. */
(() => {
  'use strict';
  const catalog = window.UW_UI_CATALOG || {sourceLocale:'en', locales:{en:{label:'English', messages:{}}}};
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const sourceKeys = new Map();
  const sourcePatterns = [];
  for (const [key, message] of Object.entries(catalog.locales[catalog.sourceLocale]?.messages || {})) {
    if (typeof message !== 'string') continue;
    if (!message.includes('{')) sourceKeys.set(message, key);
    else {
      const names = [], escaped = message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{([a-zA-Z][a-zA-Z0-9_]*)\\\}/g, (_, name) => { names.push(name); return '(.+?)'; });
      sourcePatterns.push({key, names, literal:message.replace(/\{[a-zA-Z][a-zA-Z0-9_]*\}/g, '').length, pattern:new RegExp(`^${escaped}$`, 's')});
    }
  }
  // Prefer the most specific template when generic measurement patterns also match.
  sourcePatterns.sort((a, b) => b.literal - a.literal || a.names.length - b.names.length);
  const supported = value => typeof value === 'string' && has(catalog.locales, value);
  let stored;
  try { stored = JSON.parse(localStorage.getItem('uw:locale')); } catch (_) {}
  const requested = new URLSearchParams(location.search).get('lang');
  let locale = supported(requested) ? requested : supported(stored) ? stored : catalog.sourceLocale;
  function t(key, values = {}) {
    const selected = catalog.locales[locale]?.messages || {}, fallback = catalog.locales[catalog.sourceLocale]?.messages || {};
    let message = has(selected, key) ? selected[key] : has(fallback, key) ? fallback[key] : undefined;
    if (message == null) return key;
    if (typeof message === 'object') {
      const category = new Intl.PluralRules(has(selected, key) ? locale : catalog.sourceLocale).select(Number(values.count));
      message = message[category] ?? message.other;
    }
    return message.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (token, name) => has(values, name) ? String(values[name]) : token);
  }
  function text(source, values = {}) {
    const exact = sourceKeys.get(source); if (exact) return t(exact, values);
    for (const candidate of sourcePatterns) {
      const match = candidate.pattern.exec(source); if (!match) continue;
      const found = {...values}; candidate.names.forEach((name, i) => { found[name] = match[i + 1]; });
      return t(candidate.key, found);
    }
    return source.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (token, name) => has(values, name) ? String(values[name]) : token);
  }
  // Never inject translated HTML; attributes are explicitly allowlisted.
  function apply(root = document) {
    const bindings = [['data-i18n', null], ['data-i18n-title','title'], ['data-i18n-placeholder','placeholder'], ['data-i18n-aria-label','aria-label']];
    for (const [marker, attr] of bindings) {
      const nodes = [...root.querySelectorAll(`[${marker}]`)];
      if (root.nodeType === 1 && root.hasAttribute(marker)) nodes.unshift(root);
      for (const node of nodes) {
        const value = t(node.getAttribute(marker));
        if (attr) { if (node.getAttribute(attr) !== value) node.setAttribute(attr, value); }
        else if (node.textContent !== value) node.textContent = value;
      }
    }
    for (const picker of root.querySelectorAll('[data-locale-picker]')) picker.value = locale;
    for (const node of root.querySelectorAll('[data-i18n-locale]')) node.lang = locale;
    const autoRoots = [];
    if (root.nodeType === 1 && root.matches('[data-i18n-auto]')) autoRoots.push(root);
    if (root.querySelectorAll) autoRoots.push(...root.querySelectorAll('[data-i18n-auto]'));
    for (const autoRoot of autoRoots) {
      const walker = document.createTreeWalker(autoRoot, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node.parentElement?.closest('script,style,[data-i18n-skip]')) continue;
        const raw = node.__uwTranslated === node.nodeValue ? node.__uwSource : node.nodeValue;
        const match = /^(\s*)(.*?)(\s*)$/s.exec(raw);
        if (!match) continue;
        const translated = text(match[2]);
        if (translated === match[2] && node.__uwSource == null) continue;
        node.__uwSource = raw;
        const rendered = match[1] + translated + match[3];
        if (node.nodeValue !== rendered) node.nodeValue = rendered;
        node.__uwTranslated = rendered;
      }
      for (const node of autoRoot.querySelectorAll('[aria-label],[placeholder],[title]')) {
        for (const attr of ['aria-label', 'placeholder', 'title']) {
          if (!node.hasAttribute(attr) || node.hasAttribute(`data-i18n-${attr}`)) continue;
          const property = `__uw_${attr}_source`, rendered = `__uw_${attr}_translated`;
          const source = node[rendered] === node.getAttribute(attr) ? node[property] : node.getAttribute(attr), translated = text(source);
          if (translated === source && node[property] == null) continue;
          node[property] = source;
          if (node.getAttribute(attr) !== translated) node.setAttribute(attr, translated);
          node[rendered] = translated;
        }
      }
    }
  }
  function setLocale(value) {
    if (!supported(value)) return false;
    locale = value;
    try { localStorage.setItem('uw:locale', JSON.stringify(locale)); } catch (_) {}
    try { const url = new URL(location.href); url.searchParams.set('lang', locale); history.replaceState(null, '', url); } catch (_) {}
    document.documentElement.lang = locale;
    apply();
    window.dispatchEvent(new CustomEvent('uw:localechange', {detail:{locale}}));
    return true;
  }
  function init() {
    for (const picker of document.querySelectorAll('[data-locale-picker]')) {
      picker.replaceChildren();
      for (const [code, data] of Object.entries(catalog.locales)) {
        const option = document.createElement('option'); option.value = code; option.textContent = data.label;
        picker.append(option);
      }
      picker.addEventListener('change', () => setLocale(picker.value));
    }
    document.documentElement.lang = locale;
    apply();
    const observer = new MutationObserver(records => {
      const roots = new Set();
      for (const record of records) {
        const element = record.target.nodeType === 1 ? record.target : record.target.parentElement;
        const root = element?.closest?.('[data-i18n-auto]'); if (root) roots.add(root);
      }
      for (const root of roots) apply(root);
    });
    for (const root of document.querySelectorAll('[data-i18n-auto]')) observer.observe(root, {subtree:true, childList:true, characterData:true, attributes:true, attributeFilter:['aria-label','placeholder','title']});
  }
  window.UWI18n = Object.freeze({t, text, apply, setLocale, get locale() { return locale; }});
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true}); else init();
})();
