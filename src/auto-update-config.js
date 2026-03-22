'use strict';

function normalizePrefix(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeAutoUpdateConfig(rawConfig = {}) {
  const source = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
  const url = normalizePrefix(source.url || source.feedUrl || source.providerUrl);
  const intervalMinutes = Math.max(15, Number(source.intervalMinutes || source.checkMinutes || 180) || 180);
  const channel = normalizePrefix(source.channel) || 'latest';

  return {
    enabled: Boolean(url) && source.enabled !== false,
    url,
    channel,
    checkOnLaunch: source.checkOnLaunch !== false,
    intervalMinutes,
    allowPrerelease: source.allowPrerelease === true
  };
}

module.exports = {
  normalizeAutoUpdateConfig
};
