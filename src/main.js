'use strict';

const { app, BrowserWindow, dialog, ipcMain, session } = require('electron');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { fileURLToPath, pathToFileURL } = require('url');

const CONFIG_FILE = 'config.json';
const EMBEDDED_CONFIG_FILE = 'embedded-config.json';
const SESSION_STATE_FILE = 'session-state.json';
const ORIGIN_STORAGE_STATE_FILE = 'origin-storage-state.json';
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
const REMINDER_POLL_INTERVAL_MS = 30 * 1000;
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
const REMOTE_SCHEDULE_DEFAULT_REFRESH_MINUTES = 3;
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
let appConfig = null;
let libraryDefinitions = [];
let libraryIndex = new Map();
let sessionPersistTimer = null;
let sessionPersistPromise = Promise.resolve();
let internalServer = null;
let internalServerOrigin = '';
let pendingNetdiskAuth = null;
let netdiskState = createEmptyNetdiskState();
let netdiskDlinkCache = new Map();
let originStorageState = { origins: {} };
let studyToolsState = createEmptyStudyToolsState();
let reminderPollTimer = null;
let reminderFlashTimer = null;
let reminderCheckInFlight = false;
let reminderAudioBuilds = new Map();
let remoteSchedulePollTimer = null;
let remoteScheduleStatus = createEmptyRemoteScheduleStatus();
let remoteScheduleSyncSerial = 0;
let studyDataMutationSerial = 0;

app.setPath('userData', STABLE_USER_DATA_DIR);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-features', 'Translate,msSmartScreenProtection');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
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
    mobileToken: crypto.randomBytes(12).toString('hex')
  };
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

function normalizeStudySchedule(rawSchedule, libraries, options = {}) {
  if (!Array.isArray(rawSchedule) || !rawSchedule.length) {
    return [];
  }

  const planScope = normalizePlanScope(options.planScope, 'parent');
  const libraryIds = new Set(libraries.map((library) => library.id));
  const seenIds = new Set();
  const schedule = [];

  for (let index = 0; index < rawSchedule.length; index += 1) {
    const item = rawSchedule[index] || {};
    const id = normalizeScopedScheduleId(item.id, `schedule-${index + 1}`, planScope);

    if (seenIds.has(id)) {
      continue;
    }

    const candidateTargetId = normalizeScheduleTargetId(item.target || item.targetId);
    const targetId =
      candidateTargetId === 'english-course' || libraryIds.has(candidateTargetId) ? candidateTargetId : '';
    const title =
      normalizePrefix(item.title) ||
      (targetId === 'english-course' ? '说课英语' : targetId ? resolveLibraryTitle(libraries, targetId) : '');

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

function resolveLibraryTitle(libraries, libraryId) {
  const library = libraries.find((item) => item.id === libraryId);
  return library ? library.title : '学习内容';
}

function normalizeLibraries(rawLibraries, options = {}) {
  const source =
    Array.isArray(rawLibraries)
      ? rawLibraries
      : options.fallbackToDefault === false
        ? []
        : defaultLibraries();
  const seenIds = new Set();
  const libraries = [];

  for (let index = 0; index < source.length; index += 1) {
    const item = source[index] || {};
    const fallbackId = `library-${index + 1}`;
    const id = normalizeLibraryId(item.id, fallbackId);

    if (seenIds.has(id)) {
      continue;
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

function normalizeStudyData(rawState, fallbackLibraries = []) {
  const fallbackLibraryList = Array.isArray(fallbackLibraries) && fallbackLibraries.length ? fallbackLibraries : defaultLibraries();
  const source = rawState && typeof rawState === 'object' ? rawState : {};
  const hasExplicitLibraries =
    Array.isArray(source.contentLibraries) || Array.isArray(source.libraries);
  const rawLibraries = Array.isArray(source.contentLibraries)
    ? source.contentLibraries
    : Array.isArray(source.libraries)
      ? source.libraries
      : fallbackLibraryList;
  const libraries = normalizeLibraries(rawLibraries, {
    fallbackToDefault: !hasExplicitLibraries
  });
  const rawParentItems = Array.isArray(rawState)
    ? rawState
    : Array.isArray(source.parentItems)
      ? source.parentItems
      : Array.isArray(source.items)
        ? source.items
        : [];
  const rawStudentItems = Array.isArray(source.studentItems) ? source.studentItems : [];
  const parentItems = normalizeStudySchedule(rawParentItems, libraries, {
    planScope: 'parent'
  });
  const studentItems = normalizeStudySchedule(rawStudentItems, libraries, {
    planScope: 'student'
  });

  return {
    parentItems,
    studentItems,
    contentLibraries: libraries
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

  const startUrl = normalizePrefix(rawConfig.startUrl);
  const startUrlObject = parseUrl(startUrl);

  if (!startUrlObject || !['http:', 'https:'].includes(startUrlObject.protocol)) {
    throw createConfigError('config.json 中的 startUrl 必须是有效的 http/https 地址。');
  }

  const topLevelPrefixes = dedupe(
    (Array.isArray(rawConfig.allowedTopLevelUrlPrefixes) ? rawConfig.allowedTopLevelUrlPrefixes : [startUrl])
      .map(normalizePrefix)
      .filter(Boolean)
  );

  if (!topLevelPrefixes.length) {
    throw createConfigError('至少需要一个 allowedTopLevelUrlPrefixes 项。');
  }

  if (!topLevelPrefixes.some((prefix) => startUrl.startsWith(prefix))) {
    throw createConfigError(
      `startUrl (${startUrl}) 必须包含在 allowedTopLevelUrlPrefixes 中，否则启动时会被自己拦截。`
    );
  }

  const allowedHostnames = dedupe(
    (Array.isArray(rawConfig.allowedResourceHostnames)
      ? rawConfig.allowedResourceHostnames
      : [startUrlObject.hostname])
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
  const libraries = normalizeLibraries(rawConfig.contentLibraries);
  const parentStudySchedule = normalizeStudySchedule(rawConfig.studySchedule, libraries, {
    planScope: 'parent'
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
    parentStudySchedule,
    studentStudySchedule: [],
    studySchedule: mergeStudySchedules(parentStudySchedule, [])
  };
}

function rebuildLibraryIndex() {
  libraryDefinitions = appConfig.libraries;
  libraryIndex = new Map(libraryDefinitions.map((library) => [library.id, library]));
}

function resolveLibrary(libraryId) {
  if (libraryId && libraryIndex.has(libraryId)) {
    return libraryIndex.get(libraryId);
  }

  return libraryDefinitions[0] || null;
}

function matchesPrefix(url, prefixes) {
  return prefixes.some((prefix) => url.startsWith(prefix));
}

function sessionStatePath() {
  return path.join(appConfig.stateDir, SESSION_STATE_FILE);
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
  return matchesPrefix(url, appConfig.topLevelPrefixes);
}

function storageOriginKey(value) {
  const parsed = parseUrl(value);

  if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
    return '';
  }

  return parsed.origin;
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
  if (isAllowedTopLevelDestination(targetUrl)) {
    return;
  }

  event.preventDefault();
  logBlockedRequest({ resourceType: 'navigation', url: targetUrl }, 'BLOCK_NAV');
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

function loadHomePage() {
  mainWindow.loadFile(internalPagePath('home'));
}

function loadLibraryPage(libraryId) {
  const library = resolveLibrary(libraryId);

  if (!library) {
    loadHomePage();
    return;
  }

  mainWindow.loadFile(internalPagePath('library'), {
    query: {
      library: library.id
    }
  });
}

function loadStudentPlanPage() {
  mainWindow.loadFile(internalPagePath('studentPlan'));
}

function navigateMainWindow(target) {
  const normalizedTarget = normalizePrefix(target);

  if (!normalizedTarget || !mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  if (normalizedTarget === 'internal:home') {
    loadHomePage();
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

  if (normalizedTarget.startsWith('internal:library:')) {
    loadLibraryPage(normalizedTarget.slice('internal:library:'.length));
    return true;
  }

  if (!isAllowedTopLevel(normalizedTarget)) {
    logBlockedRequest({ resourceType: 'navigation', url: normalizedTarget }, 'BLOCK_NAV');
    return false;
  }

  mainWindow.loadURL(normalizedTarget);
  return true;
}

function launchStudyEntry(target, options = {}) {
  const normalizedTarget = normalizePrefix(target);
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

  const hostname = parsed.hostname.toLowerCase();
  const isCoursePage = hostname.endsWith('talk915.com');
  const isClassroomPage =
    hostname.endsWith('chindle.com') ||
    hostname.endsWith('keyclass.cn') ||
    hostname.endsWith('xuedianyun.com');

  model.crumbs.push({ label: '首页', target: 'internal:home', current: false });

  if (isCoursePage) {
    model.crumbs.push({ label: '说课英语', target: appConfig.startUrl, current: true });
    return model;
  }

  model.crumbs.push({ label: '说课英语', target: appConfig.startUrl, current: false });
  model.crumbs.push({
    label: isClassroomPage ? '在线课堂' : '当前页面',
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
      sessionStorage: snapshot && snapshot.sessionStorage && typeof snapshot.sessionStorage === 'object' ? snapshot.sessionStorage : {},
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
    sessionStorage: snapshot && snapshot.sessionStorage && typeof snapshot.sessionStorage === 'object' ? snapshot.sessionStorage : {}
  };
}

function setOriginStorageSnapshot(payload = {}) {
  const origin = storageOriginKey(payload.url || payload.origin);

  if (!origin || !shouldPersistOriginStorage(payload.url || origin)) {
    return false;
  }

  originStorageState.origins[origin] = {
    localStorage: payload.localStorage && typeof payload.localStorage === 'object' ? payload.localStorage : {},
    sessionStorage: payload.sessionStorage && typeof payload.sessionStorage === 'object' ? payload.sessionStorage : {},
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
  const contentLibraries = Array.isArray(state.contentLibraries) ? state.contentLibraries : appConfig.libraries;

  return {
    parentItems: serializeStudySchedule(parentItems),
    studentItems: serializeStudySchedule(studentItems),
    contentLibraries: serializeLibraries(contentLibraries),
    items: serializeStudySchedule(mergeStudySchedules(parentItems, studentItems))
  };
}

function currentStudyData() {
  return {
    parentItems: appConfig.parentStudySchedule || [],
    studentItems: appConfig.studentStudySchedule || [],
    contentLibraries: appConfig.libraries || []
  };
}

function bumpStudyDataMutation() {
  studyDataMutationSerial += 1;
  return studyDataMutationSerial;
}

function applyStudyData(state, source = 'local') {
  const normalized = normalizeStudyData(state, appConfig.baseLibraries || appConfig.libraries);
  appConfig.libraries = normalized.contentLibraries;
  rebuildLibraryIndex();
  appConfig.parentStudySchedule = normalized.parentItems;
  appConfig.studentStudySchedule = normalized.studentItems;
  appConfig.studySchedule = mergeStudySchedules(normalized.parentItems, normalized.studentItems);

  if (source === 'remote') {
    remoteScheduleStatus.source = 'remote';
  }
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

function saveStudySchedule(rawSchedule) {
  const normalizedParentItems = normalizeStudySchedule(rawSchedule, libraryDefinitions, {
    planScope: 'parent'
  });
  const savedState = saveStructuredStudyData(
    {
      parentItems: normalizedParentItems,
      studentItems: appConfig.studentStudySchedule,
      contentLibraries: appConfig.libraries
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
    const normalizedState = normalizeStudyData(rawState, appConfig.baseLibraries || libraryDefinitions);
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
          contentLibraries: appConfig.libraries
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
      mobileToken: normalizePrefix(rawState.mobileToken) || crypto.randomBytes(12).toString('hex')
    };
  } catch {
    studyToolsState = createEmptyStudyToolsState();
  }
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
  fs.writeFileSync(studyToolsStatePath(), JSON.stringify(studyToolsState, null, 2), 'utf8');
}

function studyScheduleOccurrenceKey(scheduleId, dateKey = formatLocalDateKey()) {
  return `${scheduleId}:${dateKey}`;
}

function scheduleMessage(schedule) {
  return schedule.message || `到${schedule.title}时间了。`;
}

function resolveStudyTargetById(targetId) {
  if (targetId === 'english-course') {
    return {
      target: appConfig.startUrl,
      libraryId: '',
      libraryTitle: '',
      entryLabel: '进入课程'
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
      detail: `已于 ${formatDisplayTime(mark.completedAt)} 进入。`
    };
  }

  if (formatLocalTime(now) >= schedule.time) {
    return {
      code: 'pending',
      label: '待完成',
      detail: '已到上课时间，进入对应入口后会记为完成。'
    };
  }

  return {
    code: 'upcoming',
    label: '未开始',
    detail: '还没到上课时间。'
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

function buildStudentPlanResponse(options = {}) {
  return {
    model: buildStudentPlanModel(options),
    studentItems: serializeStudySchedule(appConfig.studentStudySchedule || [])
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
      resolve(false);
    });

    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
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

async function synthesizeReminderSegmentWave(segmentText, cacheDirectory) {
  const normalizedText = normalizePrefix(segmentText);

  if (!normalizedText) {
    return null;
  }

  const segmentCachePath = path.join(cacheDirectory, `segment-${createReminderSegmentCacheKey(normalizedText)}.wav`);

  if (!fs.existsSync(segmentCachePath)) {
    const built = await runPiperToWave(normalizedText, segmentCachePath);

    if (!built) {
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
    return Promise.resolve('');
  }

  const executablePath = bundledPiperExecutablePath();
  const modelPath = bundledPiperModelPath();
  const modelConfigPath = bundledPiperModelConfigPath();

  if (!fs.existsSync(executablePath) || !fs.existsSync(modelPath) || !fs.existsSync(modelConfigPath)) {
    return Promise.resolve('');
  }

  const cacheDirectory = reminderAudioCacheDirPath();
  const cacheKey = createReminderAudioCacheKey(normalizedSegments, repeatCount);
  const outputPath = path.join(cacheDirectory, `${cacheKey}.wav`);

  if (fs.existsSync(outputPath)) {
    return Promise.resolve(pathToFileURL(outputPath).href);
  }

  if (reminderAudioBuilds.has(cacheKey)) {
    return reminderAudioBuilds.get(cacheKey);
  }

  const buildPromise = (async () => {
    fs.mkdirSync(cacheDirectory, { recursive: true });
    pruneReminderAudioCache(cacheDirectory);

    const segmentWaves = [];

    for (const segmentText of normalizedSegments) {
      const wave = await synthesizeReminderSegmentWave(segmentText, cacheDirectory);

      if (!wave) {
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
      return '';
    }

    const segmentPause = createSilenceDataBuffer(format, REMINDER_SEGMENT_PAUSE_MS);
    const repeatPause = createSilenceDataBuffer(format, REMINDER_REPEAT_PAUSE_MS);
    const chunks = [];
    const normalizedRepeatCount = normalizeRepeatCount(repeatCount);

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
    return pathToFileURL(outputPath).href;
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
  return deltaMs >= 0 && deltaMs < REMINDER_POLL_INTERVAL_MS;
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

async function buildReminderPayload(schedule, leadMinutes) {
  const offsetLabel = leadMinutes > 0 ? `提前${leadMinutes}分钟` : '到点提醒';
  const speechText = buildReminderSpeechText(schedule, leadMinutes);
  const speechSegments = buildReminderSpeechSegments(schedule, leadMinutes);
  const repeatCount = 3;

  return {
    id: schedule.id,
    time: `${offsetLabel} · ${schedule.time}`,
    title: schedule.title,
    message: speechText,
    speechText,
    repeatCount,
    audioUrl: await synthesizeReminderAudioWithPiper(speechSegments, repeatCount)
  };
}

async function pushReminderToWindow(schedule, leadMinutes) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (reminderFlashTimer) {
    clearTimeout(reminderFlashTimer);
    reminderFlashTimer = null;
  }

  mainWindow.flashFrame(true);
  mainWindow.webContents.send('shell:study-reminder', await buildReminderPayload(schedule, leadMinutes));

  reminderFlashTimer = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.flashFrame(false);
    }

    reminderFlashTimer = null;
  }, 8000);
}

async function checkStudyReminders() {
  if (!appConfig || !Array.isArray(appConfig.studySchedule) || !appConfig.studySchedule.length) {
    return;
  }

  if (reminderCheckInFlight) {
    return;
  }

  reminderCheckInFlight = true;

  try {
    const now = new Date();
    const todayKey = formatLocalDateKey(now);
    const leadMinutes = Array.isArray(appConfig.reminders && appConfig.reminders.leadMinutes)
      ? appConfig.reminders.leadMinutes
      : DEFAULT_REMINDER_LEAD_MINUTES;

    for (const schedule of getTodaySchedules(now)) {
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
        await pushReminderToWindow(schedule, leadMinute);
        return;
      }
    }
  } finally {
    reminderCheckInFlight = false;
  }
}

function startReminderPolling() {
  if (reminderPollTimer) {
    return;
  }

  void checkStudyReminders();
  reminderPollTimer = setInterval(() => {
    void checkStudyReminders();
  }, REMINDER_POLL_INTERVAL_MS);
}

function stopReminderPolling() {
  if (reminderPollTimer) {
    clearInterval(reminderPollTimer);
    reminderPollTimer = null;
  }

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
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, 8000);
    let payload;

    try {
      payload = await fetchJson(appConfig.remoteSchedule.url, {
        headers,
        signal: abortController.signal
      });
    } finally {
      clearTimeout(timeoutId);
    }
    if (!Array.isArray(payload) && (!payload || typeof payload !== 'object')) {
      throw new Error('服务器返回的课表格式不对。');
    }
    if (!Array.isArray(payload) && payload && typeof payload === 'object' && payload.error) {
      throw new Error(`服务器同步失败：${payload.error}`);
    }

    const normalizedState = normalizeStudyData(payload, appConfig.baseLibraries || libraryDefinitions);

    if (syncSerial !== remoteScheduleSyncSerial || mutationSerialAtStart !== studyDataMutationSerial) {
      return false;
    }

    applyStudyData(normalizedState, 'remote');
    saveRemoteScheduleCache(normalizedState);
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
  const normalizedStudentItems = normalizeStudySchedule(rawSchedule, libraryDefinitions, {
    planScope: 'student'
  });

  if (!appConfig.remoteSchedule.enabled) {
    saveStructuredStudyData(
      {
        parentItems: appConfig.parentStudySchedule,
        studentItems: normalizedStudentItems,
        contentLibraries: appConfig.libraries
      },
      'local'
    );

    return currentStudyData();
  }

  const mutationSerial = bumpStudyDataMutation();

  const writeToken = appConfig.remoteSchedule.studentWriteToken;

  if (!writeToken) {
    throw new Error('没有配置 remoteSchedule.studentWriteToken。');
  }

  const payload = await fetchJson(appConfig.remoteSchedule.url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${writeToken}`
    },
    body: JSON.stringify({
      action: 'saveStudentItems',
      items: serializeStudySchedule(normalizedStudentItems)
    })
  });

  if (!payload || payload.error) {
    throw new Error(payload && payload.error ? `学生计划保存失败：${payload.error}` : '学生计划保存失败。');
  }

  if (mutationSerial !== studyDataMutationSerial) {
    return currentStudyData();
  }

  const normalizedState = normalizeStudyData(payload, appConfig.baseLibraries || libraryDefinitions);
  applyStudyData(normalizedState, 'remote');
  saveRemoteScheduleCache(normalizedState);
  remoteScheduleStatus = {
    ...remoteScheduleStatus,
    enabled: true,
    source: 'remote',
    lastSuccessAt: new Date().toISOString(),
    message: '学生计划已经同步到服务器。'
  };

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
    { id: 'english-course', label: '说课英语' },
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
    targetOptions: mobileTargetOptions()
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
      targetOptions: mobileTargetOptions()
    });
    return;
  }

  if (request.method !== 'POST') {
    sendJson(response, 405, {
      error: 'method_not_allowed'
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
      app.quit();
    }
  });

  mainWindow.webContents.on('will-navigate', blockNavigation);
  mainWindow.webContents.on('will-redirect', blockNavigation);
  mainWindow.webContents.on('did-finish-load', () => {
    void applyCompatibilityPatch();
    scheduleSessionPersist();
  });
  mainWindow.webContents.on('did-navigate', () => {
    scheduleSessionPersist();
  });
  mainWindow.webContents.on('did-navigate-in-page', () => {
    scheduleSessionPersist();
  });
  mainWindow.webContents.on('context-menu', (event) => event.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedTopLevel(url)) {
      setImmediate(() => {
        navigateMainWindow(url);
      });

      return { action: 'deny' };
    }

    logBlockedRequest({ resourceType: 'window-open', url }, 'BLOCK_POPUP');
    return { action: 'deny' };
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  loadHomePage();
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
  ipcMain.handle('shell:get-home-model', async () => {
    const todaySchedule = buildStudyScheduleModel();
    const calendarSchedule = buildStudyCalendarModel();

    return {
      appTitle: appConfig.appTitle,
      todaySchedule,
      calendarSchedule,
      cards: [
        {
          id: 'english-course',
          title: '说课英语',
          tone: 'amber',
          badge: '在线课堂',
          target: appConfig.startUrl,
          scheduleTargetId: 'english-course',
          libraryId: ''
        },
        ...libraryDefinitions.map((library) => ({
          id: library.id,
          title: library.title,
          tone: library.tone,
          badge: '百度网盘',
          target: libraryTarget(library.id),
          scheduleTargetId: library.id,
          libraryId: library.id
        }))
      ]
    };
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
    markScheduleCompletedForToday(
      {
        scheduleId: normalizePrefix(payload.scheduleId)
      },
      new Date()
    );

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
  ipcMain.handle('shell:navigate', async (_event, target) => ({
    success: navigateMainWindow(target)
  }));
}

function showStartupError(error) {
  dialog.showErrorBox('启动失败', error.message);
}

app.whenReady().then(async () => {
  try {
    appConfig = loadConfig();
    rebuildLibraryIndex();
    loadPersistedStudySchedule();
    loadRemoteScheduleCache();
    loadNetdiskState();
    loadOriginStorageState();
    loadStudyToolsState();
    await startInternalServer();
    app.setName(appConfig.appTitle);
    configureSessionGuards();
    registerIpc();
    await restoreSessionState();
    await syncRemoteStudySchedule();
    startRemoteSchedulePolling();
    createMainWindow();
    startReminderPolling();
  } catch (error) {
    showStartupError(error);
    app.quit();
  }
});

app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  if (sessionPersistTimer) {
    clearTimeout(sessionPersistTimer);
    sessionPersistTimer = null;
  }

  clearPendingNetdiskAuth();
  stopReminderPolling();
  stopRemoteSchedulePolling();
  stopInternalServer();
  void persistSessionState();
});
