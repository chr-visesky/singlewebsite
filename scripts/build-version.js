'use strict';

function normalizePrefix(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function formatDateVersion(date = new Date()) {
  const year = date.getFullYear();
  const monthDay = (date.getMonth() + 1) * 100 + date.getDate();
  const timeCode = date.getHours() * 100 + date.getMinutes();
  return `${year}.${monthDay}.${timeCode}`;
}

function parseTaggedVersion(rawValue) {
  const matched = normalizePrefix(rawValue).match(/^v?(\d{4})\.(\d{2})\.(\d{2})-(\d{2})(\d{2})$/);

  if (!matched) {
    return '';
  }

  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const hour = Number(matched[4]);
  const minute = Number(matched[5]);

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(hour) || !Number.isFinite(minute)) {
    return '';
  }

  return `${year}.${month * 100 + day}.${hour * 100 + minute}`;
}

function normalizeSemver(rawValue) {
  const normalized = normalizePrefix(rawValue).replace(/^v/i, '');
  return /^\d+\.\d+\.\d+$/.test(normalized) ? normalized : '';
}

function resolveBuildVersion(options = {}) {
  const env = options.env && typeof options.env === 'object' ? options.env : process.env;
  const candidates = [
    env.STUDYGATE_APP_VERSION,
    env.GITHUB_REF_NAME,
    env.RELEASE_TAG,
    env.CI_COMMIT_TAG
  ];

  for (const candidate of candidates) {
    const taggedVersion = parseTaggedVersion(candidate);

    if (taggedVersion) {
      return taggedVersion;
    }

    const semver = normalizeSemver(candidate);

    if (semver) {
      return semver;
    }
  }

  return formatDateVersion(options.now instanceof Date ? options.now : new Date());
}

module.exports = {
  formatDateVersion,
  resolveBuildVersion
};
