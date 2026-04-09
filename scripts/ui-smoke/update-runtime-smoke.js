'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createAutoUpdateRuntime } = require('../../src/auto-update-runtime');

function normalizePrefix(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

class FakeAutoUpdater extends EventEmitter {
  constructor() {
    super();
    this.autoDownload = false;
    this.autoInstallOnAppQuit = true;
    this.allowPrerelease = false;
    this.downloadCalls = 0;
    this.quitAndInstallCalls = [];
    this.feedUrl = null;
  }

  setFeedURL(options) {
    this.feedUrl = options;
  }

  async checkForUpdates() {
    this.emit('checking-for-update');
    await delay(10);
    const updateInfo = { version: '2026.323.1900' };
    this.emit('update-available', updateInfo);
    return { updateInfo };
  }

  downloadUpdate() {
    this.downloadCalls += 1;
    return new Promise((resolve) => {
      setTimeout(() => {
        this.emit('download-progress', {
          bytesPerSecond: 1024 * 1024 * 2,
          percent: 24,
          total: 1024 * 1024 * 100,
          transferred: 1024 * 1024 * 24
        });
      }, 10);
      setTimeout(() => {
        this.emit('download-progress', {
          bytesPerSecond: 1024 * 1024 * 3,
          percent: 88,
          total: 1024 * 1024 * 100,
          transferred: 1024 * 1024 * 88
        });
      }, 20);
      setTimeout(() => {
        this.emit('update-downloaded', {
          version: '2026.323.1900'
        });
        resolve();
      }, 40);
    });
  }

  quitAndInstall(isSilent, isForceRunAfter) {
    this.quitAndInstallCalls.push({
      isSilent,
      isForceRunAfter
    });
  }
}

async function runUpdateRuntimeSmoke({ rootDir, outputDir }) {
  const failedChecks = [];
  const updater = new FakeAutoUpdater();
  const statuses = [];
  const debugLogPath = path.join(outputDir, 'update-debug.log');
  const resourcesDir = path.join(outputDir, 'resources');
  const packagedUpdateConfigPath = path.join(resourcesDir, 'app-update.yml');
  const originalResourcesPath = process.resourcesPath;

  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(resourcesDir, { recursive: true });
  fs.writeFileSync(
    packagedUpdateConfigPath,
    [
      'provider: generic',
      'url: https://updates.example.com/latest',
      'channel: latest',
      'updaterCacheDirName: singlewebsite-updater',
      ''
    ].join('\n'),
    'utf8'
  );

  Object.defineProperty(process, 'resourcesPath', {
    configurable: true,
    value: resourcesDir
  });

  try {
    const runtime = createAutoUpdateRuntime({
      Notification: class {
        show() {}
      },
      app: {
        getVersion: () => '2026.323.1849',
        isPackaged: true
      },
      autoUpdater: updater,
      emitStatusChanged: (status) => {
        statuses.push({
          ...status
        });
      },
      fs,
      getAppConfig: () => ({
        autoUpdate: {
          channel: 'latest',
          enabled: true,
          intervalMinutes: 180,
          url: 'https://updates.example.com/latest'
        }
      }),
      logNavigationDebug() {},
      normalizePrefix,
      runtimePaths: {
        updateDebugLogPath: () => debugLogPath
      }
    });

    const checkResult = await runtime.checkForUpdates({
      reason: 'manual',
      autoDownload: false
    });
    const statusAfterCheck = runtime.getStatus();

    if (!checkResult.hasUpdate || checkResult.availableVersion !== '2026.323.1900') {
      failedChecks.push('Manual update check did not return the expected available version.');
    }

    if (statusAfterCheck.state !== 'available') {
      failedChecks.push(`Status after check should be available, got ${statusAfterCheck.state || '(empty)'}.`);
    }

    const downloadResult = await runtime.downloadAvailableUpdate();

    if (!downloadResult.started || downloadResult.state !== 'downloading') {
      failedChecks.push('Downloading an available update did not immediately return the downloading state.');
    }

    await delay(80);
    const statusAfterDownload = runtime.getStatus();

    if (statusAfterDownload.state !== 'downloaded') {
      failedChecks.push(`Status after download should be downloaded, got ${statusAfterDownload.state || '(empty)'}.`);
    }

    if (Number(statusAfterDownload.percent) !== 100) {
      failedChecks.push(`Download percent should be 100 after completion, got ${statusAfterDownload.percent}%.`);
    }

    if (statusAfterDownload.latestVersion !== '2026.323.1900' || statusAfterDownload.hasUpdate !== true) {
      failedChecks.push('Downloaded status did not preserve latestVersion/hasUpdate for renderer updates.');
    }

    runtime.installDownloadedUpdate();
    const statusAfterInstall = runtime.getStatus();

    if (statusAfterInstall.state !== 'installing') {
      failedChecks.push(`Status after install should be installing, got ${statusAfterInstall.state || '(empty)'}.`);
    }

    if (updater.quitAndInstallCalls.length !== 1) {
      failedChecks.push(`installDownloadedUpdate should call quitAndInstall exactly once, got ${updater.quitAndInstallCalls.length}.`);
    } else {
      const installCall = updater.quitAndInstallCalls[0];
      if (installCall.isSilent !== true || installCall.isForceRunAfter !== true) {
        failedChecks.push('installDownloadedUpdate should request a silent installer run that relaunches after install.');
      }
    }

    const observedStates = statuses.map((item) => item.state);

    if (!observedStates.includes('checking') || !observedStates.includes('available')) {
      failedChecks.push('Status push stream is missing checking/available.');
    }

    if (!observedStates.includes('downloading') || !observedStates.includes('downloaded')) {
      failedChecks.push('Status push stream is missing downloading/downloaded.');
    }

    if (!observedStates.includes('installing')) {
      failedChecks.push('Status push stream is missing installing.');
    }

    return {
      passed: failedChecks.length === 0,
      failedChecks,
      checkResult,
      downloadResult,
      observedStates,
      statusAfterCheck,
      statusAfterDownload,
      statusAfterInstall
    };
  } finally {
    Object.defineProperty(process, 'resourcesPath', {
      configurable: true,
      value: originalResourcesPath
    });
  }
}

module.exports = {
  runUpdateRuntimeSmoke
};
