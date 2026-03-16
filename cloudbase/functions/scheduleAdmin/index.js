'use strict';

const crypto = require('crypto');
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const COLLECTION = process.env.SCHEDULE_COLLECTION || 'study_schedule';
const STATE_DOC_ID = process.env.SCHEDULE_DOC_ID || 'main';
const ADMIN_COLLECTION = process.env.ADMIN_COLLECTION || 'study_admins';
const ADMIN_DOC_ID = process.env.ADMIN_DOC_ID || 'main';
const DEFAULT_ONLINE_CLASSROOMS = [
  {
    id: 'english-course',
    title: '说课英语',
    description: '进入英语在线课堂。',
    tone: 'amber',
    entryUrl: 'https://www.talk915.com/student/login/'
  }
];

function normalizePrefix(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeOpenId(value) {
  return normalizePrefix(value);
}

function normalizeOpenIds(values) {
  const source = Array.isArray(values) ? values : [values];
  const items = [];
  const seen = new Set();

  for (const item of source) {
    const openId = normalizeOpenId(item);

    if (!openId || seen.has(openId)) {
      continue;
    }

    seen.add(openId);
    items.push(openId);
  }

  return items;
}

function normalizeId(value, fallback) {
  const normalized = normalizePrefix(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || fallback;
}

function normalizeEntryUrl(value) {
  const normalized = normalizePrefix(value);

  if (!/^https?:\/\//i.test(normalized)) {
    return '';
  }

  try {
    return new URL(normalized).href;
  } catch {
    return '';
  }
}

function normalizePlanScope(value, fallback = 'parent') {
  return normalizePrefix(value).toLowerCase() === 'student' ? 'student' : fallback;
}

function normalizeScopedScheduleId(value, fallback, planScope = 'parent') {
  const normalizedScope = normalizePlanScope(planScope);
  const normalizedId = normalizeId(value, fallback);
  const prefix = `${normalizedScope}-`;
  return normalizedId.startsWith(prefix) ? normalizedId : `${prefix}${normalizedId}`;
}

function normalizeTime(value, fallback) {
  const normalized = normalizePrefix(value);
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(normalized) ? normalized : fallback;
}

function normalizeWeekdays(rawValue) {
  const source = Array.isArray(rawValue) ? rawValue : [rawValue];
  const days = new Set();

  for (const item of source) {
    const numeric = Number(item);

    if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 7) {
      days.add(numeric);
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

function normalizeTarget(value) {
  const normalized = normalizeId(value, '');

  if (!normalized) {
    return '';
  }

  if (['course', 'english', 'english-course', 'start-url', 'starturl'].includes(normalized)) {
    return 'english-course';
  }

  return normalized;
}

function normalizeNetdiskFolderPath(value, fallback = '/') {
  const normalized = normalizePrefix(value).replace(/\\/g, '/');
  const candidate = normalized || fallback;
  return candidate.startsWith('/') ? candidate : `/${candidate}`;
}

function normalizeLearningToolPath(value) {
  return normalizePrefix(value);
}

function normalizeContentLibraries(rawLibraries) {
  if (!Array.isArray(rawLibraries) || !rawLibraries.length) {
    return [];
  }

  const libraries = [];
  const seenIds = new Set();

  for (let index = 0; index < rawLibraries.length; index += 1) {
    const item = rawLibraries[index] || {};
    const title = normalizePrefix(item.title);
    const folderPath = normalizeNetdiskFolderPath(item.folderPath || item.path, '');

    if (!title || !folderPath) {
      continue;
    }

    const id = normalizeId(item.id, `library-${index + 1}`);

    if (seenIds.has(id)) {
      continue;
    }

    seenIds.add(id);
    libraries.push({
      id,
      title,
      description: normalizePrefix(item.description),
      tone: normalizePrefix(item.tone),
      folderPath
    });
  }

  return libraries;
}

function normalizeLearningTools(rawTools) {
  if (!Array.isArray(rawTools) || !rawTools.length) {
    return [];
  }

  const tools = [];
  const seenIds = new Set();

  for (let index = 0; index < rawTools.length; index += 1) {
    const item = rawTools[index] || {};
    const title = normalizePrefix(item.title);
    const appPath = normalizeLearningToolPath(item.appPath || item.path || item.executablePath);

    if (!title || !appPath) {
      continue;
    }

    const id = normalizeId(item.id, `tool-${index + 1}`);

    if (seenIds.has(id)) {
      continue;
    }

    seenIds.add(id);
    tools.push({
      id,
      title,
      description: normalizePrefix(item.description),
      tone: normalizePrefix(item.tone),
      appPath
    });
  }

  return tools;
}

function normalizeOnlineClassrooms(rawClassrooms) {
  if (!Array.isArray(rawClassrooms) || !rawClassrooms.length) {
    return [];
  }

  const classrooms = [];
  const seenIds = new Set();

  for (let index = 0; index < rawClassrooms.length; index += 1) {
    const item = rawClassrooms[index] || {};
    const title = normalizePrefix(item.title);
    const entryUrl = normalizeEntryUrl(item.entryUrl || item.url || item.startUrl);

    if (!title || !entryUrl) {
      continue;
    }

    const id = normalizeId(item.id, index === 0 ? 'english-course' : `classroom-${index + 1}`);

    if (seenIds.has(id)) {
      continue;
    }

    seenIds.add(id);
    classrooms.push({
      id,
      title,
      description: normalizePrefix(item.description),
      tone: normalizePrefix(item.tone),
      entryUrl
    });
  }

  return classrooms;
}

function fallbackOnlineClassrooms(classrooms) {
  return Array.isArray(classrooms) && classrooms.length
    ? classrooms
    : normalizeOnlineClassrooms(DEFAULT_ONLINE_CLASSROOMS);
}

function normalizeDeviceLabel(value, fallback = '桌面客户端') {
  return normalizePrefix(value).slice(0, 80) || fallback;
}

function normalizeStudentDeviceStatus(value) {
  return normalizePrefix(value).toLowerCase() === 'approved' ? 'approved' : 'pending';
}

function hashStudentDeviceSecret(deviceId, deviceSecret) {
  return crypto.createHash('sha256').update(`${deviceId}\u0000${deviceSecret}`).digest('hex');
}

function normalizeStudentDeviceAccess(rawItems) {
  if (!Array.isArray(rawItems) || !rawItems.length) {
    return [];
  }

  const devices = [];
  const seenIds = new Set();

  for (let index = 0; index < rawItems.length; index += 1) {
    const item = rawItems[index] || {};
    const id = normalizeId(item.id || item.deviceId, '');
    const secretHash = normalizePrefix(item.secretHash);

    if (!id || !secretHash || seenIds.has(id)) {
      continue;
    }

    seenIds.add(id);
    devices.push({
      id,
      label: normalizeDeviceLabel(item.label || item.deviceLabel, id),
      secretHash,
      status: normalizeStudentDeviceStatus(item.status),
      requestedAt: normalizePrefix(item.requestedAt),
      approvedAt: normalizePrefix(item.approvedAt),
      updatedAt: normalizePrefix(item.updatedAt)
    });
  }

  return devices;
}

function sanitizeStudentDeviceAccess(rawItems) {
  return normalizeStudentDeviceAccess(rawItems).map((item) => ({
    id: item.id,
    label: item.label,
    status: item.status,
    requestedAt: item.requestedAt,
    approvedAt: item.approvedAt,
    updatedAt: item.updatedAt
  }));
}

function createEmptyControlSettings() {
  return {
    exitPasswordHash: '',
    exitPasswordSalt: '',
    exitPasswordUpdatedAt: ''
  };
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

function buildControlSettingsFromPassword(password) {
  const normalizedPassword = typeof password === 'string' ? password.trim() : '';

  if (!normalizedPassword) {
    return createEmptyControlSettings();
  }

  const exitPasswordSalt = crypto.randomBytes(16).toString('hex');

  return {
    exitPasswordHash: hashExitPassword(normalizedPassword, exitPasswordSalt),
    exitPasswordSalt,
    exitPasswordUpdatedAt: new Date().toISOString()
  };
}

function normalizeSchedule(rawItems, planScope = 'parent') {
  if (!Array.isArray(rawItems)) {
    return [];
  }

  const normalizedScope = normalizePlanScope(planScope);
  const items = [];
  const seenIds = new Set();

  for (let index = 0; index < rawItems.length; index += 1) {
    const item = rawItems[index] || {};
    const id = normalizeScopedScheduleId(item.id, `schedule-${index + 1}`, normalizedScope);

    if (seenIds.has(id)) {
      continue;
    }

    const title = normalizePrefix(item.title);
    const specificDate = normalizeSpecificDate(item.specificDate || item.date);
    const weekdays = specificDate ? [] : normalizeWeekdays(item.weekdays || item.days);
    const exceptionDates = specificDate ? [] : normalizeDateList(item.exceptionDates || item.skipDates);

    if (!title || (!specificDate && !weekdays.length)) {
      continue;
    }

    seenIds.add(id);
    items.push({
      id,
      planScope: normalizedScope,
      enabled: item.enabled !== false,
      mode: specificDate ? 'date' : 'weekly',
      title,
      target: normalizeTarget(item.target || item.targetId),
      time: normalizeTime(item.time, '19:00'),
      weekdays,
      specificDate,
      exceptionDates,
      message: normalizePrefix(item.message)
    });
  }

  return items;
}

function combineItems(parentItems, studentItems) {
  return [...parentItems, ...studentItems];
}

function assertLearningToolsNotInUse(currentState, nextLearningTools) {
  const currentIds = new Set((Array.isArray(currentState.learningTools) ? currentState.learningTools : []).map((item) => item.id));
  const nextIds = new Set((Array.isArray(nextLearningTools) ? nextLearningTools : []).map((item) => item.id));
  const removedIds = [...currentIds].filter((item) => !nextIds.has(item));

  if (!removedIds.length) {
    return;
  }

  const removedIdSet = new Set(removedIds);
  const removedTitleMap = new Map(
    (Array.isArray(currentState.learningTools) ? currentState.learningTools : [])
      .filter((item) => removedIdSet.has(item.id))
      .map((item) => [item.id, item.title || item.id])
  );
  const referencedTitles = Array.from(
    new Set(
      combineItems(currentState.parentItems, currentState.studentItems)
        .filter((item) => removedIdSet.has(normalizeTarget(item.target || item.targetId)))
        .map((item) => removedTitleMap.get(normalizeTarget(item.target || item.targetId)) || normalizeTarget(item.target || item.targetId))
        .filter(Boolean)
    )
  );

  if (!referencedTitles.length) {
    return;
  }

  throw new Error(`以下学习工具仍被计划引用，不能删除：${referencedTitles.join('、')}`);
}

function adminOpenIds() {
  return normalizeOpenIds(normalizePrefix(process.env.ADMIN_OPENIDS).split(','));
}

function currentOpenId(event) {
  const context = typeof cloud.getWXContext === 'function' ? cloud.getWXContext() : null;
  const contextOpenId = normalizeOpenId(context && (context.OPENID || context.openId));

  if (contextOpenId) {
    return contextOpenId;
  }

  return normalizeOpenId(event && event.userInfo && event.userInfo.openId);
}

async function readAdminState() {
  try {
    const result = await db.collection(ADMIN_COLLECTION).doc(ADMIN_DOC_ID).get();
    const data = result && result.data ? result.data : {};

    return {
      updatedAt: normalizePrefix(data.updatedAt),
      openIds: normalizeOpenIds(data.openIds)
    };
  } catch (error) {
    const message = normalizePrefix(error && (error.errMsg || error.message));

    if (message.includes('document.get:fail') || message.includes('not exist')) {
      return {
        updatedAt: '',
        openIds: []
      };
    }

    throw error;
  }
}

async function resolveAdminState(options = {}) {
  const storedState = await readAdminState();
  const bootstrapOpenIds = adminOpenIds();

  if (storedState.openIds.length) {
    return {
      updatedAt: storedState.updatedAt,
      openIds: storedState.openIds,
      source: 'database'
    };
  }

  if (bootstrapOpenIds.length && options.persistBootstrap) {
    try {
      const state = await writeAdminState(bootstrapOpenIds);

      return {
        updatedAt: state.updatedAt,
        openIds: state.openIds,
        source: 'database'
      };
    } catch {
      return {
        updatedAt: '',
        openIds: bootstrapOpenIds,
        source: 'bootstrap'
      };
    }
  }

  return {
    updatedAt: '',
    openIds: bootstrapOpenIds,
    source: bootstrapOpenIds.length ? 'bootstrap' : 'empty'
  };
}

async function writeAdminState(rawOpenIds) {
  const state = {
    updatedAt: new Date().toISOString(),
    openIds: normalizeOpenIds(rawOpenIds)
  };

  await db.collection(ADMIN_COLLECTION).doc(ADMIN_DOC_ID).set({
    data: state
  });

  return state;
}

async function mutateAdminState(mutator) {
  const bootstrapOpenIds = adminOpenIds();

  return db.runTransaction(async (transaction) => {
    let currentState = {
      updatedAt: '',
      openIds: bootstrapOpenIds
    };

    try {
      const result = await transaction.collection(ADMIN_COLLECTION).doc(ADMIN_DOC_ID).get();
      const data = result && result.data ? result.data : {};

      currentState = {
        updatedAt: normalizePrefix(data.updatedAt),
        openIds: normalizeOpenIds(data.openIds)
      };

      if (!currentState.openIds.length && bootstrapOpenIds.length) {
        currentState.openIds = bootstrapOpenIds;
      }
    } catch (error) {
      const message = normalizePrefix(error && (error.errMsg || error.message));

      if (!message.includes('document.get:fail') && !message.includes('not exist')) {
        throw error;
      }
    }

    const nextOpenIds = normalizeOpenIds(mutator(currentState.openIds));
    const nextState = {
      updatedAt: new Date().toISOString(),
      openIds: nextOpenIds
    };

    await transaction.collection(ADMIN_COLLECTION).doc(ADMIN_DOC_ID).set({
      data: nextState
    });

    return nextState;
  });
}

async function assertAdmin(event) {
  const openId = currentOpenId(event);
  const adminState = await resolveAdminState({
    persistBootstrap: true
  });
  const allowList = new Set(adminState.openIds);

  if (!openId) {
    throw new Error('无法识别当前用户身份。');
  }

  if (!allowList.size || !allowList.has(openId)) {
    throw new Error(`当前账号未授权。请让已有管理员把这个 OPENID 加进管理员列表：${openId}`);
  }

  return {
    openId,
    adminState
  };
}

async function readState() {
  try {
    const result = await db.collection(COLLECTION).doc(STATE_DOC_ID).get();
    const data = result && result.data ? result.data : {};
    const parentItems = normalizeSchedule(
      Array.isArray(data.parentItems) ? data.parentItems : Array.isArray(data.items) ? data.items : [],
      'parent'
    );
    const studentItems = normalizeSchedule(Array.isArray(data.studentItems) ? data.studentItems : [], 'student');
    const onlineClassrooms = fallbackOnlineClassrooms(normalizeOnlineClassrooms(data.onlineClassrooms || data.classrooms));
    const contentLibraries = normalizeContentLibraries(data.contentLibraries || data.libraries);
    const learningTools = normalizeLearningTools(data.learningTools || data.tools);
    const studentDeviceAccess = normalizeStudentDeviceAccess(data.studentDeviceAccess);
    const controlSettings = normalizeControlSettings(data.controlSettings);

    return {
      updatedAt: normalizePrefix(data.updatedAt),
      parentItems,
      studentItems,
      onlineClassrooms,
      contentLibraries,
      learningTools,
      studentDeviceAccess,
      studentDeviceAccessUpdatedAt: normalizePrefix(data.studentDeviceAccessUpdatedAt),
      controlSettings,
      items: combineItems(parentItems, studentItems)
    };
  } catch (error) {
    const message = normalizePrefix(error && (error.errMsg || error.message));

    if (message.includes('document.get:fail') || message.includes('not exist')) {
      return {
        updatedAt: '',
        parentItems: [],
        studentItems: [],
        onlineClassrooms: normalizeOnlineClassrooms(DEFAULT_ONLINE_CLASSROOMS),
        contentLibraries: [],
        learningTools: [],
        studentDeviceAccess: [],
        studentDeviceAccessUpdatedAt: '',
        controlSettings: createEmptyControlSettings(),
        items: []
      };
    }

    throw error;
  }
}

async function writeState(rawState = {}, options = {}) {
  const useMerge = Boolean(options.mergeWithExisting);

  return db.runTransaction(async (transaction) => {
    let currentState = {
      parentItems: [],
      studentItems: [],
      onlineClassrooms: [],
      contentLibraries: [],
      learningTools: [],
      studentDeviceAccess: [],
      studentDeviceAccessUpdatedAt: '',
      controlSettings: createEmptyControlSettings()
    };

    if (useMerge) {
      try {
        const result = await transaction.collection(COLLECTION).doc(STATE_DOC_ID).get();
        const data = result && result.data ? result.data : {};

        currentState = {
          parentItems: normalizeSchedule(
            Array.isArray(data.parentItems) ? data.parentItems : Array.isArray(data.items) ? data.items : [],
            'parent'
          ),
          studentItems: normalizeSchedule(Array.isArray(data.studentItems) ? data.studentItems : [], 'student'),
          onlineClassrooms: fallbackOnlineClassrooms(normalizeOnlineClassrooms(data.onlineClassrooms || data.classrooms)),
          contentLibraries: normalizeContentLibraries(data.contentLibraries || data.libraries),
          learningTools: normalizeLearningTools(data.learningTools || data.tools),
          studentDeviceAccess: normalizeStudentDeviceAccess(data.studentDeviceAccess),
          studentDeviceAccessUpdatedAt: normalizePrefix(data.studentDeviceAccessUpdatedAt),
          controlSettings: normalizeControlSettings(data.controlSettings)
        };
      } catch (error) {
        const message = normalizePrefix(error && (error.errMsg || error.message));

        if (!message.includes('document.get:fail') && !message.includes('not exist')) {
          throw error;
        }
      }
    }

    const parentItems = Object.prototype.hasOwnProperty.call(rawState, 'parentItems')
      ? normalizeSchedule(rawState.parentItems, 'parent')
      : currentState.parentItems;
    const studentItems = Object.prototype.hasOwnProperty.call(rawState, 'studentItems')
      ? normalizeSchedule(rawState.studentItems, 'student')
      : currentState.studentItems;
    const onlineClassrooms = Object.prototype.hasOwnProperty.call(rawState, 'onlineClassrooms')
      ? normalizeOnlineClassrooms(rawState.onlineClassrooms)
      : currentState.onlineClassrooms;
    const contentLibraries = Object.prototype.hasOwnProperty.call(rawState, 'contentLibraries')
      ? normalizeContentLibraries(rawState.contentLibraries)
      : currentState.contentLibraries;
    const learningTools = Object.prototype.hasOwnProperty.call(rawState, 'learningTools')
      ? normalizeLearningTools(rawState.learningTools)
      : currentState.learningTools;
    const studentDeviceAccess = Object.prototype.hasOwnProperty.call(rawState, 'studentDeviceAccess')
      ? normalizeStudentDeviceAccess(rawState.studentDeviceAccess)
      : currentState.studentDeviceAccess;
    const controlSettings = Object.prototype.hasOwnProperty.call(rawState, 'controlSettings')
      ? normalizeControlSettings(rawState.controlSettings)
      : currentState.controlSettings;
    const studentDeviceAccessUpdatedAt = Object.prototype.hasOwnProperty.call(rawState, 'studentDeviceAccess')
      ? new Date().toISOString()
      : currentState.studentDeviceAccessUpdatedAt;
    const state = {
      updatedAt: new Date().toISOString(),
      parentItems,
      studentItems,
      onlineClassrooms: fallbackOnlineClassrooms(onlineClassrooms),
      contentLibraries,
      learningTools,
      studentDeviceAccess,
      studentDeviceAccessUpdatedAt,
      controlSettings,
      items: combineItems(parentItems, studentItems)
    };

    await transaction.collection(COLLECTION).doc(STATE_DOC_ID).set({
      data: state
    });

    return state;
  });
}

async function mutateStudentDeviceAccess(mutator) {
  return db.runTransaction(async (transaction) => {
    let currentState = {
      updatedAt: '',
      parentItems: [],
      studentItems: [],
      onlineClassrooms: normalizeOnlineClassrooms(DEFAULT_ONLINE_CLASSROOMS),
      contentLibraries: [],
      learningTools: [],
      studentDeviceAccess: [],
      studentDeviceAccessUpdatedAt: '',
      controlSettings: createEmptyControlSettings()
    };

    try {
      const result = await transaction.collection(COLLECTION).doc(STATE_DOC_ID).get();
      const data = result && result.data ? result.data : {};
      currentState = {
        updatedAt: normalizePrefix(data.updatedAt),
        parentItems: normalizeSchedule(
          Array.isArray(data.parentItems) ? data.parentItems : Array.isArray(data.items) ? data.items : [],
          'parent'
        ),
        studentItems: normalizeSchedule(Array.isArray(data.studentItems) ? data.studentItems : [], 'student'),
        onlineClassrooms: fallbackOnlineClassrooms(normalizeOnlineClassrooms(data.onlineClassrooms || data.classrooms)),
        contentLibraries: normalizeContentLibraries(data.contentLibraries || data.libraries),
        learningTools: normalizeLearningTools(data.learningTools || data.tools),
        studentDeviceAccess: normalizeStudentDeviceAccess(data.studentDeviceAccess),
        studentDeviceAccessUpdatedAt: normalizePrefix(data.studentDeviceAccessUpdatedAt),
        controlSettings: normalizeControlSettings(data.controlSettings)
      };
    } catch (error) {
      const message = normalizePrefix(error && (error.errMsg || error.message));

      if (!message.includes('document.get:fail') && !message.includes('not exist')) {
        throw error;
      }
    }

    const nextDevices = normalizeStudentDeviceAccess(mutator(currentState.studentDeviceAccess));
    const now = new Date().toISOString();
    const state = {
      updatedAt: currentState.updatedAt,
      parentItems: currentState.parentItems,
      studentItems: currentState.studentItems,
      onlineClassrooms: currentState.onlineClassrooms,
      contentLibraries: currentState.contentLibraries,
      learningTools: currentState.learningTools,
      studentDeviceAccess: nextDevices,
      studentDeviceAccessUpdatedAt: now,
      controlSettings: currentState.controlSettings,
      items: combineItems(currentState.parentItems, currentState.studentItems)
    };

    await transaction.collection(COLLECTION).doc(STATE_DOC_ID).set({
      data: state
    });

    return state;
  });
}

exports.main = async (event = {}) => {
  const action = normalizePrefix(event.action) || 'list';

  if (action === 'whoami') {
    const openId = currentOpenId(event);
    const adminState = await resolveAdminState({
      persistBootstrap: true
    });
    const allowList = new Set(adminState.openIds);
    const state = await readState();

    return {
      ok: true,
      openId,
      authorized: Boolean(openId && allowList.has(openId)),
      adminCount: adminState.openIds.length,
      adminSource: adminState.source,
      scheduleCount: state.items.length,
      classroomCount: state.onlineClassrooms.length,
      libraryCount: state.contentLibraries.length,
      learningToolCount: state.learningTools.length,
      hasExitPassword: Boolean(state.controlSettings.exitPasswordHash)
    };
  }

  const context = await assertAdmin(event);

  if (action === 'list') {
    return {
      ok: true,
      ...(await readState())
    };
  }

  if (action === 'saveAll') {
    const payload = {};

    if (Array.isArray(event.parentItems)) {
      payload.parentItems = event.parentItems;
    } else if (Array.isArray(event.items)) {
      payload.parentItems = event.items;
    }

    if (Array.isArray(event.studentItems)) {
      payload.studentItems = event.studentItems;
    }

    if (Array.isArray(event.contentLibraries)) {
      payload.contentLibraries = event.contentLibraries;
    }

    if (Array.isArray(event.learningTools)) {
      payload.learningTools = event.learningTools;
    }

    if (Array.isArray(event.onlineClassrooms)) {
      payload.onlineClassrooms = event.onlineClassrooms;
    }

    const state = await writeState(
      payload,
      {
        mergeWithExisting: true
      }
    );

    return {
      ok: true,
      ...state
    };
  }

  if (action === 'saveLibraries') {
    return {
      ok: true,
      ...(await writeState(
        {
          contentLibraries: Array.isArray(event.contentLibraries) ? event.contentLibraries : event.libraries
        },
        {
          mergeWithExisting: true
        }
      ))
    };
  }

  if (action === 'saveOnlineClassrooms') {
    return {
      ok: true,
      ...(await writeState(
        {
          onlineClassrooms: Array.isArray(event.onlineClassrooms) ? event.onlineClassrooms : event.classrooms
        },
        {
          mergeWithExisting: true
        }
      ))
    };
  }

  if (action === 'saveLearningTools') {
    const currentState = await readState();
    const nextLearningTools = normalizeLearningTools(
      Array.isArray(event.learningTools) ? event.learningTools : event.tools
    );

    assertLearningToolsNotInUse(currentState, nextLearningTools);

    return {
      ok: true,
      ...(await writeState(
        {
          learningTools: nextLearningTools
        },
        {
          mergeWithExisting: true
        }
      ))
    };
  }

  if (action === 'getControlSettings') {
    const state = await readState();

    return {
      ok: true,
      hasExitPassword: Boolean(state.controlSettings.exitPasswordHash),
      exitPasswordUpdatedAt: state.controlSettings.exitPasswordUpdatedAt
    };
  }

  if (action === 'saveControlSettings') {
    const exitPassword = typeof event.exitPassword === 'string' ? event.exitPassword : '';
    const clearExitPassword = event.clearExitPassword === true;

    if (!clearExitPassword && exitPassword.trim().length < 4) {
      throw new Error('退出密码至少 4 位。');
    }

    const controlSettings = clearExitPassword
      ? createEmptyControlSettings()
      : buildControlSettingsFromPassword(exitPassword);
    const state = await writeState(
      {
        controlSettings
      },
      {
        mergeWithExisting: true
      }
    );

    return {
      ok: true,
      hasExitPassword: Boolean(state.controlSettings.exitPasswordHash),
      exitPasswordUpdatedAt: state.controlSettings.exitPasswordUpdatedAt
    };
  }

  if (action === 'listStudentDevices') {
    const state = await readState();

    return {
      ok: true,
      updatedAt: state.studentDeviceAccessUpdatedAt,
      items: sanitizeStudentDeviceAccess(state.studentDeviceAccess)
    };
  }

  if (action === 'approveStudentDevice') {
    const targetDeviceId = normalizeId(event.deviceId, '');

    if (!targetDeviceId) {
      throw new Error('要批准的客户端不能为空。');
    }

    const state = await mutateStudentDeviceAccess((currentDevices) => {
      let found = false;
      const now = new Date().toISOString();
      const nextDevices = currentDevices.map((item) => {
        if (item.id !== targetDeviceId) {
          return item;
        }

        found = true;
        return {
          ...item,
          status: 'approved',
          approvedAt: item.approvedAt || now,
          updatedAt: now
        };
      });

      if (!found) {
        throw new Error('找不到这个桌面客户端。');
      }

      return nextDevices;
    });

    return {
      ok: true,
      updatedAt: state.studentDeviceAccessUpdatedAt,
      items: sanitizeStudentDeviceAccess(state.studentDeviceAccess)
    };
  }

  if (action === 'removeStudentDevice') {
    const targetDeviceId = normalizeId(event.deviceId, '');

    if (!targetDeviceId) {
      throw new Error('要删除的客户端不能为空。');
    }

    const state = await mutateStudentDeviceAccess((currentDevices) =>
      currentDevices.filter((item) => item.id !== targetDeviceId)
    );

    return {
      ok: true,
      updatedAt: state.studentDeviceAccessUpdatedAt,
      items: sanitizeStudentDeviceAccess(state.studentDeviceAccess)
    };
  }

  if (action === 'listAdmins') {
    return {
      ok: true,
      updatedAt: context.adminState.updatedAt,
      source: context.adminState.source,
      openIds: context.adminState.openIds
    };
  }

  if (action === 'addAdmin') {
    const targetOpenId = normalizeOpenId(event.openId);

    if (!targetOpenId) {
      throw new Error('要添加的 OPENID 不能为空。');
    }

    return {
      ok: true,
      ...(await mutateAdminState((currentOpenIds) => [...currentOpenIds, targetOpenId]))
    };
  }

  if (action === 'removeAdmin') {
    const targetOpenId = normalizeOpenId(event.openId);

    if (!targetOpenId) {
      throw new Error('要移除的 OPENID 不能为空。');
    }

    return {
      ok: true,
      ...(await mutateAdminState((currentOpenIds) => {
        const mergedNextOpenIds = currentOpenIds.filter((item) => item !== targetOpenId);

        if (!mergedNextOpenIds.length) {
          throw new Error('至少要保留一个管理员。');
        }

        return mergedNextOpenIds;
      }))
    };
  }

  throw new Error(`不支持的 action：${action}`);
};
