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
    this.quitAndInstallCalls = 0;
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

  quitAndInstall() {
    this.quitAndInstallCalls += 1;
  }
}

async function runUpdateRuntimeSmoke({ rootDir, outputDir }) {
  const failedChecks = [];
  const updater = new FakeAutoUpdater();
  const statuses = [];
  const debugLogPath = path.join(outputDir, 'update-debug.log');

  fs.mkdirSync(outputDir, { recursive: true });

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
    failedChecks.push('手动检查更新没有返回正确的可升级版本。');
  }

  if (statusAfterCheck.state !== 'available') {
    failedChecks.push(`检查更新后状态应为 available，实际是 ${statusAfterCheck.state || '(empty)'}。`);
  }

  const downloadResult = await runtime.downloadAvailableUpdate();

  if (!downloadResult.started || downloadResult.state !== 'downloading') {
    failedChecks.push('开始下载更新时没有立即返回 downloading 状态。');
  }

  await delay(80);
  const statusAfterDownload = runtime.getStatus();

  if (statusAfterDownload.state !== 'downloaded') {
    failedChecks.push(`下载完成后状态应为 downloaded，实际是 ${statusAfterDownload.state || '(empty)'}。`);
  }

  if (Number(statusAfterDownload.percent) !== 100) {
    failedChecks.push(`下载完成后进度应为 100%，实际是 ${statusAfterDownload.percent}%。`);
  }

  runtime.installDownloadedUpdate();
  const statusAfterInstall = runtime.getStatus();

  if (statusAfterInstall.state !== 'installing') {
    failedChecks.push(`点击安装后状态应为 installing，实际是 ${statusAfterInstall.state || '(empty)'}。`);
  }

  if (updater.quitAndInstallCalls !== 1) {
    failedChecks.push(`installDownloadedUpdate 应调用一次 quitAndInstall，实际是 ${updater.quitAndInstallCalls} 次。`);
  }

  const observedStates = statuses.map((item) => item.state);

  if (!observedStates.includes('checking') || !observedStates.includes('available')) {
    failedChecks.push('更新状态没有正确推送 checking/available。');
  }

  if (!observedStates.includes('downloading') || !observedStates.includes('downloaded')) {
    failedChecks.push('更新状态没有正确推送 downloading/downloaded。');
  }

  if (!observedStates.includes('installing')) {
    failedChecks.push('更新状态没有正确推送 installing。');
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
}

module.exports = {
  runUpdateRuntimeSmoke
};
