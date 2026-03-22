'use strict';

function createAutoUpdateRuntime(options = {}) {
  const {
    Notification,
    app,
    autoUpdater,
    fs,
    getAppConfig,
    logNavigationDebug,
    normalizePrefix,
    runtimePaths
  } = options;

  let initialized = false;
  let intervalHandle = null;
  let checkPromise = null;
  let activeCheckReason = 'auto';
  let lastStatus = {
    state: 'idle',
    currentVersion: app.getVersion(),
    availableVersion: '',
    updatedAt: ''
  };

  function compareVersions(left, right) {
    const leftParts = String(left || '')
      .split('.')
      .map((part) => Number.parseInt(part, 10))
      .filter((part) => Number.isFinite(part));
    const rightParts = String(right || '')
      .split('.')
      .map((part) => Number.parseInt(part, 10))
      .filter((part) => Number.isFinite(part));
    const length = Math.max(leftParts.length, rightParts.length);

    for (let index = 0; index < length; index += 1) {
      const leftPart = leftParts[index] || 0;
      const rightPart = rightParts[index] || 0;

      if (leftPart > rightPart) {
        return 1;
      }

      if (leftPart < rightPart) {
        return -1;
      }
    }

    return 0;
  }

  function getCurrentVersion() {
    return normalizePrefix(app.getVersion());
  }

  function hasNewerAvailableVersion(version) {
    return Boolean(version) && compareVersions(getCurrentVersion(), version) < 0;
  }

  function logUpdater(event, details = {}) {
    const payload = {
      ...details,
      event,
      at: new Date().toISOString()
    };

    try {
      fs.appendFileSync(
        runtimePaths.updateDebugLogPath(),
        `${JSON.stringify(payload)}\n`,
        'utf8'
      );
    } catch {
      // Ignore update log failures.
    }

    logNavigationDebug(`auto-update:${event}`, details);
  }

  function updateStatus(state, details = {}) {
    lastStatus = {
      ...lastStatus,
      ...details,
      state,
      updatedAt: new Date().toISOString()
    };
    logUpdater(state, details);
  }

  function currentConfig() {
    const appConfig = getAppConfig();
    return appConfig && appConfig.autoUpdate ? appConfig.autoUpdate : { enabled: false };
  }

  function updaterEnabled(autoUpdateConfig = currentConfig()) {
    return Boolean(app.isPackaged && autoUpdateConfig.enabled && autoUpdateConfig.url);
  }

  function configureUpdater(autoDownload) {
    const autoUpdateConfig = currentConfig();

    autoUpdater.allowPrerelease = autoUpdateConfig.allowPrerelease === true;
    autoUpdater.autoDownload = autoDownload;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: autoUpdateConfig.url,
      channel: autoUpdateConfig.channel || 'latest'
    });

    return autoUpdateConfig;
  }

  function notify(title, body) {
    try {
      const notification = new Notification({
        title,
        body
      });
      notification.show();
    } catch {
      // Ignore notification failures.
    }
  }

  async function checkForUpdates(options = {}) {
    const autoUpdateConfig = currentConfig();
    const reason = normalizePrefix(options.reason) || 'auto';
    const autoDownload = options.autoDownload !== false;
    const currentVersion = getCurrentVersion();

    if (!app.isPackaged || !autoUpdateConfig.enabled || !autoUpdateConfig.url) {
      updateStatus('disabled', {
        enabled: autoUpdateConfig.enabled === true,
        packaged: app.isPackaged,
        url: autoUpdateConfig.url
      });
      return {
        checked: false,
        currentVersion,
        availableVersion: '',
        hasUpdate: false,
        state: 'disabled'
      };
    }

    if (checkPromise) {
      return checkPromise;
    }

    checkPromise = (async () => {
      activeCheckReason = reason;
      configureUpdater(autoDownload);
      updateStatus('checking', {
        feedUrl: autoUpdateConfig.url,
        channel: autoUpdateConfig.channel || 'latest',
        reason
      });

      const result = await autoUpdater.checkForUpdates();
      const updateInfo = result && result.updateInfo ? result.updateInfo : {};
      const availableVersion = normalizePrefix(updateInfo.version || lastStatus.availableVersion);

      return {
        checked: true,
        currentVersion,
        availableVersion,
        hasUpdate: hasNewerAvailableVersion(availableVersion),
        state: lastStatus.state
      };
    })();

    try {
      return await checkPromise;
    } finally {
      checkPromise = null;
      activeCheckReason = 'auto';
    }
  }

  async function getManualCheckSnapshot() {
    registerHandlers();

    const currentVersion = getCurrentVersion();
    const autoUpdateConfig = currentConfig();

    return {
      currentVersion,
      latestVersion: normalizePrefix(lastStatus.availableVersion),
      hasUpdate: hasNewerAvailableVersion(lastStatus.availableVersion),
      enabled: updaterEnabled(autoUpdateConfig),
      state: lastStatus.state,
      percent: Number(lastStatus.percent) || 0,
      message: normalizePrefix(lastStatus.message)
    };
  }

  async function downloadAvailableUpdate() {
    registerHandlers();

    const autoUpdateConfig = currentConfig();

    if (!updaterEnabled(autoUpdateConfig)) {
      return {
        started: false,
        state: 'disabled',
        currentVersion: getCurrentVersion(),
        latestVersion: '',
        hasUpdate: false
      };
    }

    const availableVersion = normalizePrefix(lastStatus.availableVersion);

    if (!hasNewerAvailableVersion(availableVersion)) {
      return {
        started: false,
        state: lastStatus.state,
        currentVersion: getCurrentVersion(),
        latestVersion: availableVersion,
        hasUpdate: false
      };
    }

    configureUpdater(true);
    updateStatus('downloading', {
      availableVersion,
      percent: Number(lastStatus.percent) || 0
    });
    await autoUpdater.downloadUpdate();

    return {
      started: true,
      state: lastStatus.state,
      currentVersion: getCurrentVersion(),
      latestVersion: availableVersion,
      hasUpdate: true
    };
  }

  function installDownloadedUpdate() {
    autoUpdater.quitAndInstall(false, true);
  }

  function registerHandlers() {
    if (initialized) {
      return;
    }

    initialized = true;

    autoUpdater.on('checking-for-update', () => {
      updateStatus('checking');
    });

    autoUpdater.on('update-available', (info = {}) => {
      const version = normalizePrefix(info.version);
      updateStatus('available', {
        availableVersion: version
      });

      if (activeCheckReason !== 'manual' && autoUpdater.autoDownload !== false) {
        notify('StudyGate 检测到新版本', `正在下载 ${version || '最新版本'}。`);
      }
    });

    autoUpdater.on('update-not-available', () => {
      updateStatus('idle', {
        availableVersion: ''
      });
    });

    autoUpdater.on('download-progress', (progress = {}) => {
      updateStatus('downloading', {
        availableVersion: lastStatus.availableVersion,
        percent: Number(progress.percent) || 0
      });
    });

    autoUpdater.on('update-downloaded', (info = {}) => {
      const version = normalizePrefix(info.version);
      updateStatus('downloaded', {
        availableVersion: version
      });
      notify('StudyGate 更新已就绪', `版本 ${version || '最新版本'} 已下载，将在下次退出时自动安装。`);
    });

    autoUpdater.on('error', (error) => {
      updateStatus('error', {
        message: error && error.message ? error.message : String(error)
      });
    });
  }

  function start() {
    registerHandlers();

    const autoUpdateConfig = currentConfig();

    if (!autoUpdateConfig.enabled) {
      updateStatus('disabled', {
        enabled: false
      });
      return;
    }

    if (autoUpdateConfig.checkOnLaunch !== false) {
      void checkForUpdates().catch((error) => {
        updateStatus('error', {
          message: error && error.message ? error.message : String(error)
        });
      });
    }

    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }

    intervalHandle = setInterval(() => {
      void checkForUpdates().catch((error) => {
        updateStatus('error', {
          message: error && error.message ? error.message : String(error)
        });
      });
    }, Math.max(15, Number(autoUpdateConfig.intervalMinutes) || 180) * 60 * 1000);
  }

  function stop() {
    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
  }

  return {
    checkForUpdates,
    downloadAvailableUpdate,
    getStatus: () => ({ ...lastStatus }),
    getManualCheckSnapshot,
    installDownloadedUpdate,
    start,
    stop
  };
}

module.exports = {
  createAutoUpdateRuntime
};
