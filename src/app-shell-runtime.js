'use strict';

function createAppShellRuntime(dependencies = {}) {
  const {
    app,
    BrowserWindow,
    dialog,
    attachMainWindowHandlers,
    getAppConfig,
    getMainWindow,
    loadHomePage,
    logNavigationDebug,
    pathModule,
    preloadPath,
    resolveWindowIconPath,
    sessionPartition,
    setMainWindow
  } = dependencies;

  function configureAutoLaunch() {
    if (!app.isPackaged) {
      return;
    }

    try {
      app.setLoginItemSettings({
        openAtLogin: true,
        path: process.execPath
      });
    } catch {
      // Ignore auto-launch configuration failures on unsupported machines.
    }
  }

  function focusMainWindow() {
    const mainWindow = getMainWindow();

    if (!mainWindow || mainWindow.isDestroyed()) {
      return false;
    }

    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    mainWindow.focus();
    return true;
  }

  function createMainWindow() {
    const appConfig = getAppConfig();
    logNavigationDebug('create-main-window');

    const mainWindow = new BrowserWindow({
      title: appConfig.appTitle,
      width: 1440,
      height: 960,
      show: false,
      icon: resolveWindowIconPath(),
      frame: true,
      autoHideMenuBar: true,
      fullscreenable: true,
      minimizable: true,
      maximizable: true,
      movable: true,
      kiosk: appConfig.kiosk,
      alwaysOnTop: appConfig.alwaysOnTop,
      backgroundColor: '#0f172a',
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

    setMainWindow(mainWindow);
    mainWindow.removeMenu();
    mainWindow.setMenuBarVisibility(false);
    mainWindow.setAlwaysOnTop(appConfig.alwaysOnTop, 'screen-saver');
    attachMainWindowHandlers();
    loadHomePage('create-main-window');
  }

  function showStartupError(error) {
    dialog.showErrorBox('启动失败', error.message);
  }

  return {
    configureAutoLaunch,
    createMainWindow,
    focusMainWindow,
    showStartupError
  };
}

module.exports = {
  createAppShellRuntime
};
