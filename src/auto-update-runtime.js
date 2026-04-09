'use strict';

const path = require('path');

function createAutoUpdateRuntime(options = {}) {
  const {
    Notification,
    app,
    autoUpdater,
    closeExitPasswordWindow,
    emitStatusChanged,
    fs,
    getAppConfig,
    logNavigationDebug,
    normalizePrefix,
    runtimePaths,
    setAllowAppQuit
  } = options;

  let initialized = false;
  let intervalHandle = null;
  let checkPromise = null;
  let downloadPromise = null;
  let activeCheckReason = 'auto';
  let lastStatus = {
    state: 'idle',
    currentVersion: app.getVersion(),
    availableVersion: '',
    bytesPerSecond: 0,
    percent: 0,
    totalBytes: 0,
    transferredBytes: 0,
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

  function packagedUpdateConfigPath() {
    return path.join(process.resourcesPath || '', 'app-update.yml');
  }

  function packagedUpdateConfigExists() {
    const configPath = packagedUpdateConfigPath();

    try {
      return Boolean(configPath) && typeof fs.existsSync === 'function' && fs.existsSync(configPath);
    } catch {
      return false;
    }
  }

  function assertPackagedUpdateConfigExists() {
    const configPath = packagedUpdateConfigPath();
    const exists = packagedUpdateConfigExists();

    logUpdater('packaged-update-config-check', {
      configPath,
      exists
    });

    if (!exists) {
      throw new Error(`Missing packaged updater config: ${configPath}`);
    }
  }

  function buildStatusSnapshot(details = {}) {
    const autoUpdateConfig = currentConfig();
    const currentVersion = getCurrentVersion();
    const availableVersion = normalizePrefix(details.availableVersion || lastStatus.availableVersion);

    return {
      ...lastStatus,
      ...details,
      currentVersion,
      latestVersion: availableVersion,
      availableVersion,
      enabled: updaterEnabled(autoUpdateConfig),
      hasUpdate: hasNewerAvailableVersion(availableVersion)
    };
  }

  function updateStatus(state, details = {}) {
    lastStatus = buildStatusSnapshot({
      ...details,
      state,
      updatedAt: new Date().toISOString()
    });
    logUpdater(state, details);
    try {
      if (typeof emitStatusChanged === 'function') {
        emitStatusChanged({ ...lastStatus });
      }
    } catch {
      // Ignore renderer notification failures.
    }
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
    const configPath = packagedUpdateConfigPath();

    autoUpdater.allowPrerelease = autoUpdateConfig.allowPrerelease === true;
    autoUpdater.autoDownload = autoDownload;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: autoUpdateConfig.url,
      channel: autoUpdateConfig.channel || 'latest'
    });

    logUpdater('configured', {
      autoDownload,
      channel: autoUpdateConfig.channel || 'latest',
      feedUrl: autoUpdateConfig.url,
      packaged: app.isPackaged,
      packagedUpdateConfigExists: packagedUpdateConfigExists(),
      packagedUpdateConfigPath: configPath
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
    registerHandlers();
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
        message: '',
        percent: 0,
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
    const snapshot = buildStatusSnapshot();

    return {
      bytesPerSecond: Number(snapshot.bytesPerSecond) || 0,
      currentVersion: snapshot.currentVersion,
      latestVersion: snapshot.latestVersion,
      hasUpdate: snapshot.hasUpdate,
      enabled: snapshot.enabled,
      state: snapshot.state,
      percent: Number(snapshot.percent) || 0,
      totalBytes: Number(snapshot.totalBytes) || 0,
      transferredBytes: Number(snapshot.transferredBytes) || 0,
      message: normalizePrefix(snapshot.message)
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

    if (downloadPromise) {
      return {
        started: false,
        state: lastStatus.state,
        currentVersion: getCurrentVersion(),
        latestVersion: availableVersion,
        hasUpdate: true
      };
    }

    configureUpdater(true);
    assertPackagedUpdateConfigExists();
    updateStatus('downloading', {
      availableVersion,
      bytesPerSecond: 0,
      percent: Number(lastStatus.percent) || 0,
      totalBytes: Number(lastStatus.totalBytes) || 0,
      transferredBytes: Number(lastStatus.transferredBytes) || 0
    });
    downloadPromise = autoUpdater.downloadUpdate()
      .catch((error) => {
        updateStatus('error', {
          message: error && error.message ? error.message : String(error)
        });
        throw error;
      })
      .finally(() => {
        downloadPromise = null;
      });

    return {
      started: true,
      state: 'downloading',
      currentVersion: getCurrentVersion(),
      latestVersion: availableVersion,
      hasUpdate: true
    };
  }

  function prepareForInstall() {
    try {
      if (typeof setAllowAppQuit === 'function') {
        setAllowAppQuit(true);
      }
    } catch {
      // Ignore allow-quit failures and let the installer try anyway.
    }

    try {
      if (typeof closeExitPasswordWindow === 'function') {
        closeExitPasswordWindow();
      }
    } catch {
      // Ignore exit dialog cleanup failures.
    }
  }

  function installDownloadedUpdate() {
    registerHandlers();
    logUpdater('install-requested', {
      availableVersion: lastStatus.availableVersion,
      packagedUpdateConfigExists: packagedUpdateConfigExists(),
      packagedUpdateConfigPath: packagedUpdateConfigPath()
    });
    prepareForInstall();
    updateStatus('installing', {
      availableVersion: lastStatus.availableVersion,
      message: '',
      percent: 100
    });
    autoUpdater.quitAndInstall(true, true);
  }

  function registerHandlers() {
    if (initialized) {
      return;
    }

    initialized = true;

    autoUpdater.on('checking-for-update', () => {
      updateStatus('checking', {
        message: '',
        percent: 0
      });
    });

    autoUpdater.on('update-available', (info = {}) => {
      const version = normalizePrefix(info.version);
      updateStatus('available', {
        availableVersion: version,
        message: '',
        percent: 0
      });

      if (activeCheckReason !== 'manual' && autoUpdater.autoDownload !== false) {
        notify('StudyGate 检测到新版本', `正在下载 ${version || '最新版本'}。`);
      }
    });

    autoUpdater.on('update-not-available', () => {
      updateStatus('idle', {
        availableVersion: '',
        bytesPerSecond: 0,
        message: '',
        percent: 0,
        totalBytes: 0,
        transferredBytes: 0
      });
    });

    autoUpdater.on('download-progress', (progress = {}) => {
      updateStatus('downloading', {
        availableVersion: lastStatus.availableVersion,
        bytesPerSecond: Number(progress.bytesPerSecond) || 0,
        message: '',
        percent: Number(progress.percent) || 0,
        totalBytes: Number(progress.total) || 0,
        transferredBytes: Number(progress.transferred) || 0
      });
    });

    autoUpdater.on('update-downloaded', (info = {}) => {
      const version = normalizePrefix(info.version);
      updateStatus('downloaded', {
        availableVersion: version,
        bytesPerSecond: 0,
        message: '',
        percent: 100,
        totalBytes: Number(lastStatus.totalBytes) || 0,
        transferredBytes: Number(lastStatus.totalBytes || lastStatus.transferredBytes) || 0
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
    getStatus: () => buildStatusSnapshot(),
    getManualCheckSnapshot,
    installDownloadedUpdate,
    start,
    stop
  };
}

module.exports = {
  createAutoUpdateRuntime
};
