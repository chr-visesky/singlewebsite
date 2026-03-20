'use strict';

const crypto = require('crypto');
const path = require('path');
const { normalizeLearningTools, resolveLearningToolTitle: resolveLearningToolTitleFromList } = require('./learning-tools');
const { listNativeModules, resolveNativeModuleTitle } = require('./native-modules');

const VALID_CARD_TONES = new Set(['amber', 'teal', 'coral']);
const RESOURCE_ACCESS_MODES = new Set(['whitelist', 'top-level-only']);
const DEFAULT_REMINDER_LEAD_MINUTES = [5, 1];
const REMOTE_SCHEDULE_DEFAULT_REFRESH_MINUTES = 3;
const DEFAULT_UI_ZOOM_FACTOR = 1;
const MIN_UI_ZOOM_FACTOR = 0.75;
const MAX_UI_ZOOM_FACTOR = 1.8;
const UI_ZOOM_STEP = 0.1;
const DEFAULT_NAVIGATION_BANNER_TEXT = '先看计划，再开始。';
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

function normalizeHomeNotice(rawNotice, fallbackImageUrl = '') {
  const source = rawNotice && typeof rawNotice === 'object' ? rawNotice : {};
  const buttonText = normalizePrefix(source.buttonText) || '知道了';
  const imageUrl = normalizePrefix(source.imageUrl) || normalizePrefix(fallbackImageUrl);

  if (source.enabled === false) {
    return {
      enabled: false,
      buttonText,
      imageUrl
    };
  }

  return {
    enabled: Boolean(imageUrl),
    buttonText,
    imageUrl
  };
}

function hashExitPassword(password, salt) {
  return crypto.createHash('sha256').update(`${salt}\u0000${password}`).digest('hex');
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

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
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

function serializeOnlineClassrooms(classrooms = []) {
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

function serializeLibraries(libraries = []) {
  return (Array.isArray(libraries) ? libraries : []).map((library) => ({
    id: library.id,
    title: library.title,
    description: library.description,
    tone: library.tone,
    folderPath: library.folderPath
  }));
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
  const nativeModuleIds = new Set(
    Array.isArray(options.nativeModuleIds)
      ? options.nativeModuleIds
      : listNativeModules().map((moduleDefinition) => moduleDefinition.id)
  );
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

function normalizeStudyData(rawState, fallbackClassrooms = [], fallbackLibraries = [], fallbackLearningTools = [], options = {}) {
  const fallbackClassroomList =
    Array.isArray(fallbackClassrooms) && fallbackClassrooms.length
      ? fallbackClassrooms
      : defaultOnlineClassrooms(options.defaultStartUrl);
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
  const nativeModuleIds = new Set(listNativeModules().map((moduleDefinition) => moduleDefinition.id));
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
    learningTools,
    nativeModuleIds: [...nativeModuleIds]
  });
  const studentItems = normalizeStudySchedule(rawStudentItems, classrooms, libraries, {
    planScope: 'student',
    learningTools,
    nativeModuleIds: [...nativeModuleIds]
  });

  return {
    parentItems,
    studentItems,
    onlineClassrooms: classrooms,
    contentLibraries: libraries,
    learningTools,
    controlSettings: hasExplicitControlSettings
      ? normalizeControlSettings(source.controlSettings)
      : normalizeControlSettings(options.fallbackControlSettings)
  };
}

function mergeStudySchedules(parentItems = [], studentItems = []) {
  return [...parentItems, ...studentItems];
}

module.exports = {
  DEFAULT_NAVIGATION_BANNER_TEXT,
  DEFAULT_REMINDER_LEAD_MINUTES,
  DEFAULT_UI_ZOOM_FACTOR,
  MAX_UI_ZOOM_FACTOR,
  MERGE_STUDY_SCHEDULES: mergeStudySchedules,
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
};
