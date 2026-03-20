'use strict';

const {
  Notification,
  app,
  BrowserView,
  BrowserWindow,
  dialog,
  ipcMain,
  safeStorage,
  session,
  shell: electronShell
} = require('electron');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { fileURLToPath } = require('url');
const {
  listNativeModules,
  resolveNativeModule,
  resolveNativeModuleTitle,
  nativeModuleTarget,
  nativeModuleTargetOptions,
  launchNativeModule
} = require('./native-modules');
const {
  launchLearningTool,
  normalizeLearningTools,
  resolveLearningToolTitle: resolveLearningToolTitleFromList,
  serializeLearningTools
} = require('./learning-tools');
const {
  buildClassroomNavigationUiModel,
  buildHomeUiModel,
  buildNavigationUiModel
} = require('./ui-models');
const {
  DEFAULT_NAVIGATION_BANNER_TEXT,
  DEFAULT_REMINDER_LEAD_MINUTES,
  DEFAULT_UI_ZOOM_FACTOR,
  MAX_UI_ZOOM_FACTOR,
  MIN_UI_ZOOM_FACTOR,
  REMOTE_SCHEDULE_DEFAULT_REFRESH_MINUTES,
  UI_ZOOM_STEP,
  clockTimeToMinutes,
  createConfigError,
  createEmptyControlSettings,
  createEmptyNetdiskState,
  createEmptyRemoteScheduleStatus,
  createEmptyStudentDeviceAccessStatus,
  createEmptyStudyToolsState,
  createNetdiskApiError,
  createNetdiskAuthError,
  defaultLibraries,
  defaultOnlineClassrooms,
  formatDisplayTime,
  formatLocalDateKey,
  formatLocalTime,
  formatStudyDayLabel,
  formatWeekdayLabel,
  hashExitPassword,
  isKeyboardTokenPressed,
  localWeekdayNumber,
  mergeStudySchedules,
  normalizeCardTone,
  normalizeClockTime,
  normalizeControlSettings,
  normalizeDateList,
  normalizeEntryUrl,
  normalizeHomeNotice,
  normalizeHostname,
  normalizeHostnameSuffix,
  normalizeKey,
  normalizeLibraries,
  normalizeLibraryId,
  normalizeNetdiskFolderPath,
  normalizeOnlineClassrooms,
  normalizePlanScope,
  normalizePrefix,
  normalizeReminderLeadMinutes,
  normalizeRemoteSchedule,
  normalizeResourceAccessMode,
  normalizeScheduleTargetId,
  normalizeScopedScheduleId,
  normalizeSpecificDate,
  normalizeStudyData,
  normalizeStudySchedule,
  normalizeTitle,
  normalizeUiZoomFactor,
  normalizeWeekdays,
  parseUrl,
  resolveClassroomTitle,
  resolveLibraryTitle,
  resolveStudyTargetTitle,
  serializeLibraries,
  serializeOnlineClassrooms,
  shortcutMatches
} = require('./study-runtime');
const {
  createBannerAssetLoader,
  createStatePathHelpers
} = require('./runtime-paths');
const {
  createConfigRuntime
} = require('./config-runtime');
const {
  createStudyScheduleRuntime
} = require('./schedule-runtime');
const {
  registerShellIpc
} = require('./ipc-runtime');
const {
  createReminderPollingRuntime
} = require('./reminder-polling-runtime');
const {
  createReminderRuntime
} = require('./reminder-runtime');
const {
  createNavigationRuntime
} = require('./navigation-runtime');
const {
  createNetdiskRuntime
} = require('./netdisk-runtime');
const {
  createStorageRuntime
} = require('./storage-runtime');
const {
  createStudyDataRuntime
} = require('./study-data-runtime');
const {
  createExitRuntime
} = require('./exit-runtime');
const {
  createAppShellRuntime
} = require('./app-shell-runtime');
const {
  createInternalServiceRuntime
} = require('./internal-service-runtime');
const {
  createSecurityRuntime
} = require('./security-runtime');
const {
  createStudyTargetRuntime
} = require('./study-target-runtime');

const CONFIG_FILE = 'config.json';
const EMBEDDED_CONFIG_FILE = 'embedded-config.json';
const INTERNAL_SERVER_PREFIX = '/__studygate';
const INTERNAL_MEDIA_ROUTE = `${INTERNAL_SERVER_PREFIX}/baidu/media`;
const INTERNAL_OAUTH_CALLBACK_ROUTE = `${INTERNAL_SERVER_PREFIX}/baidu/oauth/callback`;
const INTERNAL_MOBILE_CONFIG_ROUTE = `${INTERNAL_SERVER_PREFIX}/mobile`;
const INTERNAL_MOBILE_SCHEDULE_API_ROUTE = `${INTERNAL_SERVER_PREFIX}/mobile/api/schedule`;
const INTERNAL_SERVER_PORT = 32147;
const ALLOWED_APP_SCHEMES = new Set(['about:', 'blob:', 'data:', 'file:']);
const ALLOWED_MEDIA_PERMISSIONS = new Set(['media', 'speaker-selection']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.m4v', '.mov', '.mp3', '.m4a']);
const SESSION_PARTITION = 'persist:studygate';
const STABLE_USER_DATA_DIR = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'StudyGate'
);
const REMINDER_TRIGGER_GRACE_MS = 2 * 60 * 1000;
const REMINDER_CHECK_ALIGNMENT_FUZZ_MS = 150;
const MAIN_WINDOW_USER_AGENT = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
const CLASSROOM_SHELL_TOP_HEIGHT = 62;
const STARTUP_DEBUG_LOG = path.join(os.tmpdir(), 'studygate-startup-debug.log');
const LEGACY_MEDIA_COMPATIBILITY_SCRIPT = String.raw`
(() => {
  if (!window || !window.navigator || !/^https?:$/.test(window.location.protocol)) {
    return;
  }

  const navigatorObject = window.navigator;
  const originalMediaDevices = navigatorObject.mediaDevices || {};

  const normalizeTrackConstraints = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return value;
    }

    const nextValue = { ...value };
    let sourceId = '';

    if (typeof nextValue.sourceId === 'string' && nextValue.sourceId) {
      sourceId = nextValue.sourceId;
    }

    if (nextValue.mandatory && typeof nextValue.mandatory.sourceId === 'string' && nextValue.mandatory.sourceId) {
      sourceId = nextValue.mandatory.sourceId;
    }

    if (Array.isArray(nextValue.optional)) {
      for (const option of nextValue.optional) {
        if (option && typeof option.sourceId === 'string' && option.sourceId) {
          sourceId = option.sourceId;
          break;
        }
      }
    }

    delete nextValue.sourceId;
    delete nextValue.optional;
    delete nextValue.mandatory;

    if (sourceId) {
      nextValue.deviceId = { exact: sourceId };
    }

    return Object.keys(nextValue).length ? nextValue : true;
  };

  const normalizeConstraints = (constraints) => {
    if (constraints === 'video') {
      return { video: true };
    }

    if (constraints === 'audio') {
      return { audio: true };
    }

    if (!constraints || typeof constraints !== 'object' || Array.isArray(constraints)) {
      return constraints;
    }

    const nextConstraints = { ...constraints };

    if ('video' in nextConstraints) {
      nextConstraints.video = normalizeTrackConstraints(nextConstraints.video);
    }

    if ('audio' in nextConstraints) {
      nextConstraints.audio = normalizeTrackConstraints(nextConstraints.audio);
    }

    return nextConstraints;
  };

  const nativeLegacyGetUserMedia =
    (typeof navigatorObject.getUserMedia === 'function' && navigatorObject.getUserMedia.bind(navigatorObject)) ||
    (typeof navigatorObject.webkitGetUserMedia === 'function' && navigatorObject.webkitGetUserMedia.bind(navigatorObject)) ||
    (typeof navigatorObject.mozGetUserMedia === 'function' && navigatorObject.mozGetUserMedia.bind(navigatorObject)) ||
    (typeof navigatorObject.msGetUserMedia === 'function' && navigatorObject.msGetUserMedia.bind(navigatorObject)) ||
    null;

  const nativeModernGetUserMedia =
    originalMediaDevices && typeof originalMediaDevices.getUserMedia === 'function'
      ? originalMediaDevices.getUserMedia.bind(originalMediaDevices)
      : null;

  if (!nativeModernGetUserMedia && !nativeLegacyGetUserMedia) {
    return;
  }

  const modernShim = (constraints) => {
    const normalizedConstraints = normalizeConstraints(constraints);

    if (nativeModernGetUserMedia) {
      return nativeModernGetUserMedia(normalizedConstraints);
    }

    return new Promise((resolve, reject) => {
      nativeLegacyGetUserMedia(normalizedConstraints, resolve, reject);
    });
  };

  const legacyShim = (constraints, successCallback, errorCallback) =>
    modernShim(constraints).then(
      (stream) => {
        if (typeof successCallback === 'function') {
          successCallback(stream);
        }

        return stream;
      },
      (error) => {
        if (typeof errorCallback === 'function') {
          errorCallback(error);
        }

        throw error;
      }
    );

  try {
    if (!navigatorObject.mediaDevices) {
      Object.defineProperty(navigatorObject, 'mediaDevices', {
        configurable: true,
        enumerable: true,
        value: originalMediaDevices
      });
    }
  } catch {
    // Ignore read-only navigator properties.
  }

  try {
    navigatorObject.mediaDevices.getUserMedia = modernShim;
  } catch {
    // Ignore read-only mediaDevices methods.
  }

  for (const key of ['getUserMedia', 'webkitGetUserMedia', 'mozGetUserMedia', 'msGetUserMedia']) {
    try {
      navigatorObject[key] = legacyShim;
    } catch {
      // Ignore read-only legacy navigator properties.
    }
  }

  if (!window.AudioContext && window.webkitAudioContext) {
    window.AudioContext = window.webkitAudioContext;
  }
})();
`;
let mainWindow = null;
let appConfig = null;
let classroomDefinitions = [];
let classroomIndex = new Map();
let libraryDefinitions = [];
let libraryIndex = new Map();
let learningToolDefinitions = [];
let learningToolIndex = new Map();
let internalServiceRuntime = null;
const nativeModuleDefinitions = listNativeModules();
const nativeModuleIndex = new Map(nativeModuleDefinitions.map((moduleDefinition) => [moduleDefinition.id, moduleDefinition]));
const bannerAssets = createBannerAssetLoader({
  app,
  fs,
  path,
  processCwd: () => process.cwd(),
  processExecPath: process.execPath
});
const configRuntime = createConfigRuntime({
  app,
  bannerAssets,
  createConfigError,
  defaultNavigationBannerText: DEFAULT_NAVIGATION_BANNER_TEXT,
  defaultReminderLeadMinutes: DEFAULT_REMINDER_LEAD_MINUTES,
  embeddedConfigFile: EMBEDDED_CONFIG_FILE,
  fs,
  mergeStudySchedules,
  nativeModuleDefinitions,
  normalizeControlSettings,
  normalizeHomeNotice,
  normalizeHostname,
  normalizeHostnameSuffix,
  normalizeLibraries,
  normalizeLearningTools,
  normalizeOnlineClassrooms,
  normalizePrefix,
  normalizeReminderLeadMinutes,
  normalizeRemoteSchedule,
  normalizeResourceAccessMode,
  normalizeStudySchedule,
  parseUrl,
  path,
  serializeLearningTools,
  serializeLibraries,
  serializeOnlineClassrooms,
  stableUserDataDir: STABLE_USER_DATA_DIR
});
const runtimePaths = createStatePathHelpers(() => appConfig && appConfig.stateDir);
let navigationRuntime = null;
const exitRuntime = createExitRuntime({
  BrowserWindow,
  getAppConfig: () => appConfig,
  getMainWindow: () => mainWindow,
  getAllowAppQuit: () => allowAppQuit,
  setAllowAppQuit: (value) => {
    allowAppQuit = Boolean(value);
  },
  hashExitPassword,
  normalizePrefix,
  pathModule: path,
  preloadPath: path.join(__dirname, 'preload.js'),
  quitApp: () => app.quit(),
  sessionPartition: SESSION_PARTITION
});
const {
  closeExitPasswordWindow,
  exitVerificationModel,
  hasConfiguredExitPassword,
  requestAppQuit,
  verifyExitPassword
} = exitRuntime;
const securityRuntime = createSecurityRuntime({
  allowedAppSchemes: ALLOWED_APP_SCHEMES,
  allowedMediaPermissions: ALLOWED_MEDIA_PERMISSIONS,
  app,
  fileURLToPath,
  fs,
  getAppConfig: () => appConfig,
  getClassroomDefinitions: () => classroomDefinitions,
  getMainWindow: () => mainWindow,
  getResolveClassroomForUrl: () => (navigationRuntime ? navigationRuntime.resolveClassroomForUrl : null),
  legacyMediaCompatibilityScript: LEGACY_MEDIA_COMPATIBILITY_SCRIPT,
  os,
  parseUrl,
  pathModule: path,
  runtimePaths,
  shortcutMatches
});
const {
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
} = securityRuntime;
let scheduleSessionPersist = () => {};
const studyTargetRuntime = createStudyTargetRuntime({
  dialog,
  launchLearningTool,
  launchNativeModule,
  learningToolEntryTarget: (toolId) => learningToolEntryTarget(toolId),
  libraryTarget: (libraryId) => libraryTarget(libraryId),
  logNavigationDebug,
  nativeModuleTarget,
  normalizePrefix,
  pathModule: path,
  processExecPath: () => process.execPath,
  projectRootPath: path.resolve(__dirname, '..'),
  resolveLearningTool,
  resolveLibrary,
  resolveNativeModule,
  resolveNativeModuleDefinitionFromIndex: (moduleId) =>
    nativeModuleIndex.get(normalizePrefix(moduleId)),
  resolveClassroom
});
const {
  launchLearningToolEntry,
  launchNativeModuleEntry,
  resolveStudyTargetById
} = studyTargetRuntime;
navigationRuntime = createNavigationRuntime({
  BrowserView,
  buildClassroomNavigationUiModel,
  buildNavigationUiModel,
  classroomShellTopHeight: CLASSROOM_SHELL_TOP_HEIGHT,
  dialog,
  fileURLToPath,
  getAppConfig: () => appConfig,
  getBannerImageUrl: () => bannerAssets.navigationBannerDataUrl(),
  getBannerText: () => appConfig.navigationBannerText,
  getClassroomDefinitions: () => classroomDefinitions,
  getCurrentWindowZoomFactor: () => currentWindowZoomFactor,
  getMainWindow: () => mainWindow,
  isAllowedTopLevel,
  isExitShortcut,
  launchLearningToolEntry,
  launchNativeModuleEntry,
  logBlockedRequest,
  logNavigationDebug,
  mainWindowUserAgent: MAIN_WINDOW_USER_AGENT,
  getScheduleLaunchStatusForToday: (options) => getScheduleLaunchStatusForToday(options),
  markScheduleCompletedForToday: (options) => markScheduleCompletedForToday(options),
  normalizePrefix,
  onMainWindowClosed: () => {
    mainWindow = null;
  },
  parseUrl,
  pathModule: path,
  requestAppQuit,
  resolveClassroom,
  resolveLibrary,
  scheduleSessionPersist,
  sessionPartition: SESSION_PARTITION,
  shouldAllowAppQuit: () => allowAppQuit,
  shouldBlockShortcut,
  syncCompatibilityPatch: (targetWebContents) => applyCompatibilityPatch(targetWebContents),
  topLevelDecision
});
const {
  attachMainWindowHandlers,
  currentNavigationModel,
  destroyClassroomBrowserView,
  getActiveClassroomShell,
  goBackIfPossible,
  goForwardIfPossible,
  isClassroomShellActive,
  launchStudyEntry,
  learningToolEntryTarget,
  libraryTarget,
  loadHomePage,
  navigateMainWindow,
  resolveClassroomForUrl,
  setClassroomBrowserViewZoomFactor,
  updateClassroomShellTopHeight,
  syncClassroomBrowserView
} = navigationRuntime;
const appShellRuntime = createAppShellRuntime({
  app,
  BrowserWindow,
  dialog,
  attachMainWindowHandlers,
  getAppConfig: () => appConfig,
  getMainWindow: () => mainWindow,
  loadHomePage,
  logNavigationDebug,
  pathModule: path,
  preloadPath: path.join(__dirname, 'preload.js'),
  sessionPartition: SESSION_PARTITION,
  setMainWindow: (window) => {
    mainWindow = window;
  }
});
const {
  configureAutoLaunch,
  createMainWindow,
  focusMainWindow,
  showStartupError
} = appShellRuntime;
const storageRuntime = createStorageRuntime({
  createEmptyStudyToolsState,
  crypto,
  formatLocalDateKey,
  fs,
  getAppConfig: () => appConfig,
  getClassroomDefinitions: () => classroomDefinitions,
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
  sessionPartition: SESSION_PARTITION,
  shouldPersistOriginStorage,
  storageOriginKey,
  logNavigationDebug
});
const {
  clearCourseSiteState,
  getOriginStorageSnapshot,
  getSiteCredentialSnapshot,
  getStudyToolsState,
  ensureMobileToken,
  loadOriginStorageState,
  loadSiteCredentialState,
  loadStudyToolsState,
  restoreSessionState,
  saveSiteCredentialSnapshot,
  saveStudyToolsState,
  scheduleSessionPersist: storageScheduleSessionPersist,
  setOriginStorageSnapshot,
  setStudyToolsUiZoomFactor,
  stopSessionPersistence,
  studentDeviceCredentialPayload
} = storageRuntime;
scheduleSessionPersist = storageScheduleSessionPersist;
const studyDataRuntime = createStudyDataRuntime({
  createEmptyRemoteScheduleStatus,
  createEmptyStudentDeviceAccessStatus,
  fetchJson: (...args) => internalServiceRuntime.fetchJson(...args),
  getAppConfig: () => appConfig,
  getClassroomDefinitions: () => classroomDefinitions,
  getLearningToolDefinitions: () => learningToolDefinitions,
  getLibraryDefinitions: () => libraryDefinitions,
  fs,
  mergeStudySchedules,
  normalizeControlSettings,
  normalizeDateList,
  normalizePrefix,
  normalizeStudyData,
  normalizeStudySchedule,
  normalizeTitle,
  serializeLearningTools,
  serializeLibraries,
  serializeOnlineClassrooms,
  studentDeviceCredentialPayload,
  reminderAudioPrewarm: () => reminderRuntime.scheduleReminderAudioPrewarm(),
  rebuildLibraryIndex,
  runtimePaths
});
const {
  loadPersistedStudySchedule,
  loadRemoteScheduleCache,
  persistStudentStudySchedule,
  saveStudySchedule,
  serializeStudySchedule,
  startRemoteSchedulePolling,
  stopRemoteSchedulePolling,
  syncStudentDeviceAccessStatus,
  syncRemoteStudySchedule
} = studyDataRuntime;
const studyScheduleRuntime = createStudyScheduleRuntime({
  buildHomeUiModel,
  formatDisplayTime,
  formatLocalDateKey,
  formatLocalTime,
  formatStudyDayLabel,
  formatWeekdayLabel,
  localWeekdayNumber,
  normalizeDateList,
  normalizePlanScope,
  normalizePrefix,
  normalizeScheduleTargetId,
  normalizeSpecificDate,
  normalizeWeekdays,
  getAppConfig: () => appConfig,
  getStudyToolsState,
  saveStudyToolsState,
  resolveStudyTargetById: (targetId) => resolveStudyTargetById(targetId),
  getNativeModuleDefinitions: () => nativeModuleDefinitions,
  getClassroomDefinitions: () => classroomDefinitions,
  getLibraryDefinitions: () => libraryDefinitions,
  getLearningToolDefinitions: () => learningToolDefinitions,
  nativeModuleTarget,
  libraryTarget,
  learningToolEntryTarget,
  syncStudentDeviceAccessStatus: (options) => syncStudentDeviceAccessStatus(options),
  serializeStudySchedule
});
const {
  buildHomeModel,
  buildStudentPlanResponse,
  buildStudyScheduleModel,
  findScheduleForLaunch,
  getScheduleLaunchStatusForToday,
  getScheduleMark,
  getTodaySchedules,
  markScheduleCompletedForToday,
  normalizeReminderMarks,
  upsertScheduleMark
} = studyScheduleRuntime;
const reminderRuntime = createReminderRuntime({
  app,
  crypto,
  fs,
  os,
  path,
  shell: electronShell,
  spawn,
  normalizePrefix,
  clockTimeToMinutes,
  logDebug: (...args) => logReminderDebug(...args),
  getAppConfig: () => appConfig,
  processExecPath: process.execPath,
  processCwd: () => process.cwd()
});
const reminderPollingRuntime = createReminderPollingRuntime({
  Notification,
  logDebug: (...args) => logReminderDebug(...args),
  getMainWindow: () => mainWindow,
  focusMainWindow: () => focusMainWindow(),
  getAppConfig: () => appConfig,
  formatLocalDateKey,
  getTodaySchedules: (date) => getTodaySchedules(date),
  getScheduleMark: (scheduleId, dateKey) => getScheduleMark(scheduleId, dateKey),
  normalizeReminderMarks: (mark) => normalizeReminderMarks(mark),
  upsertScheduleMark: (schedule, updates, date) => upsertScheduleMark(schedule, updates, date),
  reminderRuntime,
  defaultLeadMinutes: DEFAULT_REMINDER_LEAD_MINUTES,
  triggerGraceMs: REMINDER_TRIGGER_GRACE_MS,
  checkAlignmentFuzzMs: REMINDER_CHECK_ALIGNMENT_FUZZ_MS
});
const netdiskRuntime = createNetdiskRuntime({
  BrowserWindow,
  Readable,
  createConfigError,
  createEmptyNetdiskState,
  createNetdiskApiError,
  createNetdiskAuthError,
  getAppConfig: () => appConfig,
  getInternalMediaRoute: () => INTERNAL_MEDIA_ROUTE,
  getInternalServerOrigin: () => internalServiceRuntime.getInternalServerOrigin(),
  normalizeNetdiskFolderPath,
  normalizePrefix,
  normalizeTitle,
  pathModule: path,
  readStateFile: (filePath) => {
    if (!filePath || !fs.existsSync(filePath)) {
      return '';
    }

    return fs.readFileSync(filePath, 'utf8');
  },
  resolveLibrary,
  runtimePaths,
  videoExtensions: VIDEO_EXTENSIONS,
  writeStateFile: (filePath, content) => {
    if (!filePath) {
      return;
    }

    fs.writeFileSync(filePath, content, 'utf8');
  }
});
const {
  authorizeNetdisk,
  buildLibraryFolderModel,
  buildLibraryModel,
  loadNetdiskState,
  proxyNetdiskMedia
} = netdiskRuntime;
internalServiceRuntime = createInternalServiceRuntime({
  createConfigError,
  ensureMobileToken,
  fs,
  getAppConfig: () => appConfig,
  getClassroomDefinitions: () => classroomDefinitions,
  getLearningToolDefinitions: () => learningToolDefinitions,
  getLibraryDefinitions: () => libraryDefinitions,
  getProxyNetdiskMedia: () => proxyNetdiskMedia,
  getSaveStudySchedule: () => saveStudySchedule,
  getSerializeStudySchedule: () => serializeStudySchedule,
  http,
  internalMediaRoute: INTERNAL_MEDIA_ROUTE,
  internalMobileConfigRoute: INTERNAL_MOBILE_CONFIG_ROUTE,
  internalMobileScheduleApiRoute: INTERNAL_MOBILE_SCHEDULE_API_ROUTE,
  internalOAuthCallbackRoute: INTERNAL_OAUTH_CALLBACK_ROUTE,
  internalServerPort: INTERNAL_SERVER_PORT,
  nativeModuleTargetOptions,
  normalizeDateList,
  normalizePrefix,
  os,
  pathModule: path
});
const {
  startInternalServer,
  stopInternalServer
} = internalServiceRuntime;
let allowAppQuit = false;
let currentWindowZoomFactor = DEFAULT_UI_ZOOM_FACTOR;

function appendStartupDebug(message, details) {
  try {
    const suffix = details === undefined ? '' : ` ${JSON.stringify(details)}`;
    fs.appendFileSync(
      STARTUP_DEBUG_LOG,
      `[${new Date().toISOString()}] ${message}${suffix}${os.EOL}`,
      'utf8'
    );
  } catch {
    // Ignore startup debug logging failures.
  }
}

appendStartupDebug('process-start', {
  pid: process.pid,
  cwd: process.cwd(),
  execPath: process.execPath
});

app.setPath('userData', STABLE_USER_DATA_DIR);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-features', 'Translate,msSmartScreenProtection');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const gotSingleInstanceLock = app.requestSingleInstanceLock();
appendStartupDebug('single-instance-lock', {
  gotSingleInstanceLock
});

if (!gotSingleInstanceLock) {
  app.exit(0);
}

function dedupe(items) {
  return [...new Set(items)];
}

function loadConfig() {
  return configRuntime.loadConfig(CONFIG_FILE);
}

function rebuildLibraryIndex() {
  classroomDefinitions = appConfig.classrooms;
  classroomIndex = new Map(classroomDefinitions.map((classroom) => [classroom.id, classroom]));
  libraryDefinitions = appConfig.libraries;
  libraryIndex = new Map(libraryDefinitions.map((library) => [library.id, library]));
  learningToolDefinitions = appConfig.learningTools || [];
  learningToolIndex = new Map(learningToolDefinitions.map((learningTool) => [learningTool.id, learningTool]));
}

function resolveClassroom(classroomId) {
  if (classroomId && classroomIndex.has(classroomId)) {
    return classroomIndex.get(classroomId);
  }

  if (classroomId) {
    return null;
  }

  return classroomDefinitions[0] || null;
}

function resolveLibrary(libraryId) {
  if (libraryId && libraryIndex.has(libraryId)) {
    return libraryIndex.get(libraryId);
  }

  if (libraryId) {
    return null;
  }

  return libraryDefinitions[0] || null;
}

function resolveLearningTool(learningToolId) {
  if (learningToolId && learningToolIndex.has(learningToolId)) {
    return learningToolIndex.get(learningToolId);
  }

  if (learningToolId) {
    return null;
  }

  return learningToolDefinitions[0] || null;
}

function applyWindowZoomFactor(factor, options = {}) {
  currentWindowZoomFactor = normalizeUiZoomFactor(factor);
  setStudyToolsUiZoomFactor(currentWindowZoomFactor, { skipPersist: options.skipPersist });

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.setZoomFactor(currentWindowZoomFactor);
  }

  setClassroomBrowserViewZoomFactor(currentWindowZoomFactor);

  return currentWindowZoomFactor;
}
function configureSessionGuards() {
  const ses = session.fromPartition(SESSION_PARTITION);

  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(shouldGrantPermission(webContents, permission, null, details));
  });

  ses.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) =>
    shouldGrantPermission(webContents, permission, requestingOrigin, details)
  );

  ses.on('will-download', (event) => {
    event.preventDefault();
  });

  ses.cookies.on('changed', () => {
    scheduleSessionPersist();
  });

  ses.webRequest.onBeforeRequest((details, callback) => {
    const allowed = shouldAllowRequest(details);

    if (!allowed) {
      logBlockedRequest(details, 'BLOCK_REQ');
    }

    callback({ cancel: !allowed });
  });
}

if (gotSingleInstanceLock) {
  app.whenReady().then(async () => {
    try {
      appendStartupDebug('when-ready-enter');
      appConfig = loadConfig();
      appendStartupDebug('config-loaded', {
        appTitle: appConfig.appTitle,
        classrooms: appConfig.classrooms.length,
        libraries: appConfig.libraries.length
      });
      app.setAppUserModelId('StudyGate');
      rebuildLibraryIndex();
      appendStartupDebug('indexes-rebuilt');
      configureAutoLaunch();
      loadPersistedStudySchedule();
      loadRemoteScheduleCache();
      loadNetdiskState();
      loadOriginStorageState();
      loadSiteCredentialState();
      loadStudyToolsState();
      appendStartupDebug('state-loaded');
      reminderRuntime.scheduleReminderAudioPrewarm(50);
      await startInternalServer();
      appendStartupDebug('internal-server-started');
      app.setName(appConfig.appTitle);
      configureSessionGuards();
      appendStartupDebug('session-guards-configured');
      registerShellIpc({
        app,
        ipcMain,
        normalizePrefix,
        defaultUiZoomFactor: DEFAULT_UI_ZOOM_FACTOR,
        getOriginStorageSnapshot,
        setOriginStorageSnapshot,
        getSiteCredentialSnapshot,
        saveSiteCredentialSnapshot,
        clearCourseSiteState,
        isClassroomShellActive,
        getActiveClassroomShell,
        syncClassroomBrowserView,
        getAppConfig: () => appConfig,
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
        getMainWindow: () => mainWindow,
        getCurrentWindowZoomFactor: () => currentWindowZoomFactor,
        applyWindowZoomFactor,
        navigateMainWindow,
        updateClassroomShellTopHeight,
        exitVerificationModel,
        hasConfiguredExitPassword,
        verifyExitPassword,
        setAllowAppQuit: (value) => {
          allowAppQuit = Boolean(value);
        },
        closeExitPasswordWindow
      });
      appendStartupDebug('ipc-registered');
      await restoreSessionState();
      appendStartupDebug('session-restored');
      await syncRemoteStudySchedule();
      appendStartupDebug('remote-schedule-synced');
      await syncStudentDeviceAccessStatus({
        throwOnError: false
      });
      appendStartupDebug('student-device-access-synced');
      startRemoteSchedulePolling();
      appendStartupDebug('remote-polling-started');
      createMainWindow();
      appendStartupDebug('main-window-created');
      reminderPollingRuntime.start();
      appendStartupDebug('reminder-polling-started');
    } catch (error) {
      appendStartupDebug('startup-error', {
        message: error && error.message ? error.message : String(error),
        stack: error && error.stack ? error.stack : ''
      });
      showStartupError(error);
      app.quit();
    }
  });
}

app.on('second-instance', () => {
  logNavigationDebug('second-instance');
  if (focusMainWindow()) {
    return;
  }

  if (app.isReady() && appConfig) {
    createMainWindow();
  }
});

app.on('window-all-closed', () => {
  logNavigationDebug('window-all-closed', {
    allowAppQuit
  });
  if (allowAppQuit) {
    app.quit();
    return;
  }

  setImmediate(() => {
    if (!allowAppQuit && (!mainWindow || mainWindow.isDestroyed())) {
      logNavigationDebug('window-all-closed-recreate-main-window');
      createMainWindow();
    }
  });
});

app.on('before-quit', () => {
  allowAppQuit = true;
  destroyClassroomBrowserView();
  stopSessionPersistence();

  clearPendingNetdiskAuth();
  closeExitPasswordWindow();
  reminderPollingRuntime.stop();
  stopRemoteSchedulePolling();
  stopInternalServer();
  void persistSessionState();
});
