'use strict';

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function ensureObjectPayload(payload, command) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`${command} 需要一个 JSON 对象作为请求体。`);
  }

  return payload;
}

function makeRequestId(prefix) {
  return `${prefix}-${Date.now()}`;
}

function normalizeCreateRequest(payload, index = 0) {
  const nextPayload = ensureObjectPayload(payload, 'recitation-create');
  const sourceText = normalizeText(nextPayload.sourceText || nextPayload.text || nextPayload.content);

  if (!sourceText) {
    throw new Error('创建背诵必须提供 sourceText。');
  }

  return {
    requestId: normalizeText(nextPayload.requestId) || makeRequestId(`openclaw-recitation-${index + 1}`),
    agentId: normalizeText(nextPayload.agentId) || 'openclaw',
    label: normalizeText(nextPayload.label) || 'OpenClaw',
    title: normalizeText(nextPayload.title),
    subject: normalizeText(nextPayload.subject) || '语文',
    bucket: normalizeText(nextPayload.bucket) || '课内',
    targetDate: normalizeText(nextPayload.targetDate),
    sourceText,
    summary: normalizeText(nextPayload.summary),
    note: normalizeText(nextPayload.note || nextPayload.description)
  };
}

function buildRecitationCreatePayload(payload) {
  const nextPayload = ensureObjectPayload(payload, 'recitation-create');
  const requests = Array.isArray(nextPayload.requests)
    ? nextPayload.requests
    : Array.isArray(nextPayload.items) && nextPayload.items.every((item) => item && typeof item === 'object')
      ? nextPayload.items
      : null;

  if (requests) {
    return {
      action: 'submitAgentRecitationRequests',
      requests: requests.map((item, index) => normalizeCreateRequest(item, index))
    };
  }

  return {
    action: 'submitAgentRecitationRequest',
    ...normalizeCreateRequest(nextPayload)
  };
}

function buildRecitationQueryPayload(payload) {
  const nextPayload = payload && typeof payload === 'object' ? payload : {};
  const query = {
    action: 'queryAgentRecitationRequests'
  };

  if (normalizeText(nextPayload.targetDate)) {
    query.targetDate = normalizeText(nextPayload.targetDate);
  }

  if (Array.isArray(nextPayload.targetDates)) {
    query.targetDates = nextPayload.targetDates.filter((item) => normalizeText(item));
  } else if (Array.isArray(nextPayload.dates)) {
    query.targetDates = nextPayload.dates.filter((item) => normalizeText(item));
  }

  if (normalizeText(nextPayload.subject)) {
    query.subject = normalizeText(nextPayload.subject);
  }

  if (Array.isArray(nextPayload.subjects)) {
    query.subjects = nextPayload.subjects.filter((item) => normalizeText(item));
  }

  if (normalizeText(nextPayload.bucket)) {
    query.bucket = normalizeText(nextPayload.bucket);
  }

  if (normalizeText(nextPayload.status)) {
    query.status = normalizeText(nextPayload.status);
  }

  if (Array.isArray(nextPayload.statuses)) {
    query.statuses = nextPayload.statuses.filter((item) => normalizeText(item));
  }

  if (Number.isFinite(Number(nextPayload.limit))) {
    query.limit = Number(nextPayload.limit);
  }

  return query;
}

function buildRecitationStatusPayload(payload, requestIdOption) {
  const nextPayload = payload && typeof payload === 'object' ? payload : {};
  const requestIds = Array.isArray(nextPayload.requestIds)
    ? nextPayload.requestIds.filter((item) => normalizeText(item))
    : Array.isArray(nextPayload.ids)
      ? nextPayload.ids.filter((item) => normalizeText(item))
      : [];

  if (requestIds.length) {
    return {
      action: 'getAgentRecitationRequestStatuses',
      requestIds
    };
  }

  const requestId = normalizeText(requestIdOption || nextPayload.requestId || nextPayload.id);

  if (!requestId) {
    throw new Error('背诵状态查询必须提供 requestId。');
  }

  return {
    action: 'getAgentRecitationRequestStatus',
    requestId
  };
}

module.exports = {
  buildRecitationCreatePayload,
  buildRecitationQueryPayload,
  buildRecitationStatusPayload
};
