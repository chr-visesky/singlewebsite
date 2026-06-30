'use strict';

function createI18nRuntime(dependencies = {}) {
  const {
    fs,
    pathModule,
    projectRootPath,
    locale = 'zh-CN',
    fallbackLocale = 'en-US'
  } = dependencies;

  if (!fs) {
    throw new Error('i18n runtime requires fs.');
  }

  const path = pathModule || require('path');
  const cache = new Map();

  function localePath(localeName) {
    return path.join(projectRootPath, 'src', 'locales', `${localeName}.json`);
  }

  function readLocale(localeName) {
    const normalizedLocale = String(localeName || '').trim() || fallbackLocale;

    if (cache.has(normalizedLocale)) {
      return cache.get(normalizedLocale);
    }

    const filePath = localePath(normalizedLocale);
    let messages = {};

    if (fs.existsSync(filePath)) {
      messages = JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')) || {};
    }

    cache.set(normalizedLocale, messages);
    return messages;
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

  function t(key, fallback = '', variables = {}) {
    const value = getByKey(readLocale(locale), key);
    const fallbackValue = value === undefined ? getByKey(readLocale(fallbackLocale), key) : value;
    return format(fallbackValue === undefined ? fallback || key : fallbackValue, variables);
  }

  return {
    t
  };
}

module.exports = {
  createI18nRuntime
};
