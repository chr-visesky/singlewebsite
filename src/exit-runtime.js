'use strict';

function createExitRuntime(dependencies = {}) {
  const {
    BrowserWindow,
    getAppConfig,
    getMainWindow,
    getAllowAppQuit,
    setAllowAppQuit,
    hashExitPassword,
    normalizePrefix,
    pathModule,
    preloadPath,
    quitApp,
    resolveWindowIconPath,
    sessionPartition
  } = dependencies;

  let exitPasswordWindow = null;

  function hasConfiguredExitPassword() {
    const appConfig = getAppConfig();
    return Boolean(
      appConfig &&
        appConfig.controlSettings &&
        appConfig.controlSettings.exitPasswordHash &&
        appConfig.controlSettings.exitPasswordSalt
    );
  }

  function verifyExitPassword(password) {
    const appConfig = getAppConfig();

    if (!hasConfiguredExitPassword()) {
      return true;
    }

    const normalizedPassword = normalizePrefix(password);

    if (!normalizedPassword) {
      return false;
    }

    const settings = appConfig.controlSettings;
    return hashExitPassword(normalizedPassword, settings.exitPasswordSalt) === settings.exitPasswordHash;
  }

  function closeExitPasswordWindow() {
    if (exitPasswordWindow && !exitPasswordWindow.isDestroyed()) {
      exitPasswordWindow.close();
    }

    exitPasswordWindow = null;
  }

  function exitPasswordPagePath() {
    return pathModule.join(__dirname, 'exit-verify.html');
  }

  function focusExitPasswordWindow() {
    if (!exitPasswordWindow || exitPasswordWindow.isDestroyed()) {
      return false;
    }

    if (exitPasswordWindow.isMinimized()) {
      exitPasswordWindow.restore();
    }

    exitPasswordWindow.focus();
    return true;
  }

  function exitVerificationModel() {
    const appConfig = getAppConfig();
    return {
      appTitle: appConfig ? appConfig.appTitle : 'StudyGate',
      hasExitPassword: hasConfiguredExitPassword()
    };
  }

  function requestAppQuit() {
    if (getAllowAppQuit()) {
      quitApp();
      return;
    }

    if (!hasConfiguredExitPassword()) {
      setAllowAppQuit(true);
      quitApp();
      return;
    }

    if (focusExitPasswordWindow()) {
      return;
    }

    const mainWindow = getMainWindow();
    exitPasswordWindow = new BrowserWindow({
      title: '退出验证',
      width: 420,
      height: 360,
      icon: resolveWindowIconPath(),
      parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : null,
      modal: Boolean(mainWindow && !mainWindow.isDestroyed()),
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#f4ebdd',
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        devTools: false,
        spellcheck: false,
        preload: preloadPath,
        partition: sessionPartition
      }
    });

    exitPasswordWindow.removeMenu();
    exitPasswordWindow.setMenuBarVisibility(false);
    exitPasswordWindow.on('closed', () => {
      exitPasswordWindow = null;
    });
    exitPasswordWindow.once('ready-to-show', () => {
      if (exitPasswordWindow && !exitPasswordWindow.isDestroyed()) {
        exitPasswordWindow.show();
        exitPasswordWindow.focus();
      }
    });
    void exitPasswordWindow.loadFile(exitPasswordPagePath());
  }

  return {
    closeExitPasswordWindow,
    exitVerificationModel,
    hasConfiguredExitPassword,
    requestAppQuit,
    verifyExitPassword
  };
}

module.exports = {
  createExitRuntime
};
