'use strict';

function createSecurityRuntime(dependencies = {}) {
  const {
    allowedAppSchemes,
    allowedMediaPermissions,
    app,
    fileURLToPath,
    fs,
    getAppConfig,
    getClassroomDefinitions,
    getMainWindow,
    getResolveClassroomForUrl,
    legacyMediaCompatibilityScript,
    os,
    parseUrl,
    pathModule,
    runtimePaths,
    shortcutMatches
  } = dependencies;

  function isLocalAppFile(urlObject) {
    if (!urlObject || urlObject.protocol !== 'file:') {
      return false;
    }

    const appPath = pathModule.resolve(app.getAppPath());
    const normalizedPath = pathModule.resolve(fileURLToPath(urlObject));
    return normalizedPath.startsWith(appPath);
  }

  function isInternalServerUrl(url) {
    const appConfig = getAppConfig();
    return Boolean(appConfig && appConfig.internalServerOrigin) && url.startsWith(`${appConfig.internalServerOrigin}/__studygate/`);
  }

  function matchesPrefix(url, prefixes) {
    return prefixes.some((prefix) => url.startsWith(prefix));
  }

  function matchesClassroomEntryUrl(url) {
    return getClassroomDefinitions().some((classroom) => url.startsWith(classroom.entryUrl));
  }

  function matchesAllowedHostname(url) {
    const parsed = parseUrl(url);
    const appConfig = getAppConfig();

    if (!parsed || !['http:', 'https:'].includes(parsed.protocol) || !appConfig) {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase();

    if (appConfig.allowedHostnames.has(hostname)) {
      return true;
    }

    if (
      getClassroomDefinitions().some((classroom) => {
        const classroomUrl = parseUrl(classroom.entryUrl);
        return classroomUrl && classroomUrl.hostname.toLowerCase() === hostname;
      })
    ) {
      return true;
    }

    return appConfig.allowedHostnameSuffixes.some((suffix) => hostname.endsWith(suffix));
  }

  function isTopLevelOnlyResourceMode() {
    const appConfig = getAppConfig();
    return Boolean(appConfig && appConfig.resourceAccessMode === 'top-level-only');
  }

  function topLevelDecision(url) {
    const appConfig = getAppConfig();
    const parsed = parseUrl(url);

    if (!parsed || !appConfig) {
      return {
        allowed: false,
        reason: parsed ? 'missing_config' : 'invalid_url'
      };
    }

    if (parsed.protocol === 'file:') {
      return {
        allowed: isLocalAppFile(parsed),
        reason: 'local_file'
      };
    }

    const resolveClassroomForUrl = getResolveClassroomForUrl();
    const classroom = typeof resolveClassroomForUrl === 'function' ? resolveClassroomForUrl(url) : null;

    if (matchesPrefix(url, appConfig.topLevelPrefixes) || matchesClassroomEntryUrl(url) || classroom) {
      return {
        allowed: true,
        reason: classroom
          ? 'matched_classroom_runtime'
          : matchesClassroomEntryUrl(url)
            ? 'matched_classroom_entry'
            : 'matched_prefix'
      };
    }

    if (isTopLevelOnlyResourceMode()) {
      const hostnameMatched = matchesAllowedHostname(url);
      return {
        allowed: hostnameMatched,
        reason: hostnameMatched ? 'matched_hostname_top_level_only' : 'hostname_not_allowed_top_level_only'
      };
    }

    return {
      allowed: false,
      reason: 'prefix_not_allowed'
    };
  }

  function isAllowedTopLevel(url) {
    return topLevelDecision(url).allowed;
  }

  function storageOriginKey(value) {
    const parsed = parseUrl(value);

    if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
      return '';
    }

    return parsed.origin;
  }

  function isCourseEcosystemOrigin(value) {
    const parsed = parseUrl(value);

    if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase();
    return (
      hostname.endsWith('talk915.com') ||
      hostname.endsWith('chindle.com') ||
      hostname.endsWith('keyclass.cn') ||
      hostname.endsWith('xuedianyun.com')
    );
  }

  function shouldPersistOriginStorage(value) {
    const parsed = parseUrl(value);

    if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
      return false;
    }

    return isAllowedTopLevel(parsed.href);
  }

  function isAllowedResource(url) {
    const appConfig = getAppConfig();

    if (!appConfig) {
      return false;
    }

    if (isInternalServerUrl(url)) {
      return true;
    }

    if (matchesPrefix(url, appConfig.topLevelPrefixes)) {
      return true;
    }

    if (matchesPrefix(url, appConfig.allowedResourceUrlPrefixes)) {
      return true;
    }

    const parsed = parseUrl(url);

    if (!parsed) {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase();

    if (appConfig.allowedHostnames.has(hostname)) {
      return true;
    }

    return appConfig.allowedHostnameSuffixes.some((suffix) => hostname.endsWith(suffix));
  }

  function isAllowedOrigin(candidate) {
    if (typeof candidate !== 'string' || !candidate.trim()) {
      return false;
    }

    if (isInternalServerUrl(candidate)) {
      return true;
    }

    const parsed = parseUrl(candidate);

    if (!parsed) {
      return false;
    }

    if (parsed.protocol === 'file:') {
      return isLocalAppFile(parsed);
    }

    return isAllowedResource(parsed.href);
  }

  function isTrustedPermissionContext(webContents) {
    if (!webContents || webContents.isDestroyed()) {
      return false;
    }

    const currentUrl = webContents.getURL();

    if (!currentUrl) {
      return false;
    }

    if (isInternalServerUrl(currentUrl)) {
      return true;
    }

    const parsed = parseUrl(currentUrl);

    if (!parsed) {
      return false;
    }

    if (parsed.protocol === 'file:') {
      return isLocalAppFile(parsed);
    }

    return isAllowedTopLevel(currentUrl);
  }

  function shouldGrantPermission(webContents, permission, requestingOrigin, details = {}) {
    if (!allowedMediaPermissions.has(permission)) {
      return false;
    }

    if (isTopLevelOnlyResourceMode() && isTrustedPermissionContext(webContents)) {
      return true;
    }

    const candidates = [
      details.requestingUrl,
      details.securityOrigin,
      requestingOrigin,
      webContents && !webContents.isDestroyed() ? webContents.getURL() : null
    ];

    return candidates.some((candidate) => isAllowedOrigin(candidate));
  }

  function logBlockedRequest(details, reason) {
    const appConfig = getAppConfig();

    if (!appConfig || !appConfig.logBlockedRequests) {
      return;
    }

    const logLine = `[${new Date().toISOString()}] ${reason} ${details.resourceType || 'unknown'} ${details.url}${os.EOL}`;
    const logPath = pathModule.join(appConfig.configDir, 'blocked-requests.log');

    try {
      fs.appendFileSync(logPath, logLine, 'utf8');
    } catch {
      // Ignore logging failures.
    }
  }

  function logNavigationDebug(eventName, payload = {}) {
    const appConfig = getAppConfig();

    if (!appConfig || !appConfig.logBlockedRequests) {
      return;
    }

    const mainWindow = getMainWindow();
    const currentUrl =
      mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents
        ? (payload && payload.currentUrl) || (mainWindow.webContents.getURL() || '')
        : '';
    const logLine = JSON.stringify({
      at: new Date().toISOString(),
      event: eventName,
      currentUrl,
      ...payload
    });

    try {
      fs.appendFileSync(runtimePaths.navigationDebugLogPath(), `${logLine}${os.EOL}`, 'utf8');
    } catch {
      // Ignore logging failures.
    }
  }

  function logReminderDebug(eventName, payload = {}) {
    const logLine = JSON.stringify({
      at: new Date().toISOString(),
      event: eventName,
      ...payload
    });

    try {
      fs.appendFileSync(runtimePaths.reminderDebugLogPath(), `${logLine}${os.EOL}`, 'utf8');
    } catch {
      // Ignore logging failures.
    }
  }

  function isAllowedTopLevelDestination(url) {
    const parsed = parseUrl(url);

    if (!parsed) {
      return false;
    }

    if (parsed.protocol === 'file:') {
      return isLocalAppFile(parsed);
    }

    return isAllowedTopLevel(url);
  }

  function shouldAllowRequest(details) {
    const parsed = parseUrl(details.url);

    if (isInternalServerUrl(details.url)) {
      return true;
    }

    if (!parsed) {
      return false;
    }

    if (allowedAppSchemes.has(parsed.protocol)) {
      if (parsed.protocol !== 'file:') {
        return true;
      }

      return isLocalAppFile(parsed);
    }

    if (!['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) {
      return false;
    }

    if (details.resourceType === 'mainFrame') {
      return isAllowedTopLevel(details.url);
    }

    if (isTopLevelOnlyResourceMode()) {
      return true;
    }

    return isAllowedResource(details.url);
  }

  function blockNavigation(event, targetUrl) {
    const decision = topLevelDecision(targetUrl);

    if (isAllowedTopLevelDestination(targetUrl)) {
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

  function shouldBlockShortcut(input) {
    const appConfig = getAppConfig();
    return Boolean(
      appConfig &&
        input.type === 'keyDown' &&
        appConfig.blockedShortcuts.some((shortcut) => shortcutMatches(input, shortcut))
    );
  }

  function isExitShortcut(input) {
    const appConfig = getAppConfig();
    return Boolean(appConfig && input.type === 'keyDown' && shortcutMatches(input, appConfig.exitShortcut));
  }

  async function applyCompatibilityPatch(targetWebContents = null) {
    const webContents = targetWebContents || (getMainWindow() && !getMainWindow().isDestroyed() ? getMainWindow().webContents : null);

    if (!webContents || webContents.isDestroyed()) {
      return;
    }

    const currentUrl = webContents.getURL();
    const parsed = parseUrl(currentUrl);

    if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
      return;
    }

    try {
      await webContents.executeJavaScript(legacyMediaCompatibilityScript, true);
    } catch {
      // Ignore compatibility injection failures.
    }
  }

  return {
    applyCompatibilityPatch,
    blockNavigation,
    isAllowedTopLevel,
    isCourseEcosystemOrigin,
    isExitShortcut,
    logBlockedRequest,
    logNavigationDebug,
    logReminderDebug,
    shouldAllowRequest,
    shouldBlockShortcut,
    shouldGrantPermission,
    shouldPersistOriginStorage,
    storageOriginKey,
    topLevelDecision
  };
}

module.exports = {
  createSecurityRuntime
};
