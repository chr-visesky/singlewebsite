'use strict';

const crypto = require('crypto');
const cloud = require('wx-server-sdk');
const { createAgentPlanPublicRuntime } = require('./shared/agent-plan-public');
const { createCollectionEnsurer } = require('./shared/ensure-collection');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const COLLECTION = process.env.SCHEDULE_COLLECTION || 'study_schedule';
const STATE_DOC_ID = process.env.SCHEDULE_DOC_ID || 'main';
const READ_TOKEN = (process.env.READ_TOKEN || '').trim();
const STUDENT_WRITE_TOKEN = (process.env.STUDENT_WRITE_TOKEN || '').trim();
const AGENT_WRITE_TOKEN = (process.env.AGENT_WRITE_TOKEN || '').trim();
const AGENT_REQUEST_COLLECTION = process.env.AGENT_REQUEST_COLLECTION || 'study_agent_plan_requests';
const AGENT_REQUEST_DOC_ID = process.env.AGENT_REQUEST_DOC_ID || 'main';
const MAX_AGENT_PLAN_REQUESTS = 40;
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

function normalizeStudentDeviceRequest(payload = {}) {
  const deviceId = normalizeId(payload.deviceId || payload.studentDeviceId, '');
  const deviceSecret = normalizePrefix(payload.deviceSecret || payload.studentDeviceSecret);
  return {
    deviceId,
    deviceSecret,
    label: normalizeDeviceLabel(payload.deviceLabel || payload.label, deviceId || '桌面客户端')
  };
}

function buildStudentDeviceAccessStatus(item, message, mode = 'approval') {
  const normalizedItem = item && typeof item === 'object' ? item : {};
  const status = normalizeStudentDeviceStatus(normalizedItem.status);
  return {
    ok: true,
    mode,
    approved: status === 'approved',
    status,
    deviceId: normalizePrefix(normalizedItem.id),
    label: normalizeDeviceLabel(normalizedItem.label, '桌面客户端'),
    requestedAt: normalizePrefix(normalizedItem.requestedAt),
    approvedAt: normalizePrefix(normalizedItem.approvedAt),
    updatedAt: normalizePrefix(normalizedItem.updatedAt),
    message: normalizePrefix(message)
  };
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

function sanitizePublicState(state = {}) {
  return {
    updatedAt: normalizePrefix(state.updatedAt),
    parentItems: normalizeSchedule(state.parentItems, 'parent'),
    studentItems: normalizeSchedule(state.studentItems, 'student'),
    onlineClassrooms: fallbackOnlineClassrooms(normalizeOnlineClassrooms(state.onlineClassrooms)),
    contentLibraries: normalizeContentLibraries(state.contentLibraries),
    learningTools: normalizeLearningTools(state.learningTools),
    items: combineItems(
      normalizeSchedule(state.parentItems, 'parent'),
      normalizeSchedule(state.studentItems, 'student')
    ),
    controlSettings: sanitizeControlSettings(state.controlSettings)
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

const agentPlanRuntime = createAgentPlanPublicRuntime({
  db,
  scheduleCollection: COLLECTION,
  scheduleDocId: STATE_DOC_ID,
  agentRequestCollection: AGENT_REQUEST_COLLECTION,
  agentRequestDocId: AGENT_REQUEST_DOC_ID,
  ensureAgentRequestCollection: createCollectionEnsurer(AGENT_REQUEST_COLLECTION),
  maxAgentPlanRequests: MAX_AGENT_PLAN_REQUESTS,
  defaultOnlineClassrooms: DEFAULT_ONLINE_CLASSROOMS,
  normalizePrefix,
  normalizeId,
  normalizeTime,
  normalizeWeekdays,
  normalizeSpecificDate,
  normalizeDateList,
  normalizeTarget,
  normalizeSchedule,
  normalizeOnlineClassrooms,
  fallbackOnlineClassrooms,
  normalizeContentLibraries,
  normalizeLearningTools,
  normalizeStudentDeviceAccess,
  normalizeControlSettings,
  createEmptyControlSettings,
  combineItems
});
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

async function writeStudentItems(rawItems, options = {}) {
  const normalizedStudentItems = normalizeSchedule(rawItems, 'student');
  const studentDevice = options.studentDevice && typeof options.studentDevice === 'object' ? options.studentDevice : null;

  return db.runTransaction(async (transaction) => {
    let parentItems = [];
    let onlineClassrooms = [];
    let contentLibraries = [];
    let learningTools = [];
    let studentDeviceAccess = [];
    let studentDeviceAccessUpdatedAt = '';
    let controlSettings = createEmptyControlSettings();

    try {
      const result = await transaction.collection(COLLECTION).doc(STATE_DOC_ID).get();
      const data = result && result.data ? result.data : {};

      parentItems = normalizeSchedule(
        Array.isArray(data.parentItems) ? data.parentItems : Array.isArray(data.items) ? data.items : [],
        'parent'
      );
      contentLibraries = normalizeContentLibraries(data.contentLibraries || data.libraries);
      learningTools = normalizeLearningTools(data.learningTools || data.tools);
      onlineClassrooms = fallbackOnlineClassrooms(normalizeOnlineClassrooms(data.onlineClassrooms || data.classrooms));
      studentDeviceAccess = normalizeStudentDeviceAccess(data.studentDeviceAccess);
      studentDeviceAccessUpdatedAt = normalizePrefix(data.studentDeviceAccessUpdatedAt);
      controlSettings = normalizeControlSettings(data.controlSettings);
    } catch (error) {
      const message = normalizePrefix(error && (error.errMsg || error.message));

      if (!message.includes('document.get:fail') && !message.includes('not exist')) {
        throw error;
      }
    }

    if (studentDevice) {
      const secretHash = hashStudentDeviceSecret(studentDevice.deviceId, studentDevice.deviceSecret);
      const matchedDevice = studentDeviceAccess.find(
        (item) => item.id === studentDevice.deviceId && item.secretHash === secretHash && item.status === 'approved'
      );

      if (!matchedDevice) {
        const deviceError = new Error('device_not_approved');
        deviceError.code = 'device_not_approved';
        throw deviceError;
      }
    }

    const state = {
      updatedAt: new Date().toISOString(),
      parentItems,
      studentItems: normalizedStudentItems,
      onlineClassrooms: fallbackOnlineClassrooms(onlineClassrooms),
      contentLibraries,
      learningTools,
      studentDeviceAccess,
      studentDeviceAccessUpdatedAt,
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

async function upsertStudentDeviceAccess(payload = {}) {
  const request = normalizeStudentDeviceRequest(payload);

  if (!request.deviceId || !request.deviceSecret) {
    const error = new Error('missing_device_credential');
    error.code = 'missing_device_credential';
    throw error;
  }

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

    const now = new Date().toISOString();
    const secretHash = hashStudentDeviceSecret(request.deviceId, request.deviceSecret);
    const currentDevices = normalizeStudentDeviceAccess(currentState.studentDeviceAccess);
    const existingIndex = currentDevices.findIndex((item) => item.id === request.deviceId);
    let nextDevices = currentDevices;
    let currentEntry = null;
    let changed = false;

    if (existingIndex >= 0) {
      const existing = currentDevices[existingIndex];

      if (existing.secretHash !== secretHash) {
        currentEntry = {
          id: request.deviceId,
          label: request.label,
          secretHash,
          status: 'pending',
          requestedAt: now,
          approvedAt: '',
          updatedAt: now
        };
        nextDevices = currentDevices.map((item, index) => (index === existingIndex ? currentEntry : item));
        changed = true;
      } else {
        currentEntry = {
          ...existing,
          label: request.label || existing.label
        };

        if (currentEntry.label !== existing.label) {
          currentEntry.updatedAt = now;
          nextDevices = currentDevices.map((item, index) => (index === existingIndex ? currentEntry : item));
          changed = true;
        }
      }
    } else {
      currentEntry = {
        id: request.deviceId,
        label: request.label,
        secretHash,
        status: 'pending',
        requestedAt: now,
        approvedAt: '',
        updatedAt: now
      };
      nextDevices = [...currentDevices, currentEntry];
      changed = true;
    }

    if (changed) {
      const state = {
        updatedAt: currentState.updatedAt,
        parentItems: currentState.parentItems,
        studentItems: currentState.studentItems,
        onlineClassrooms: currentState.onlineClassrooms,
        contentLibraries: currentState.contentLibraries,
        learningTools: currentState.learningTools,
        studentDeviceAccess: normalizeStudentDeviceAccess(nextDevices),
        studentDeviceAccessUpdatedAt: now,
        controlSettings: currentState.controlSettings,
        items: combineItems(currentState.parentItems, currentState.studentItems)
      };

      await transaction.collection(COLLECTION).doc(STATE_DOC_ID).set({
        data: state
      });
    }

    return buildStudentDeviceAccessStatus(
      currentEntry,
      currentEntry.status === 'approved'
        ? '当前客户端已获准修改学生计划。'
        : '已自动提交学生计划写入申请，等待家长在手机端批准。',
      'approval'
    );
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
    if (!READ_TOKEN && !AGENT_WRITE_TOKEN) {
      return jsonResponse(500, {
        error: 'missing_read_token'
      });
    }

    const requestToken = headerTokenOnly(event);

    const canRead = (READ_TOKEN && requestToken === READ_TOKEN)
      || (AGENT_WRITE_TOKEN && requestToken === AGENT_WRITE_TOKEN);

    if (!canRead) {
      return jsonResponse(403, {
        error: 'forbidden'
      });
    }

    const state = await readState();

    return jsonResponse(200, sanitizePublicState(state));
  }

  if (method === 'POST') {
    const requestToken = headerTokenOnly(event);

    const payload = parseBody(event.body);

    if (!payload || typeof payload !== 'object') {
      return jsonResponse(400, {
        error: 'bad_json'
      });
    }

    const action = normalizePrefix(payload.action) || 'saveStudentItems';

    if (action === 'getControlSettings') {
      if (!READ_TOKEN) {
        return jsonResponse(500, {
          error: 'missing_read_token'
        });
      }

      if (requestToken !== READ_TOKEN) {
        return jsonResponse(403, {
          error: 'forbidden'
        });
      }

      const state = await readState();

      return jsonResponse(200, {
        ok: true,
        controlSettings: normalizeControlSettings(state.controlSettings)
      });
    }

    if (action === 'getStudentDeviceAccessStatus') {
      if (requestToken === STUDENT_WRITE_TOKEN && STUDENT_WRITE_TOKEN) {
        const request = normalizeStudentDeviceRequest(payload);

        return jsonResponse(200, buildStudentDeviceAccessStatus(
          {
            id: request.deviceId,
            label: request.label,
            status: 'approved',
            requestedAt: '',
            approvedAt: '',
            updatedAt: ''
          },
          '当前客户端已通过专用写入令牌授权。',
          'token'
        ));
      }

      if (!READ_TOKEN) {
        return jsonResponse(500, {
          error: 'missing_read_token'
        });
      }

      if (requestToken !== READ_TOKEN) {
        return jsonResponse(403, {
          error: 'forbidden'
        });
      }

      try {
        return jsonResponse(200, await upsertStudentDeviceAccess(payload));
      } catch (error) {
        if (error && error.code === 'missing_device_credential') {
          return jsonResponse(400, {
            error: 'missing_device_credential'
          });
        }

        throw error;
      }
    }

    const agentPlanWriteActions = new Set([
      'addAgentPlanItem',
      'addAgentPlanItems',
      'updateAgentPlanItem',
      'updateAgentPlanItems',
      'deleteAgentPlanItem',
      'deleteAgentPlanItems',
      'getAgentPlanRequestStatus',
      'submitAgentPlanRequest'
    ]);

    if (agentPlanWriteActions.has(action)) {
      if (!AGENT_WRITE_TOKEN) {
        return jsonResponse(500, {
          error: 'missing_agent_write_token'
        });
      }

      if (requestToken !== AGENT_WRITE_TOKEN) {
        return jsonResponse(403, {
          error: 'forbidden'
        });
      }

      try {
        if (action === 'submitAgentPlanRequest') {
          return jsonResponse(400, {
            error: 'whole_replace_not_allowed'
          });
        }

        if (action !== 'getAgentPlanRequestStatus') {
          return jsonResponse(200, await agentPlanRuntime.submitRequest({
            ...payload,
            action
          }));
        }

        return jsonResponse(200, {
          ok: true,
          request: await agentPlanRuntime.getRequestStatus(payload.requestId || payload.id)
        });
      } catch (error) {
        if (error && error.code) {
          return jsonResponse(400, {
            error: error.code
          });
        }

        throw error;
      }
    }

    if (action !== 'saveStudentItems') {
      return jsonResponse(400, {
        error: 'unsupported_action'
      });
    }

    let writeMode = 'denied';
    let studentDevice = null;

    if (STUDENT_WRITE_TOKEN && requestToken === STUDENT_WRITE_TOKEN) {
      writeMode = 'token';
    } else if (READ_TOKEN && requestToken === READ_TOKEN) {
      studentDevice = normalizeStudentDeviceRequest(payload);

      if (!studentDevice.deviceId || !studentDevice.deviceSecret) {
        return jsonResponse(400, {
          error: 'missing_device_credential'
        });
      }

      writeMode = 'approval';
    }

    if (writeMode === 'denied') {
      if (!STUDENT_WRITE_TOKEN && !READ_TOKEN) {
        return jsonResponse(500, {
          error: 'missing_student_write_token'
        });
      }

      return jsonResponse(403, {
        error: 'forbidden'
      });
    }

    try {
      return jsonResponse(200, sanitizePublicState(await writeStudentItems(payload.items, {
        studentDevice: writeMode === 'approval' ? studentDevice : null
      })));
    } catch (error) {
      if (error && error.code === 'device_not_approved') {
        return jsonResponse(403, {
          error: 'device_not_approved'
        });
      }

      throw error;
    }
  }

  return jsonResponse(405, {
    error: 'method_not_allowed'
  });
};
