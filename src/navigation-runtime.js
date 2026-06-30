'use strict';

function createNavigationRuntime(dependencies = {}) {
  const {
    BrowserView,
    buildClassroomNavigationUiModel,
    buildNavigationUiModel,
    classroomShellTopHeight,
    dialog,
    fileURLToPath,
    getAppConfig,
    getBannerImageUrl,
    getBannerText,
    getClassroomDefinitions,
    getCurrentWindowZoomFactor,
    adjustWindowZoomByDelta,
    getMainWindow,
    isAllowedTopLevel,
    isExitShortcut,
    launchLearningToolEntry,
    launchNativeModuleEntry,
    logBlockedRequest,
    logNavigationDebug,
    mainWindowUserAgent,
    markScheduleCompletedForToday,
    getScheduleLaunchStatusForToday,
    normalizePrefix,
    onMainWindowClosed,
    parseUrl,
    pathModule,
    requestAppQuit,
    resolveClassroom,
    resolveLibrary,
    scheduleSessionPersist,
    sessionPartition,
    shouldAllowAppQuit,
    shouldBlockShortcut,
    syncCompatibilityPatch,
    syncCompatibilityPatchForFrame,
    t,
    topLevelDecision
  } = dependencies;

  const internalPages = {
    home: 'home.html',
    library: 'library.html',
    studentPlan: 'student-plan.html',
    aiLearning: 'ai-learning.html',
    classroomShell: 'classroom-shell.html'
  };

  let classroomBrowserView = null;
  let activeClassroomShell = null;
  let classroomShellMeasuredTopHeight = classroomShellTopHeight;

  function tryHandleClassroomZoomInput(event, input = {}) {
    if (!input || input.type !== 'mouseWheel' || !input.control) {
      return false;
    }

    logNavigationDebug('classroom-view-zoom-wheel-pass-through', {
      deltaY: Number(input.deltaY) || Number(input.wheelDeltaY) || Number(input.delta) || 0
    });
    return false;
  }

  function internalPagePath(pageName) {
    const pageFile = internalPages[pageName];
    return pageFile ? pathModule.join(__dirname, pageFile) : null;
  }

  function libraryTarget(libraryId) {
    return `internal:library:${libraryId}`;
  }

  function studentPlanTarget() {
    return 'internal:student-plan';
  }

  function aiLearningTarget() {
    return 'internal:ai-learning';
  }

  function learningToolEntryTarget(toolId) {
    return `internal:learning-tool:${toolId}`;
  }

  function isClassroomShellUrl(value) {
    const normalized = normalizePrefix(value);

    if (!normalized) {
      return false;
    }

    const parsed = parseUrl(normalized);

    if (!parsed || parsed.protocol !== 'file:') {
      return false;
    }

    try {
      return pathModule.basename(fileURLToPath(parsed)).toLowerCase() === 'classroom-shell.html';
    } catch {
      return false;
    }
  }

  function isClassroomShellActive() {
    const mainWindow = getMainWindow();

    return Boolean(
      activeClassroomShell &&
        mainWindow &&
        !mainWindow.isDestroyed() &&
        isClassroomShellUrl(mainWindow.webContents.getURL())
    );
  }

  function activeNavigationWebContents() {
    if (isClassroomShellActive() && classroomBrowserView && classroomBrowserView.webContents && !classroomBrowserView.webContents.isDestroyed()) {
      return classroomBrowserView.webContents;
    }

    const mainWindow = getMainWindow();
    return mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null;
  }

  function resolveClassroomForUrl(url) {
    const normalizedUrl = normalizePrefix(url);

    if (!normalizedUrl) {
      return null;
    }

    const classroomDefinitions = getClassroomDefinitions();
    const exactPrefixMatch = classroomDefinitions.find((classroom) => normalizedUrl.startsWith(classroom.entryUrl));

    if (exactPrefixMatch) {
      return exactPrefixMatch;
    }

    const parsed = parseUrl(normalizedUrl);

    if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
      return null;
    }

    const hostname = parsed.hostname.toLowerCase();

    return (
      classroomDefinitions.find((classroom) => {
        const classroomUrl = parseUrl(classroom.entryUrl);
        return classroomUrl && classroomUrl.hostname.toLowerCase() === hostname;
      }) || null
    );
  }

  function layoutClassroomBrowserView() {
    const mainWindow = getMainWindow();

    if (
      !mainWindow ||
      mainWindow.isDestroyed() ||
      !classroomBrowserView ||
      !isClassroomShellActive()
    ) {
      return;
    }

    const effectiveTopHeight = Math.max(
      0,
      Number.isFinite(Number(classroomShellMeasuredTopHeight))
        ? Math.ceil(Number(classroomShellMeasuredTopHeight))
        : classroomShellTopHeight
    );
    const contentBounds = mainWindow.getContentBounds();
    classroomBrowserView.setBounds({
      x: 0,
      y: effectiveTopHeight,
      width: Math.max(0, contentBounds.width),
      height: Math.max(0, contentBounds.height - effectiveTopHeight)
    });
    classroomBrowserView.setAutoResize({
      width: true,
      height: true
    });
  }

  function destroyClassroomBrowserView(options = {}) {
    const preserveState = Boolean(options.preserveState);
    const mainWindow = getMainWindow();

    if (mainWindow && !mainWindow.isDestroyed() && classroomBrowserView) {
      try {
        if (typeof mainWindow.removeBrowserView === 'function') {
          mainWindow.removeBrowserView(classroomBrowserView);
        } else if (typeof mainWindow.setBrowserView === 'function' && mainWindow.getBrowserView() === classroomBrowserView) {
          mainWindow.setBrowserView(null);
        }
      } catch {
        // Ignore detach failures.
      }
    }

    if (classroomBrowserView) {
      const contents = classroomBrowserView.webContents;
      classroomBrowserView = null;

      if (contents && !contents.isDestroyed()) {
        try {
          contents.destroy();
        } catch {
          // Ignore destroy failures.
        }
      }
    }

    if (!preserveState) {
      activeClassroomShell = null;
    }
  }

  function attachClassroomBrowserViewHandlers(browserView) {
    const contents = browserView.webContents;
    contents.setUserAgent(mainWindowUserAgent);
    contents.setZoomFactor(getCurrentWindowZoomFactor());

    contents.on('before-input-event', (event, input) => {
      if (tryHandleClassroomZoomInput(event, input)) {
        return;
      }

      if (shouldBlockShortcut(input)) {
        event.preventDefault();
        return;
      }

      if (isExitShortcut(input)) {
        event.preventDefault();
        requestAppQuit();
      }
    });

    contents.on('will-navigate', blockNavigation);
    contents.on('will-redirect', blockNavigation);
    contents.on('did-start-navigation', (_event, url, isInPlace, isMainFrame) => {
      logNavigationDebug('classroom-view-did-start-navigation', {
        url,
        isInPlace,
        isMainFrame
      });
    });
    contents.on('dom-ready', () => {
      logNavigationDebug('classroom-view-dom-ready', {
        url: contents.getURL()
      });
    });
    contents.on('did-redirect-navigation', (_event, url, isInPlace, isMainFrame) => {
      logNavigationDebug('classroom-view-did-redirect-navigation', {
        url,
        isInPlace,
        isMainFrame
      });
    });
    contents.on('did-finish-load', () => {
      if (activeClassroomShell) {
        activeClassroomShell.targetUrl = normalizePrefix(contents.getURL()) || activeClassroomShell.targetUrl;
      }
      logNavigationDebug('classroom-view-did-finish-load', {
        url: contents.getURL()
      });
      void syncCompatibilityPatch(contents);
      scheduleSessionPersist();
    });
    contents.on('did-frame-finish-load', (_event, isMainFrame, frameProcessId, frameRoutingId) => {
      logNavigationDebug('classroom-view-did-frame-finish-load', {
        isMainFrame,
        frameProcessId,
        frameRoutingId
      });

      if (!isMainFrame) {
        void syncCompatibilityPatchForFrame(frameProcessId, frameRoutingId);
      }
    });
    contents.on('did-navigate', (_event, url) => {
      if (activeClassroomShell) {
        activeClassroomShell.targetUrl = normalizePrefix(url) || activeClassroomShell.targetUrl;
      }
      logNavigationDebug('classroom-view-did-navigate', {
        url
      });
      scheduleSessionPersist();
    });
    contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (activeClassroomShell) {
        activeClassroomShell.targetUrl = normalizePrefix(url) || activeClassroomShell.targetUrl;
      }
      logNavigationDebug('classroom-view-did-navigate-in-page', {
        url,
        isMainFrame
      });
      scheduleSessionPersist();
    });
    contents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      logNavigationDebug('classroom-view-did-fail-load', {
        errorCode,
        errorDescription,
        validatedURL,
        isMainFrame
      });
    });
    contents.on('audio-state-changed', (_event, audible) => {
      logNavigationDebug('classroom-view-audio-state-changed', {
        audible,
        url: contents.getURL()
      });
    });
    contents.on('unresponsive', () => {
      logNavigationDebug('classroom-view-unresponsive', {
        url: contents.getURL()
      });
    });
    contents.on('responsive', () => {
      logNavigationDebug('classroom-view-responsive', {
        url: contents.getURL()
      });
    });
    contents.on('render-process-gone', (_event, details) => {
      logNavigationDebug('classroom-view-render-process-gone', details || {});
    });
    contents.on('console-message', (_event, level, message, line, sourceId) => {
      if (level <= 1) {
        logNavigationDebug('classroom-view-renderer-console', {
          level,
          message: normalizePrefix(message),
          line,
          sourceId: normalizePrefix(sourceId)
        });
      }
    });
    contents.on('context-menu', (event) => event.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      if (isAllowedTopLevel(url)) {
        logNavigationDebug('classroom-view-window-open-allow', {
          url,
          decision: topLevelDecision(url)
        });
        setImmediate(() => {
          if (contents && !contents.isDestroyed()) {
            contents.loadURL(url);
          }
        });

        return { action: 'deny' };
      }

      logBlockedRequest({ resourceType: 'window-open', url }, 'BLOCK_POPUP');
      logNavigationDebug('classroom-view-window-open-deny', {
        url,
        decision: topLevelDecision(url)
      });
      return { action: 'deny' };
    });
  }

  function ensureClassroomBrowserView() {
    if (classroomBrowserView) {
      return classroomBrowserView;
    }

    classroomBrowserView = new BrowserView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegrationInSubFrames: true,
        sandbox: true,
        nodeIntegration: false,
        devTools: false,
        spellcheck: false,
        preload: pathModule.join(__dirname, 'classroom-preload.js'),
        partition: sessionPartition
      }
    });
    attachClassroomBrowserViewHandlers(classroomBrowserView);
    return classroomBrowserView;
  }

  async function syncClassroomBrowserView(options = {}) {
    if (!isClassroomShellActive() || !activeClassroomShell) {
      return;
    }

    const mainWindow = getMainWindow();
    const browserView = ensureClassroomBrowserView();

    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.getBrowserView() !== browserView) {
      mainWindow.setBrowserView(browserView);
    }

    layoutClassroomBrowserView();

    const desiredUrl = normalizePrefix(options.targetUrl || activeClassroomShell.targetUrl);
    const currentUrl = normalizePrefix(browserView.webContents.getURL());

    if (!desiredUrl) {
      return;
    }

    if (options.forceLoad || currentUrl !== desiredUrl) {
      await browserView.webContents.loadURL(desiredUrl);
    }
  }

  function loadClassroomShell(classroom, targetUrl) {
    const normalizedTarget = normalizePrefix(targetUrl);
    const mainWindow = getMainWindow();

    if (!normalizedTarget || !mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    activeClassroomShell = {
      classroomId: classroom ? classroom.id : '',
      targetUrl: normalizedTarget
    };

    if (isClassroomShellActive()) {
      void syncClassroomBrowserView({
        targetUrl: normalizedTarget,
        forceLoad: true
      });
      return;
    }

    destroyClassroomBrowserView({
      preserveState: true
    });
    logNavigationDebug('load-classroom-shell', {
      classroomId: classroom ? classroom.id : '',
      targetUrl: normalizedTarget
    });
    mainWindow.loadFile(internalPagePath('classroomShell'));
  }

  function loadHomePage(reason = 'manual') {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    destroyClassroomBrowserView();
    logNavigationDebug('load-home-page', {
      reason
    });
    mainWindow.loadFile(internalPagePath('home'));
  }

  function loadLibraryPage(libraryId) {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    destroyClassroomBrowserView();
    const library = resolveLibrary(libraryId);

    if (!library) {
      loadHomePage('library-not-found');
      return;
    }

    logNavigationDebug('load-library-page', {
      libraryId: library.id
    });

    mainWindow.loadFile(internalPagePath('library'), {
      query: {
        library: library.id
      }
    });
  }

  function loadStudentPlanPage() {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    destroyClassroomBrowserView();
    logNavigationDebug('load-student-plan-page');
    mainWindow.loadFile(internalPagePath('studentPlan'));
  }

  function loadAiLearningPage(query = {}) {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    destroyClassroomBrowserView();
    logNavigationDebug('load-ai-learning-page');
    mainWindow.loadFile(internalPagePath('aiLearning'), {
      query
    });
  }

  function navigateMainWindow(target) {
    const normalizedTarget = normalizePrefix(target);
    const mainWindow = getMainWindow();

    if (!normalizedTarget || !mainWindow || mainWindow.isDestroyed()) {
      logNavigationDebug('navigate-main-window-rejected', {
        target: normalizedTarget,
        reason: 'missing_target_or_window'
      });
      return false;
    }

    if (normalizedTarget === 'internal:home') {
      loadHomePage('navigate-internal-home');
      return true;
    }

    if (normalizedTarget === 'internal:library') {
      const defaultLibrary = resolveLibrary(null);
      loadLibraryPage(defaultLibrary && defaultLibrary.id);
      return true;
    }

    if (normalizedTarget === studentPlanTarget()) {
      loadStudentPlanPage();
      return true;
    }

    if (normalizedTarget === aiLearningTarget() || normalizedTarget.startsWith(`${aiLearningTarget()}?`)) {
      const query = {};
      const queryIndex = normalizedTarget.indexOf('?');

      if (queryIndex >= 0) {
        const params = new URLSearchParams(normalizedTarget.slice(queryIndex + 1));

        for (const [key, value] of params.entries()) {
          query[key] = value;
        }
      }

      loadAiLearningPage(query);
      return true;
    }

    if (normalizedTarget.startsWith('internal:native-module:')) {
      return launchNativeModuleEntry(normalizedTarget.slice('internal:native-module:'.length));
    }

    if (normalizedTarget.startsWith('internal:learning-tool:')) {
      return launchLearningToolEntry(normalizedTarget.slice('internal:learning-tool:'.length));
    }

    if (normalizedTarget.startsWith('internal:library:')) {
      loadLibraryPage(normalizedTarget.slice('internal:library:'.length));
      return true;
    }

    if (!isAllowedTopLevel(normalizedTarget)) {
      logBlockedRequest({ resourceType: 'navigation', url: normalizedTarget }, 'BLOCK_NAV');
      logNavigationDebug('navigate-main-window-blocked', {
        target: normalizedTarget,
        decision: topLevelDecision(normalizedTarget)
      });
      return false;
    }

    const classroom = resolveClassroomForUrl(normalizedTarget) || resolveClassroom(activeClassroomShell && activeClassroomShell.classroomId);

    logNavigationDebug('navigate-main-window-load-classroom-shell', {
      target: normalizedTarget,
      decision: topLevelDecision(normalizedTarget),
      classroomId: classroom ? classroom.id : ''
    });
    loadClassroomShell(classroom, normalizedTarget);
    return true;
  }

  function launchStudyEntry(target, options = {}) {
    const normalizedTarget = normalizePrefix(target);
    const launchStatus = typeof getScheduleLaunchStatusForToday === 'function'
      ? getScheduleLaunchStatusForToday(options)
      : null;

    if (launchStatus && launchStatus.blocked) {
      return {
        success: false,
        blocked: true,
        scheduleId: launchStatus.schedule.id,
        message: `${launchStatus.schedule.title} 还没到开放时间。`
      };
    }

    logNavigationDebug('launch-study-entry', {
      target: normalizedTarget,
      scheduleId: normalizePrefix(options.scheduleId),
      scheduleTargetId: normalizePrefix(options.scheduleTargetId),
      libraryId: normalizePrefix(options.libraryId)
    });
    const success = navigateMainWindow(normalizedTarget);

    if (!success) {
      return {
        success: false,
        message: normalizedTarget ? '目标无法打开。' : '模块未配置。'
      };
    }

    const completion = launchStatus && !launchStatus.alreadyCompleted
      ? markScheduleCompletedForToday(options)
      : launchStatus;

    if (completion) {
      return {
        success: true,
        completedScheduleId: completion.schedule.id
      };
    }

    return { success: true };
  }

  function goBackIfPossible() {
    const contents = activeNavigationWebContents();

    if (contents && !contents.isDestroyed() && contents.canGoBack()) {
      contents.goBack();
    }
  }

  function goForwardIfPossible() {
    const contents = activeNavigationWebContents();

    if (contents && !contents.isDestroyed() && contents.canGoForward()) {
      contents.goForward();
    }
  }

  function currentNavigationModel() {
    const mainWindow = getMainWindow();

    if (isClassroomShellActive()) {
      const contents = activeNavigationWebContents();
      const url =
        contents && !contents.isDestroyed()
          ? contents.getURL()
          : normalizePrefix(activeClassroomShell && activeClassroomShell.targetUrl);
      const classroom = resolveClassroomForUrl(url) || resolveClassroom(activeClassroomShell && activeClassroomShell.classroomId);

      return buildClassroomNavigationUiModel({
        canGoBack: Boolean(contents && !contents.isDestroyed() && contents.canGoBack()),
        canGoForward: Boolean(contents && !contents.isDestroyed() && contents.canGoForward()),
        bannerText: getBannerText(),
        bannerImageUrl: getBannerImageUrl(),
        classroom,
        currentTarget: url,
        studentPlanTarget: studentPlanTarget()
      });
    }

    const url = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents.getURL() : '';
    return buildNavigationUiModel({
      url,
      canGoBack: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.canGoBack()),
      canGoForward: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.canGoForward()),
      bannerText: getBannerText(),
      bannerImageUrl: getBannerImageUrl(),
      t,
      studentPlanTarget: studentPlanTarget(),
      aiLearningTarget: aiLearningTarget(),
      resolveLibrary,
      libraryTarget,
      resolveClassroomForUrl,
      allowStateReset: isAllowedTopLevel(url),
      parseUrl,
      pathModule,
      fileURLToPath
    });
  }

  function blockNavigation(event, targetUrl) {
    const decision = topLevelDecision(targetUrl);

    if (isAllowedTopLevel(targetUrl)) {
      logNavigationDebug('block-navigation-allow', {
        targetUrl,
        decision
      });
      return;
    }

    event.preventDefault();
    logBlockedRequest({ resourceType: 'navigation', url: targetUrl }, 'BLOCK_NAV');
    logNavigationDebug('block-navigation-deny', {
      targetUrl,
      decision
    });
  }

  function attachMainWindowHandlers() {
    const mainWindow = getMainWindow();

    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    mainWindow.webContents.setUserAgent(mainWindowUserAgent);
    mainWindow.webContents.setZoomFactor(getCurrentWindowZoomFactor());
    mainWindow.on('closed', () => {
      logNavigationDebug('main-window-closed');
      destroyClassroomBrowserView();
      onMainWindowClosed();
    });
    mainWindow.on('close', (event) => {
      if (shouldAllowAppQuit()) {
        return;
      }

      event.preventDefault();
      requestAppQuit();
    });
    mainWindow.on('enter-full-screen', () => {
      layoutClassroomBrowserView();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('window:fullscreen-changed', {
          fullscreen: true
        });
      }
    });
    mainWindow.on('leave-full-screen', () => {
      layoutClassroomBrowserView();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('window:fullscreen-changed', {
          fullscreen: false
        });
      }
    });
    mainWindow.on('resize', () => {
      layoutClassroomBrowserView();
    });
    mainWindow.on('maximize', () => {
      layoutClassroomBrowserView();
    });
    mainWindow.on('unmaximize', () => {
      layoutClassroomBrowserView();
    });

    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (shouldBlockShortcut(input)) {
        event.preventDefault();
        return;
      }

      if (isExitShortcut(input)) {
        event.preventDefault();
        requestAppQuit();
      }
    });

    mainWindow.webContents.on('will-navigate', blockNavigation);
    mainWindow.webContents.on('will-redirect', blockNavigation);
    mainWindow.webContents.on('did-start-navigation', (_event, url, isInPlace, isMainFrame) => {
      logNavigationDebug('did-start-navigation', {
        url,
        isInPlace,
        isMainFrame
      });
    });
    mainWindow.webContents.on('did-redirect-navigation', (_event, url, isInPlace, isMainFrame) => {
      logNavigationDebug('did-redirect-navigation', {
        url,
        isInPlace,
        isMainFrame
      });
    });
    mainWindow.webContents.on('did-finish-load', () => {
      const currentUrl = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents.getURL() : '';
      logNavigationDebug('did-finish-load', {
        url: currentUrl
      });
      if (isClassroomShellUrl(currentUrl)) {
        void syncClassroomBrowserView({
          forceLoad: true
        });
      }
      void syncCompatibilityPatch();
      scheduleSessionPersist();
    });
    mainWindow.webContents.on('did-navigate', (_event, url) => {
      logNavigationDebug('did-navigate', {
        url
      });
      scheduleSessionPersist();
    });
    mainWindow.webContents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      logNavigationDebug('did-navigate-in-page', {
        url,
        isMainFrame
      });
      scheduleSessionPersist();
    });
    mainWindow.webContents.on(
      'did-fail-load',
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        logNavigationDebug('did-fail-load', {
          errorCode,
          errorDescription,
          validatedURL,
          isMainFrame
        });
      }
    );
    mainWindow.webContents.on('render-process-gone', (_event, details) => {
      logNavigationDebug('render-process-gone', details || {});
    });
    mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      if (level <= 1) {
        logNavigationDebug('renderer-console', {
          level,
          message: normalizePrefix(message),
          line,
          sourceId: normalizePrefix(sourceId)
        });
      }
    });
    mainWindow.webContents.on('context-menu', (event) => event.preventDefault());
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (isAllowedTopLevel(url)) {
        logNavigationDebug('window-open-allow', {
          url,
          decision: topLevelDecision(url)
        });
        setImmediate(() => {
          navigateMainWindow(url);
        });

        return { action: 'deny' };
      }

      logBlockedRequest({ resourceType: 'window-open', url }, 'BLOCK_POPUP');
      logNavigationDebug('window-open-deny', {
        url,
        decision: topLevelDecision(url)
      });
      return { action: 'deny' };
    });

    mainWindow.once('ready-to-show', () => {
      logNavigationDebug('main-window-ready-to-show');
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isMaximized()) {
        mainWindow.maximize();
      }
      mainWindow.show();
      mainWindow.focus();
    });
  }

  function setClassroomBrowserViewZoomFactor(factor) {
    if (classroomBrowserView && classroomBrowserView.webContents && !classroomBrowserView.webContents.isDestroyed()) {
      classroomBrowserView.webContents.setZoomFactor(factor);
      layoutClassroomBrowserView();
    }
  }

  function updateClassroomShellTopHeight(height) {
    const normalizedHeight = Number.isFinite(Number(height))
      ? Math.max(classroomShellTopHeight, Math.ceil(Number(height)))
      : classroomShellTopHeight;

    if (normalizedHeight === classroomShellMeasuredTopHeight) {
      return;
    }

    classroomShellMeasuredTopHeight = normalizedHeight;
    layoutClassroomBrowserView();
  }

  return {
    attachMainWindowHandlers,
    currentNavigationModel,
    destroyClassroomBrowserView,
    getActiveClassroomShell: () => activeClassroomShell,
    goBackIfPossible,
    goForwardIfPossible,
    internalPagePath,
    isClassroomShellActive,
    isClassroomShellUrl,
    launchStudyEntry,
    learningToolEntryTarget,
    libraryTarget,
    aiLearningTarget,
    loadHomePage,
    navigateMainWindow,
    resolveClassroomForUrl,
    setClassroomBrowserViewZoomFactor,
    updateClassroomShellTopHeight,
    studentPlanTarget,
    syncClassroomBrowserView
  };
}

module.exports = {
  createNavigationRuntime
};
