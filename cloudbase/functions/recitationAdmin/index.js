'use strict';

const cloud = require('wx-server-sdk');
const { createAgentRecitationRuntime } = require('./shared/agent-recitation-runtime');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const ADMIN_COLLECTION = process.env.ADMIN_COLLECTION || 'study_admins';
const ADMIN_DOC_ID = process.env.ADMIN_DOC_ID || 'main';
const AGENT_RECITATION_COLLECTION = process.env.AGENT_RECITATION_COLLECTION || 'study_agent_recitation_requests';
const AGENT_RECITATION_DOC_ID = process.env.AGENT_RECITATION_DOC_ID || 'main';
const MAX_AGENT_RECITATION_REQUESTS = 60;

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

const recitationRuntime = createAgentRecitationRuntime({
  db,
  collectionName: AGENT_RECITATION_COLLECTION,
  docId: AGENT_RECITATION_DOC_ID,
  maxRequests: MAX_AGENT_RECITATION_REQUESTS,
  normalizePrefix,
  normalizeId
});

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

exports.main = async (event = {}) => {
  const action = normalizePrefix(event.action) || 'listAgentRecitationRequests';

  if (action === 'whoami') {
    const openId = currentOpenId(event);
    const adminState = await resolveAdminState({
      persistBootstrap: true
    });
    const allowList = new Set(adminState.openIds);
    const items = await recitationRuntime.listRequests();

    return {
      ok: true,
      openId,
      authorized: Boolean(openId && allowList.has(openId)),
      adminCount: adminState.openIds.length,
      adminSource: adminState.source,
      recitationRequestCount: items.length,
      pendingRecitationRequestCount: items.filter((item) => item.status === 'pending').length
    };
  }

  await assertAdmin(event);

  if (action === 'listAgentRecitationRequests') {
    const items = await recitationRuntime.listRequests();
    return {
      ok: true,
      items,
      updatedAt: items[0] ? items[0].updatedAt : ''
    };
  }

  if (action === 'getAgentRecitationRequestStatus') {
    return {
      ok: true,
      request: await recitationRuntime.getRequestStatus(event.requestId || event.id)
    };
  }

  if (action === 'getAgentRecitationRequestStatuses') {
    return {
      ok: true,
      requests: await recitationRuntime.getRequestStatuses(event.requestIds || event.ids)
    };
  }

  throw new Error(`不支持的 action: ${action}`);
};
