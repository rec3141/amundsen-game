import { messages } from './i18n-source.js';

// Standalone minigame imports retain English without requiring the browser shell.
export function t(key, values = {}) {
  if (globalThis.UWI18n) return globalThis.UWI18n.t(key, values);
  let message = messages[key] ?? key;
  if (typeof message === 'object') {
    message = message[new Intl.PluralRules('en').select(Number(values.count))] ?? message.other;
  }
  return message.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g,
    (token, name) => Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : token);
}

export function text(source, values = {}) {
  if (globalThis.UWI18n) return globalThis.UWI18n.text(source, values);
  return source.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g,
    (token, name) => Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : token);
}
