'use strict';

const { Notification, app, BrowserWindow, dialog, ipcMain, safeStorage, screen, session, shell: electronShell } = require('electron');
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

const CONFIG_FILE = 'config.json';
const EMBEDDED_CONFIG_FILE = 'embedded-config.json';
const SESSION_STATE_FILE = 'session-state.json';
const ORIGIN_STORAGE_STATE_FILE = 'origin-storage-state.json';
const SITE_CREDENTIAL_STATE_FILE = 'site-credentials.bin';
const NETDISK_STATE_FILE = 'baidu-netdisk-state.json';
const STUDY_TOOLS_STATE_FILE = 'study-tools-state.json';
const STUDY_SCHEDULE_FILE = 'study-schedule.json';
const REMOTE_SCHEDULE_CACHE_FILE = 'study-schedule-cache.json';
const INTERNAL_SERVER_PREFIX = '/__studygate';
const INTERNAL_MEDIA_ROUTE = `${INTERNAL_SERVER_PREFIX}/baidu/media`;
const INTERNAL_OAUTH_CALLBACK_ROUTE = `${INTERNAL_SERVER_PREFIX}/baidu/oauth/callback`;
const INTERNAL_MOBILE_CONFIG_ROUTE = `${INTERNAL_SERVER_PREFIX}/mobile`;
const INTERNAL_MOBILE_SCHEDULE_API_ROUTE = `${INTERNAL_SERVER_PREFIX}/mobile/api/schedule`;
const INTERNAL_SERVER_PORT = 32147;
const NETDISK_AUTH_USER_AGENT =
  'pan.baidu.com';
const ALLOWED_APP_SCHEMES = new Set(['about:', 'blob:', 'data:', 'file:']);
const ALLOWED_MEDIA_PERMISSIONS = new Set(['media', 'speaker-selection']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.m4v', '.mov', '.mp3', '.m4a']);
const SESSION_PARTITION = 'persist:studygate';
const STABLE_USER_DATA_DIR = path.join(app.getPath('appData'), 'StudyGate');
const VALID_CARD_TONES = new Set(['amber', 'teal', 'coral']);
const AUTH_ERRNOS = new Set([111]);
const RESOURCE_ACCESS_MODES = new Set(['whitelist', 'top-level-only']);
const REMINDER_TRIGGER_GRACE_MS = 2 * 60 * 1000;
const REMINDER_CHECK_ALIGNMENT_FUZZ_MS = 150;
const DEFAULT_REMINDER_LEAD_MINUTES = [5, 1];
const NETDISK_DEVICE_SCOPE = 'basic,netdisk';
const NETDISK_DEVICE_MIN_POLL_MS = 5000;
const PIPER_RUNTIME_RELATIVE_DIR = path.join('vendor', 'piper', 'runtime', 'piper');
const PIPER_EXECUTABLE_NAME = 'piper.exe';
const PIPER_MODEL_RELATIVE_PATH = path.join('vendor', 'piper', 'models', 'zh_CN-huayan-medium.onnx');
const PIPER_MODEL_CONFIG_RELATIVE_PATH = `${PIPER_MODEL_RELATIVE_PATH}.json`;
const REMINDER_AUDIO_CACHE_DIR = 'reminder-audio-cache';
const REMINDER_SEGMENT_PAUSE_MS = 210;
const REMINDER_REPEAT_PAUSE_MS = 450;
const REMINDER_SEQUENCE_REPEAT_COUNT = 3;
const REMINDER_AUDIO_TEMPLATE_VERSION = 'template-v3';
const REMINDER_FIXED_TEXT_COMPONENTS = Object.freeze({
  distance: '距离',
  remain: '还剩',
  five_minutes: '5分钟',
  one_minutes: '1分钟',
  now: '现在开始'
});
const REMINDER_SILENCE_COMPONENTS_MS = Object.freeze({
  s120: 120,
  s180: 180,
  s220: 220
});
const REMOTE_SCHEDULE_DEFAULT_REFRESH_MINUTES = 3;
const MAIN_WINDOW_USER_AGENT = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
const DEFAULT_UI_ZOOM_FACTOR = 1;
const MIN_UI_ZOOM_FACTOR = 0.75;
const MAX_UI_ZOOM_FACTOR = 1.8;
const UI_ZOOM_STEP = 0.1;
const WEEKDAY_ALIASES = new Map([
  ['1', 1],
  ['mon', 1],
  ['monday', 1],
  ['周一', 1],
  ['星期一', 1],
  ['2', 2],
  ['tue', 2],
  ['tues', 2],
  ['tuesday', 2],
  ['周二', 2],
  ['星期二', 2],
  ['3', 3],
  ['wed', 3],
  ['wednesday', 3],
  ['周三', 3],
  ['星期三', 3],
  ['4', 4],
  ['thu', 4],
  ['thur', 4],
  ['thurs', 4],
  ['thursday', 4],
  ['周四', 4],
  ['星期四', 4],
  ['5', 5],
  ['fri', 5],
  ['friday', 5],
  ['周五', 5],
  ['星期五', 5],
  ['6', 6],
  ['sat', 6],
  ['saturday', 6],
  ['周六', 6],
  ['星期六', 6],
  ['0', 7],
  ['7', 7],
  ['sun', 7],
  ['sunday', 7],
  ['周日', 7],
  ['周天', 7],
  ['星期日', 7],
  ['星期天', 7]
]);
const WEEKDAY_LABELS = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
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
const INTERNAL_PAGES = {
  home: 'home.html',
  library: 'library.html',
  studentPlan: 'student-plan.html'
};

let mainWindow = null;
let authWindow = null;
let exitPasswordWindow = null;
let appConfig = null;
let classroomDefinitions = [];
let classroomIndex = new Map();
let libraryDefinitions = [];
let libraryIndex = new Map();
let learningToolDefinitions = [];
let learningToolIndex = new Map();
const nativeModuleDefinitions = listNativeModules();
const nativeModuleIndex = new Map(nativeModuleDefinitions.map((moduleDefinition) => [moduleDefinition.id, moduleDefinition]));
let sessionPersistTimer = null;
let sessionPersistPromise = Promise.resolve();
let internalServer = null;
let internalServerOrigin = '';
let pendingNetdiskAuth = null;
let netdiskState = createEmptyNetdiskState();
let netdiskDlinkCache = new Map();
let originStorageState = { origins: {} };
let siteCredentialState = { origins: {} };
let studyToolsState = createEmptyStudyToolsState();
let reminderPollTimer = null;
let reminderFlashTimer = null;
let reminderCheckInFlight = false;
let reminderAudioBuilds = new Map();
let reminderAudioPrewarmTimer = null;
let reminderAudioPrewarmInFlight = false;
let reminderAudioPrewarmQueued = false;
let reminderAudioProcess = null;
let reminderPopupWindow = null;
let reminderPopupTimer = null;
let remoteSchedulePollTimer = null;
let remoteScheduleStatus = createEmptyRemoteScheduleStatus();
let studentDeviceAccessStatus = createEmptyStudentDeviceAccessStatus();
let remoteScheduleSyncSerial = 0;
let studyDataMutationSerial = 0;
let allowAppQuit = false;
let currentWindowZoomFactor = DEFAULT_UI_ZOOM_FACTOR;

app.setPath('userData', STABLE_USER_DATA_DIR);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-features', 'Translate,msSmartScreenProtection');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.exit(0);
}

function createEmptyNetdiskState() {
  return {
    accessToken: '',
    refreshToken: '',
    expiresAt: 0,
    scope: '',
    tokenType: 'Bearer'
  };
}

function createEmptyStudyToolsState() {
  return {
    classMarks: {},
    mobileToken: crypto.randomBytes(12).toString('hex'),
    uiZoomFactor: DEFAULT_UI_ZOOM_FACTOR,
    studentDeviceCredential: {
      deviceId: `desktop-${crypto.randomBytes(8).toString('hex')}`,
      deviceSecret: crypto.randomBytes(16).toString('hex'),
      label: ''
    }
  };
}

function normalizeUiZoomFactor(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return DEFAULT_UI_ZOOM_FACTOR;
  }

  return Math.min(MAX_UI_ZOOM_FACTOR, Math.max(MIN_UI_ZOOM_FACTOR, Math.round(numeric * 100) / 100));
}

function createEmptyRemoteScheduleStatus() {
  return {
    enabled: false,
    source: 'local',
    lastAttemptAt: '',
    lastSuccessAt: '',
    message: '当前使用本机课表。'
  };
}

function createEmptyStudentDeviceAccessStatus() {
  return {
    mode: 'local',
    approved: true,
    status: 'approved',
    deviceId: '',
    label: '',
    requestedAt: '',
    approvedAt: '',
    updatedAt: '',
    message: '当前使用本机学生计划。'
  };
}

function createEmptyControlSettings() {
  return {
    exitPasswordHash: '',
    exitPasswordSalt: '',
    exitPasswordUpdatedAt: ''
  };
}

function dedupe(items) {
  return [...new Set(items)];
}

function candidateFiles(fileName) {
  return dedupe([
    path.join(process.cwd(), fileName),
    path.join(path.dirname(process.execPath), fileName),
    path.join(app.getAppPath(), fileName)
  ]);
}

function firstExistingFile(paths) {
  return paths.find((filePath) => fs.existsSync(filePath));
}

function normalizePrefix(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}

function normalizeHostname(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().toLowerCase();
}

function normalizeHostnameSuffix(value) {
  const normalized = normalizeHostname(value);

  if (!normalized) {
    return '';
  }

  return normalized.startsWith('.') ? normalized : `.${normalized}`;
}

function normalizeKey(input) {
  if (!input.key) {
    return '';
  }

  const rawKey = input.key.toUpperCase();
  const aliases = {
    ARROWLEFT: 'LEFT',
    ARROWRIGHT: 'RIGHT',
    ARROWUP: 'UP',
    ARROWDOWN: 'DOWN',
    ESCAPE: 'ESC'
  };

  return aliases[rawKey] || rawKey;
}

function normalizeTitle(fileName) {
  return path.basename(fileName, path.extname(fileName)).replace(/[_-]+/g, ' ').trim();
}

function normalizeCardTone(value, fallback = 'teal') {
  const normalized = normalizePrefix(value).toLowerCase();
  return VALID_CARD_TONES.has(normalized) ? normalized : fallback;
}

function normalizeResourceAccessMode(value) {
  const normalized = normalizePrefix(value).toLowerCase();
  return RESOURCE_ACCESS_MODES.has(normalized) ? normalized : 'whitelist';
}

function normalizeClockTime(value, fallback) {
  const normalized = normalizePrefix(value);

  if (/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(normalized)) {
    return normalized;
  }

  return fallback;
}

function clockTimeToMinutes(value) {
  const normalized = normalizeClockTime(value, '');

  if (!normalized) {
    return null;
  }

  const [hours, minutes] = normalized.split(':').map((item) => Number(item));
  return hours * 60 + minutes;
}

function normalizeReminderLeadMinutes(rawValue) {
  const source = Array.isArray(rawValue) ? rawValue : [rawValue];
  const values = [];
  const seen = new Set();

  for (const item of source) {
    const numeric = Number(item);

    if (!Number.isFinite(numeric)) {
      continue;
    }

    const rounded = Math.round(numeric);

    if (rounded < 0 || rounded > 120 || seen.has(rounded)) {
      continue;
    }

    seen.add(rounded);
    values.push(rounded);
  }

  return values.sort((left, right) => right - left);
}

function normalizeControlSettings(rawSettings) {
  const source = rawSettings && typeof rawSettings === 'object' ? rawSettings : {};
  const exitPasswordHash = normalizePrefix(source.exitPasswordHash);
  const exitPasswordSalt = normalizePrefix(source.exitPasswordSalt);
  const exitPasswordUpdatedAt = normalizePrefix(source.exitPasswordUpdatedAt);

  if (!exitPasswordHash || !exitPasswordSalt) {
    return createEmptyControlSettings();
  }

  return {
    exitPasswordHash,
    exitPasswordSalt,
    exitPasswordUpdatedAt
  };
}

function hashExitPassword(password, salt) {
  return crypto.createHash('sha256').update(`${salt}\u0000${password}`).digest('hex');
}

function hasConfiguredExitPassword() {
  return Boolean(
    appConfig &&
      appConfig.controlSettings &&
      appConfig.controlSettings.exitPasswordHash &&
      appConfig.controlSettings.exitPasswordSalt
  );
}

function verifyExitPassword(password) {
  if (!hasConfiguredExitPassword()) {
    return true;
  }

  const rawPassword = typeof password === 'string' ? password : '';
  const candidateHash = hashExitPassword(rawPassword, appConfig.controlSettings.exitPasswordSalt);
  const expectedHash = appConfig.controlSettings.exitPasswordHash;

  if (candidateHash.length !== expectedHash.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(candidateHash, 'utf8'),
    Buffer.from(expectedHash, 'utf8')
  );
}

function normalizeScheduleTargetId(value) {
  const normalized = normalizeLibraryId(value, '');

  if (!normalized) {
    return '';
  }

  if (['course', 'english', 'english-course', 'start-url', 'starturl'].includes(normalized)) {
    return 'english-course';
  }

  return normalized;
}

function normalizeEntryUrl(value) {
  const normalized = normalizePrefix(value);
  const parsed = parseUrl(normalized);

  if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
    return '';
  }

  return parsed.href;
}

function normalizeWeekdays(rawValue) {
  const source = Array.isArray(rawValue) ? rawValue : [rawValue];
  const days = new Set();

  for (const item of source) {
    const normalized = normalizePrefix(String(item || '')).toLowerCase();
    const weekday = WEEKDAY_ALIASES.get(normalized);

    if (weekday) {
      days.add(weekday);
    }
  }

  return [...days].sort((left, right) => left - right);
}

function normalizeSpecificDate(value) {
  const normalized = normalizePrefix(value);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return '';
  }

  const [year, month, day] = normalized.split('-').map((item) => Number(item));
  const candidate = new Date(Date.UTC(year, month - 1, day));

  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return '';
  }

  return normalized;
}

function normalizeDateList(rawValue) {
  const source = Array.isArray(rawValue) ? rawValue : [rawValue];
  const values = [];
  const seen = new Set();

  for (const item of source) {
    const normalized = normalizeSpecificDate(item);

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    values.push(normalized);
  }

  return values.sort();
}

function normalizePlanScope(value, fallback = 'parent') {
  const normalized = normalizePrefix(value).toLowerCase();
  return normalized === 'student' ? 'student' : fallback;
}

function normalizeScopedScheduleId(value, fallback, planScope = 'parent') {
  const normalizedScope = normalizePlanScope(planScope);
  const normalizedId = normalizeLibraryId(value, fallback);
  const scopePrefix = `${normalizedScope}-`;

  if (normalizedId.startsWith(scopePrefix)) {
    return normalizedId;
  }

  return `${scopePrefix}${normalizedId}`;
}

function normalizeStudySchedule(rawSchedule, classrooms, libraries, options = {}) {
  if (!Array.isArray(rawSchedule) || !rawSchedule.length) {
    return [];
  }

  const planScope = normalizePlanScope(options.planScope, 'parent');
  const classroomIds = new Set(classrooms.map((classroom) => classroom.id));
  const defaultClassroomId = classrooms[0] ? classrooms[0].id : '';
  const libraryIds = new Set(libraries.map((library) => library.id));
  const learningToolIds = new Set(
    (Array.isArray(options.learningTools) ? options.learningTools : []).map((learningTool) => learningTool.id)
  );
  const nativeModuleIds = new Set(nativeModuleDefinitions.map((moduleDefinition) => moduleDefinition.id));
  const seenIds = new Set();
  const schedule = [];

  for (let index = 0; index < rawSchedule.length; index += 1) {
    const item = rawSchedule[index] || {};
    const id = normalizeScopedScheduleId(item.id, `schedule-${index + 1}`, planScope);

    if (seenIds.has(id)) {
      continue;
    }

    const candidateTargetId = normalizeScheduleTargetId(item.target || item.targetId);
    const targetId = candidateTargetId === 'english-course'
      ? defaultClassroomId
      : classroomIds.has(candidateTargetId) ||
          libraryIds.has(candidateTargetId) ||
          learningToolIds.has(candidateTargetId) ||
          nativeModuleIds.has(candidateTargetId)
        ? candidateTargetId
        : '';
    const title =
      normalizePrefix(item.title) ||
      (targetId
        ? resolveStudyTargetTitle(
            classrooms,
            libraries,
            Array.isArray(options.learningTools) ? options.learningTools : [],
            targetId
          )
        : '');

    if (!title) {
      continue;
    }

    const specificDate = normalizeSpecificDate(item.specificDate || item.date);
    const weekdays = specificDate ? [] : normalizeWeekdays(item.weekdays || item.days);
    const exceptionDates = specificDate ? [] : normalizeDateList(item.exceptionDates || item.skipDates);

    if (!specificDate && !weekdays.length) {
      continue;
    }

    seenIds.add(id);
    schedule.push({
      id,
      planScope,
      enabled: item.enabled !== false,
      mode: specificDate ? 'date' : 'weekly',
      targetId,
      time: normalizeClockTime(item.time, '19:00'),
      title,
      message: normalizePrefix(item.message) || '',
      weekdays,
      specificDate,
      exceptionDates
    });
  }

  return schedule;
}

function normalizeRemoteSchedule(rawRemoteSchedule) {
  const url = normalizePrefix(rawRemoteSchedule && rawRemoteSchedule.url);
  const parsedUrl = parseUrl(url);

  if (url && (!parsedUrl || !['http:', 'https:'].includes(parsedUrl.protocol))) {
    throw createConfigError('remoteSchedule.url 必须是有效的 http/https 地址。');
  }

  const rawRefreshMinutes = Number(rawRemoteSchedule && rawRemoteSchedule.refreshMinutes);
  const refreshMinutes =
    Number.isFinite(rawRefreshMinutes) && rawRefreshMinutes >= 1
      ? Math.min(Math.round(rawRefreshMinutes), 1440)
      : REMOTE_SCHEDULE_DEFAULT_REFRESH_MINUTES;

  return {
    enabled: Boolean(url),
    url,
    authToken: normalizePrefix(rawRemoteSchedule && (rawRemoteSchedule.authToken || rawRemoteSchedule.token)),
    studentWriteToken: normalizePrefix(rawRemoteSchedule && (rawRemoteSchedule.studentWriteToken || rawRemoteSchedule.writeToken)),
    refreshMinutes
  };
}

function formatLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatLocalTime(date = new Date()) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function formatDisplayTime(isoString) {
  const date = new Date(isoString);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function localWeekdayNumber(date = new Date()) {
  const weekday = date.getDay();
  return weekday === 0 ? 7 : weekday;
}

function formatWeekdayLabel(weekday) {
  return WEEKDAY_LABELS[weekday] || '';
}

function formatStudyDayLabel(date = new Date()) {
  return `${formatLocalDateKey(date)} ${formatWeekdayLabel(localWeekdayNumber(date))}`;
}

function normalizeLibraryId(value, fallback) {
  const normalized = normalizePrefix(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || fallback;
}

function normalizeNetdiskFolderPath(value, fallback) {
  const normalized = normalizePrefix(value).replace(/\\/g, '/');
  const candidate = normalized || fallback;

  if (!candidate) {
    return '/';
  }

  return candidate.startsWith('/') ? candidate : `/${candidate}`;
}

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function createConfigError(message) {
  const error = new Error(message);
  error.name = 'ConfigError';
  return error;
}

function createNetdiskAuthError(message) {
  const error = new Error(message);
  error.name = 'NetdiskAuthError';
  return error;
}

function createNetdiskApiError(message, errno) {
  const error = new Error(message);
  error.name = 'NetdiskApiError';
  error.errno = errno;
  return error;
}

function isKeyboardTokenPressed(shortcutPart, input) {
  switch (shortcutPart) {
    case 'CTRL':
      return Boolean(input.control);
    case 'ALT':
      return Boolean(input.alt);
    case 'SHIFT':
      return Boolean(input.shift);
    case 'META':
    case 'CMD':
    case 'SUPER':
      return Boolean(input.meta);
    default:
      return false;
  }
}

function shortcutMatches(input, shortcut) {
  const parts = shortcut
    .toUpperCase()
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);

  if (!parts.length) {
    return false;
  }

  const keyPart = parts[parts.length - 1];
  const modifierParts = parts.slice(0, -1);
  const pressedKey = normalizeKey(input);

  if (pressedKey !== keyPart) {
    return false;
  }

  const requiredModifiers = new Set(modifierParts);
  const modifierState = {
    CTRL: Boolean(input.control),
    ALT: Boolean(input.alt),
    SHIFT: Boolean(input.shift),
    META: Boolean(input.meta)
  };

  if (modifierState.CTRL !== requiredModifiers.has('CTRL')) {
    return false;
  }

  if (modifierState.ALT !== requiredModifiers.has('ALT')) {
    return false;
  }

  if (modifierState.SHIFT !== requiredModifiers.has('SHIFT')) {
    return false;
  }

  const expectsMeta =
    requiredModifiers.has('META') ||
    requiredModifiers.has('CMD') ||
    requiredModifiers.has('SUPER');

  if (modifierState.META !== expectsMeta) {
    return false;
  }

  return modifierParts.every((part) => isKeyboardTokenPressed(part, input));
}

function defaultLibraries() {
  return [
    {
      id: 'great-chinese',
      title: '大语文',
      description: '只展示百度网盘固定目录里的大语文视频。',
      tone: 'coral',
      sourceType: 'baiduNetdisk',
      folderPath: '/大语文'
    },
    {
      id: 'teacher-library',
      title: '陆老师讲义',
      description: '只展示百度网盘固定目录里的陆老师讲义视频。',
      tone: 'teal',
      sourceType: 'baiduNetdisk',
      folderPath: '/陆老师讲义'
    }
  ];
}

function defaultOnlineClassrooms(startUrl = '') {
  const entryUrl = normalizeEntryUrl(startUrl);

  if (!entryUrl) {
    return [];
  }

  return [
    {
      id: 'english-course',
      title: '说课英语',
      description: '进入你指定的在线课堂网站。',
      tone: 'amber',
      entryUrl
    }
  ];
}

function normalizeOnlineClassrooms(rawClassrooms, options = {}) {
  const reservedIds = options.reservedIds instanceof Set ? options.reservedIds : new Set();
  const fallbackClassrooms =
    options.fallbackToDefault === false ? [] : defaultOnlineClassrooms(options.defaultStartUrl);
  const source = Array.isArray(rawClassrooms) && rawClassrooms.length ? rawClassrooms : fallbackClassrooms;
  const classrooms = [];
  const seenIds = new Set();

  for (let index = 0; index < source.length; index += 1) {
    const item = source[index] || {};
    const entryUrl = normalizeEntryUrl(item.entryUrl || item.url || item.startUrl);

    if (!entryUrl) {
      continue;
    }

    let id = normalizeLibraryId(item.id, index === 0 ? 'english-course' : `classroom-${index + 1}`);

    while (seenIds.has(id) || reservedIds.has(id)) {
      id = normalizeLibraryId(`${id}-classroom`, `classroom-${index + 1}`);
    }

    seenIds.add(id);
    classrooms.push({
      id,
      title: normalizePrefix(item.title) || `在线课堂 ${index + 1}`,
      description: normalizePrefix(item.description) || '进入固定在线课堂网址。',
      tone: normalizeCardTone(item.tone, index === 0 ? 'amber' : 'teal'),
      entryUrl
    });
  }

  return classrooms;
}

function serializeOnlineClassrooms(classrooms = classroomDefinitions) {
  return (Array.isArray(classrooms) ? classrooms : []).map((classroom) => ({
    id: classroom.id,
    title: classroom.title,
    description: classroom.description,
    tone: classroom.tone,
    entryUrl: classroom.entryUrl
  }));
}

function resolveClassroomTitle(classrooms, classroomId) {
  const classroom = classrooms.find((item) => item.id === classroomId);
  return classroom ? classroom.title : '';
}

function resolveLibraryTitle(libraries, libraryId) {
  const library = libraries.find((item) => item.id === libraryId);
  return library ? library.title : '学习内容';
}

function resolveStudyTargetTitle(classrooms, libraries, learningTools, targetId) {
  return (
    resolveClassroomTitle(classrooms, targetId) ||
    resolveLearningToolTitleFromList(learningTools, targetId) ||
    resolveNativeModuleTitle(targetId) ||
    resolveLibraryTitle(libraries, targetId)
  );
}

function normalizeLibraries(rawLibraries, options = {}) {
  const source =
    Array.isArray(rawLibraries)
      ? rawLibraries
      : options.fallbackToDefault === false
        ? []
        : defaultLibraries();
  const reservedIds = options.reservedIds instanceof Set ? options.reservedIds : new Set();
  const seenIds = new Set();
  const libraries = [];

  for (let index = 0; index < source.length; index += 1) {
    const item = source[index] || {};
    const fallbackId = `library-${index + 1}`;
    let id = normalizeLibraryId(item.id, fallbackId);

    while (seenIds.has(id) || reservedIds.has(id)) {
      id = normalizeLibraryId(`${id}-library`, fallbackId);
    }

    seenIds.add(id);
    libraries.push({
      id,
      title: normalizePrefix(item.title) || `媒体库 ${index + 1}`,
      description: normalizePrefix(item.description) || '从百度网盘固定目录读取视频。',
      tone: normalizeCardTone(item.tone, index % 2 === 0 ? 'teal' : 'coral'),
      sourceType: 'baiduNetdisk',
      folderPath: normalizeNetdiskFolderPath(item.folderPath || item.path, '/')
    });
  }

  return libraries;
}

function serializeLibraries(libraries = libraryDefinitions) {
  return (Array.isArray(libraries) ? libraries : []).map((library) => ({
    id: library.id,
    title: library.title,
    description: library.description,
    tone: library.tone,
    folderPath: library.folderPath
  }));
}

function normalizeStudyData(rawState, fallbackClassrooms = [], fallbackLibraries = [], fallbackLearningTools = []) {
  const fallbackClassroomList =
    Array.isArray(fallbackClassrooms) && fallbackClassrooms.length
      ? fallbackClassrooms
      : defaultOnlineClassrooms(appConfig && appConfig.startUrl);
  const fallbackLibraryList = Array.isArray(fallbackLibraries) && fallbackLibraries.length ? fallbackLibraries : defaultLibraries();
  const fallbackLearningToolList = Array.isArray(fallbackLearningTools) ? fallbackLearningTools : [];
  const source = rawState && typeof rawState === 'object' ? rawState : {};
  const hasExplicitControlSettings = Object.prototype.hasOwnProperty.call(source, 'controlSettings');
  const hasExplicitClassrooms =
    Array.isArray(source.onlineClassrooms) || Array.isArray(source.classrooms);
  const hasExplicitLibraries =
    Array.isArray(source.contentLibraries) || Array.isArray(source.libraries);
  const hasExplicitLearningTools = Array.isArray(source.learningTools) || Array.isArray(source.tools);
  const rawClassrooms = Array.isArray(source.onlineClassrooms)
    ? source.onlineClassrooms
    : Array.isArray(source.classrooms)
      ? source.classrooms
      : fallbackClassroomList;
  const rawLibraries = Array.isArray(source.contentLibraries)
    ? source.contentLibraries
    : Array.isArray(source.libraries)
      ? source.libraries
      : fallbackLibraryList;
  const rawLearningTools = Array.isArray(source.learningTools)
    ? source.learningTools
    : Array.isArray(source.tools)
      ? source.tools
      : fallbackLearningToolList;
  const nativeModuleIds = new Set(nativeModuleDefinitions.map((moduleDefinition) => moduleDefinition.id));
  const classrooms = normalizeOnlineClassrooms(rawClassrooms, {
    defaultStartUrl: fallbackClassroomList[0] ? fallbackClassroomList[0].entryUrl : '',
    fallbackToDefault: !hasExplicitClassrooms,
    reservedIds: nativeModuleIds
  });
  const libraries = normalizeLibraries(rawLibraries, {
    fallbackToDefault: !hasExplicitLibraries,
    reservedIds: new Set([
      ...nativeModuleIds,
      ...classrooms.map((classroom) => classroom.id)
    ])
  });
  const learningTools = normalizeLearningTools(rawLearningTools, {
    fallbackToDefault: !hasExplicitLearningTools,
    reservedIds: new Set([
      ...nativeModuleIds,
      ...classrooms.map((classroom) => classroom.id),
      ...libraries.map((library) => library.id)
    ])
  });
  const rawParentItems = Array.isArray(rawState)
    ? rawState
    : Array.isArray(source.parentItems)
      ? source.parentItems
      : Array.isArray(source.items)
        ? source.items
        : [];
  const rawStudentItems = Array.isArray(source.studentItems) ? source.studentItems : [];
  const parentItems = normalizeStudySchedule(rawParentItems, classrooms, libraries, {
    planScope: 'parent',
    learningTools
  });
  const studentItems = normalizeStudySchedule(rawStudentItems, classrooms, libraries, {
    planScope: 'student',
    learningTools
  });

  return {
    parentItems,
    studentItems,
    onlineClassrooms: classrooms,
    contentLibraries: libraries,
    learningTools,
    controlSettings: hasExplicitControlSettings
      ? normalizeControlSettings(source.controlSettings)
      : normalizeControlSettings(appConfig && appConfig.controlSettings)
  };
}

function mergeStudySchedules(parentItems = [], studentItems = []) {
  return [...parentItems, ...studentItems];
}

function loadConfig() {
  const embeddedConfigPath = path.join(app.getAppPath(), EMBEDDED_CONFIG_FILE);
  const configPath = fs.existsSync(embeddedConfigPath)
    ? embeddedConfigPath
    : firstExistingFile(candidateFiles(CONFIG_FILE));

  if (!configPath) {
    throw createConfigError(`找不到 ${CONFIG_FILE}。`);
  }

  let rawConfig;

  try {
    rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw createConfigError(`无法解析 ${configPath}：${error.message}`);
  }

  const configuredStartUrl = normalizePrefix(rawConfig.startUrl);
  const configuredStartUrlObject = configuredStartUrl ? parseUrl(configuredStartUrl) : null;

  if (configuredStartUrl && (!configuredStartUrlObject || !['http:', 'https:'].includes(configuredStartUrlObject.protocol))) {
    throw createConfigError('config.json 中的 startUrl 必须是有效的 http/https 地址。');
  }

  const nativeModuleIds = new Set(nativeModuleDefinitions.map((moduleDefinition) => moduleDefinition.id));
  const classrooms = normalizeOnlineClassrooms(rawConfig.onlineClassrooms || rawConfig.classrooms, {
    defaultStartUrl: configuredStartUrl,
    reservedIds: nativeModuleIds
  });
  const libraries = normalizeLibraries(rawConfig.contentLibraries, {
    reservedIds: new Set([
      ...nativeModuleIds,
      ...classrooms.map((classroom) => classroom.id)
    ])
  });
  const learningTools = normalizeLearningTools(rawConfig.learningTools || rawConfig.tools, {
    reservedIds: new Set([
      ...nativeModuleIds,
      ...classrooms.map((classroom) => classroom.id),
      ...libraries.map((library) => library.id)
    ])
  });

  if (!classrooms.length) {
    throw createConfigError('至少需要一个在线课堂入口。可以配置 onlineClassrooms，或者保留有效的 startUrl。');
  }

  const startUrl = classrooms[0].entryUrl;
  const classroomEntryUrls = classrooms.map((classroom) => classroom.entryUrl);
  const topLevelPrefixes = dedupe(
    [...(Array.isArray(rawConfig.allowedTopLevelUrlPrefixes) ? rawConfig.allowedTopLevelUrlPrefixes : classroomEntryUrls), ...classroomEntryUrls]
      .map(normalizePrefix)
      .filter(Boolean)
  );

  if (!topLevelPrefixes.length) {
    throw createConfigError('至少需要一个 allowedTopLevelUrlPrefixes 项。');
  }

  const allowedHostnames = dedupe(
    [...(Array.isArray(rawConfig.allowedResourceHostnames) ? rawConfig.allowedResourceHostnames : []), ...classroomEntryUrls.map((entryUrl) => {
      const parsed = parseUrl(entryUrl);
      return parsed ? parsed.hostname : '';
    })]
      .map(normalizeHostname)
      .filter(Boolean)
  );

  const allowedHostnameSuffixes = dedupe(
    (Array.isArray(rawConfig.allowedResourceHostnameSuffixes)
      ? rawConfig.allowedResourceHostnameSuffixes
      : [])
      .map(normalizeHostnameSuffix)
      .filter(Boolean)
  );

  const allowedResourceUrlPrefixes = dedupe(
    (Array.isArray(rawConfig.allowedResourceUrlPrefixes) ? rawConfig.allowedResourceUrlPrefixes : [])
      .map(normalizePrefix)
      .filter(Boolean)
  );

  const blockedShortcuts = dedupe(
    (Array.isArray(rawConfig.blockedShortcuts) ? rawConfig.blockedShortcuts : [])
      .map(normalizePrefix)
      .filter(Boolean)
  );
  const parentStudySchedule = normalizeStudySchedule(rawConfig.studySchedule, classrooms, libraries, {
    planScope: 'parent',
    learningTools
  });
  const stateDir = path.basename(configPath).toLowerCase() === EMBEDDED_CONFIG_FILE ? STABLE_USER_DATA_DIR : path.dirname(configPath);
  const reminderLeadMinutes = normalizeReminderLeadMinutes(
    (rawConfig.reminders && rawConfig.reminders.leadMinutes) || rawConfig.reminderLeadMinutes || DEFAULT_REMINDER_LEAD_MINUTES
  );

  fs.mkdirSync(stateDir, { recursive: true });

  return {
    configPath,
    configDir: path.dirname(configPath),
    stateDir,
    appTitle: normalizePrefix(rawConfig.appTitle) || '学习入口',
    startUrl,
    baseClassrooms: serializeOnlineClassrooms(classrooms),
    classrooms,
    baseLearningTools: serializeLearningTools(learningTools),
    learningTools,
    topLevelPrefixes,
    allowedHostnames: new Set(allowedHostnames),
    allowedHostnameSuffixes,
    allowedResourceUrlPrefixes,
    resourceAccessMode: normalizeResourceAccessMode(rawConfig.resourceAccessMode),
    kiosk: rawConfig.kiosk !== false,
    alwaysOnTop: rawConfig.alwaysOnTop !== false,
    exitShortcut: normalizePrefix(rawConfig.exitShortcut) || 'Ctrl+Alt+Shift+Q',
    blockedShortcuts,
    logBlockedRequests: rawConfig.logBlockedRequests !== false,
    baiduNetdisk: {
      clientId: normalizePrefix(rawConfig.baiduNetdisk && (rawConfig.baiduNetdisk.clientId || rawConfig.baiduNetdisk.appKey)),
      clientSecret: normalizePrefix(
        rawConfig.baiduNetdisk && (rawConfig.baiduNetdisk.clientSecret || rawConfig.baiduNetdisk.secretKey)
      ),
      scope: normalizePrefix(rawConfig.baiduNetdisk && rawConfig.baiduNetdisk.scope) || 'netdisk'
    },
    remoteSchedule: normalizeRemoteSchedule(rawConfig.remoteSchedule),
    reminders: {
      leadMinutes: reminderLeadMinutes.length ? reminderLeadMinutes : [...DEFAULT_REMINDER_LEAD_MINUTES]
    },
    baseLibraries: serializeLibraries(libraries),
    libraries,
    controlSettings: normalizeControlSettings(rawConfig.controlSettings),
    parentStudySchedule,
    studentStudySchedule: [],
    studySchedule: mergeStudySchedules(parentStudySchedule, [])
  };
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

function matchesPrefix(url, prefixes) {
  return prefixes.some((prefix) => url.startsWith(prefix));
}

function matchesClassroomEntryUrl(url) {
  return classroomDefinitions.some((classroom) => url.startsWith(classroom.entryUrl));
}

function matchesAllowedHostname(url) {
  const parsed = parseUrl(url);

  if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();

  if (appConfig.allowedHostnames.has(hostname)) {
    return true;
  }

  if (
    classroomDefinitions.some((classroom) => {
      const classroomUrl = parseUrl(classroom.entryUrl);
      return classroomUrl && classroomUrl.hostname.toLowerCase() === hostname;
    })
  ) {
    return true;
  }

  return appConfig.allowedHostnameSuffixes.some((suffix) => hostname.endsWith(suffix));
}

function topLevelDecision(url) {
  const parsed = parseUrl(url);

  if (!parsed) {
    return {
      allowed: false,
      reason: 'invalid_url'
    };
  }

  if (parsed.protocol === 'file:') {
    return {
      allowed: isLocalAppFile(parsed),
      reason: 'local_file'
    };
  }

  const classroom = resolveClassroomForUrl(url);

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

function sessionStatePath() {
  return path.join(appConfig.stateDir, SESSION_STATE_FILE);
}

function navigationDebugLogPath() {
  return path.join(appConfig.stateDir, 'navigation-debug.log');
}

function reminderDebugLogPath() {
  return path.join(appConfig.stateDir, 'reminder-debug.log');
}

function siteCredentialStatePath() {
  return path.join(appConfig.stateDir, SITE_CREDENTIAL_STATE_FILE);
}

function netdiskStatePath() {
  return path.join(appConfig.stateDir, NETDISK_STATE_FILE);
}

function studyToolsStatePath() {
  return path.join(appConfig.stateDir, STUDY_TOOLS_STATE_FILE);
}

function studySchedulePath() {
  return path.join(appConfig.stateDir, STUDY_SCHEDULE_FILE);
}

function remoteScheduleCachePath() {
  return path.join(appConfig.stateDir, REMOTE_SCHEDULE_CACHE_FILE);
}

function originStorageStatePath() {
  return path.join(appConfig.stateDir, ORIGIN_STORAGE_STATE_FILE);
}

function isLocalAppFile(urlObject) {
  if (!urlObject || urlObject.protocol !== 'file:') {
    return false;
  }

  const appPath = path.resolve(app.getAppPath());
  const normalizedPath = path.resolve(fileURLToPath(urlObject));

  return normalizedPath.startsWith(appPath);
}

function isInternalServerUrl(url) {
  return Boolean(internalServerOrigin) && url.startsWith(`${internalServerOrigin}${INTERNAL_SERVER_PREFIX}/`);
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

function isTopLevelOnlyResourceMode() {
  return appConfig && appConfig.resourceAccessMode === 'top-level-only';
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
  if (!ALLOWED_MEDIA_PERMISSIONS.has(permission)) {
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
  if (!appConfig.logBlockedRequests) {
    return;
  }

  const logLine = `[${new Date().toISOString()}] ${reason} ${details.resourceType || 'unknown'} ${details.url}${os.EOL}`;
  const logPath = path.join(appConfig.configDir, 'blocked-requests.log');

  try {
    fs.appendFileSync(logPath, logLine, 'utf8');
  } catch {
    // Ignore logging failures.
  }
}

function logNavigationDebug(eventName, payload = {}) {
  if (!appConfig.logBlockedRequests) {
    return;
  }

  const currentUrl =
    mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents
      ? normalizePrefix(mainWindow.webContents.getURL())
      : '';
  const logLine = JSON.stringify({
    at: new Date().toISOString(),
    event: eventName,
    currentUrl,
    ...payload
  });

  try {
    fs.appendFileSync(navigationDebugLogPath(), `${logLine}${os.EOL}`, 'utf8');
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
    fs.appendFileSync(reminderDebugLogPath(), `${logLine}${os.EOL}`, 'utf8');
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
  if (isInternalServerUrl(details.url)) {
    return true;
  }

  const parsed = parseUrl(details.url);

  if (!parsed) {
    return false;
  }

  if (ALLOWED_APP_SCHEMES.has(parsed.protocol)) {
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
  if (input.type !== 'keyDown') {
    return false;
  }

  return appConfig.blockedShortcuts.some((shortcut) => shortcutMatches(input, shortcut));
}

function isExitShortcut(input) {
  return input.type === 'keyDown' && shortcutMatches(input, appConfig.exitShortcut);
}

function internalPagePath(pageName) {
  const pageFile = INTERNAL_PAGES[pageName];
  return pageFile ? path.join(__dirname, pageFile) : null;
}

function libraryTarget(libraryId) {
  return `internal:library:${libraryId}`;
}

function studentPlanTarget() {
  return 'internal:student-plan';
}

function learningToolEntryTarget(toolId) {
  return `internal:learning-tool:${toolId}`;
}

function resolveNativeModuleDefinition(moduleId) {
  return nativeModuleIndex.get(normalizePrefix(moduleId)) || resolveNativeModule(moduleId);
}

function launchNativeModuleEntry(moduleId) {
  const moduleDefinition = resolveNativeModuleDefinition(moduleId);

  if (!moduleDefinition) {
    return false;
  }

  const result = launchNativeModule(moduleId, {
    executableDir: path.dirname(process.execPath),
    projectRoot: path.resolve(__dirname, '..')
  });

  if (!result.ok) {
    dialog.showErrorBox(moduleDefinition.title, result.error || `${moduleDefinition.title} 启动失败。`);
    return false;
  }

  logNavigationDebug('launch-native-module', {
    moduleId,
    executablePath: result.executablePath
  });
  return true;
}

function launchLearningToolEntry(toolId) {
  const learningTool = resolveLearningTool(toolId);

  if (!learningTool) {
    return false;
  }

  const result = launchLearningTool(learningTool, {
    executableDir: path.dirname(process.execPath),
    projectRoot: path.resolve(__dirname, '..')
  });

  if (!result.ok) {
    dialog.showErrorBox(learningTool.title, result.error || `${learningTool.title} 启动失败。`);
    return false;
  }

  logNavigationDebug('launch-learning-tool', {
    toolId,
    appPath: learningTool.appPath,
    command: result.launchPlan && result.launchPlan.command
  });
  return true;
}

function loadHomePage(reason = 'manual') {
  logNavigationDebug('load-home-page', {
    reason
  });
  mainWindow.loadFile(internalPagePath('home'));
}

function loadLibraryPage(libraryId) {
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
  logNavigationDebug('load-student-plan-page');
  mainWindow.loadFile(internalPagePath('studentPlan'));
}

function navigateMainWindow(target) {
  const normalizedTarget = normalizePrefix(target);

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

  logNavigationDebug('navigate-main-window-load-url', {
    target: normalizedTarget,
    decision: topLevelDecision(normalizedTarget)
  });
  mainWindow.loadURL(normalizedTarget);
  return true;
}

function launchStudyEntry(target, options = {}) {
  const normalizedTarget = normalizePrefix(target);
  logNavigationDebug('launch-study-entry', {
    target: normalizedTarget,
    scheduleId: normalizePrefix(options.scheduleId),
    scheduleTargetId: normalizePrefix(options.scheduleTargetId),
    libraryId: normalizePrefix(options.libraryId)
  });
  const success = navigateMainWindow(normalizedTarget);

  if (!success) {
    return { success: false };
  }

  const completion = markScheduleCompletedForToday(options);

  if (completion) {
    return {
      success: true,
      completedScheduleId: completion.schedule.id
    };
  }

  return { success: true };
}

function goBackIfPossible() {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.canGoBack()) {
    mainWindow.webContents.goBack();
  }
}

function goForwardIfPossible() {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.canGoForward()) {
    mainWindow.webContents.goForward();
  }
}

function resolveClassroomForUrl(url) {
  const normalizedUrl = normalizePrefix(url);

  if (!normalizedUrl) {
    return null;
  }

  const exactPrefixMatch = classroomDefinitions.find((classroom) => normalizedUrl.startsWith(classroom.entryUrl));

  if (exactPrefixMatch) {
    return exactPrefixMatch;
  }

  const parsed = parseUrl(normalizedUrl);

  if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();

  return classroomDefinitions.find((classroom) => {
    const classroomUrl = parseUrl(classroom.entryUrl);
    return classroomUrl && classroomUrl.hostname.toLowerCase() === hostname;
  }) || null;
}

function currentNavigationModel() {
  const url = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents.getURL() : '';
  const parsed = parseUrl(url);
  const model = {
    canGoBack: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.canGoBack()),
    canGoForward: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.canGoForward()),
    crumbs: []
  };

  if (!parsed) {
    model.crumbs = [{ label: '首页', target: 'internal:home', current: true }];
    return model;
  }

  if (parsed.protocol === 'file:') {
    const fileName = path.basename(fileURLToPath(parsed)).toLowerCase();

    if (fileName === 'library.html') {
      const library = resolveLibrary(parsed.searchParams.get('library'));
      model.crumbs = [
        { label: '首页', target: 'internal:home', current: false },
        {
          label: library ? library.title : '媒体库',
          target: library ? libraryTarget(library.id) : 'internal:home',
          current: true
        }
      ];
      return model;
    }

    if (fileName === 'student-plan.html') {
      model.crumbs = [
        { label: '首页', target: 'internal:home', current: false },
        { label: '学生计划', target: studentPlanTarget(), current: true }
      ];
      return model;
    }

    model.crumbs = [{ label: '首页', target: 'internal:home', current: true }];
    return model;
  }

  const classroom = resolveClassroomForUrl(url);

  model.crumbs.push({ label: '首页', target: 'internal:home', current: false });

  if (classroom) {
    model.crumbs.push({ label: classroom.title, target: classroom.entryUrl, current: true });
    return model;
  }

  model.crumbs.push({
    label: '当前页面',
    target: url,
    current: true
  });

  return model;
}

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
  const ses = session.fromPartition(SESSION_PARTITION);
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

  fs.writeFileSync(sessionStatePath(), JSON.stringify(state, null, 2), 'utf8');
  await ses.cookies.flushStore();
  await ses.flushStorageData();
}

function persistSessionState() {
  sessionPersistPromise = sessionPersistPromise
    .catch(() => {})
    .then(() => writeSessionState());

  return sessionPersistPromise.catch(() => {});
}

async function applyCompatibilityPatch() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const currentUrl = mainWindow.webContents.getURL();
  const parsed = parseUrl(currentUrl);

  if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
    return;
  }

  try {
    await mainWindow.webContents.executeJavaScript(LEGACY_MEDIA_COMPATIBILITY_SCRIPT, true);
  } catch {
    // Ignore compatibility injection failures.
  }
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

async function restoreSessionState() {
  const filePath = sessionStatePath();

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

  const ses = session.fromPartition(SESSION_PARTITION);

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

function loadNetdiskState() {
  const filePath = netdiskStatePath();

  if (!fs.existsSync(filePath)) {
    netdiskState = createEmptyNetdiskState();
    return;
  }

  try {
    const rawState = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    netdiskState = {
      accessToken: normalizePrefix(rawState.accessToken),
      refreshToken: normalizePrefix(rawState.refreshToken),
      expiresAt: Number(rawState.expiresAt) || 0,
      scope: normalizePrefix(rawState.scope),
      tokenType: normalizePrefix(rawState.tokenType) || 'Bearer'
    };
  } catch {
    netdiskState = createEmptyNetdiskState();
  }
}

function saveNetdiskState() {
  fs.writeFileSync(netdiskStatePath(), JSON.stringify(netdiskState, null, 2), 'utf8');
}

function updateNetdiskState(tokenPayload) {
  netdiskState = {
    accessToken: normalizePrefix(tokenPayload.access_token || tokenPayload.accessToken),
    refreshToken: normalizePrefix(tokenPayload.refresh_token || tokenPayload.refreshToken || netdiskState.refreshToken),
    expiresAt: Date.now() + Math.max(0, (Number(tokenPayload.expires_in || tokenPayload.expiresIn) || 0) - 60) * 1000,
    scope: normalizePrefix(tokenPayload.scope),
    tokenType: normalizePrefix(tokenPayload.token_type || tokenPayload.tokenType) || 'Bearer'
  };

  saveNetdiskState();
}

function clearNetdiskState() {
  netdiskState = createEmptyNetdiskState();
  netdiskDlinkCache = new Map();

  try {
    fs.unlinkSync(netdiskStatePath());
  } catch {
    // Ignore absent files.
  }
}

function canUseSiteCredentialStorage() {
  return Boolean(safeStorage && typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable());
}

function loadSiteCredentialState() {
  const filePath = siteCredentialStatePath();

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
  fs.writeFileSync(siteCredentialStatePath(), encrypted);
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

  for (const prefix of appConfig.topLevelPrefixes || []) {
    if (isCourseEcosystemOrigin(prefix)) {
      const origin = storageOriginKey(prefix);

      if (origin) {
        origins.add(origin);
      }
    }
  }

  for (const classroom of classroomDefinitions) {
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
  const ses = session.fromPartition(SESSION_PARTITION);
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
    removals.push(
      ses.cookies.remove(cookieUrl, cookie.name).catch(() => {})
    );
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
  const filePath = originStorageStatePath();

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
      localStorage: snapshot && snapshot.localStorage && typeof snapshot.localStorage === 'object' ? snapshot.localStorage : {},
      sessionStorage: {},
      updatedAt: normalizePrefix(snapshot && snapshot.updatedAt) || new Date().toISOString()
    };
  }

  originStorageState = { origins: nextOrigins };
}

function saveOriginStorageState() {
  pruneOriginStorageState();
  fs.writeFileSync(originStorageStatePath(), JSON.stringify(originStorageState, null, 2), 'utf8');
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
    localStorage: snapshot && snapshot.localStorage && typeof snapshot.localStorage === 'object' ? snapshot.localStorage : {},
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

function serializeStudySchedule(schedule = appConfig.studySchedule) {
  return schedule.map((item) => ({
    id: item.id,
    enabled: item.enabled,
    mode: item.mode === 'date' || item.specificDate ? 'date' : 'weekly',
    title: item.title,
    target: item.targetId,
    time: item.time,
    weekdays: item.weekdays,
    specificDate: item.specificDate || '',
    exceptionDates: normalizeDateList(item.exceptionDates || []),
    message: item.message
  }));
}

function serializeStudyData(state = {}) {
  const parentItems = Array.isArray(state.parentItems) ? state.parentItems : appConfig.parentStudySchedule;
  const studentItems = Array.isArray(state.studentItems) ? state.studentItems : appConfig.studentStudySchedule;
  const onlineClassrooms = Array.isArray(state.onlineClassrooms) ? state.onlineClassrooms : appConfig.classrooms;
  const contentLibraries = Array.isArray(state.contentLibraries) ? state.contentLibraries : appConfig.libraries;
  const learningTools = Array.isArray(state.learningTools) ? state.learningTools : appConfig.learningTools;
  const controlSettings = normalizeControlSettings(state.controlSettings || appConfig.controlSettings);

  return {
    parentItems: serializeStudySchedule(parentItems),
    studentItems: serializeStudySchedule(studentItems),
    onlineClassrooms: serializeOnlineClassrooms(onlineClassrooms),
    contentLibraries: serializeLibraries(contentLibraries),
    learningTools: serializeLearningTools(learningTools),
    controlSettings,
    items: serializeStudySchedule(mergeStudySchedules(parentItems, studentItems))
  };
}

function currentStudyData() {
  return {
    parentItems: appConfig.parentStudySchedule || [],
    studentItems: appConfig.studentStudySchedule || [],
    onlineClassrooms: appConfig.classrooms || [],
    contentLibraries: appConfig.libraries || [],
    learningTools: appConfig.learningTools || [],
    controlSettings: normalizeControlSettings(appConfig.controlSettings)
  };
}

function bumpStudyDataMutation() {
  studyDataMutationSerial += 1;
  return studyDataMutationSerial;
}

function applyStudyData(state, source = 'local') {
  const normalized = normalizeStudyData(
    state,
    appConfig.baseClassrooms || appConfig.classrooms,
    appConfig.baseLibraries || appConfig.libraries,
    appConfig.baseLearningTools || appConfig.learningTools
  );
  appConfig.classrooms = normalized.onlineClassrooms;
  appConfig.startUrl = normalized.onlineClassrooms[0] ? normalized.onlineClassrooms[0].entryUrl : appConfig.startUrl;
  appConfig.libraries = normalized.contentLibraries;
  appConfig.learningTools = normalized.learningTools;
  rebuildLibraryIndex();
  appConfig.parentStudySchedule = normalized.parentItems;
  appConfig.studentStudySchedule = normalized.studentItems;
  appConfig.studySchedule = mergeStudySchedules(normalized.parentItems, normalized.studentItems);
  appConfig.controlSettings = normalized.controlSettings;

  if (source === 'remote') {
    remoteScheduleStatus.source = 'remote';
  }

  scheduleReminderAudioPrewarm();
}

function loadPersistedStudySchedule() {
  const filePath = studySchedulePath();

  if (!fs.existsSync(filePath)) {
    return;
  }

  try {
    const rawState = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    applyStudyData(rawState, 'local');
  } catch {
    // Ignore broken persisted schedules and continue with config defaults.
  }
}

function saveStructuredStudyData(state, source = 'local') {
  if (source !== 'remote') {
    bumpStudyDataMutation();
  }

  applyStudyData(state, source);
  fs.writeFileSync(studySchedulePath(), JSON.stringify(serializeStudyData(currentStudyData()), null, 2), 'utf8');
  return currentStudyData();
}

async function syncStudentDeviceAccessStatus(options = {}) {
  if (!appConfig.remoteSchedule.enabled) {
    studentDeviceAccessStatus = createEmptyStudentDeviceAccessStatus();
    return studentDeviceAccessStatus;
  }

  const statusToken = appConfig.remoteSchedule.studentWriteToken || appConfig.remoteSchedule.authToken;

  if (!statusToken) {
    studentDeviceAccessStatus = normalizeStudentDeviceAccessStatus({
      mode: 'error',
      approved: false,
      message: '云端学生计划未配置可用的访问令牌。'
    });

    if (options.throwOnError) {
      throw new Error(studentDeviceAccessStatus.message);
    }

    return studentDeviceAccessStatus;
  }

  try {
    const payload = await fetchJson(appConfig.remoteSchedule.url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${statusToken}`
      },
      body: JSON.stringify({
        action: 'getStudentDeviceAccessStatus',
        ...studentDeviceCredentialPayload()
      })
    });

    if (!payload || payload.error) {
      const errorCode = normalizePrefix(payload && payload.error);
      throw new Error(
        errorCode === 'missing_device_credential'
          ? '当前客户端缺少身份凭据，请稍后重试。'
          : errorCode
            ? `学生计划授权状态同步失败：${errorCode}`
            : '学生计划授权状态同步失败。'
      );
    }

    studentDeviceAccessStatus = normalizeStudentDeviceAccessStatus(payload);
    return studentDeviceAccessStatus;
  } catch (error) {
    studentDeviceAccessStatus = normalizeStudentDeviceAccessStatus({
      mode: 'error',
      approved: false,
      message: error && error.message ? error.message : '学生计划授权状态同步失败。'
    });

    if (options.throwOnError) {
      throw new Error(studentDeviceAccessStatus.message);
    }

    return studentDeviceAccessStatus;
  }
}

function saveStudySchedule(rawSchedule) {
  const normalizedParentItems = normalizeStudySchedule(rawSchedule, classroomDefinitions, libraryDefinitions, {
    planScope: 'parent',
    learningTools: learningToolDefinitions
  });
  const savedState = saveStructuredStudyData(
    {
      parentItems: normalizedParentItems,
      studentItems: appConfig.studentStudySchedule,
      onlineClassrooms: appConfig.classrooms,
      contentLibraries: appConfig.libraries,
      learningTools: appConfig.learningTools
    },
    'local'
  );

  return savedState.parentItems;
}

function loadRemoteScheduleCache() {
  if (!appConfig.remoteSchedule.enabled) {
    return;
  }

  const filePath = remoteScheduleCachePath();

  if (!fs.existsSync(filePath)) {
    return;
  }

  try {
    const rawState = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const normalizedState = normalizeStudyData(
      rawState,
      appConfig.baseClassrooms || classroomDefinitions,
      appConfig.baseLibraries || libraryDefinitions,
      appConfig.baseLearningTools || learningToolDefinitions
    );
    applyStudyData(normalizedState, 'remote');
    remoteScheduleStatus = {
      ...remoteScheduleStatus,
      enabled: true,
      source: 'remote-cache',
      message: '当前使用上一次成功同步到本机的服务器课表。'
    };
  } catch {
    // Ignore broken cache files.
  }
}

function saveRemoteScheduleCache(schedule) {
  const payload =
    schedule && typeof schedule === 'object' && !Array.isArray(schedule)
      ? serializeStudyData(schedule)
      : serializeStudyData({
          parentItems: appConfig.parentStudySchedule,
          studentItems: Array.isArray(schedule) ? schedule : appConfig.studentStudySchedule,
          onlineClassrooms: appConfig.classrooms,
          contentLibraries: appConfig.libraries,
          learningTools: appConfig.learningTools
        });

  fs.writeFileSync(remoteScheduleCachePath(), JSON.stringify(payload, null, 2), 'utf8');
}

function ensureMobileToken() {
  if (!studyToolsState.mobileToken) {
    studyToolsState.mobileToken = crypto.randomBytes(12).toString('hex');
    saveStudyToolsState();
  }

  return studyToolsState.mobileToken;
}

function loadStudyToolsState() {
  const filePath = studyToolsStatePath();

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
          rawState &&
            rawState.studentDeviceCredential &&
            rawState.studentDeviceCredential.deviceId,
          `desktop-${crypto.randomBytes(8).toString('hex')}`
        ),
        deviceSecret:
          normalizePrefix(
            rawState &&
              rawState.studentDeviceCredential &&
              rawState.studentDeviceCredential.deviceSecret
          ) || crypto.randomBytes(16).toString('hex'),
        label: normalizePrefix(
          rawState &&
            rawState.studentDeviceCredential &&
            rawState.studentDeviceCredential.label
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

function normalizeStudentDeviceAccessMode(value) {
  const normalized = normalizePrefix(value).toLowerCase();
  return ['local', 'approval', 'token', 'error'].includes(normalized) ? normalized : 'approval';
}

function normalizeStudentDeviceAccessStatus(rawStatus = {}) {
  const source = rawStatus && typeof rawStatus === 'object' ? rawStatus : {};
  const mode = normalizeStudentDeviceAccessMode(source.mode);
  const approved = Boolean(source.approved) || mode === 'local' || mode === 'token';
  return {
    mode,
    approved,
    status: approved ? 'approved' : 'pending',
    deviceId: normalizePrefix(source.deviceId),
    label: normalizePrefix(source.label),
    requestedAt: normalizePrefix(source.requestedAt),
    approvedAt: normalizePrefix(source.approvedAt),
    updatedAt: normalizePrefix(source.updatedAt),
    message:
      normalizePrefix(source.message) ||
      (approved
        ? '当前客户端已获准修改学生计划。'
        : '已自动提交学生计划写入申请，等待家长在手机端批准。')
  };
}

function canWriteStudentPlan(status = studentDeviceAccessStatus) {
  return Boolean(status && (status.approved || status.mode === 'local' || status.mode === 'token'));
}

function studentDeviceCredentialPayload() {
  const previousId =
    studyToolsState &&
    studyToolsState.studentDeviceCredential &&
    studyToolsState.studentDeviceCredential.deviceId;
  const previousSecret =
    studyToolsState &&
    studyToolsState.studentDeviceCredential &&
    studyToolsState.studentDeviceCredential.deviceSecret;
  const previousLabel =
    studyToolsState &&
    studyToolsState.studentDeviceCredential &&
    studyToolsState.studentDeviceCredential.label;
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
  fs.writeFileSync(studyToolsStatePath(), JSON.stringify(studyToolsState, null, 2), 'utf8');
}

function applyWindowZoomFactor(factor, options = {}) {
  currentWindowZoomFactor = normalizeUiZoomFactor(factor);

  if (studyToolsState) {
    studyToolsState.uiZoomFactor = currentWindowZoomFactor;

    if (!options.skipPersist) {
      saveStudyToolsState();
    }
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.setZoomFactor(currentWindowZoomFactor);
  }

  return currentWindowZoomFactor;
}

function studyScheduleOccurrenceKey(scheduleId, dateKey = formatLocalDateKey()) {
  return `${scheduleId}:${dateKey}`;
}

function scheduleMessage(schedule) {
  return schedule.message || `到${schedule.title}时间了。`;
}

function resolveStudyTargetById(targetId) {
  const classroom = targetId === 'english-course' ? resolveClassroom(null) : resolveClassroom(targetId);

  if (classroom && (targetId === 'english-course' || targetId === classroom.id)) {
    return {
      target: classroom.entryUrl,
      classroomId: classroom.id,
      classroomTitle: classroom.title,
      libraryId: '',
      libraryTitle: '',
      entryLabel: '进入课堂'
    };
  }

  const learningTool = resolveLearningTool(targetId);

  if (learningTool) {
    return {
      target: learningToolEntryTarget(learningTool.id),
      classroomId: '',
      classroomTitle: '',
      libraryId: '',
      libraryTitle: '',
      entryLabel: '打开工具'
    };
  }

  const nativeModule = resolveNativeModuleDefinition(targetId);

  if (nativeModule) {
    return {
      target: nativeModuleTarget(nativeModule.id),
      classroomId: '',
      classroomTitle: '',
      libraryId: '',
      libraryTitle: '',
      entryLabel: nativeModule.entryLabel || '打开模块'
    };
  }

  const library = resolveLibrary(targetId);

  if (!library) {
    return null;
  }

  return {
    target: libraryTarget(library.id),
    libraryId: library.id,
    libraryTitle: library.title,
    entryLabel: '打开内容'
  };
}

function currentInternalServerPort() {
  const address = internalServer && typeof internalServer.address === 'function' ? internalServer.address() : null;
  return address && typeof address.port === 'number' ? address.port : 0;
}

function localNetworkAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (!entry || entry.internal || entry.family !== 'IPv4') {
        continue;
      }

      addresses.push(entry.address);
    }
  }

  return dedupe(addresses).sort();
}

function formatStatusTimestamp(isoString) {
  if (!isoString) {
    return '';
  }

  const date = new Date(isoString);
  return `${formatLocalDateKey(date)} ${formatDisplayTime(isoString)}`;
}

function buildScheduleControlModel() {
  const port = currentInternalServerPort();
  const token = ensureMobileToken();
  const pathWithToken = `${INTERNAL_MOBILE_CONFIG_ROUTE}?token=${encodeURIComponent(token)}`;
  const lanUrls = port ? localNetworkAddresses().map((ip) => `http://${ip}:${port}${pathWithToken}`) : [];
  const remoteEnabled = Boolean(appConfig.remoteSchedule.enabled);
  let summary = '';
  let status = '';

  if (remoteEnabled) {
    summary = '当前已启用服务器课表同步。手机、小程序或别的后台只要能改远程 JSON，电脑就会自动拉取。';

    if (remoteScheduleStatus.lastSuccessAt) {
      status = `最近成功同步：${formatStatusTimestamp(remoteScheduleStatus.lastSuccessAt)}。${remoteScheduleStatus.message}`;
    } else if (remoteScheduleStatus.lastAttemptAt) {
      status = `最近尝试同步：${formatStatusTimestamp(remoteScheduleStatus.lastAttemptAt)}。${remoteScheduleStatus.message}`;
    } else {
      status = remoteScheduleStatus.message;
    }
  } else {
    summary = lanUrls.length
      ? '当前使用本机课表。手机和电脑在同一网络下时，可以直接用下面的网址改。'
      : '当前使用本机课表。没有找到可供手机访问的局域网地址。';
    status = lanUrls.length
      ? '如果后面想改成服务器取课表，可以再配置 remoteSchedule。'
      : '如果不想依赖同一局域网，可以直接配置 remoteSchedule 让程序从服务器拉。';
  }

  return {
    enabled: Boolean(port),
    remoteEnabled,
    summary,
    status,
    urls: lanUrls
  };
}

function getScheduleMark(scheduleId, dateKey = formatLocalDateKey()) {
  const occurrenceKey = studyScheduleOccurrenceKey(scheduleId, dateKey);
  const mark = studyToolsState.classMarks[occurrenceKey];

  return mark && typeof mark === 'object' ? mark : null;
}

function normalizeReminderMarks(mark) {
  if (!mark || typeof mark !== 'object' || !mark.reminderMarks || typeof mark.reminderMarks !== 'object') {
    return {};
  }

  const result = {};

  for (const [key, value] of Object.entries(mark.reminderMarks)) {
    const offset = Number(key);

    if (!Number.isFinite(offset) || typeof value !== 'string' || !value) {
      continue;
    }

    result[String(offset)] = value;
  }

  return result;
}

function upsertScheduleMark(schedule, updates, date = new Date()) {
  const dateKey = formatLocalDateKey(date);
  const occurrenceKey = studyScheduleOccurrenceKey(schedule.id, dateKey);
  const existing = getScheduleMark(schedule.id, dateKey) || {};
  const timestamp = date.toISOString();

  studyToolsState.classMarks[occurrenceKey] = {
    scheduleId: schedule.id,
    targetId: schedule.targetId,
    title: schedule.title,
    time: schedule.time,
    dateKey,
    remindedAt: existing.remindedAt || '',
    reminderMarks: normalizeReminderMarks(existing),
    completedAt: existing.completedAt || '',
    updatedAt: timestamp,
    ...updates
  };

  saveStudyToolsState();
  return studyToolsState.classMarks[occurrenceKey];
}

function getTodaySchedules(date = new Date()) {
  const weekday = localWeekdayNumber(date);
  const dateKey = formatLocalDateKey(date);

  return appConfig.studySchedule
    .filter((schedule) => {
      if (!schedule.enabled) {
        return false;
      }

      if (schedule.mode === 'date' || schedule.specificDate) {
        return schedule.specificDate === dateKey;
      }

      if (normalizeDateList(schedule.exceptionDates).includes(dateKey)) {
        return false;
      }

      return schedule.weekdays.includes(weekday);
    })
    .sort((left, right) => left.time.localeCompare(right.time) || left.title.localeCompare(right.title));
}

function describeScheduleStatus(schedule, mark, now = new Date()) {
  if (mark && mark.completedAt) {
    return {
      code: 'completed',
      label: '已完成',
      detail: `已于 ${formatDisplayTime(mark.completedAt)} 打卡。`
    };
  }

  if (formatLocalTime(now) >= schedule.time) {
    return {
      code: 'pending',
      label: '打卡',
      detail: '已到打卡时间。'
    };
  }

  return {
    code: 'upcoming',
    label: '未到时间',
    detail: '还没到打卡时间。'
  };
}

function findScheduleForLaunch(options = {}, date = new Date()) {
  const todaySchedules = getTodaySchedules(date);
  const requestedScheduleId = normalizePrefix(options.scheduleId);

  if (requestedScheduleId) {
    return todaySchedules.find((schedule) => schedule.id === requestedScheduleId) || null;
  }

  const targetId = normalizeScheduleTargetId(options.scheduleTargetId || options.libraryId || '');

  if (!targetId) {
    return null;
  }

  const matchingSchedules = todaySchedules.filter((schedule) => schedule.targetId === targetId);

  if (!matchingSchedules.length) {
    return null;
  }

  const incompleteSchedule = matchingSchedules.find((schedule) => {
    const mark = getScheduleMark(schedule.id, formatLocalDateKey(date));
    return !(mark && mark.completedAt);
  });

  return incompleteSchedule || matchingSchedules[matchingSchedules.length - 1];
}

function markScheduleCompletedForToday(options = {}, date = new Date()) {
  const schedule = findScheduleForLaunch(options, date);

  if (!schedule) {
    return null;
  }

  const existing = getScheduleMark(schedule.id, formatLocalDateKey(date));
  const status = describeScheduleStatus(schedule, existing, date);

  if (status.code === 'upcoming') {
    return {
      schedule,
      mark: existing || null,
      blocked: true,
      reason: 'not_started'
    };
  }

  if (existing && existing.completedAt) {
    return {
      schedule,
      mark: existing
    };
  }

  return {
    schedule,
    mark: upsertScheduleMark(
      schedule,
      {
        completedAt: date.toISOString()
      },
      date
    )
  };
}

function buildStudyScheduleModel(date = new Date()) {
  const todayKey = formatLocalDateKey(date);
  const todaySchedules = getTodaySchedules(date);
  const classes = todaySchedules.map((schedule) => {
    const mark = getScheduleMark(schedule.id, todayKey);
    const status = describeScheduleStatus(schedule, mark, date);
    const target = resolveStudyTargetById(schedule.targetId);

    return {
      id: schedule.id,
      planScope: normalizePlanScope(schedule.planScope, 'parent'),
      planScopeLabel: normalizePlanScope(schedule.planScope, 'parent') === 'student' ? '学生' : '家长',
      time: schedule.time,
      title: schedule.title,
      message: scheduleMessage(schedule),
      status: status.code,
      statusLabel: status.label,
      statusDetail: status.detail,
      canCheckIn: status.code === 'pending',
      target: target ? target.target : '',
      scheduleTargetId: schedule.targetId,
      libraryId: target ? target.libraryId : '',
      libraryTitle: target ? target.libraryTitle : '',
      canLaunch: Boolean(target),
      entryLabel: target ? target.entryLabel : '记完成'
    };
  });
  const completedCount = classes.filter((item) => item.status === 'completed').length;
  const pendingCount = classes.filter((item) => item.status === 'pending').length;
  const upcomingCount = classes.filter((item) => item.status === 'upcoming').length;
  const summary = !classes.length
    ? '今天没有排课，不会触发提醒。'
    : `今天共 ${classes.length} 节，已完成 ${completedCount} 节，待完成 ${pendingCount} 节。`;

  return {
    todayLabel: formatStudyDayLabel(date),
    classes,
    totalCount: classes.length,
    completedCount,
    pendingCount,
    upcomingCount,
    summary
  };
}

function monthKeyFromDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function parseMonthKey(monthKey) {
  const normalized = normalizePrefix(monthKey);

  if (!/^\d{4}-\d{2}$/.test(normalized)) {
    return null;
  }

  const [year, month] = normalized.split('-').map((item) => Number(item));
  return new Date(year, month - 1, 1);
}

function shiftMonthKey(monthKey, delta) {
  const date = parseMonthKey(monthKey) || new Date();
  return monthKeyFromDate(new Date(date.getFullYear(), date.getMonth() + delta, 1));
}

function monthLabelFromDate(date = new Date()) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

function selectedDateLabelFromDate(date = new Date()) {
  return `${date.getMonth() + 1}月${date.getDate()}日 ${formatWeekdayLabel(localWeekdayNumber(date))}`;
}

function formatCalendarItem(schedule, date = new Date()) {
  return {
    id: schedule.id,
    time: schedule.time,
    title: schedule.title,
    message: scheduleMessage(schedule),
    dateKey: formatLocalDateKey(date)
  };
}

function buildStudyCalendarModel(selectedDate = new Date()) {
  const monthDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
  const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const startOffset = localWeekdayNumber(firstDay) - 1;
  const gridStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1 - startOffset);
  const selectedDateKey = formatLocalDateKey(selectedDate);
  const todayKey = formatLocalDateKey(new Date());
  const entriesByDate = {};
  const cells = [];

  for (let index = 0; index < 42; index += 1) {
    const cellDate = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index);
    const dateKey = formatLocalDateKey(cellDate);
    const items = getTodaySchedules(cellDate).map((schedule) => formatCalendarItem(schedule, cellDate));
    const previewRows = items.slice(0, 2).map((item) => item.title);

    if (items.length) {
      entriesByDate[dateKey] = items;
    }

    cells.push({
      dateKey,
      dayLabel: String(cellDate.getDate()),
      inCurrentMonth: cellDate.getMonth() === monthDate.getMonth(),
      isToday: dateKey === todayKey,
      isSelected: dateKey === selectedDateKey,
      count: items.length,
      previewRows,
      extraCount: Math.max(0, items.length - previewRows.length)
    });
  }

  return {
    monthKey: monthKeyFromDate(monthDate),
    monthLabel: monthLabelFromDate(monthDate),
    selectedDateKey,
    selectedDateLabel: selectedDateLabelFromDate(selectedDate),
    cells,
    entriesByDate
  };
}

function buildHomeModel() {
  return {
    appTitle: appConfig.appTitle,
    todaySchedule: buildStudyScheduleModel(),
    calendarSchedule: buildStudyCalendarModel(),
    cards: [
      ...classroomDefinitions.map((classroom) => ({
        id: classroom.id,
        title: classroom.title,
        tone: classroom.tone,
        badge: '在线课堂',
        target: classroom.entryUrl,
        scheduleTargetId: classroom.id,
        classroomId: classroom.id,
        libraryId: '',
        supportsStateReset: isCourseEcosystemOrigin(classroom.entryUrl)
      })),
      ...libraryDefinitions.map((library) => ({
        id: library.id,
        title: library.title,
        tone: library.tone,
        badge: '百度网盘',
        target: libraryTarget(library.id),
        scheduleTargetId: library.id,
        libraryId: library.id
      })),
      ...learningToolDefinitions.map((learningTool) => ({
        id: learningTool.id,
        title: learningTool.title,
        tone: learningTool.tone,
        badge: '学习工具',
        target: learningToolEntryTarget(learningTool.id),
        scheduleTargetId: learningTool.id,
        libraryId: ''
      })),
      ...nativeModuleDefinitions.map((moduleDefinition) => ({
        id: moduleDefinition.id,
        title: moduleDefinition.title,
        tone: moduleDefinition.tone,
        badge: moduleDefinition.badge || '作业模块',
        target: nativeModuleTarget(moduleDefinition.id),
        scheduleTargetId: moduleDefinition.id,
        libraryId: ''
      }))
    ]
  };
}

function buildPlanItemsForDate(dateKey, options = {}) {
  const normalizedDateKey = normalizeSpecificDate(dateKey) || formatLocalDateKey(new Date());
  const date = new Date(`${normalizedDateKey}T00:00:00`);
  const weekday = localWeekdayNumber(date);
  const includeSkippedWeekly = Boolean(options.includeSkippedWeekly);

  return (Array.isArray(appConfig.studySchedule) ? appConfig.studySchedule : [])
    .filter((schedule) => {
      if (!schedule || !schedule.enabled) {
        return false;
      }

      if (schedule.mode === 'date' || schedule.specificDate) {
        return schedule.specificDate === normalizedDateKey;
      }

      if (!Array.isArray(schedule.weekdays) || !schedule.weekdays.includes(weekday)) {
        return false;
      }

      const isSkipped = normalizeDateList(schedule.exceptionDates).includes(normalizedDateKey);
      return includeSkippedWeekly || !isSkipped;
    })
    .map((schedule) => {
      const isDatePlan = schedule.mode === 'date' || Boolean(schedule.specificDate);
      const isSkipped = !isDatePlan && normalizeDateList(schedule.exceptionDates).includes(normalizedDateKey);
      const planScope = normalizePlanScope(schedule.planScope, 'parent');
      const editable = planScope === 'student';

      if (!editable) {
        return {
          id: schedule.id,
          title: schedule.title,
          time: schedule.time,
          planScope,
          planScopeLabel: '家长',
          kindLabel: isDatePlan ? '单次' : '周期',
          stateLabel: isDatePlan ? '单次' : isSkipped ? '已跳过' : '周期',
          isSkipped,
          canEdit: false,
          actionLabel: ''
        };
      }

      return {
        id: schedule.id,
        title: schedule.title,
        time: schedule.time,
        planScope,
        planScopeLabel: '学生',
        kindLabel: isDatePlan ? '单次' : '周期',
        stateLabel: isDatePlan ? '单次' : isSkipped ? '已跳过' : '周期',
        isSkipped,
        canEdit: true,
        actionLabel: isDatePlan ? '删除' : isSkipped ? '恢复' : '跳过'
      };
    })
    .sort(
      (left, right) =>
        Number(Boolean(left.isSkipped)) - Number(Boolean(right.isSkipped)) ||
        left.time.localeCompare(right.time) ||
        left.title.localeCompare(right.title)
    );
}

function buildStudentPlanModel(options = {}) {
  const selectedDateKey = normalizeSpecificDate(options.selectedDate) || formatLocalDateKey(new Date());
  const monthDate = parseMonthKey(options.monthKey || selectedDateKey.slice(0, 7)) || new Date();
  const monthKey = monthKeyFromDate(monthDate);
  const monthLabel = monthLabelFromDate(monthDate);
  const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const startOffset = localWeekdayNumber(firstDay) - 1;
  const gridStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1 - startOffset);
  const todayKey = formatLocalDateKey(new Date());
  const selectedDateItems = buildPlanItemsForDate(selectedDateKey, {
    includeSkippedWeekly: true
  });
  const calendarCells = [];

  for (let index = 0; index < 42; index += 1) {
    const cellDate = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index);
    const cellDateKey = formatLocalDateKey(cellDate);
    const previewItems = buildPlanItemsForDate(cellDateKey);
    const previewRows = previewItems.slice(0, 2).map((item) => item.title);

    calendarCells.push({
      dateKey: cellDateKey,
      monthKey: monthKeyFromDate(cellDate),
      dayLabel: String(cellDate.getDate()),
      inCurrentMonth: cellDate.getMonth() === monthDate.getMonth(),
      isToday: cellDateKey === todayKey,
      isSelected: cellDateKey === selectedDateKey,
      planCount: previewItems.length,
      previewRows,
      extraCount: Math.max(0, previewItems.length - previewRows.length)
    });
  }

  const studentWeeklyItems = (appConfig.studentStudySchedule || [])
    .filter((item) => item.mode !== 'date' && !item.specificDate)
    .sort((left, right) => left.time.localeCompare(right.time) || left.title.localeCompare(right.title))
    .map((item) => ({
      id: item.id,
      title: item.title,
      time: item.time,
      message: item.message || '',
      patternLabel: normalizeWeekdays(item.weekdays).map((weekday) => formatWeekdayLabel(weekday)).join('、')
    }));

  return {
    currentMonthKey: monthKey,
    monthLabel,
    selectedDateKey,
    selectedDateLabel: selectedDateLabelFromDate(new Date(`${selectedDateKey}T00:00:00`)),
    calendarCells,
    selectedDateItems,
    studentWeeklyItems
  };
}

async function buildStudentPlanResponse(options = {}) {
  const accessStatus = await syncStudentDeviceAccessStatus({
    throwOnError: false
  });

  return {
    model: buildStudentPlanModel(options),
    studentItems: serializeStudySchedule(appConfig.studentStudySchedule || []),
    accessStatus
  };
}

function bundledPiperExecutablePath() {
  return path.join(app.getAppPath(), PIPER_RUNTIME_RELATIVE_DIR, PIPER_EXECUTABLE_NAME);
}

function bundledPiperModelPath() {
  return path.join(app.getAppPath(), PIPER_MODEL_RELATIVE_PATH);
}

function bundledPiperModelConfigPath() {
  return path.join(app.getAppPath(), PIPER_MODEL_CONFIG_RELATIVE_PATH);
}

function reminderAudioCacheDirPath() {
  return path.join(appConfig.stateDir, REMINDER_AUDIO_CACHE_DIR);
}

function normalizeRepeatCount(repeatCount) {
  return Number.isFinite(Number(repeatCount)) ? Math.max(1, Math.min(5, Math.round(Number(repeatCount)))) : 1;
}

function createReminderAudioCacheKey(speechSegments, repeatCount) {
  return crypto
    .createHash('sha1')
    .update(
      JSON.stringify({
        voice: 'piper-medium',
        repeatCount: normalizeRepeatCount(repeatCount),
        segmentPauseMs: REMINDER_SEGMENT_PAUSE_MS,
        repeatPauseMs: REMINDER_REPEAT_PAUSE_MS,
        speechSegments
      })
    )
    .digest('hex');
}

function createReminderSegmentCacheKey(segmentText) {
  return crypto
    .createHash('sha1')
    .update(`piper-medium-segment|${normalizePrefix(segmentText)}`)
    .digest('hex');
}

function createReminderTitleComponentCacheKey(title) {
  return crypto
    .createHash('sha1')
    .update(`${REMINDER_AUDIO_TEMPLATE_VERSION}|title|${normalizePrefix(title)}`)
    .digest('hex');
}

function createReminderPlanAudioCacheKey(title, leadMinutes) {
  return crypto
    .createHash('sha1')
    .update(
      JSON.stringify({
        version: REMINDER_AUDIO_TEMPLATE_VERSION,
        title: normalizePrefix(title),
        leadMinutes: Number(leadMinutes)
      })
    )
    .digest('hex');
}

function reminderAudioComponentDirPath() {
  return path.join(reminderAudioCacheDirPath(), 'components');
}

function reminderAudioPlanDirPath() {
  return path.join(reminderAudioCacheDirPath(), 'plans');
}

function reminderStaticAudioDirCandidates() {
  return dedupe([
    path.join(path.dirname(process.execPath), 'videos'),
    path.join(app.getAppPath(), 'videos'),
    path.join(path.resolve(app.getAppPath(), '..'), 'videos'),
    path.join(path.resolve(app.getAppPath(), '..', '..'), 'videos'),
    path.join(process.cwd(), 'videos')
  ]);
}

function resolveReminderStaticAudioPath(componentName) {
  const normalizedComponentName = normalizePrefix(componentName).toLowerCase();

  if (!normalizedComponentName) {
    return '';
  }

  for (const candidateDirectory of reminderStaticAudioDirCandidates()) {
    if (!candidateDirectory || !fs.existsSync(candidateDirectory)) {
      continue;
    }

    try {
      const fileEntries = fs.readdirSync(candidateDirectory, { withFileTypes: true }).filter((entry) => {
        if (!entry.isFile()) {
          return false;
        }

        const parsed = path.parse(entry.name);
        return ['.wav', '.mp3'].includes(parsed.ext.toLowerCase()) && parsed.name.trim().toLowerCase() === normalizedComponentName;
      });
      const sortedMatches = fileEntries.sort((left, right) => {
        const leftExt = path.extname(left.name).toLowerCase();
        const rightExt = path.extname(right.name).toLowerCase();

        if (leftExt === rightExt) {
          return left.name.localeCompare(right.name, 'en-US');
        }

        if (leftExt === '.wav') {
          return -1;
        }

        if (rightExt === '.wav') {
          return 1;
        }

        return left.name.localeCompare(right.name, 'en-US');
      });

      if (sortedMatches.length) {
        return path.join(candidateDirectory, sortedMatches[0].name);
      }
    } catch {
      // Ignore scan failures for optional static audio directories.
    }
  }

  return '';
}

function reminderTemplateForLeadMinutes(leadMinutes) {
  if (Number(leadMinutes) === 5) {
    return ['alarm', 's120', 'alarm', 's220', 'distance', 's180', 'planName', 's180', 'remain', 's120', 'five_minutes'];
  }

  if (Number(leadMinutes) === 1) {
    return ['alarm', 's120', 'alarm', 's220', 'distance', 's180', 'planName', 's180', 'remain', 's120', 'one_minutes'];
  }

  return null;
}

function pruneReminderAudioCache(cacheDirectory) {
  if (!fs.existsSync(cacheDirectory)) {
    return;
  }

  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;

  for (const entry of fs.readdirSync(cacheDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.wav') {
      continue;
    }

    const entryPath = path.join(cacheDirectory, entry.name);

    try {
      const stats = fs.statSync(entryPath);

      if (stats.mtimeMs < cutoff) {
        fs.unlinkSync(entryPath);
      }
    } catch {
      // Ignore cache pruning failures.
    }
  }
}

function runPiperToWave(text, outputPath) {
  return new Promise((resolve) => {
    const executablePath = bundledPiperExecutablePath();
    const modelPath = bundledPiperModelPath();
    const modelConfigPath = bundledPiperModelConfigPath();
    logReminderDebug('audio-segment-build-start', {
      text: normalizePrefix(text),
      outputPath
    });
    const child = spawn(
      executablePath,
      ['--model', modelPath, '--config', modelConfigPath, '--output_file', outputPath],
      {
        cwd: path.dirname(executablePath),
        windowsHide: true,
        stdio: ['pipe', 'ignore', 'pipe']
      }
    );

    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', () => {
      logReminderDebug('audio-segment-build-error', {
        text: normalizePrefix(text),
        outputPath
      });
      resolve(false);
    });

    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        logReminderDebug('audio-segment-build-complete', {
          text: normalizePrefix(text),
          outputPath
        });
        resolve(true);
        return;
      }

      try {
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
        }
      } catch {
        // Ignore partial file cleanup failures.
      }

      if (stderr.trim()) {
        process.stderr.write(`[Piper] ${stderr.trim()}${os.EOL}`);
      }

      logReminderDebug('audio-segment-build-failed', {
        text: normalizePrefix(text),
        outputPath,
        code,
        stderr: stderr.trim()
      });

      resolve(false);
    });

    child.stdin.end(normalizePrefix(text), 'utf8');
  });
}

function findWaveChunk(buffer, chunkId) {
  for (let offset = 12; offset + 8 <= buffer.length; ) {
    const currentChunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkDataOffset = offset + 8;

    if (currentChunkId === chunkId) {
      return {
        dataOffset: chunkDataOffset,
        size: chunkSize
      };
    }

    offset = chunkDataOffset + chunkSize + (chunkSize % 2);
  }

  return null;
}

function readPcmWaveFile(filePath) {
  const buffer = fs.readFileSync(filePath);

  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('不是有效的 WAV 文件。');
  }

  const fmtChunk = findWaveChunk(buffer, 'fmt ');
  const dataChunk = findWaveChunk(buffer, 'data');

  if (!fmtChunk || !dataChunk) {
    throw new Error('WAV 文件缺少 fmt 或 data 区块。');
  }

  const audioFormat = buffer.readUInt16LE(fmtChunk.dataOffset);
  const channels = buffer.readUInt16LE(fmtChunk.dataOffset + 2);
  const sampleRate = buffer.readUInt32LE(fmtChunk.dataOffset + 4);
  const blockAlign = buffer.readUInt16LE(fmtChunk.dataOffset + 12);
  const bitsPerSample = buffer.readUInt16LE(fmtChunk.dataOffset + 14);

  if (audioFormat !== 1) {
    throw new Error('仅支持 PCM WAV。');
  }

  return {
    channels,
    sampleRate,
    bitsPerSample,
    blockAlign,
    data: buffer.subarray(dataChunk.dataOffset, dataChunk.dataOffset + dataChunk.size)
  };
}

function buildPcmWaveBuffer(format, dataBuffer) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 4, 'ascii');
  header.writeUInt32LE(36 + dataBuffer.length, 4);
  header.write('WAVE', 8, 4, 'ascii');
  header.write('fmt ', 12, 4, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(format.channels, 22);
  header.writeUInt32LE(format.sampleRate, 24);
  header.writeUInt32LE(format.sampleRate * format.blockAlign, 28);
  header.writeUInt16LE(format.blockAlign, 32);
  header.writeUInt16LE(format.bitsPerSample, 34);
  header.write('data', 36, 4, 'ascii');
  header.writeUInt32LE(dataBuffer.length, 40);
  return Buffer.concat([header, dataBuffer]);
}

function createSilenceDataBuffer(format, durationMs) {
  const frameCount = Math.max(1, Math.round((format.sampleRate * durationMs) / 1000));
  return Buffer.alloc(frameCount * format.blockAlign);
}

function createToneDataBuffer(format, frequency, durationMs, amplitude = 0.25) {
  const frameCount = Math.max(1, Math.round((format.sampleRate * durationMs) / 1000));
  const sampleCount = frameCount * format.channels;
  const buffer = Buffer.alloc(frameCount * format.blockAlign);

  if (format.bitsPerSample !== 16) {
    return buffer;
  }

  const peak = Math.max(0, Math.min(0.9, amplitude)) * 32767;

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const t = frameIndex / format.sampleRate;
    const envelope = Math.sin(Math.PI * Math.min(1, frameIndex / Math.max(1, frameCount - 1)));
    const sampleValue = Math.round(Math.sin(2 * Math.PI * frequency * t) * peak * envelope);

    for (let channelIndex = 0; channelIndex < format.channels; channelIndex += 1) {
      buffer.writeInt16LE(sampleValue, (frameIndex * format.channels + channelIndex) * 2);
    }
  }

  return buffer;
}

function createReminderAlarmIntroData(format) {
  return Buffer.concat([
    createToneDataBuffer(format, 1046.5, 140, 0.24),
    createSilenceDataBuffer(format, 90),
    createToneDataBuffer(format, 1046.5, 140, 0.24),
    createSilenceDataBuffer(format, 120),
    createToneDataBuffer(format, 1318.5, 220, 0.28),
    createSilenceDataBuffer(format, 180)
  ]);
}

function createReminderAlarmClipData(format) {
  return Buffer.concat([
    createToneDataBuffer(format, 1046.5, 150, 0.26),
    createSilenceDataBuffer(format, 30)
  ]);
}

function loadWaveFormat(filePath) {
  const wave = readPcmWaveFile(filePath);
  return {
    channels: wave.channels,
    sampleRate: wave.sampleRate,
    bitsPerSample: wave.bitsPerSample,
    blockAlign: wave.blockAlign
  };
}

function ensureGeneratedPcmWaveFile(filePath, format, buildDataBuffer) {
  if (fs.existsSync(filePath)) {
    return filePath;
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const dataBuffer = buildDataBuffer();
  fs.writeFileSync(filePath, buildPcmWaveBuffer(format, dataBuffer));
  return filePath;
}

async function ensureReminderFixedTextComponentWave(componentName, cacheDirectory) {
  const text = REMINDER_FIXED_TEXT_COMPONENTS[componentName];

  if (!text) {
    return '';
  }

  const componentPath = path.join(cacheDirectory, `${componentName}.wav`);

  if (!fs.existsSync(componentPath)) {
    const built = await runPiperToWave(text, componentPath);

    if (!built) {
      return '';
    }
  }

  return componentPath;
}

async function ensureReminderTitleComponentWave(title, cacheDirectory) {
  const normalizedTitle = normalizePrefix(title) || '学习计划';
  const componentPath = path.join(cacheDirectory, `title-${createReminderTitleComponentCacheKey(normalizedTitle)}.wav`);

  if (!fs.existsSync(componentPath)) {
    const built = await runPiperToWave(normalizedTitle, componentPath);

    if (!built) {
      return '';
    }
  }

  return componentPath;
}

function ensureReminderGeneratedComponentWaves(cacheDirectory, format) {
  const generatedPaths = {};

  generatedPaths.alarm = ensureGeneratedPcmWaveFile(
    path.join(cacheDirectory, 'alarm.wav'),
    format,
    () => createReminderAlarmClipData(format)
  );

  for (const [componentName, durationMs] of Object.entries(REMINDER_SILENCE_COMPONENTS_MS)) {
    generatedPaths[componentName] = ensureGeneratedPcmWaveFile(
      path.join(cacheDirectory, `${componentName}.wav`),
      format,
      () => createSilenceDataBuffer(format, durationMs)
    );
  }

  return generatedPaths;
}

async function synthesizeReminderAudioFromTemplate(schedule, leadMinutes) {
  const sequence = reminderTemplateForLeadMinutes(leadMinutes);

  if (!sequence) {
    return '';
  }

  const title = normalizePrefix(schedule && schedule.title) || '学习计划';
  const cacheRoot = reminderAudioCacheDirPath();
  const componentDirectory = reminderAudioComponentDirPath();
  const planDirectory = reminderAudioPlanDirPath();
  const outputPath = path.join(planDirectory, `${createReminderPlanAudioCacheKey(title, leadMinutes)}.wav`);

  if (fs.existsSync(outputPath)) {
    logReminderDebug('audio-template-cache-hit', {
      title,
      leadMinutes,
      outputPath
    });
    return outputPath;
  }

  fs.mkdirSync(cacheRoot, { recursive: true });
  fs.mkdirSync(componentDirectory, { recursive: true });
  fs.mkdirSync(planDirectory, { recursive: true });
  pruneReminderAudioCache(planDirectory);

  const distancePath = await ensureReminderFixedTextComponentWave('distance', componentDirectory);
  const remainPath = await ensureReminderFixedTextComponentWave('remain', componentDirectory);
  const leadPath = await ensureReminderFixedTextComponentWave(leadMinutes === 5 ? 'five_minutes' : 'one_minutes', componentDirectory);
  const titlePath = await ensureReminderTitleComponentWave(title, componentDirectory);

  if (!distancePath || !remainPath || !leadPath || !titlePath) {
    logReminderDebug('audio-template-component-missing', {
      title,
      leadMinutes,
      distancePath,
      remainPath,
      leadPath,
      titlePath
    });
    return '';
  }

  const format = loadWaveFormat(distancePath);
  const generatedPaths = ensureReminderGeneratedComponentWaves(componentDirectory, format);
  const componentPathMap = {
    alarm: generatedPaths.alarm,
    s120: generatedPaths.s120,
    s180: generatedPaths.s180,
    s220: generatedPaths.s220,
    distance: distancePath,
    remain: remainPath,
    five_minutes: leadMinutes === 5 ? leadPath : path.join(componentDirectory, 'five_minutes.wav'),
    one_minutes: leadMinutes === 1 ? leadPath : path.join(componentDirectory, 'one_minutes.wav'),
    planName: titlePath
  };

  if (leadMinutes !== 5) {
    componentPathMap.five_minutes = await ensureReminderFixedTextComponentWave('five_minutes', componentDirectory);
  }

  if (leadMinutes !== 1) {
    componentPathMap.one_minutes = await ensureReminderFixedTextComponentWave('one_minutes', componentDirectory);
  }

  const chunks = [];

  for (const componentName of sequence) {
    const componentPath = componentPathMap[componentName];

    if (!componentPath || !fs.existsSync(componentPath)) {
      logReminderDebug('audio-template-sequence-missing', {
        title,
        leadMinutes,
        componentName,
        componentPath
      });
      return '';
    }

    const componentWave = readPcmWaveFile(componentPath);

    if (
      componentWave.channels !== format.channels ||
      componentWave.sampleRate !== format.sampleRate ||
      componentWave.bitsPerSample !== format.bitsPerSample ||
      componentWave.blockAlign !== format.blockAlign
    ) {
      logReminderDebug('audio-template-format-mismatch', {
        title,
        leadMinutes,
        componentName,
        componentPath
      });
      return '';
    }

    chunks.push(componentWave.data);
  }

  fs.writeFileSync(outputPath, buildPcmWaveBuffer(format, Buffer.concat(chunks)));
  logReminderDebug('audio-template-built', {
    title,
    leadMinutes,
    outputPath,
    sequence
  });
  return outputPath;
}

async function synthesizeReminderSegmentWave(segmentText, cacheDirectory) {
  const normalizedText = normalizePrefix(segmentText);

  if (!normalizedText) {
    return null;
  }

  const segmentCachePath = path.join(cacheDirectory, `segment-${createReminderSegmentCacheKey(normalizedText)}.wav`);

  if (!fs.existsSync(segmentCachePath)) {
    const built = await runPiperToWave(normalizedText, segmentCachePath);

    if (!built) {
      logReminderDebug('audio-segment-cache-build-miss', {
        text: normalizedText,
        segmentCachePath
      });
      return null;
    }
  }

  try {
    return readPcmWaveFile(segmentCachePath);
  } catch {
    return null;
  }
}

async function synthesizeReminderAudioWithPiper(speechSegments, repeatCount) {
  const normalizedSegments = (Array.isArray(speechSegments) ? speechSegments : [])
    .map((segment) => normalizePrefix(segment))
    .filter(Boolean);

  if (!normalizedSegments.length || !appConfig) {
    logReminderDebug('audio-build-skip', {
      reason: !normalizedSegments.length ? 'empty_segments' : 'missing_app_config'
    });
    return Promise.resolve('');
  }

  const executablePath = bundledPiperExecutablePath();
  const modelPath = bundledPiperModelPath();
  const modelConfigPath = bundledPiperModelConfigPath();

  if (!fs.existsSync(executablePath) || !fs.existsSync(modelPath) || !fs.existsSync(modelConfigPath)) {
    logReminderDebug('audio-build-skip', {
      reason: 'missing_piper_runtime',
      executablePath,
      modelPath,
      modelConfigPath
    });
    return Promise.resolve('');
  }

  const cacheDirectory = reminderAudioCacheDirPath();
  const cacheKey = createReminderAudioCacheKey(normalizedSegments, repeatCount);
  const outputPath = path.join(cacheDirectory, `${cacheKey}.wav`);

  if (fs.existsSync(outputPath)) {
    logReminderDebug('audio-build-cache-hit', {
      outputPath,
      cacheKey
    });
    return Promise.resolve(outputPath);
  }

  if (reminderAudioBuilds.has(cacheKey)) {
    return reminderAudioBuilds.get(cacheKey);
  }

  const buildPromise = (async () => {
    try {
      logReminderDebug('audio-build-start', {
        cacheKey,
        outputPath,
        repeatCount: normalizeRepeatCount(repeatCount),
        speechSegments: normalizedSegments
      });

      fs.mkdirSync(cacheDirectory, { recursive: true });
      pruneReminderAudioCache(cacheDirectory);

      const segmentWaves = [];

      for (const segmentText of normalizedSegments) {
        const wave = await synthesizeReminderSegmentWave(segmentText, cacheDirectory);

        if (!wave) {
          logReminderDebug('audio-build-segment-failed', {
            cacheKey,
            segmentText
          });
          return '';
        }

        segmentWaves.push(wave);
      }

      const format = segmentWaves[0];

      if (
        segmentWaves.some(
          (wave) =>
            wave.channels !== format.channels ||
            wave.sampleRate !== format.sampleRate ||
            wave.bitsPerSample !== format.bitsPerSample ||
            wave.blockAlign !== format.blockAlign
        )
      ) {
        logReminderDebug('audio-build-format-mismatch', {
          cacheKey
        });
        return '';
      }

      const segmentPause = createSilenceDataBuffer(format, REMINDER_SEGMENT_PAUSE_MS);
      const repeatPause = createSilenceDataBuffer(format, REMINDER_REPEAT_PAUSE_MS);
      const alarmIntro = createReminderAlarmIntroData(format);
      const chunks = [];
      const normalizedRepeatCount = normalizeRepeatCount(repeatCount);

      if (alarmIntro.length) {
        chunks.push(alarmIntro);
      }

      for (let repeatIndex = 0; repeatIndex < normalizedRepeatCount; repeatIndex += 1) {
        segmentWaves.forEach((wave, segmentIndex) => {
          chunks.push(wave.data);

          if (segmentIndex < segmentWaves.length - 1) {
            chunks.push(segmentPause);
          }
        });

        if (repeatIndex < normalizedRepeatCount - 1) {
          chunks.push(repeatPause);
        }
      }

      fs.writeFileSync(outputPath, buildPcmWaveBuffer(format, Buffer.concat(chunks)));
      logReminderDebug('audio-build-complete', {
        cacheKey,
        outputPath
      });
      return outputPath;
    } catch (error) {
      logReminderDebug('audio-build-error', {
        cacheKey,
        outputPath,
        message: error && error.message ? error.message : 'unknown'
      });
      return '';
    }
  }).finally(() => {
    reminderAudioBuilds.delete(cacheKey);
  });

  reminderAudioBuilds.set(cacheKey, buildPromise);
  return buildPromise;
}

function scheduleStartDateTimeForDate(schedule, date = new Date()) {
  const minutes = clockTimeToMinutes(schedule && schedule.time);

  if (minutes === null) {
    return null;
  }

  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    Math.floor(minutes / 60),
    minutes % 60,
    0,
    0
  );
}

function reminderIsDue(now, targetTime) {
  if (!(targetTime instanceof Date) || Number.isNaN(targetTime.getTime())) {
    return false;
  }

  const deltaMs = now.getTime() - targetTime.getTime();
  return deltaMs >= 0 && deltaMs < REMINDER_TRIGGER_GRACE_MS;
}

function buildReminderSpeechText(schedule, leadMinutes) {
  const title = normalizePrefix(schedule && schedule.title) || '学习计划';

  if (leadMinutes > 0) {
    return `距离，${title}，还剩，${leadMinutes}分钟。`;
  }

  return `${title}，现在开始。`;
}

function buildReminderSpeechSegments(schedule, leadMinutes) {
  const title = normalizePrefix(schedule && schedule.title) || '学习计划';

  if (leadMinutes > 0) {
    return ['距离', title, '还剩', `${leadMinutes}分钟`];
  }

  return [title, '现在开始'];
}

function collectReminderAudioPrewarmEntries() {
  if (!appConfig || !Array.isArray(appConfig.studySchedule) || !appConfig.studySchedule.length) {
    return [];
  }

  const leadMinutes = Array.isArray(appConfig.reminders && appConfig.reminders.leadMinutes)
    ? appConfig.reminders.leadMinutes
    : DEFAULT_REMINDER_LEAD_MINUTES;
  const seen = new Set();
  const entries = [];

  for (const schedule of appConfig.studySchedule) {
    if (!schedule || schedule.enabled === false) {
      continue;
    }

    const title = normalizePrefix(schedule.title);

    if (!title) {
      continue;
    }

    for (const leadMinute of leadMinutes) {
      const key = `${title}|${leadMinute}`;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      entries.push({
        title,
        leadMinute
      });
    }
  }

  return entries;
}

async function prewarmReminderAudioCache() {
  if (reminderAudioPrewarmInFlight) {
    reminderAudioPrewarmQueued = true;
    return;
  }

  const entries = collectReminderAudioPrewarmEntries();

  if (!entries.length) {
    logReminderDebug('audio-prewarm-skip', {
      reason: 'empty_schedule'
    });
    return;
  }

  reminderAudioPrewarmInFlight = true;
  reminderAudioPrewarmQueued = false;

  try {
    logReminderDebug('audio-prewarm-start', {
      count: entries.length
    });

    for (const entry of entries) {
      const audioPath = await ensureReminderPlanTitleAudioPath(entry.title);
      logReminderDebug('audio-prewarm-entry', {
        title: entry.title,
        leadMinute: entry.leadMinute,
        audioPath
      });
    }

    logReminderDebug('audio-prewarm-complete', {
      count: entries.length
    });
  } catch (error) {
    logReminderDebug('audio-prewarm-error', {
      message: error && error.message ? error.message : 'unknown'
    });
  } finally {
    reminderAudioPrewarmInFlight = false;

    if (reminderAudioPrewarmQueued) {
      reminderAudioPrewarmQueued = false;
      scheduleReminderAudioPrewarm(200);
    }
  }
}

function scheduleReminderAudioPrewarm(delayMs = 400) {
  if (reminderAudioPrewarmTimer) {
    clearTimeout(reminderAudioPrewarmTimer);
  }

  reminderAudioPrewarmTimer = setTimeout(() => {
    reminderAudioPrewarmTimer = null;
    void prewarmReminderAudioCache();
  }, Math.max(0, Number(delayMs) || 0));
}

async function ensureReminderPlanTitleAudioPath(title) {
  const componentDirectory = reminderAudioComponentDirPath();
  fs.mkdirSync(componentDirectory, { recursive: true });
  return ensureReminderTitleComponentWave(title, componentDirectory);
}

async function buildReminderAudioSequence(schedule, leadMinutes) {
  const sequence = reminderTemplateForLeadMinutes(leadMinutes);

  if (!sequence) {
    return [];
  }

  const title = normalizePrefix(schedule && schedule.title) || '学习计划';
  const titlePath = await ensureReminderPlanTitleAudioPath(title);

  if (!titlePath || !fs.existsSync(titlePath)) {
    logReminderDebug('audio-sequence-title-missing', {
      title,
      leadMinutes,
      titlePath
    });
    return [];
  }

  const componentDirectory = reminderAudioComponentDirPath();
  const titleFormat = loadWaveFormat(titlePath);
  const sequenceParts = [];
  let fallbackAlarmPath = '';

  for (const componentName of sequence) {
    if (Object.prototype.hasOwnProperty.call(REMINDER_SILENCE_COMPONENTS_MS, componentName)) {
      sequenceParts.push({
        componentName,
        kind: 'pause',
        ms: REMINDER_SILENCE_COMPONENTS_MS[componentName]
      });
      continue;
    }

    if (componentName === 'planName') {
      sequenceParts.push({
        componentName,
        kind: 'file',
        path: titlePath,
        source: 'title'
      });
      continue;
    }

    const staticPath = resolveReminderStaticAudioPath(componentName);

    if (staticPath) {
      sequenceParts.push({
        componentName,
        kind: 'file',
        path: staticPath,
        source: 'videos'
      });
      continue;
    }

    if (componentName === 'alarm') {
      if (!fallbackAlarmPath) {
        fallbackAlarmPath = ensureGeneratedPcmWaveFile(
          path.join(componentDirectory, 'alarm-generated.wav'),
          titleFormat,
          () => createReminderAlarmClipData(titleFormat)
        );
      }

      sequenceParts.push({
        componentName,
        kind: 'file',
        path: fallbackAlarmPath,
        source: 'generated'
      });
      continue;
    }

    const fallbackSpeechPath = await ensureReminderFixedTextComponentWave(componentName, componentDirectory);

    if (fallbackSpeechPath) {
      sequenceParts.push({
        componentName,
        kind: 'file',
        path: fallbackSpeechPath,
        source: 'generated'
      });
      continue;
    }

    logReminderDebug('audio-sequence-component-missing', {
      title,
      leadMinutes,
      componentName
    });
    return [];
  }

  const spokenStartIndex = sequenceParts.findIndex((part) => part.componentName === 'distance');
  let finalParts = sequenceParts;

  if (spokenStartIndex >= 0 && REMINDER_SEQUENCE_REPEAT_COUNT > 1) {
    const preamble = sequenceParts.slice(0, spokenStartIndex).map((part) => ({ ...part }));
    const spoken = sequenceParts.slice(spokenStartIndex).map((part) => ({ ...part }));
    finalParts = [...preamble];

    for (let repeatIndex = 0; repeatIndex < REMINDER_SEQUENCE_REPEAT_COUNT; repeatIndex += 1) {
      finalParts.push(...spoken.map((part) => ({ ...part })));

      if (repeatIndex < REMINDER_SEQUENCE_REPEAT_COUNT - 1) {
        finalParts.push({
          componentName: 'repeatPause',
          kind: 'pause',
          ms: REMINDER_REPEAT_PAUSE_MS
        });
      }
    }
  }

  logReminderDebug('audio-sequence-built', {
    title,
    leadMinutes,
    repeatCount: REMINDER_SEQUENCE_REPEAT_COUNT,
    sequenceParts: finalParts.map((part) => (part.kind === 'pause' ? `pause:${part.ms}` : `${part.source}:${path.basename(part.path)}`))
  });
  return finalParts.map((part) =>
    part.kind === 'pause'
      ? {
          kind: 'pause',
          ms: part.ms
        }
      : {
          kind: 'file',
          path: part.path,
          source: part.source
        }
  );
}

function playReminderAlarmFallback() {
  for (const offsetMs of [0, 220, 480]) {
    setTimeout(() => {
      try {
        electronShell.beep();
        logReminderDebug('alarm-fallback-beep', {
          offsetMs
        });
      } catch {
        // Ignore system beep failures.
      }
    }, offsetMs);
  }
}

function showReminderNotification(payload) {
  if (!Notification || (typeof Notification.isSupported === 'function' && !Notification.isSupported())) {
    logReminderDebug('notification-unsupported');
    return false;
  }

  try {
    const notification = new Notification({
      title: normalizePrefix(payload && payload.title) || '学习提醒',
      body: normalizePrefix(payload && payload.message) || '到学习时间了。',
      silent: false
    });

    notification.on('click', () => {
      focusMainWindow();
    });
    notification.show();
    logReminderDebug('notification-shown', {
      title: normalizePrefix(payload && payload.title),
      message: normalizePrefix(payload && payload.message)
    });
    return true;
  } catch {
    // Ignore OS notification failures.
    logReminderDebug('notification-failed');
    return false;
  }
}

function closeReminderPopup() {
  if (reminderPopupTimer) {
    clearTimeout(reminderPopupTimer);
    reminderPopupTimer = null;
  }

  if (reminderPopupWindow && !reminderPopupWindow.isDestroyed()) {
    reminderPopupWindow.close();
  }

  reminderPopupWindow = null;
}

function renderReminderPopupHtml(payload = {}) {
  const title = (normalizePrefix(payload.title) || '学习提醒')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const time = (normalizePrefix(payload.time) || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const message = (normalizePrefix(payload.message) || '到学习时间了。')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return `<!doctype html>
  <html lang="zh-CN">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>学习提醒</title>
      <style>
        * { box-sizing: border-box; }
        body {
          margin: 0;
          font-family: "Microsoft YaHei UI", "Segoe UI", sans-serif;
          background: linear-gradient(145deg, #1f1414, #12131a 65%, #152127);
          color: #f7f7fb;
          display: grid;
          min-height: 100vh;
          place-items: center;
          padding: 16px;
        }
        .shell {
          width: 100%;
          border-radius: 22px;
          padding: 20px 22px;
          background: rgba(15, 20, 28, 0.96);
          border: 1px solid rgba(255,255,255,0.08);
          box-shadow: 0 22px 60px rgba(0,0,0,0.3);
        }
        .time {
          margin: 0 0 10px;
          font-size: 13px;
          color: #f0b65d;
          letter-spacing: 0.08em;
        }
        h1 {
          margin: 0 0 12px;
          font-size: 28px;
          line-height: 1.2;
        }
        p {
          margin: 0;
          font-size: 16px;
          line-height: 1.5;
          color: rgba(247,247,251,0.84);
        }
      </style>
    </head>
    <body>
      <main class="shell">
        <div class="time">${time}</div>
        <h1>${title}</h1>
        <p>${message}</p>
      </main>
    </body>
  </html>`;
}

async function showReminderPopup(payload) {
  try {
    if (!app.isReady()) {
      return false;
    }

    if (!reminderPopupWindow || reminderPopupWindow.isDestroyed()) {
      reminderPopupWindow = new BrowserWindow({
        width: 420,
        height: 220,
        frame: false,
        resizable: false,
        minimizable: false,
        maximizable: false,
        movable: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        show: false,
        transparent: false,
        backgroundColor: '#12131a',
        webPreferences: {
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
          devTools: false,
          spellcheck: false
        }
      });

      reminderPopupWindow.on('closed', () => {
        reminderPopupWindow = null;
      });

      reminderPopupWindow.on('focus', () => {
        focusMainWindow();
        closeReminderPopup();
      });
    }

    const display = screen.getPrimaryDisplay();
    const workArea = display.workArea;
    const width = 420;
    const height = 220;
    const x = Math.round(workArea.x + workArea.width - width - 18);
    const y = Math.round(workArea.y + 18);
    reminderPopupWindow.setBounds({ x, y, width, height });
    await reminderPopupWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderReminderPopupHtml(payload))}`);
    if (reminderPopupWindow && !reminderPopupWindow.isDestroyed()) {
      reminderPopupWindow.showInactive();
    }

    if (reminderPopupTimer) {
      clearTimeout(reminderPopupTimer);
    }

    reminderPopupTimer = setTimeout(() => {
      closeReminderPopup();
    }, 20000);

    logReminderDebug('popup-shown', {
      title: normalizePrefix(payload && payload.title),
      time: normalizePrefix(payload && payload.time)
    });
    return true;
  } catch (error) {
    logReminderDebug('popup-failed', {
      message: error && error.message ? error.message : 'unknown'
    });
    return false;
  }
}

function escapePowerShellSingleQuotedString(value) {
  return String(value || '').replace(/'/g, "''");
}

function stopReminderAudioProcess() {
  if (reminderAudioProcess && !reminderAudioProcess.killed) {
    try {
      reminderAudioProcess.kill();
    } catch {
      // Ignore player termination failures.
    }
  }

  reminderAudioProcess = null;
}

function playReminderSequenceNative(sequenceParts) {
  if (!Array.isArray(sequenceParts) || !sequenceParts.length) {
    logReminderDebug('audio-sequence-empty');
    playReminderAlarmFallback();
    return;
  }

  stopReminderAudioProcess();

  const encodedSequence = Buffer.from(JSON.stringify(sequenceParts), 'utf8').toString('base64');
  const command = [
    'Add-Type -AssemblyName PresentationCore',
    `$json = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${encodedSequence}'))`,
    '$sequence = $json | ConvertFrom-Json',
    'function Play-StudyGateMedia([string] $mediaPath) {',
    '  $player = New-Object System.Windows.Media.MediaPlayer',
    '  try {',
    '    $uri = New-Object System.Uri($mediaPath)',
    '    $player.Open($uri)',
    '    $player.Volume = 1.0',
    '    $player.Play()',
    '    $deadline = [DateTime]::UtcNow.AddSeconds(30)',
    '    while ([DateTime]::UtcNow -lt $deadline) {',
    '      Start-Sleep -Milliseconds 50',
    '      if ($player.NaturalDuration.HasTimeSpan) {',
    '        if ($player.Position -ge $player.NaturalDuration.TimeSpan -and $player.NaturalDuration.TimeSpan.TotalMilliseconds -gt 0) { break }',
    '      }',
    '    }',
    '  } finally {',
    '    $player.Stop()',
    '    $player.Close()',
    '  }',
    '}',
    'foreach ($item in $sequence) {',
    "  if ($item.kind -eq 'pause') { Start-Sleep -Milliseconds ([int]$item.ms); continue }",
    "  if ($item.kind -eq 'file' -and (Test-Path -LiteralPath $item.path)) { Play-StudyGateMedia $item.path }",
    '}'
  ].join('; ');
  const playerProcess = spawn(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', command],
    {
      windowsHide: true
    }
  );

  reminderAudioProcess = playerProcess;
  logReminderDebug('audio-sequence-play-start', {
    pid: playerProcess.pid,
    parts: sequenceParts.map((part) => (part.kind === 'pause' ? `pause:${part.ms}` : path.basename(part.path)))
  });
  playerProcess.stderr.on('data', (chunk) => {
    logReminderDebug('audio-sequence-play-stderr', {
      message: String(chunk || '').trim()
    });
  });
  playerProcess.on('exit', () => {
    logReminderDebug('audio-sequence-play-exit');
    if (reminderAudioProcess === playerProcess) {
      reminderAudioProcess = null;
    }
  });
  playerProcess.on('error', (error) => {
    if (reminderAudioProcess === playerProcess) {
      reminderAudioProcess = null;
    }
    logReminderDebug('audio-sequence-play-error', {
      message: error && error.message ? error.message : 'unknown'
    });
    playReminderAlarmFallback();
  });
}

function playReminderAudioNative(audioPath) {
  const normalizedPath = normalizePrefix(audioPath);

  if (!normalizedPath || !fs.existsSync(normalizedPath)) {
    logReminderDebug('audio-path-missing', {
      audioPath: normalizedPath
    });
    playReminderAlarmFallback();
    return;
  }

  stopReminderAudioProcess();

  const command = `$player = New-Object System.Media.SoundPlayer('${escapePowerShellSingleQuotedString(normalizedPath)}'); $player.PlaySync();`;
  const playerProcess = spawn(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', command],
    {
      windowsHide: true
    }
  );

  reminderAudioProcess = playerProcess;
  logReminderDebug('audio-play-start', {
    audioPath: normalizedPath,
    pid: playerProcess.pid
  });
  playerProcess.stderr.on('data', (chunk) => {
    logReminderDebug('audio-play-stderr', {
      message: String(chunk || '').trim()
    });
  });
  playerProcess.on('exit', () => {
    logReminderDebug('audio-play-exit', {
      audioPath: normalizedPath
    });
    if (reminderAudioProcess === playerProcess) {
      reminderAudioProcess = null;
    }
  });
  playerProcess.on('error', (error) => {
    if (reminderAudioProcess === playerProcess) {
      reminderAudioProcess = null;
    }
    logReminderDebug('audio-play-error', {
      audioPath: normalizedPath,
      message: error && error.message ? error.message : 'unknown'
    });
    playReminderAlarmFallback();
  });
}

function createBaseReminderPayload(schedule, leadMinutes) {
  const offsetLabel = leadMinutes > 0 ? `提前${leadMinutes}分钟` : '到点提醒';
  const speechText = buildReminderSpeechText(schedule, leadMinutes);
  return {
    id: schedule.id,
    time: `${offsetLabel} · ${schedule.time}`,
    title: schedule.title,
    message: speechText,
    speechText,
    leadMinutes,
    audioPath: ''
  };
}

async function pushReminderToWindow(schedule, leadMinutes) {
  const payload = createBaseReminderPayload(schedule, leadMinutes);
  logReminderDebug('reminder-dispatch-start', {
    scheduleId: schedule.id,
    title: schedule.title,
    leadMinutes,
    time: schedule.time
  });

  closeReminderPopup();
  const notificationShown = showReminderNotification(payload);
  const popupShown = false;
  let rendererShown = false;

  if (!mainWindow || mainWindow.isDestroyed()) {
    logReminderDebug('reminder-main-window-missing', {
      scheduleId: schedule.id
    });
  } else {
    if (reminderFlashTimer) {
      clearTimeout(reminderFlashTimer);
      reminderFlashTimer = null;
    }

    try {
      mainWindow.flashFrame(true);
      mainWindow.webContents.send('shell:study-reminder', payload);
      rendererShown = true;
    } catch (error) {
      logReminderDebug('renderer-reminder-failed', {
        scheduleId: schedule.id,
        message: error && error.message ? error.message : 'unknown'
      });
    }

    reminderFlashTimer = setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.flashFrame(false);
      }

      reminderFlashTimer = null;
    }, 8000);
  }

  let audioSequence = [];

  try {
    audioSequence = await buildReminderAudioSequence(schedule, leadMinutes);
  } catch (error) {
    logReminderDebug('audio-sequence-build-uncaught', {
      scheduleId: schedule.id,
      message: error && error.message ? error.message : 'unknown'
    });
    audioSequence = [];
  }

  if (audioSequence.length) {
    playReminderSequenceNative(audioSequence);
  } else {
    logReminderDebug('audio-sequence-empty-fallback', {
      scheduleId: schedule.id,
      title: schedule.title
    });
    playReminderAlarmFallback();
  }

  logReminderDebug('reminder-dispatch-complete', {
    scheduleId: schedule.id,
    title: schedule.title,
    leadMinutes,
    time: schedule.time,
    notificationShown,
    popupShown,
    rendererShown,
    audioPath: payload.audioPath,
    audioSequenceCount: audioSequence.length
  });

  return notificationShown || popupShown || rendererShown;
}

async function checkStudyReminders() {
  if (!appConfig || !Array.isArray(appConfig.studySchedule) || !appConfig.studySchedule.length) {
    logReminderDebug('check-skip-empty-schedule');
    return;
  }

  if (reminderCheckInFlight) {
    logReminderDebug('check-skip-inflight');
    return;
  }

  reminderCheckInFlight = true;

  try {
    const now = new Date();
    const todayKey = formatLocalDateKey(now);
    const leadMinutes = Array.isArray(appConfig.reminders && appConfig.reminders.leadMinutes)
      ? appConfig.reminders.leadMinutes
      : DEFAULT_REMINDER_LEAD_MINUTES;
    const todaySchedules = getTodaySchedules(now);

    logReminderDebug('check-start', {
      now: now.toISOString(),
      todayKey,
      scheduleCount: todaySchedules.length,
      leadMinutes
    });

    for (const schedule of todaySchedules) {
      if (!schedule.enabled) {
        continue;
      }

      const mark = getScheduleMark(schedule.id, todayKey);

      if (mark && mark.completedAt) {
        continue;
      }

      const scheduleStartTime = scheduleStartDateTimeForDate(schedule, now);

      if (!scheduleStartTime) {
        continue;
      }

      const reminderMarks = normalizeReminderMarks(mark);

      for (const leadMinute of leadMinutes) {
        const reminderKey = String(leadMinute);

        if (reminderMarks[reminderKey]) {
          continue;
        }

        const reminderTime = new Date(scheduleStartTime.getTime() - leadMinute * 60 * 1000);

        if (!reminderIsDue(now, reminderTime)) {
          continue;
        }

        logReminderDebug('check-due', {
          scheduleId: schedule.id,
          title: schedule.title,
          leadMinute,
          scheduleTime: schedule.time,
          reminderTime: reminderTime.toISOString(),
          now: now.toISOString()
        });

        const delivered = await pushReminderToWindow(schedule, leadMinute);

        if (!delivered) {
          logReminderDebug('check-delivery-failed', {
            scheduleId: schedule.id,
            title: schedule.title,
            leadMinute,
            scheduleTime: schedule.time
          });
          continue;
        }

        upsertScheduleMark(
          schedule,
          {
            remindedAt: now.toISOString(),
            reminderMarks: {
              ...reminderMarks,
              [reminderKey]: now.toISOString()
            }
          },
          now
        );
        return;
      }
    }

    logReminderDebug('check-no-trigger', {
      now: now.toISOString(),
      todayKey
    });
  } catch (error) {
    logReminderDebug('check-error', {
      message: error && error.message ? error.message : 'unknown',
      stack: error && error.stack ? error.stack : ''
    });
  } finally {
    reminderCheckInFlight = false;
  }
}

function startReminderPolling() {
  if (reminderPollTimer) {
    return;
  }

  void checkStudyReminders();

  const scheduleNextRun = () => {
    const delayMs = Math.max(250, 60000 - (Date.now() % 60000) + REMINDER_CHECK_ALIGNMENT_FUZZ_MS);
    reminderPollTimer = setTimeout(async () => {
      reminderPollTimer = null;

      try {
        await checkStudyReminders();
      } finally {
        scheduleNextRun();
      }
    }, delayMs);
  };

  scheduleNextRun();
}

function stopReminderPolling() {
  if (reminderPollTimer) {
    clearTimeout(reminderPollTimer);
    reminderPollTimer = null;
  }

  if (reminderAudioPrewarmTimer) {
    clearTimeout(reminderAudioPrewarmTimer);
    reminderAudioPrewarmTimer = null;
  }

  stopReminderAudioProcess();

  if (reminderFlashTimer) {
    clearTimeout(reminderFlashTimer);
    reminderFlashTimer = null;
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.flashFrame(false);
  }
}

async function syncRemoteStudySchedule() {
  if (!appConfig.remoteSchedule.enabled) {
    remoteScheduleStatus = createEmptyRemoteScheduleStatus();
    studentDeviceAccessStatus = createEmptyStudentDeviceAccessStatus();
    return false;
  }

  const syncSerial = ++remoteScheduleSyncSerial;
  const mutationSerialAtStart = studyDataMutationSerial;

  const headers = {
    Accept: 'application/json'
  };

  if (appConfig.remoteSchedule.authToken) {
    headers.Authorization = `Bearer ${appConfig.remoteSchedule.authToken}`;
  }

  const lastAttemptAt = new Date().toISOString();
  remoteScheduleStatus = {
    ...remoteScheduleStatus,
    enabled: true,
    lastAttemptAt,
    message: '正在从服务器同步课表。'
  };

  try {
    const fetchRemotePayload = async (options = {}) => {
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => {
        abortController.abort();
      }, 8000);
      try {
        return await fetchJson(appConfig.remoteSchedule.url, {
          ...options,
          signal: abortController.signal
        });
      } finally {
        clearTimeout(timeoutId);
      }
    };
    let payload;

    payload = await fetchRemotePayload({
      headers
    });
    if (!Array.isArray(payload) && (!payload || typeof payload !== 'object')) {
      throw new Error('服务器返回的课表格式不对。');
    }
    if (!Array.isArray(payload) && payload && typeof payload === 'object' && payload.error) {
      throw new Error(`服务器同步失败：${payload.error}`);
    }
    let controlSettings = normalizeControlSettings(appConfig.controlSettings);

    const controlSettingsToken =
      appConfig.remoteSchedule.studentWriteToken || appConfig.remoteSchedule.authToken;

    if (controlSettingsToken) {
      const protectedPayload = await fetchRemotePayload({
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${controlSettingsToken}`
        },
        body: JSON.stringify({
          action: 'getControlSettings'
        })
      });

      if (!protectedPayload || protectedPayload.error) {
        throw new Error(
          protectedPayload && protectedPayload.error
            ? `服务器控制设置同步失败：${protectedPayload.error}`
            : '服务器控制设置同步失败。'
        );
      }

      const syncedControlSettings = normalizeControlSettings(protectedPayload.controlSettings);

      if (syncedControlSettings.exitPasswordHash && syncedControlSettings.exitPasswordSalt) {
        controlSettings = syncedControlSettings;
      }
    }

    const normalizedState = normalizeStudyData(
      Array.isArray(payload)
        ? {
            items: payload,
            onlineClassrooms: appConfig.classrooms,
            contentLibraries: appConfig.libraries,
            learningTools: appConfig.learningTools,
            controlSettings
          }
        : {
            ...payload,
            controlSettings
          },
      appConfig.baseClassrooms || classroomDefinitions,
      appConfig.baseLibraries || libraryDefinitions,
      appConfig.baseLearningTools || learningToolDefinitions
    );

    if (syncSerial !== remoteScheduleSyncSerial || mutationSerialAtStart !== studyDataMutationSerial) {
      return false;
    }

    applyStudyData(normalizedState, 'remote');
    saveRemoteScheduleCache(normalizedState);
    void syncStudentDeviceAccessStatus();
    const mergedCount = normalizedState.parentItems.length + normalizedState.studentItems.length;
    remoteScheduleStatus = {
      enabled: true,
      source: 'remote',
      lastAttemptAt,
      lastSuccessAt: lastAttemptAt,
      message: mergedCount ? '服务器计划已经同步到本机。' : '服务器计划为空，已同步为空计划。'
    };
    return true;
  } catch (error) {
    if (syncSerial !== remoteScheduleSyncSerial) {
      return false;
    }

    remoteScheduleStatus = {
      ...remoteScheduleStatus,
      enabled: true,
      message: `服务器同步失败：${error.message || '未知错误'}`
    };
    return false;
  }
}

async function persistStudentStudySchedule(rawSchedule) {
  const normalizedStudentItems = normalizeStudySchedule(rawSchedule, classroomDefinitions, libraryDefinitions, {
    planScope: 'student',
    learningTools: learningToolDefinitions
  });

  if (!appConfig.remoteSchedule.enabled) {
    saveStructuredStudyData(
      {
        parentItems: appConfig.parentStudySchedule,
        studentItems: normalizedStudentItems,
        onlineClassrooms: appConfig.classrooms,
        contentLibraries: appConfig.libraries,
        learningTools: appConfig.learningTools
      },
      'local'
    );

    return currentStudyData();
  }

  const mutationSerial = bumpStudyDataMutation();
  const writeToken = appConfig.remoteSchedule.studentWriteToken || appConfig.remoteSchedule.authToken;

  if (!writeToken) {
    throw new Error('云端学生计划未配置可用的访问令牌。');
  }

  const accessStatus = await syncStudentDeviceAccessStatus({
    throwOnError: false
  });

  if (!canWriteStudentPlan(accessStatus)) {
    throw new Error(accessStatus.message || '已自动提交学生计划写入申请，等待家长在手机端批准。');
  }

  const requestBody = {
    action: 'saveStudentItems',
    items: serializeStudySchedule(normalizedStudentItems)
  };

  if (!appConfig.remoteSchedule.studentWriteToken) {
    Object.assign(requestBody, studentDeviceCredentialPayload());
  }

  const payload = await fetchJson(appConfig.remoteSchedule.url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${writeToken}`
    },
    body: JSON.stringify(requestBody)
  });

  if (!payload || payload.error) {
    if (payload && payload.error === 'device_not_approved') {
      const latestStatus = await syncStudentDeviceAccessStatus({
        throwOnError: false
      });
      throw new Error(latestStatus.message || '已自动提交学生计划写入申请，等待家长在手机端批准。');
    }

    throw new Error(payload && payload.error ? `学生计划保存失败：${payload.error}` : '学生计划保存失败。');
  }

  if (mutationSerial !== studyDataMutationSerial) {
    return currentStudyData();
  }

  const normalizedState = normalizeStudyData(
    payload,
    appConfig.baseClassrooms || classroomDefinitions,
    appConfig.baseLibraries || libraryDefinitions
  );
  applyStudyData(normalizedState, 'remote');
  saveRemoteScheduleCache(normalizedState);
  remoteScheduleStatus = {
    ...remoteScheduleStatus,
    enabled: true,
    source: 'remote',
    lastSuccessAt: new Date().toISOString(),
    message: '学生计划已经同步到服务器。'
  };
  studentDeviceAccessStatus = normalizeStudentDeviceAccessStatus({
    ...studentDeviceAccessStatus,
    mode: appConfig.remoteSchedule.studentWriteToken ? 'token' : studentDeviceAccessStatus.mode || 'approval',
    approved: true,
    message: appConfig.remoteSchedule.studentWriteToken
      ? '当前客户端已通过专用写入令牌授权。'
      : '当前客户端已获准修改学生计划。'
  });

  return currentStudyData();
}

function startRemoteSchedulePolling() {
  if (!appConfig.remoteSchedule.enabled || remoteSchedulePollTimer) {
    return;
  }

  const intervalMs = appConfig.remoteSchedule.refreshMinutes * 60 * 1000;
  remoteSchedulePollTimer = setInterval(() => {
    void syncRemoteStudySchedule();
  }, intervalMs);
}

function stopRemoteSchedulePolling() {
  if (remoteSchedulePollTimer) {
    clearInterval(remoteSchedulePollTimer);
    remoteSchedulePollTimer = null;
  }
}

function ensureNetdiskConfigured() {
  if (!appConfig.baiduNetdisk.clientId || !appConfig.baiduNetdisk.clientSecret) {
    throw createConfigError('请先在 config.json 的 baiduNetdisk 中填写 clientId 和 clientSecret。');
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload = null;

  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = null;
  }

  if (!response.ok && !payload) {
    throw new Error(`请求失败：${response.status}`);
  }

  if (!response.ok && payload && typeof payload === 'object') {
    return payload;
  }

  return payload;
}

async function refreshNetdiskToken() {
  ensureNetdiskConfigured();

  if (!netdiskState.refreshToken) {
    throw createNetdiskAuthError('请先连接百度网盘。');
  }

  const tokenUrl = new URL('https://openapi.baidu.com/oauth/2.0/token');
  tokenUrl.searchParams.set('grant_type', 'refresh_token');
  tokenUrl.searchParams.set('refresh_token', netdiskState.refreshToken);
  tokenUrl.searchParams.set('client_id', appConfig.baiduNetdisk.clientId);
  tokenUrl.searchParams.set('client_secret', appConfig.baiduNetdisk.clientSecret);

  const payload = await fetchJson(tokenUrl);

  if (!payload || payload.error) {
    clearNetdiskState();
    throw createNetdiskAuthError(
      `百度网盘授权已失效：${payload && payload.error_description ? payload.error_description : '刷新 token 失败。'}`
    );
  }

  updateNetdiskState(payload);
}

async function ensureNetdiskAccessToken(options = {}) {
  ensureNetdiskConfigured();
  const forceRefresh = Boolean(options.forceRefresh);

  if (!forceRefresh && netdiskState.accessToken && netdiskState.expiresAt > Date.now()) {
    return netdiskState.accessToken;
  }

  if (netdiskState.refreshToken) {
    await refreshNetdiskToken();
    return netdiskState.accessToken;
  }

  throw createNetdiskAuthError('请先连接百度网盘。');
}

async function invokeNetdiskApi(buildUrl) {
  let accessToken = await ensureNetdiskAccessToken();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const payload = await fetchJson(buildUrl(accessToken));

    if (payload && (typeof payload.errno !== 'number' || payload.errno === 0)) {
      return payload;
    }

    if (payload && AUTH_ERRNOS.has(payload.errno) && attempt === 0) {
      accessToken = await ensureNetdiskAccessToken({ forceRefresh: true });
      continue;
    }

    if (payload && AUTH_ERRNOS.has(payload.errno)) {
      clearNetdiskState();
      throw createNetdiskAuthError('百度网盘授权已失效，请重新连接。');
    }

    throw createNetdiskApiError(
      payload && payload.errmsg ? `百度网盘接口失败：${payload.errmsg}` : `百度网盘接口失败：errno=${payload ? payload.errno : 'unknown'}`,
      payload && payload.errno
    );
  }

  throw createNetdiskApiError('百度网盘接口调用失败。');
}

async function listNetdiskFolderEntries(folderPath) {
  const items = [];
  let start = 0;

  while (true) {
    const payload = await invokeNetdiskApi((accessToken) => {
      const url = new URL('https://pan.baidu.com/rest/2.0/xpan/file');
      url.searchParams.set('method', 'list');
      url.searchParams.set('access_token', accessToken);
      url.searchParams.set('dir', folderPath);
      url.searchParams.set('web', '1');
      url.searchParams.set('order', 'name');
      url.searchParams.set('desc', '0');
      url.searchParams.set('limit', '1000');
      url.searchParams.set('start', String(start));
      return url;
    });

    const page = Array.isArray(payload.list) ? payload.list : [];
    items.push(...page);

    if (!page.length || page.length < 1000 || payload.has_more !== 1) {
      break;
    }

    start += page.length;
  }

  return items;
}

function netdiskPathName(fullPath, fallback = '') {
  const normalized = normalizePrefix(fullPath);

  if (!normalized || normalized === '/') {
    return fallback || '/';
  }

  const parts = normalized.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : fallback || normalized;
}

function isSupportedVideoFileName(fileName) {
  return VIDEO_EXTENSIONS.has(path.extname(normalizePrefix(fileName)).toLowerCase());
}

function buildNetdiskVideoItems(library, rawItems) {
  return rawItems
    .filter((item) => Number(item.isdir) !== 1 && isSupportedVideoFileName(item.server_filename || item.path))
    .map((item) => ({
      id: `${library.id}-${item.fs_id}`,
      fsId: String(item.fs_id),
      title: normalizeTitle(item.server_filename || item.path || String(item.fs_id)),
      description: normalizePrefix(item.path) || normalizePrefix(item.server_filename),
      sourceUrl: `${internalServerOrigin}${INTERNAL_MEDIA_ROUTE}?libraryId=${encodeURIComponent(library.id)}&fsId=${encodeURIComponent(String(item.fs_id))}`
    }))
    .sort((left, right) => left.title.localeCompare(right.title, 'zh-CN', { numeric: true }));
}

async function buildNetdiskTreeNode(library, folderPath, options = {}) {
  const rawItems = await listNetdiskFolderEntries(folderPath);
  const folderItems = rawItems
    .filter((item) => Number(item.isdir) === 1)
    .sort((left, right) =>
      normalizeTitle(left.server_filename || left.path).localeCompare(
        normalizeTitle(right.server_filename || right.path),
        'zh-CN',
        { numeric: true }
      )
    );
  const files = buildNetdiskVideoItems(library, rawItems);
  const folders = folderItems.map((item) => {
    const childPath = normalizeNetdiskFolderPath(item.path || item.server_filename, folderPath);

    return {
      id: `folder:${childPath}`,
      name: netdiskPathName(childPath, library.title),
      path: childPath,
      folders: [],
      files: [],
      isLoaded: false
    };
  });

  return {
    id: `folder:${folderPath}`,
    name: options.isRoot ? library.title : netdiskPathName(folderPath, library.title),
    path: folderPath,
    folders,
    files,
    isLoaded: true
  };
}

function flattenTreeFiles(node, result = []) {
  if (!node || typeof node !== 'object') {
    return result;
  }

  if (Array.isArray(node.files)) {
    result.push(...node.files);
  }

  for (const child of Array.isArray(node.folders) ? node.folders : []) {
    flattenTreeFiles(child, result);
  }

  return result;
}

async function getNetdiskFileDlink(fsId) {
  const cached = netdiskDlinkCache.get(fsId);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.dlink;
  }

  const payload = await invokeNetdiskApi((accessToken) => {
    const url = new URL('https://pan.baidu.com/rest/2.0/xpan/multimedia');
    url.searchParams.set('method', 'filemetas');
    url.searchParams.set('access_token', accessToken);
    url.searchParams.set('dlink', '1');
    url.searchParams.set('fsids', JSON.stringify([Number(fsId)]));
    return url;
  });

  const dlink = payload && Array.isArray(payload.list) && payload.list[0] ? normalizePrefix(payload.list[0].dlink) : '';

  if (!dlink) {
    throw createNetdiskApiError('没有拿到百度网盘视频地址。');
  }

  netdiskDlinkCache.set(fsId, {
    dlink,
    expiresAt: Date.now() + 5 * 60 * 1000
  });

  return dlink;
}

function libraryStatus(kind, message) {
  return { kind, message };
}

async function buildLibraryModel(libraryId) {
  const library = resolveLibrary(libraryId);

  if (!library) {
    return {
      id: '',
      title: '媒体库',
      description: '没有找到这个媒体库。',
      sourceType: 'baiduNetdisk',
      providerLabel: '百度网盘',
      folderPath: '',
      authorizeLabel: '连接百度网盘',
      canAuthorize: true,
      status: libraryStatus('load_error', '没有找到这个媒体库。'),
      items: []
    };
  }

  try {
    ensureNetdiskConfigured();
    const tree = await buildNetdiskTreeNode(library, library.folderPath, { isRoot: true });
    const items = flattenTreeFiles(tree);

    return {
      id: library.id,
      title: library.title,
      description: library.description,
      sourceType: library.sourceType,
      providerLabel: '百度网盘',
      folderPath: library.folderPath,
      authorizeLabel: netdiskState.refreshToken ? '重新连接百度网盘' : '连接百度网盘',
      canAuthorize: true,
      tree,
      status: libraryStatus('ready', items.length ? '' : '这个目录里还没有可播放的视频。'),
      items
    };
  } catch (error) {
    const kind =
      error.name === 'NetdiskAuthError'
        ? 'needs_auth'
        : error.name === 'ConfigError'
          ? 'config_error'
          : 'load_error';

    return {
      id: library.id,
      title: library.title,
      description: library.description,
      sourceType: library.sourceType,
      providerLabel: '百度网盘',
      folderPath: library.folderPath,
      authorizeLabel: netdiskState.refreshToken ? '重新连接百度网盘' : '连接百度网盘',
      canAuthorize: true,
      tree: null,
      status: libraryStatus(kind, error.message || '媒体库加载失败。'),
      items: []
    };
  }
}

async function buildLibraryFolderModel(libraryId, folderPath) {
  const library = resolveLibrary(libraryId);

  if (!library) {
    throw createNetdiskApiError('没有找到这个媒体库。');
  }

  ensureNetdiskConfigured();
  return buildNetdiskTreeNode(library, normalizeNetdiskFolderPath(folderPath, library.folderPath));
}

function sendHtml(response, statusCode, html) {
  response.writeHead(statusCode, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(html);
}

function sendText(response, statusCode, text) {
  response.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(text);
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(payload));
}

function readRequestText(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    request.on('data', (chunk) => {
      chunks.push(Buffer.from(chunk));
    });
    request.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    request.on('error', reject);
  });
}

function isAuthorizedMobileRequest(requestUrl) {
  return normalizePrefix(requestUrl.searchParams.get('token')) === ensureMobileToken();
}

function mobileTargetOptions() {
  return [
    { id: '', label: '只提醒，不跳转' },
    ...classroomDefinitions.map((classroom) => ({
      id: classroom.id,
      label: classroom.title
    })),
    ...learningToolDefinitions.map((learningTool) => ({
      id: learningTool.id,
      label: learningTool.title
    })),
    ...nativeModuleTargetOptions(),
    ...libraryDefinitions.map((library) => ({
      id: library.id,
      label: library.title
    }))
  ];
}

function mobileConfigPagePath() {
  return path.join(__dirname, 'mobile-config.html');
}

function renderMobileConfigPage(requestUrl) {
  const template = fs.readFileSync(mobileConfigPagePath(), 'utf8');
  const bootstrap = {
    token: ensureMobileToken(),
    apiPath: INTERNAL_MOBILE_SCHEDULE_API_ROUTE,
    items: serializeStudySchedule(),
    targetOptions: mobileTargetOptions(),
    readOnly: Boolean(appConfig.remoteSchedule.enabled),
    readOnlyMessage: appConfig.remoteSchedule.enabled ? '当前已启用云端课表，这个本地页面只能看，不能改。' : ''
  };

  return template.replace(
    '__STUDYGATE_MOBILE_BOOTSTRAP__',
    JSON.stringify(bootstrap).replace(/</g, '\\u003c')
  );
}

async function handleMobileScheduleApi(request, response, requestUrl) {
  if (!isAuthorizedMobileRequest(requestUrl)) {
    sendJson(response, 403, {
      error: 'forbidden'
    });
    return;
  }

  if (request.method === 'GET') {
    sendJson(response, 200, {
      items: serializeStudySchedule(),
      targetOptions: mobileTargetOptions(),
      readOnly: Boolean(appConfig.remoteSchedule.enabled),
      readOnlyMessage: appConfig.remoteSchedule.enabled ? '当前已启用云端课表，这个本地页面只能看，不能改。' : ''
    });
    return;
  }

  if (request.method !== 'POST') {
    sendJson(response, 405, {
      error: 'method_not_allowed'
    });
    return;
  }

  if (appConfig.remoteSchedule.enabled) {
    sendJson(response, 409, {
      error: 'remote_enabled',
      message: '当前已启用云端课表，请在家长管理端修改。'
    });
    return;
  }

  const bodyText = await readRequestText(request);
  let payload;

  try {
    payload = bodyText ? JSON.parse(bodyText) : {};
  } catch {
    sendJson(response, 400, {
      error: 'bad_json'
    });
    return;
  }

  const items = payload && Array.isArray(payload.items) ? payload.items : [];
  const savedItems = saveStudySchedule(items);

  sendJson(response, 200, {
    success: true,
    items: savedItems.map((item) => ({
      id: item.id,
      enabled: item.enabled,
      mode: item.mode,
      title: item.title,
      target: item.targetId,
      time: item.time,
      weekdays: item.weekdays,
      specificDate: item.specificDate || '',
      exceptionDates: normalizeDateList(item.exceptionDates || []),
      message: item.message
    })),
    targetOptions: mobileTargetOptions()
  });
}

async function proxyNetdiskMedia(request, response, requestUrl) {
  const library = resolveLibrary(requestUrl.searchParams.get('libraryId'));
  const fsId = normalizePrefix(requestUrl.searchParams.get('fsId'));

  if (!library || !fsId) {
    sendText(response, 404, 'Not Found');
    return;
  }

  const accessToken = await ensureNetdiskAccessToken();
  const dlink = await getNetdiskFileDlink(fsId);
  const upstreamUrl = new URL(dlink);
  upstreamUrl.searchParams.set('access_token', accessToken);

  const headers = {};
  if (request.headers.range) {
    headers.Range = request.headers.range;
  }

  let upstreamResponse = null;
  let currentUpstreamUrl = upstreamUrl;

  for (let redirectCount = 0; redirectCount < 4; redirectCount += 1) {
    upstreamResponse = await fetch(currentUpstreamUrl, {
      method: request.method,
      headers,
      redirect: 'manual'
    });

    if (![301, 302, 303, 307, 308].includes(upstreamResponse.status)) {
      break;
    }

    const location = upstreamResponse.headers.get('location');

    if (!location) {
      break;
    }

    currentUpstreamUrl = new URL(location, currentUpstreamUrl);
  }

  response.statusCode = upstreamResponse.status;
  response.setHeader('Access-Control-Allow-Origin', '*');

  for (const headerName of [
    'accept-ranges',
    'cache-control',
    'content-length',
    'content-range',
    'content-type',
    'etag',
    'last-modified'
  ]) {
    const headerValue = upstreamResponse.headers.get(headerName);

    if (headerValue) {
      response.setHeader(headerName, headerValue);
    }
  }

  if (request.method === 'HEAD' || !upstreamResponse.body) {
    response.end();
    return;
  }

  Readable.fromWeb(upstreamResponse.body).pipe(response);
}

function closeAuthWindow() {
  if (authWindow && !authWindow.isDestroyed()) {
    authWindow.close();
  }

  authWindow = null;
}

function clearPendingNetdiskAuth() {
  if (pendingNetdiskAuth && pendingNetdiskAuth.timer) {
    clearTimeout(pendingNetdiskAuth.timer);
  }

  pendingNetdiskAuth = null;
}

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

function closeExitPasswordWindow() {
  if (exitPasswordWindow && !exitPasswordWindow.isDestroyed()) {
    exitPasswordWindow.close();
  }

  exitPasswordWindow = null;
}

function exitPasswordPagePath() {
  return path.join(__dirname, 'exit-verify.html');
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
  return {
    appTitle: appConfig ? appConfig.appTitle : 'StudyGate',
    hasExitPassword: hasConfiguredExitPassword()
  };
}

function requestAppQuit() {
  if (allowAppQuit) {
    app.quit();
    return;
  }

  if (!hasConfiguredExitPassword()) {
    allowAppQuit = true;
    app.quit();
    return;
  }

  if (focusExitPasswordWindow()) {
    return;
  }

  exitPasswordWindow = new BrowserWindow({
    title: '退出验证',
    width: 420,
    height: 360,
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
      preload: path.join(__dirname, 'preload.js'),
      partition: SESSION_PARTITION
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

function focusMainWindow() {
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

async function requestNetdiskDeviceCode() {
  ensureNetdiskConfigured();
  const url = new URL('https://openapi.baidu.com/oauth/2.0/device/code');
  url.searchParams.set('response_type', 'device_code');
  url.searchParams.set('client_id', appConfig.baiduNetdisk.clientId);
  url.searchParams.set('scope', NETDISK_DEVICE_SCOPE);

  const payload = await fetchJson(url, {
    headers: {
      'User-Agent': NETDISK_AUTH_USER_AGENT
    }
  });

  if (!payload || payload.error || !payload.device_code || !payload.user_code || !payload.qrcode_url) {
    throw createNetdiskAuthError(
      `百度网盘设备授权初始化失败：${payload && payload.error_description ? payload.error_description : '没有拿到设备码。'}`
    );
  }

  return {
    deviceCode: normalizePrefix(payload.device_code),
    userCode: normalizePrefix(payload.user_code),
    verificationUrl: normalizePrefix(payload.verification_url) || 'https://openapi.baidu.com/device',
    qrCodeUrl: normalizePrefix(payload.qrcode_url),
    expiresIn: Math.max(60, Number(payload.expires_in) || 300),
    intervalMs: Math.max(NETDISK_DEVICE_MIN_POLL_MS, (Number(payload.interval) || 5) * 1000)
  };
}

function renderNetdiskDeviceAuthHtml(deviceAuth) {
  const title = '连接百度网盘';
  const qrCodeUrl = deviceAuth.qrCodeUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const verificationUrl = deviceAuth.verificationUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const userCode = deviceAuth.userCode.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  return `<!doctype html>
  <html lang="zh-CN">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>${title}</title>
      <style>
        :root { color-scheme: dark; }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          min-height: 100vh;
          font-family: "Microsoft YaHei UI", "Segoe UI", sans-serif;
          background:
            radial-gradient(circle at top left, rgba(105, 216, 194, 0.18), transparent 24%),
            linear-gradient(145deg, #071019, #10131c 58%, #15111a);
          color: #eef7fb;
          display: grid;
          place-items: center;
          padding: 24px;
        }
        .shell {
          width: min(860px, 100%);
          display: grid;
          grid-template-columns: 320px minmax(0, 1fr);
          gap: 24px;
          padding: 24px;
          border-radius: 28px;
          background: rgba(10, 21, 30, 0.88);
          border: 1px solid rgba(255,255,255,0.08);
          box-shadow: 0 24px 80px rgba(0,0,0,0.28);
        }
        .qr-panel {
          display: grid;
          gap: 14px;
          justify-items: center;
        }
        .qr-box {
          width: 280px;
          height: 280px;
          border-radius: 22px;
          background: rgba(255,255,255,0.96);
          display: grid;
          place-items: center;
          padding: 14px;
        }
        .qr-box img {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }
        .content {
          display: grid;
          align-content: center;
          gap: 14px;
        }
        .eyebrow {
          margin: 0;
          color: #69d8c2;
          letter-spacing: 0.16em;
          font-size: 12px;
          text-transform: uppercase;
        }
        h1 {
          margin: 0;
          font-size: 34px;
        }
        p {
          margin: 0;
          color: #a6c0cf;
          line-height: 1.7;
        }
        .code {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 54px;
          padding: 0 18px;
          border-radius: 16px;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.08);
          font-size: 28px;
          font-weight: 700;
          letter-spacing: 0.12em;
        }
        .link {
          color: #f4bb64;
          word-break: break-all;
        }
        .hint {
          font-size: 13px;
        }
        @media (max-width: 760px) {
          .shell { grid-template-columns: 1fr; }
          .qr-box { width: min(72vw, 280px); height: min(72vw, 280px); }
        }
      </style>
    </head>
    <body>
      <main class="shell">
        <section class="qr-panel">
          <div class="qr-box">
            <img src="${qrCodeUrl}" alt="百度网盘授权二维码" />
          </div>
          <p class="hint">用手机百度 App、百度网盘 App 或微信扫码</p>
        </section>
        <section class="content">
          <p class="eyebrow">Baidu Netdisk</p>
          <h1>连接百度网盘</h1>
          <p>不跳系统浏览器。请直接用手机扫码授权，程序会自动完成连接。</p>
          <div class="code">${userCode}</div>
          <p>如果扫码不方便，也可以在手机浏览器打开：</p>
          <p class="link">${verificationUrl}</p>
          <p>然后输入上面的授权码。</p>
          <p class="hint">授权完成后，这个窗口会自动关闭。</p>
        </section>
      </main>
    </body>
  </html>`;
}

async function pollNetdiskDeviceAuthorization(deviceAuth, authToken) {
  const deadline = Date.now() + deviceAuth.expiresIn * 1000;
  let intervalMs = deviceAuth.intervalMs;

  while (Date.now() < deadline) {
    if (!pendingNetdiskAuth || pendingNetdiskAuth.token !== authToken) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));

    if (!pendingNetdiskAuth || pendingNetdiskAuth.token !== authToken) {
      return;
    }

    const url = new URL('https://openapi.baidu.com/oauth/2.0/token');
    url.searchParams.set('grant_type', 'device_token');
    url.searchParams.set('code', deviceAuth.deviceCode);
    url.searchParams.set('client_id', appConfig.baiduNetdisk.clientId);
    url.searchParams.set('client_secret', appConfig.baiduNetdisk.clientSecret);

    const payload = await fetchJson(url, {
      headers: {
        'User-Agent': NETDISK_AUTH_USER_AGENT
      }
    });

    if (payload && !payload.error && payload.access_token) {
      updateNetdiskState(payload);
      if (pendingNetdiskAuth && pendingNetdiskAuth.token === authToken) {
        const resolve = pendingNetdiskAuth.resolve;
        clearPendingNetdiskAuth();
        closeAuthWindow();
        resolve({ success: true });
      }
      return;
    }

    const errorCode = normalizePrefix(payload && payload.error);

    if (!errorCode || errorCode === 'authorization_pending') {
      continue;
    }

    if (errorCode === 'slow_down') {
      intervalMs += NETDISK_DEVICE_MIN_POLL_MS;
      continue;
    }

    if (pendingNetdiskAuth && pendingNetdiskAuth.token === authToken) {
      const reject = pendingNetdiskAuth.reject;
      clearPendingNetdiskAuth();
      closeAuthWindow();
      reject(
        createNetdiskAuthError(
          `百度网盘授权失败：${normalizePrefix(payload && payload.error_description) || errorCode}`
        )
      );
    }
    return;
  }

  if (pendingNetdiskAuth && pendingNetdiskAuth.token === authToken) {
    const reject = pendingNetdiskAuth.reject;
    clearPendingNetdiskAuth();
    closeAuthWindow();
    reject(createNetdiskAuthError('百度网盘授权超时，请重新扫码。'));
  }
}

async function authorizeNetdisk() {
  ensureNetdiskConfigured();

  if (pendingNetdiskAuth && pendingNetdiskAuth.promise) {
    return pendingNetdiskAuth.promise;
  }

  const deviceAuth = await requestNetdiskDeviceCode();
  const authToken = crypto.randomBytes(12).toString('hex');

  const authPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pendingNetdiskAuth || pendingNetdiskAuth.token !== authToken) {
        return;
      }

      clearPendingNetdiskAuth();
      closeAuthWindow();
      reject(createNetdiskAuthError('百度网盘授权超时，请重试。'));
    }, 5 * 60 * 1000);

    pendingNetdiskAuth = {
      token: authToken,
      resolve,
      reject,
      timer
    };
  });

  pendingNetdiskAuth.promise = authPromise;
  authWindow = new BrowserWindow({
    title: '连接百度网盘',
    width: 920,
    height: 640,
    show: true,
    frame: true,
    autoHideMenuBar: true,
    backgroundColor: '#0f172a',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: false,
      spellcheck: false
    }
  });

  authWindow.removeMenu();
  authWindow.once('ready-to-show', () => {
    if (authWindow && !authWindow.isDestroyed()) {
      authWindow.focus();
    }
  });

  authWindow.on('closed', () => {
    authWindow = null;

    if (pendingNetdiskAuth && pendingNetdiskAuth.token === authToken) {
      const reject = pendingNetdiskAuth.reject;
      clearPendingNetdiskAuth();
      reject(createNetdiskAuthError('已取消百度网盘授权。'));
    }
  });

  try {
    await authWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderNetdiskDeviceAuthHtml(deviceAuth))}`);
  } catch (error) {
    if (pendingNetdiskAuth && pendingNetdiskAuth.token === authToken) {
      const reject = pendingNetdiskAuth.reject;
      clearPendingNetdiskAuth();
      closeAuthWindow();
      reject(createNetdiskAuthError(error && error.message ? error.message : '百度网盘授权窗口打开失败。'));
    }

    return authPromise;
  }

  void pollNetdiskDeviceAuthorization(deviceAuth, authToken);

  return authPromise;
}

async function handleOAuthCallback(response, requestUrl) {
  void requestUrl;
  sendHtml(
    response,
    410,
    '<h1>这个地址已停用</h1><p>当前版本改成了百度设备码授权，不再使用浏览器 OAuth 回调地址。请回到程序里重新点“连接百度网盘”。</p>'
  );
}

async function handleInternalServerRequest(request, response) {
  const requestUrl = new URL(request.url, internalServerOrigin);

  try {
    if (requestUrl.pathname === INTERNAL_OAUTH_CALLBACK_ROUTE) {
      await handleOAuthCallback(response, requestUrl);
      return;
    }

    if (requestUrl.pathname === INTERNAL_MEDIA_ROUTE) {
      await proxyNetdiskMedia(request, response, requestUrl);
      return;
    }

    if (requestUrl.pathname === INTERNAL_MOBILE_CONFIG_ROUTE) {
      if (!isAuthorizedMobileRequest(requestUrl)) {
        sendHtml(response, 403, '<h1>禁止访问</h1><p>请从程序首页复制手机配置链接。</p>');
        return;
      }

      sendHtml(response, 200, renderMobileConfigPage(requestUrl));
      return;
    }

    if (requestUrl.pathname === INTERNAL_MOBILE_SCHEDULE_API_ROUTE) {
      await handleMobileScheduleApi(request, response, requestUrl);
      return;
    }

    sendText(response, 404, 'Not Found');
  } catch (error) {
    sendText(response, 500, error.message || 'Internal Error');
  }
}

async function startInternalServer() {
  if (internalServer) {
    return;
  }

  internalServer = http.createServer((request, response) => {
    void handleInternalServerRequest(request, response);
  });

  await new Promise((resolve, reject) => {
    const onError = (error) => {
      if (error && error.code === 'EADDRINUSE') {
        reject(createConfigError(`内部服务端口 ${INTERNAL_SERVER_PORT} 已被占用。请关闭占用该端口的程序后重试。`));
        return;
      }

      reject(error);
    };

    internalServer.once('error', onError);
    internalServer.listen(INTERNAL_SERVER_PORT, '0.0.0.0', () => {
      internalServer.off('error', onError);
      resolve();
    });
  });

  const address = internalServer.address();
  internalServerOrigin = `http://127.0.0.1:${address.port}`;
}

function stopInternalServer() {
  if (internalServer) {
    internalServer.close();
    internalServer = null;
    internalServerOrigin = '';
  }
}

function createMainWindow() {
  logNavigationDebug('create-main-window');
  mainWindow = new BrowserWindow({
    title: appConfig.appTitle,
    width: 1440,
    height: 960,
    show: false,
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
      preload: path.join(__dirname, 'preload.js'),
      partition: SESSION_PARTITION
    }
  });

  mainWindow.removeMenu();
  mainWindow.setMenuBarVisibility(false);
  mainWindow.setAlwaysOnTop(appConfig.alwaysOnTop, 'screen-saver');
  mainWindow.webContents.setUserAgent(MAIN_WINDOW_USER_AGENT);
  mainWindow.webContents.setZoomFactor(currentWindowZoomFactor);
  mainWindow.on('closed', () => {
    logNavigationDebug('main-window-closed');
    mainWindow = null;
  });
  mainWindow.on('close', (event) => {
    if (allowAppQuit) {
      return;
    }

    event.preventDefault();
    requestAppQuit();
  });
  mainWindow.on('enter-full-screen', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:fullscreen-changed', {
        fullscreen: true
      });
    }
  });
  mainWindow.on('leave-full-screen', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:fullscreen-changed', {
        fullscreen: false
      });
    }
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
    logNavigationDebug('did-finish-load', {
      url: mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents.getURL() : ''
    });
    void applyCompatibilityPatch();
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

  loadHomePage('create-main-window');
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

function registerIpc() {
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
  ipcMain.handle('shell:reset-course-site-state', async () => clearCourseSiteState());
  ipcMain.handle('shell:get-home-model', async (_event, options = {}) => {
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
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { fullscreen: false };
    }

    const nextState = !mainWindow.isFullScreen();
    mainWindow.setFullScreen(nextState);
    return { fullscreen: nextState };
  });
  ipcMain.handle('shell:get-window-fullscreen', async () => ({
    fullscreen: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isFullScreen())
  }));
  ipcMain.handle('shell:get-window-zoom', async () => ({
    zoomFactor: currentWindowZoomFactor
  }));
  ipcMain.handle('shell:adjust-window-zoom', async (_event, payload = {}) => {
    const delta = Number(payload.delta) || 0;
    const nextZoom = applyWindowZoomFactor(currentWindowZoomFactor + delta);
    return {
      zoomFactor: nextZoom
    };
  });
  ipcMain.handle('shell:reset-window-zoom', async () => ({
    zoomFactor: applyWindowZoomFactor(DEFAULT_UI_ZOOM_FACTOR)
  }));
  ipcMain.handle('shell:navigate', async (_event, target) => ({
    success: navigateMainWindow(target)
  }));
  ipcMain.handle('shell:get-exit-verification-model', async () => exitVerificationModel());
  ipcMain.handle('shell:submit-exit-password', async (_event, payload = {}) => {
    const password = typeof payload.password === 'string' ? payload.password : '';

    if (!hasConfiguredExitPassword()) {
      allowAppQuit = true;
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

    allowAppQuit = true;
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

function showStartupError(error) {
  dialog.showErrorBox('启动失败', error.message);
}

if (gotSingleInstanceLock) {
  app.whenReady().then(async () => {
    try {
      appConfig = loadConfig();
      app.setAppUserModelId('StudyGate');
      rebuildLibraryIndex();
      configureAutoLaunch();
      loadPersistedStudySchedule();
      loadRemoteScheduleCache();
      loadNetdiskState();
      loadOriginStorageState();
      loadSiteCredentialState();
      loadStudyToolsState();
      scheduleReminderAudioPrewarm(50);
      await startInternalServer();
      app.setName(appConfig.appTitle);
      configureSessionGuards();
      registerIpc();
      await restoreSessionState();
      await syncRemoteStudySchedule();
      await syncStudentDeviceAccessStatus({
        throwOnError: false
      });
      startRemoteSchedulePolling();
      createMainWindow();
      startReminderPolling();
    } catch (error) {
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

  if (sessionPersistTimer) {
    clearTimeout(sessionPersistTimer);
    sessionPersistTimer = null;
  }

  clearPendingNetdiskAuth();
  closeExitPasswordWindow();
  stopReminderPolling();
  stopRemoteSchedulePolling();
  stopInternalServer();
  void persistSessionState();
});
