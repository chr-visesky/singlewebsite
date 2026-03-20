'use strict';

const path = require('path');

function dedupe(items) {
  return [...new Set(items)];
}

function createBannerAssetLoader({ app, fs, path, processCwd, processExecPath }) {
  const assetCache = new Map();

  function candidateAssetFiles(baseName) {
    return dedupe([
      path.join(processCwd(), 'banner', `${baseName}.png`),
      path.join(processCwd(), 'banner', `${baseName}.svg`),
      path.join(path.dirname(processExecPath), 'banner', `${baseName}.png`),
      path.join(path.dirname(processExecPath), 'banner', `${baseName}.svg`),
      path.join(app.getAppPath(), 'banner', `${baseName}.png`),
      path.join(app.getAppPath(), 'banner', `${baseName}.svg`)
    ]);
  }

  function bannerAssetPath(baseName) {
    return candidateAssetFiles(baseName).find((candidatePath) => fs.existsSync(candidatePath)) || '';
  }

  function bannerAssetDataUrl(baseName) {
    const assetPath = bannerAssetPath(baseName);

    if (!assetPath) {
      return '';
    }

    const cacheKey = assetPath;

    try {
      const stats = fs.statSync(assetPath);
      const cached = assetCache.get(cacheKey);

      if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
        return cached.dataUrl;
      }

      const extension = path.extname(assetPath).toLowerCase();
      const dataUrl =
        extension === '.svg'
          ? `data:image/svg+xml;base64,${fs.readFileSync(assetPath).toString('base64')}`
          : `data:image/png;base64,${fs.readFileSync(assetPath).toString('base64')}`;

      assetCache.set(cacheKey, {
        mtimeMs: stats.mtimeMs,
        size: stats.size,
        dataUrl
      });

      return dataUrl;
    } catch {
      return '';
    }
  }

  return {
    bannerAssetDataUrl,
    bannerAssetPath,
    homeNoticeImageDataUrl() {
      return bannerAssetDataUrl('home-notice');
    },
    navigationBannerDataUrl() {
      return bannerAssetDataUrl('navigation-banner');
    }
  };
}

function createStatePathHelpers(getStateDir) {
  const resolveStateDir = () => {
    const stateDir = typeof getStateDir === 'function' ? getStateDir() : '';
    return typeof stateDir === 'string' ? stateDir : '';
  };

  return {
    navigationDebugLogPath() {
      return path.join(resolveStateDir(), 'navigation-debug.log');
    },
    netdiskStatePath() {
      return path.join(resolveStateDir(), 'baidu-netdisk-state.json');
    },
    originStorageStatePath() {
      return path.join(resolveStateDir(), 'origin-storage-state.json');
    },
    reminderDebugLogPath() {
      return path.join(resolveStateDir(), 'reminder-debug.log');
    },
    remoteScheduleCachePath() {
      return path.join(resolveStateDir(), 'study-schedule-cache.json');
    },
    sessionStatePath() {
      return path.join(resolveStateDir(), 'session-state.json');
    },
    siteCredentialStatePath() {
      return path.join(resolveStateDir(), 'site-credentials.bin');
    },
    studySchedulePath() {
      return path.join(resolveStateDir(), 'study-schedule.json');
    },
    studyToolsStatePath() {
      return path.join(resolveStateDir(), 'study-tools-state.json');
    }
  };
}

module.exports = {
  createBannerAssetLoader,
  createStatePathHelpers
};
