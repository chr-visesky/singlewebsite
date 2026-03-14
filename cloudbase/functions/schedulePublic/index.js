'use strict';

const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const COLLECTION = process.env.SCHEDULE_COLLECTION || 'study_schedule';
const STATE_DOC_ID = process.env.SCHEDULE_DOC_ID || 'main';
const READ_TOKEN = (process.env.READ_TOKEN || '').trim();
const STUDENT_WRITE_TOKEN = (process.env.STUDENT_WRITE_TOKEN || '').trim();

function normalizePrefix(value) {
  return typeof value === 'string' ? value.trim() : '';
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

function sanitizeControlSettings(controlSettings) {
  const normalized = normalizeControlSettings(controlSettings);
  return {
    hasExitPassword: Boolean(normalized.exitPasswordHash),
    exitPasswordUpdatedAt: normalized.exitPasswordUpdatedAt
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

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(payload)
  };
}

function bearerToken(headers = {}) {
  const rawHeader = normalizePrefix(headers.authorization || headers.Authorization);

  if (!rawHeader.toLowerCase().startsWith('bearer ')) {
    return '';
  }

  return normalizePrefix(rawHeader.slice(7));
}

function headerTokenOnly(event = {}) {
  return bearerToken(event.headers);
}

function parseBody(body) {
  if (!body) {
    return {};
  }

  if (typeof body === 'object') {
    return body;
  }

  try {
    return JSON.parse(String(body));
  } catch {
    return null;
  }
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
    const controlSettings = normalizeControlSettings(data.controlSettings);

    return {
      updatedAt: normalizePrefix(data.updatedAt),
      parentItems,
      studentItems,
      contentLibraries,
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
        contentLibraries: [],
        controlSettings: createEmptyControlSettings(),
        items: []
      };
    }

    throw error;
  }
}

async function writeStudentItems(rawItems) {
  const normalizedStudentItems = normalizeSchedule(rawItems, 'student');

  return db.runTransaction(async (transaction) => {
    let parentItems = [];
    let contentLibraries = [];
    let controlSettings = createEmptyControlSettings();

    try {
      const result = await transaction.collection(COLLECTION).doc(STATE_DOC_ID).get();
      const data = result && result.data ? result.data : {};

      parentItems = normalizeSchedule(
        Array.isArray(data.parentItems) ? data.parentItems : Array.isArray(data.items) ? data.items : [],
        'parent'
      );
      contentLibraries = normalizeContentLibraries(data.contentLibraries || data.libraries);
      controlSettings = normalizeControlSettings(data.controlSettings);
    } catch (error) {
      const message = normalizePrefix(error && (error.errMsg || error.message));

      if (!message.includes('document.get:fail') && !message.includes('not exist')) {
        throw error;
      }
    }

    const state = {
      updatedAt: new Date().toISOString(),
      parentItems,
      studentItems: normalizedStudentItems,
      contentLibraries,
      controlSettings
    };

    await transaction.collection(COLLECTION).doc(STATE_DOC_ID).set({
      data: {
        ...state,
        items: combineItems(state.parentItems, state.studentItems)
      }
    });

    return {
      ...state,
      items: combineItems(state.parentItems, state.studentItems)
    };
  });
}

exports.main = async (event = {}) => {
  const method = (event.httpMethod || 'GET').toUpperCase();

  if (method === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Max-Age': '86400'
      },
      body: ''
    };
  }

  if (method === 'GET') {
    if (!READ_TOKEN) {
      return jsonResponse(500, {
        error: 'missing_read_token'
      });
    }

    const requestToken = headerTokenOnly(event);

    if (requestToken !== READ_TOKEN) {
      return jsonResponse(403, {
        error: 'forbidden'
      });
    }

    const state = await readState();

    return jsonResponse(200, {
      ...state,
      controlSettings: sanitizeControlSettings(state.controlSettings)
    });
  }

  if (method === 'POST') {
    if (!STUDENT_WRITE_TOKEN) {
      return jsonResponse(500, {
        error: 'missing_student_write_token'
      });
    }

    const requestToken = headerTokenOnly(event);

    if (requestToken !== STUDENT_WRITE_TOKEN) {
      return jsonResponse(403, {
        error: 'forbidden'
      });
    }

    const payload = parseBody(event.body);

    if (!payload || typeof payload !== 'object') {
      return jsonResponse(400, {
        error: 'bad_json'
      });
    }

    const action = normalizePrefix(payload.action) || 'saveStudentItems';

    if (action === 'getControlSettings') {
      const state = await readState();

      return jsonResponse(200, {
        ok: true,
        controlSettings: normalizeControlSettings(state.controlSettings)
      });
    }

    if (action !== 'saveStudentItems') {
      return jsonResponse(400, {
        error: 'unsupported_action'
      });
    }

    return jsonResponse(200, await writeStudentItems(payload.items));
  }

  return jsonResponse(405, {
    error: 'method_not_allowed'
  });
};
