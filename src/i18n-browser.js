'use strict';

(function bootstrapI18n(globalObject) {
  const cache = new Map();
  const fallbackLocale = 'en-US';

  function normalizeLocale(value) {
    const normalized = String(value || '').trim();
    return normalized || 'zh-CN';
  }

  function getByKey(messages, key) {
    return String(key || '')
      .split('.')
      .filter(Boolean)
      .reduce((current, part) => {
        if (!current || typeof current !== 'object') {
          return undefined;
        }

        return current[part];
      }, messages);
  }

  function format(message, variables = {}) {
    return String(message === undefined || message === null ? '' : message).replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) => {
      return Object.prototype.hasOwnProperty.call(variables, name) ? String(variables[name]) : match;
    });
  }

  async function readLocale(locale) {
    const normalizedLocale = normalizeLocale(locale);

    if (cache.has(normalizedLocale)) {
      return cache.get(normalizedLocale);
    }

    const response = await fetch(`./locales/${encodeURIComponent(normalizedLocale)}.json`, {
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(`Unable to load locale: ${normalizedLocale}`);
    }

    const messages = await response.json();
    cache.set(normalizedLocale, messages || {});
    return messages || {};
  }

  async function createI18n(options = {}) {
    const params = new URLSearchParams(globalObject.location.search);
    const requestedLocale = normalizeLocale(
      params.get('lang') ||
        globalObject.localStorage.getItem('studygateLocale') ||
        'zh-CN'
    );
    const primary = await readLocale(requestedLocale).catch(() => readLocale('zh-CN'));
    const fallback = requestedLocale === fallbackLocale ? primary : await readLocale(fallbackLocale).catch(() => ({}));

    function t(key, fallbackText = '', variables = {}) {
      const value = getByKey(primary, key);
      const fallbackValue = value === undefined ? getByKey(fallback, key) : value;
      return format(fallbackValue === undefined ? fallbackText || key : fallbackValue, variables);
    }

    if (options.persist !== false) {
      globalObject.localStorage.setItem('studygateLocale', requestedLocale);
    }

    return {
      locale: requestedLocale,
      t
    };
  }

  globalObject.studyGateI18n = {
    createI18n
  };
})(window);
