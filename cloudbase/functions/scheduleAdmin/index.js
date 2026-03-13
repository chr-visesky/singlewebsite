'use strict';

const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const COLLECTION = process.env.SCHEDULE_COLLECTION || 'study_schedule';
const STATE_DOC_ID = process.env.SCHEDULE_DOC_ID || 'main';
const ADMIN_COLLECTION = process.env.ADMIN_COLLECTION || 'study_admins';
const ADMIN_DOC_ID = process.env.ADMIN_DOC_ID || 'main';

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
    const contentLibraries = normalizeContentLibraries(data.contentLibraries || data.libraries);

    return {
      updatedAt: normalizePrefix(data.updatedAt),
      parentItems,
      studentItems,
      contentLibraries,
      items: combineItems(parentItems, studentItems)
    };
  } catch (error) {
    const message = normalizePrefix(error && (error.errMsg || error.message));

    if (message.includes('document.get:fail') || message.includes('not exist')) {
      return {
        updatedAt: '',
        parentItems: [],
        studentItems: [],
        contentLibraries: [],
        items: []
      };
    }

    throw error;
  }
}

async function writeState(rawState = {}, options = {}) {
  const currentState = options.mergeWithExisting ? await readState() : {
    parentItems: [],
    studentItems: [],
    contentLibraries: []
  };
  const parentItems = Object.prototype.hasOwnProperty.call(rawState, 'parentItems')
    ? normalizeSchedule(rawState.parentItems, 'parent')
    : currentState.parentItems;
  const studentItems = Object.prototype.hasOwnProperty.call(rawState, 'studentItems')
    ? normalizeSchedule(rawState.studentItems, 'student')
    : currentState.studentItems;
  const contentLibraries = Object.prototype.hasOwnProperty.call(rawState, 'contentLibraries')
    ? normalizeContentLibraries(rawState.contentLibraries)
    : currentState.contentLibraries;
  const state = {
    updatedAt: new Date().toISOString(),
    parentItems,
    studentItems,
    contentLibraries,
    items: combineItems(parentItems, studentItems)
  };

  await db.collection(COLLECTION).doc(STATE_DOC_ID).set({
    data: state
  });

  return state;
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
      libraryCount: state.contentLibraries.length
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
      ...(await writeAdminState([...context.adminState.openIds, targetOpenId]))
    };
  }

  if (action === 'removeAdmin') {
    const targetOpenId = normalizeOpenId(event.openId);

    if (!targetOpenId) {
      throw new Error('要移除的 OPENID 不能为空。');
    }

    const nextOpenIds = context.adminState.openIds.filter((item) => item !== targetOpenId);

    if (!nextOpenIds.length) {
      throw new Error('至少要保留一个管理员。');
    }

    return {
      ok: true,
      ...(await writeAdminState(nextOpenIds))
    };
  }

  throw new Error(`不支持的 action：${action}`);
};
