'use strict';

function createStorageRuntime(dependencies = {}) {
  const {
    createEmptyStudyToolsState,
    crypto,
    formatLocalDateKey,
    fs,
    getAppConfig,
    getClassroomDefinitions,
    isAllowedTopLevel,
    isCourseEcosystemOrigin,
    normalizeHostname,
    normalizeLibraryId,
    normalizePrefix,
    normalizeUiZoomFactor,
    os,
    parseUrl,
    runtimePaths,
    safeStorage,
    session,
    sessionPartition,
    shouldPersistOriginStorage,
    storageOriginKey,
    logNavigationDebug
  } = dependencies;

  let sessionPersistTimer = null;
  let sessionPersistPromise = Promise.resolve();
  let originStorageState = { origins: {} };
  let siteCredentialState = { origins: {} };
  let studyToolsState = createEmptyStudyToolsState();

  function cookieToSetDetails(cookie) {
    if (!cookie || !cookie.name || typeof cookie.value !== 'string') {
      return null;
    }

    const normalizedDomain = normalizeHostname(cookie.domain).replace(/^\.+/, '');

    if (!normalizedDomain) {
      return null;
    }

    const protocol = cookie.secure ? 'https://' : 'http://';
    const details = {
      url: `${protocol}${normalizedDomain}${cookie.path || '/'}`,
      name: cookie.name,
      value: cookie.value,
      path: cookie.path || '/',
      secure: Boolean(cookie.secure),
      httpOnly: Boolean(cookie.httpOnly)
    };

    if (cookie.domain) {
      details.domain = cookie.domain;
    }

    if (typeof cookie.sameSite === 'string' && cookie.sameSite) {
      details.sameSite = cookie.sameSite;
    }

    if (typeof cookie.expirationDate === 'number' && Number.isFinite(cookie.expirationDate)) {
      details.expirationDate = cookie.expirationDate;
    }

    return details;
  }

  async function writeSessionState() {
    const ses = session.fromPartition(sessionPartition);
    const cookies = await ses.cookies.get({});
    const state = {
      savedAt: new Date().toISOString(),
      cookies: cookies.map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        hostOnly: Boolean(cookie.hostOnly),
        path: cookie.path,
        secure: Boolean(cookie.secure),
        httpOnly: Boolean(cookie.httpOnly),
        session: Boolean(cookie.session),
        sameSite: cookie.sameSite,
        expirationDate: cookie.expirationDate
      }))
    };

    fs.writeFileSync(runtimePaths.sessionStatePath(), JSON.stringify(state, null, 2), 'utf8');
    await ses.cookies.flushStore();
    await ses.flushStorageData();
  }

  function persistSessionState() {
    sessionPersistPromise = sessionPersistPromise
      .catch(() => {})
      .then(() => writeSessionState());

    return sessionPersistPromise.catch(() => {});
  }

  function scheduleSessionPersist(delayMs = 150) {
    if (sessionPersistTimer) {
      clearTimeout(sessionPersistTimer);
    }

    sessionPersistTimer = setTimeout(() => {
      sessionPersistTimer = null;
      void persistSessionState();
    }, delayMs);
  }

  function stopSessionPersistence() {
    if (sessionPersistTimer) {
      clearTimeout(sessionPersistTimer);
      sessionPersistTimer = null;
    }
  }

  async function restoreSessionState() {
    const filePath = runtimePaths.sessionStatePath();

    if (!fs.existsSync(filePath)) {
      return;
    }

    let state;

    try {
      state = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return;
    }

    if (!state || !Array.isArray(state.cookies) || !state.cookies.length) {
      return;
    }

    const ses = session.fromPartition(sessionPartition);

    for (const cookie of state.cookies) {
      const details = cookieToSetDetails(cookie);

      if (!details) {
        continue;
      }

      try {
        await ses.cookies.set(details);
      } catch {
        // Ignore cookies that Chromium rejects during restore.
      }
    }
  }

  function canUseSiteCredentialStorage() {
    return Boolean(
      safeStorage &&
        typeof safeStorage.isEncryptionAvailable === 'function' &&
        safeStorage.isEncryptionAvailable()
    );
  }

  function loadSiteCredentialState() {
    const filePath = runtimePaths.siteCredentialStatePath();

    if (!canUseSiteCredentialStorage() || !fs.existsSync(filePath)) {
      siteCredentialState = { origins: {} };
      return;
    }

    try {
      const encrypted = fs.readFileSync(filePath);
      const decrypted = safeStorage.decryptString(encrypted);
      const rawState = JSON.parse(decrypted);
      siteCredentialState = {
        origins: rawState && rawState.origins && typeof rawState.origins === 'object' ? rawState.origins : {}
      };
    } catch {
      siteCredentialState = { origins: {} };
    }
  }

  function saveSiteCredentialState() {
    if (!canUseSiteCredentialStorage()) {
      return false;
    }

    const encrypted = safeStorage.encryptString(
      JSON.stringify({
        origins: siteCredentialState.origins || {}
      })
    );
    fs.writeFileSync(runtimePaths.siteCredentialStatePath(), encrypted);
    return true;
  }

  function shouldStoreSiteCredentials(value) {
    const parsed = parseUrl(value);

    if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
      return false;
    }

    return isAllowedTopLevel(parsed.href);
  }

  function normalizeCredentialUsername(value) {
    return normalizePrefix(value).slice(0, 256);
  }

  function normalizeCredentialPassword(value) {
    return typeof value === 'string' ? value.slice(0, 256) : '';
  }

  function getSiteCredentialSnapshot(url) {
    const origin = storageOriginKey(url);

    if (!origin || !shouldStoreSiteCredentials(url) || !canUseSiteCredentialStorage()) {
      return {
        available: false,
        username: '',
        password: ''
      };
    }

    const record = siteCredentialState.origins[origin];
    const username = record && typeof record.username === 'string' ? record.username : '';
    const password = record && typeof record.password === 'string' ? record.password : '';

    return {
      available: Boolean(username && password),
      username,
      password
    };
  }

  function saveSiteCredentialSnapshot(payload = {}) {
    const origin = storageOriginKey(payload.url || payload.origin);
    const username = normalizeCredentialUsername(payload.username);
    const password = normalizeCredentialPassword(payload.password);

    if (!origin || !shouldStoreSiteCredentials(payload.url || origin) || !canUseSiteCredentialStorage()) {
      return false;
    }

    if (!username || !password) {
      return false;
    }

    siteCredentialState.origins[origin] = {
      username,
      password,
      updatedAt: new Date().toISOString()
    };

    return saveSiteCredentialState();
  }

  function courseEcosystemOrigins() {
    const origins = new Set();
    const appConfig = getAppConfig();

    for (const prefix of appConfig.topLevelPrefixes || []) {
      if (isCourseEcosystemOrigin(prefix)) {
        const origin = storageOriginKey(prefix);

        if (origin) {
          origins.add(origin);
        }
      }
    }

    for (const classroom of getClassroomDefinitions()) {
      if (isCourseEcosystemOrigin(classroom.entryUrl)) {
        const origin = storageOriginKey(classroom.entryUrl);

        if (origin) {
          origins.add(origin);
        }
      }
    }

    for (const origin of Object.keys(originStorageState.origins || {})) {
      if (isCourseEcosystemOrigin(origin)) {
        origins.add(origin);
      }
    }

    return [...origins];
  }

  function removeCourseOriginsFromStorageSnapshot() {
    for (const origin of Object.keys(originStorageState.origins || {})) {
      if (isCourseEcosystemOrigin(origin)) {
        delete originStorageState.origins[origin];
      }
    }

    saveOriginStorageState();
  }

  async function clearCourseSiteState() {
    const ses = session.fromPartition(sessionPartition);
    const origins = courseEcosystemOrigins();
    const cookies = await ses.cookies.get({});
    const removals = [];

    for (const cookie of cookies) {
      const domain = normalizeHostname(cookie.domain).replace(/^\.+/, '');

      if (!domain || !isCourseEcosystemOrigin(`https://${domain}/`)) {
        continue;
      }

      const protocol = cookie.secure ? 'https://' : 'http://';
      const cookieUrl = `${protocol}${domain}${cookie.path || '/'}`;
      removals.push(ses.cookies.remove(cookieUrl, cookie.name).catch(() => {}));
    }

    await Promise.all(removals);

    for (const origin of origins) {
      await ses
        .clearStorageData({
          origin,
          storages: ['filesystem', 'indexeddb', 'localstorage', 'serviceworkers', 'cachestorage', 'websql']
        })
        .catch(() => {});
    }

    if (typeof ses.clearAuthCache === 'function') {
      await ses.clearAuthCache().catch(() => {});
    }

    await ses.clearCache().catch(() => {});
    removeCourseOriginsFromStorageSnapshot();
    await writeSessionState().catch(() => {});

    logNavigationDebug('clear-course-site-state', {
      origins
    });

    return {
      ok: true
    };
  }

  function loadOriginStorageState() {
    const filePath = runtimePaths.originStorageStatePath();

    if (!fs.existsSync(filePath)) {
      originStorageState = { origins: {} };
      return;
    }

    try {
      const rawState = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      originStorageState = {
        origins: rawState && rawState.origins && typeof rawState.origins === 'object' ? rawState.origins : {}
      };
    } catch {
      originStorageState = { origins: {} };
    }
  }

  function pruneOriginStorageState() {
    const nextOrigins = {};

    for (const [origin, snapshot] of Object.entries(originStorageState.origins || {})) {
      if (!shouldPersistOriginStorage(origin)) {
        continue;
      }

      nextOrigins[origin] = {
        localStorage:
          snapshot && snapshot.localStorage && typeof snapshot.localStorage === 'object'
            ? snapshot.localStorage
            : {},
        sessionStorage: {},
        updatedAt: normalizePrefix(snapshot && snapshot.updatedAt) || new Date().toISOString()
      };
    }

    originStorageState = { origins: nextOrigins };
  }

  function saveOriginStorageState() {
    pruneOriginStorageState();
    fs.writeFileSync(runtimePaths.originStorageStatePath(), JSON.stringify(originStorageState, null, 2), 'utf8');
  }

  function getOriginStorageSnapshot(url) {
    const origin = storageOriginKey(url);

    if (!origin || !shouldPersistOriginStorage(url)) {
      return {
        origin: '',
        localStorage: {},
        sessionStorage: {}
      };
    }

    const snapshot = originStorageState.origins[origin];

    return {
      origin,
      localStorage:
        snapshot && snapshot.localStorage && typeof snapshot.localStorage === 'object'
          ? snapshot.localStorage
          : {},
      sessionStorage: {}
    };
  }

  function setOriginStorageSnapshot(payload = {}) {
    const origin = storageOriginKey(payload.url || payload.origin);

    if (!origin || !shouldPersistOriginStorage(payload.url || origin)) {
      return false;
    }

    originStorageState.origins[origin] = {
      localStorage: payload.localStorage && typeof payload.localStorage === 'object' ? payload.localStorage : {},
      sessionStorage: {},
      updatedAt: new Date().toISOString()
    };

    saveOriginStorageState();
    return true;
  }

  function loadStudyToolsState() {
    const filePath = runtimePaths.studyToolsStatePath();

    if (!fs.existsSync(filePath)) {
      studyToolsState = createEmptyStudyToolsState();
      return;
    }

    try {
      const rawState = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      studyToolsState = {
        classMarks: rawState.classMarks && typeof rawState.classMarks === 'object' ? rawState.classMarks : {},
        mobileToken: normalizePrefix(rawState.mobileToken) || crypto.randomBytes(12).toString('hex'),
        uiZoomFactor: normalizeUiZoomFactor(rawState.uiZoomFactor),
        studentDeviceCredential: {
          deviceId: normalizeLibraryId(
            rawState && rawState.studentDeviceCredential && rawState.studentDeviceCredential.deviceId,
            `desktop-${crypto.randomBytes(8).toString('hex')}`
          ),
          deviceSecret:
            normalizePrefix(
              rawState && rawState.studentDeviceCredential && rawState.studentDeviceCredential.deviceSecret
            ) || crypto.randomBytes(16).toString('hex'),
          label: normalizePrefix(
            rawState && rawState.studentDeviceCredential && rawState.studentDeviceCredential.label
          )
        }
      };
    } catch {
      studyToolsState = createEmptyStudyToolsState();
    }
  }

  function preferredStudentDeviceLabel() {
    const username = (() => {
      try {
        return normalizePrefix(os.userInfo().username);
      } catch {
        return '';
      }
    })();
    const host = normalizePrefix(os.hostname());
    return [host, username].filter(Boolean).join(' / ') || '当前桌面客户端';
  }

  function ensureStudentDeviceCredential() {
    if (!studyToolsState.studentDeviceCredential || typeof studyToolsState.studentDeviceCredential !== 'object') {
      studyToolsState.studentDeviceCredential = createEmptyStudyToolsState().studentDeviceCredential;
    }

    const credential = studyToolsState.studentDeviceCredential;
    credential.deviceId = normalizeLibraryId(credential.deviceId, `desktop-${crypto.randomBytes(8).toString('hex')}`);
    credential.deviceSecret = normalizePrefix(credential.deviceSecret) || crypto.randomBytes(16).toString('hex');
    credential.label = preferredStudentDeviceLabel();
    return credential;
  }

  function pruneStudyToolsState() {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 60);
    const cutoffKey = formatLocalDateKey(cutoffDate);

    for (const [occurrenceKey, mark] of Object.entries(studyToolsState.classMarks)) {
      const dateKey =
        mark && typeof mark.dateKey === 'string'
          ? mark.dateKey
          : normalizePrefix(occurrenceKey.split(':').slice(-1)[0]);

      if (!dateKey || dateKey < cutoffKey) {
        delete studyToolsState.classMarks[occurrenceKey];
      }
    }
  }

  function saveStudyToolsState() {
    pruneStudyToolsState();
    ensureStudentDeviceCredential();
    fs.writeFileSync(runtimePaths.studyToolsStatePath(), JSON.stringify(studyToolsState, null, 2), 'utf8');
  }

  function ensureMobileToken() {
    if (!studyToolsState.mobileToken) {
      studyToolsState.mobileToken = crypto.randomBytes(12).toString('hex');
      saveStudyToolsState();
    }

    return studyToolsState.mobileToken;
  }

  function studentDeviceCredentialPayload() {
    const previousId =
      studyToolsState && studyToolsState.studentDeviceCredential && studyToolsState.studentDeviceCredential.deviceId;
    const previousSecret =
      studyToolsState &&
      studyToolsState.studentDeviceCredential &&
      studyToolsState.studentDeviceCredential.deviceSecret;
    const previousLabel =
      studyToolsState && studyToolsState.studentDeviceCredential && studyToolsState.studentDeviceCredential.label;
    ensureStudentDeviceCredential();

    if (
      previousId !== studyToolsState.studentDeviceCredential.deviceId ||
      previousSecret !== studyToolsState.studentDeviceCredential.deviceSecret ||
      previousLabel !== studyToolsState.studentDeviceCredential.label
    ) {
      saveStudyToolsState();
    }

    return {
      deviceId: studyToolsState.studentDeviceCredential.deviceId,
      deviceSecret: studyToolsState.studentDeviceCredential.deviceSecret,
      deviceLabel: studyToolsState.studentDeviceCredential.label
    };
  }

  function setStudyToolsUiZoomFactor(value, options = {}) {
    studyToolsState.uiZoomFactor = normalizeUiZoomFactor(value);

    if (!options.skipPersist) {
      saveStudyToolsState();
    }

    return studyToolsState.uiZoomFactor;
  }

  return {
    clearCourseSiteState,
    getOriginStorageSnapshot,
    getSiteCredentialSnapshot,
    getStudyToolsState: () => studyToolsState,
    ensureMobileToken,
    loadOriginStorageState,
    loadSiteCredentialState,
    loadStudyToolsState,
    restoreSessionState,
    saveOriginStorageState,
    saveSiteCredentialSnapshot,
    saveStudyToolsState,
    scheduleSessionPersist,
    setOriginStorageSnapshot,
    setStudyToolsUiZoomFactor,
    stopSessionPersistence,
    studentDeviceCredentialPayload
  };
}

module.exports = {
  createStorageRuntime
};
