'use strict';

function registerShellIpc(dependencies = {}) {
  const {
    app,
    ipcMain,
    normalizePrefix,
    defaultUiZoomFactor,
    getOriginStorageSnapshot,
    setOriginStorageSnapshot,
    getSiteCredentialSnapshot,
    saveSiteCredentialSnapshot,
    clearCourseSiteState,
    isClassroomShellActive,
    getActiveClassroomShell,
    syncClassroomBrowserView,
    logClassroomMediaDebug,
    logNavigationDebug,
    getAppConfig,
    syncRemoteStudySchedule,
    buildHomeModel,
    buildLibraryModel,
    buildLibraryFolderModel,
    buildStudentPlanResponse,
    persistStudentStudySchedule,
    authorizeNetdisk,
    launchStudyEntry,
    buildStudyScheduleModel,
    markScheduleCompletedForToday,
    currentNavigationModel,
    goBackIfPossible,
    goForwardIfPossible,
    getMainWindow,
    getCurrentWindowZoomFactor,
    applyWindowZoomFactor,
    navigateMainWindow,
    updateClassroomShellTopHeight,
    exitVerificationModel,
    hasConfiguredExitPassword,
    verifyExitPassword,
    setAllowAppQuit,
    closeExitPasswordWindow
  } = dependencies;

  ipcMain.on('shell:get-origin-storage-sync', (event, payload = {}) => {
    event.returnValue = getOriginStorageSnapshot(normalizePrefix(payload.url));
  });

  ipcMain.on('shell:save-origin-storage', (_event, payload = {}) => {
    setOriginStorageSnapshot(payload);
  });

  ipcMain.handle('shell:get-site-credentials', async (_event, payload = {}) =>
    getSiteCredentialSnapshot(normalizePrefix(payload.url))
  );

  ipcMain.on('shell:save-site-credentials', (_event, payload = {}) => {
    saveSiteCredentialSnapshot(payload);
  });

  ipcMain.on('shell:update-toolbar-height', (_event, payload = {}) => {
    updateClassroomShellTopHeight(payload.height);
  });

  ipcMain.on('shell:log-classroom-media-event', (_event, payload = {}) => {
    const safePayload = payload && typeof payload === 'object' ? payload : {};
    logNavigationDebug('classroom-media-runtime', safePayload);
    if (typeof logClassroomMediaDebug === 'function') {
      logClassroomMediaDebug('renderer-media-runtime', safePayload);
    }
  });

  ipcMain.handle('shell:reset-course-site-state', async () => {
    await clearCourseSiteState();

    if (isClassroomShellActive() && getActiveClassroomShell()) {
      await syncClassroomBrowserView({
        targetUrl: getActiveClassroomShell().targetUrl,
        forceLoad: true
      });
    }
  });

  ipcMain.handle('shell:refresh-current-classroom', async () => {
    if (!isClassroomShellActive() || !getActiveClassroomShell()) {
      return { success: false };
    }

    await syncClassroomBrowserView({
      targetUrl: getActiveClassroomShell().targetUrl,
      forceLoad: true
    });
    return { success: true };
  });

  ipcMain.handle('shell:get-home-model', async (_event, options = {}) => {
    const appConfig = getAppConfig();

    if (options && options.syncRemote && appConfig.remoteSchedule.enabled) {
      await syncRemoteStudySchedule();
    }

    return buildHomeModel();
  });

  ipcMain.handle('shell:get-library-model', async (_event, libraryId) => buildLibraryModel(libraryId));
  ipcMain.handle('shell:reload-library-model', async (_event, libraryId) => buildLibraryModel(libraryId));
  ipcMain.handle('shell:get-library-folder-model', async (_event, libraryId, folderPath) =>
    buildLibraryFolderModel(libraryId, folderPath));

  ipcMain.handle('shell:get-student-plan-model', async (_event, options = {}) =>
    buildStudentPlanResponse({
      monthKey: normalizePrefix(options.monthKey),
      selectedDate: normalizePrefix(options.selectedDate)
    }));

  ipcMain.handle('shell:save-student-plan-items', async (_event, payload = {}) => {
    await persistStudentStudySchedule(payload && Array.isArray(payload.items) ? payload.items : []);

    return buildStudentPlanResponse({
      monthKey: normalizePrefix(payload.monthKey),
      selectedDate: normalizePrefix(payload.selectedDate)
    });
  });

  ipcMain.handle('shell:authorize-netdisk', async () => authorizeNetdisk());

  ipcMain.handle('shell:enter-study-target', async (_event, payload = {}) =>
    ({
      ...launchStudyEntry(normalizePrefix(payload.target), {
        scheduleId: normalizePrefix(payload.scheduleId),
        scheduleTargetId: normalizePrefix(payload.scheduleTargetId),
        libraryId: normalizePrefix(payload.libraryId),
        libraryTitle: normalizePrefix(payload.libraryTitle)
      }),
      todaySchedule: buildStudyScheduleModel()
    }));

  ipcMain.handle('shell:complete-study-schedule', async (_event, payload = {}) => {
    const completion = markScheduleCompletedForToday(
      {
        scheduleId: normalizePrefix(payload.scheduleId)
      },
      new Date()
    );

    if (completion && completion.blocked) {
      throw new Error('还没到打卡时间。');
    }

    return {
      success: true,
      todaySchedule: buildStudyScheduleModel()
    };
  });

  ipcMain.handle('shell:get-navigation-model', async () => currentNavigationModel());

  ipcMain.handle('shell:go-back', async () => {
    goBackIfPossible();
    return { success: true };
  });

  ipcMain.handle('shell:go-forward', async () => {
    goForwardIfPossible();
    return { success: true };
  });

  ipcMain.handle('shell:toggle-window-fullscreen', async () => {
    const mainWindow = getMainWindow();

    if (!mainWindow || mainWindow.isDestroyed()) {
      return { fullscreen: false };
    }

    const nextState = !mainWindow.isFullScreen();
    mainWindow.setFullScreen(nextState);
    return { fullscreen: nextState };
  });

  ipcMain.handle('shell:get-window-fullscreen', async () => {
    const mainWindow = getMainWindow();
    return {
      fullscreen: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isFullScreen())
    };
  });

  ipcMain.handle('shell:get-window-zoom', async () => ({
    zoomFactor: getCurrentWindowZoomFactor()
  }));

  ipcMain.handle('shell:adjust-window-zoom', async (_event, payload = {}) => {
    const delta = Number(payload.delta) || 0;
    const currentZoom = getCurrentWindowZoomFactor();
    const nextZoom = applyWindowZoomFactor(currentZoom + delta);
    return { zoomFactor: nextZoom };
  });

  ipcMain.handle('shell:reset-window-zoom', async () => ({
    zoomFactor: applyWindowZoomFactor(defaultUiZoomFactor)
  }));

  ipcMain.handle('shell:navigate', async (_event, target) => ({
    success: navigateMainWindow(target)
  }));

  ipcMain.handle('shell:get-exit-verification-model', async () => exitVerificationModel());

  ipcMain.handle('shell:submit-exit-password', async (_event, payload = {}) => {
    const password = typeof payload.password === 'string' ? payload.password : '';

    if (!hasConfiguredExitPassword()) {
      setAllowAppQuit(true);
      setImmediate(() => {
        app.quit();
      });
      return {
        ok: true,
        quitting: true
      };
    }

    if (!verifyExitPassword(password)) {
      return {
        ok: false,
        error: '密码不对。'
      };
    }

    setAllowAppQuit(true);
    closeExitPasswordWindow();
    setImmediate(() => {
      app.quit();
    });

    return {
      ok: true,
      quitting: true
    };
  });

  ipcMain.handle('shell:cancel-exit-password', async () => {
    closeExitPasswordWindow();
    return { ok: true };
  });
}

module.exports = {
  registerShellIpc
};
