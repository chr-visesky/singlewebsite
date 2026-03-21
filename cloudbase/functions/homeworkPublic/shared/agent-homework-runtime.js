'use strict';

function createMissingDocMatcher(normalizePrefix) {
  return (error) => {
    const message = normalizePrefix(error && (error.errMsg || error.message));
    return message.includes('document.get:fail') || message.includes('not exist');
  };
}

function normalizeDate(value, fallback) {
  const raw = typeof value === 'string' ? value.trim() : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : fallback;
}

function normalizeBucket(value) {
  return String(value || '').trim() === '课外' ? '课外' : '课内';
}

function normalizeSubject(value) {
  return String(value || '').trim().slice(0, 40) || '作业';
}

function normalizeSummary(value, fallback) {
  const summary = String(value || '').trim().slice(0, 240);
  return summary || fallback;
}

function normalizeNote(value) {
  return String(value || '').trim().slice(0, 1200);
}

function normalizeUrl(value) {
  const raw = String(value || '').trim();

  if (!/^https?:\/\//i.test(raw)) {
    return '';
  }

  try {
    return new URL(raw).href;
  } catch {
    return '';
  }
}

function fileKindFromUrl(url) {
  try {
    const pathname = new URL(url).pathname.toLowerCase();

    if (pathname.endsWith('.pdf')) {
      return 'pdf';
    }

    if (/\.(?:jpg|jpeg|png|bmp|gif)$/i.test(pathname)) {
      return 'image';
    }
  } catch {
    return '';
  }

  return '';
}

function normalizeSourceUrls(rawUrls) {
  const source = Array.isArray(rawUrls) ? rawUrls : [];
  const seen = new Set();
  const urls = [];

  for (const item of source) {
    const normalized = normalizeUrl(item);

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    urls.push(normalized);
  }

  return urls.slice(0, 16);
}

function validateSourceUrls(sourceUrls) {
  const kinds = sourceUrls.map(fileKindFromUrl).filter(Boolean);
  const pdfCount = kinds.filter((item) => item === 'pdf').length;
  const imageCount = kinds.filter((item) => item === 'image').length;

  if (pdfCount > 1) {
    const error = new Error('agent_homework_only_one_pdf');
    error.code = 'agent_homework_only_one_pdf';
    throw error;
  }

  if (pdfCount > 0 && imageCount > 0) {
    const error = new Error('agent_homework_mixed_sources');
    error.code = 'agent_homework_mixed_sources';
    throw error;
  }
}

function createHomeworkRuntimeError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function createAgentHomeworkRuntime(options = {}) {
  const {
    db,
    collectionName,
    docId,
    ensureCollectionExists,
    maxRequests = 60,
    normalizePrefix,
    normalizeId
  } = options;
  const isMissingDocError = createMissingDocMatcher(normalizePrefix);

  function createRequestId() {
    return `agent-homework-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;
  }

  function normalizeRequestOperation(value) {
    return normalizePrefix(value).toLowerCase() === 'delete' ? 'delete' : 'create';
  }

  function normalizeRequestStatus(value) {
    const normalized = normalizePrefix(value).toLowerCase();
    return normalized === 'completed' ? 'completed' : 'pending';
  }

  function normalizeRequests(rawItems) {
    const source = Array.isArray(rawItems) ? rawItems : [];
    const items = [];
    const seenIds = new Set();

    for (const rawItem of source) {
      const item = rawItem && typeof rawItem === 'object' ? rawItem : {};
      const id = normalizeId(item.id || item.requestId, '');

      if (!id || seenIds.has(id)) {
        continue;
      }

      seenIds.add(id);
      const operation = normalizeRequestOperation(item.operation || item.mode);
      const sourceUrls = operation === 'delete' ? [] : normalizeSourceUrls(item.sourceUrls);
      const fallbackDate = normalizeDate(item.requestedAt, new Date().toISOString().slice(0, 10));
      const targetJobId = operation === 'delete'
        ? normalizePrefix(item.targetJobId || item.jobId || (item.result && item.result.jobId))
        : '';
      const subject = normalizeSubject(item.subject || (operation === 'delete' ? '作业' : '作业'));
      const bucket = normalizeBucket(item.bucket);
      items.push({
        id,
        role: 'agent',
        agentId: normalizeId(item.agentId || item.requesterId || item.label, 'agent'),
        label: normalizePrefix(item.label).slice(0, 80) || '智能体',
        status: normalizeRequestStatus(item.status),
        operation,
        targetJobId,
        subject,
        bucket,
        targetDate: normalizeDate(item.targetDate, fallbackDate),
        mode: operation === 'delete' ? 'delete' : sourceUrls.length ? 'files' : 'blank',
        sourceUrls,
        summary: normalizeSummary(
          item.summary,
          operation === 'delete' ? `${subject}作业删除申请` : `${subject}作业创建申请`
        ),
        note: normalizeNote(item.note || item.description),
        requestedAt: normalizePrefix(item.requestedAt),
        completedAt: normalizePrefix(item.completedAt),
        updatedAt: normalizePrefix(item.updatedAt),
        result: item.result && typeof item.result === 'object'
          ? {
              jobId: normalizePrefix(item.result.jobId),
              totalPages: Math.max(0, Number(item.result.totalPages) || 0),
              subject: normalizeSubject(item.result.subject || subject),
              bucket: normalizeBucket(item.result.bucket || bucket),
              targetDate: normalizeDate(item.result.targetDate || item.targetDate, fallbackDate)
            }
          : null
      });
    }

    return items;
  }

  function sanitizeRequest(item) {
    return {
      id: item.id,
      role: item.role,
      agentId: item.agentId,
      label: item.label,
      status: item.status,
      operation: item.operation,
      targetJobId: item.targetJobId,
      subject: item.subject,
      bucket: item.bucket,
      targetDate: item.targetDate,
      mode: item.mode,
      sourceUrls: item.sourceUrls,
      sourceUrlCount: item.sourceUrls.length,
      summary: item.summary,
      note: item.note,
      requestedAt: item.requestedAt,
      completedAt: item.completedAt,
      updatedAt: item.updatedAt,
      result: item.result
    };
  }

  function trimRequests(items) {
    return normalizeRequests(items)
      .sort((left, right) =>
        (right.updatedAt || right.requestedAt || '').localeCompare(left.updatedAt || left.requestedAt || '') ||
        left.id.localeCompare(right.id)
      )
      .slice(0, maxRequests);
  }

  async function readState(reader) {
    try {
      const result = await reader.collection(collectionName).doc(docId).get();
      const data = result && result.data ? result.data : {};
      return {
        updatedAt: normalizePrefix(data.updatedAt),
        items: normalizeRequests(data.items)
      };
    } catch (error) {
      if (isMissingDocError(error)) {
        return {
          updatedAt: '',
          items: []
        };
      }

      throw error;
    }
  }

  async function persistState(transaction, items, updatedAt) {
    await transaction.collection(collectionName).doc(docId).set({
      data: {
        updatedAt,
        items
      }
    });
  }

  function createRequest(payload = {}, now) {
    const operation = normalizeRequestOperation(payload.operation || payload.mode);
    const sourceUrls = operation === 'delete' ? [] : normalizeSourceUrls(payload.sourceUrls);
    const targetJobId = operation === 'delete' ? normalizePrefix(payload.jobId || payload.targetJobId) : '';
    const subject = normalizeSubject(payload.subject || (operation === 'delete' ? '作业' : payload.subject));

    if (operation === 'delete' && !targetJobId) {
      throw createHomeworkRuntimeError('missing_agent_homework_job_id');
    }

    if (operation !== 'delete') {
      validateSourceUrls(sourceUrls);
    }

    const targetDate = normalizeDate(payload.targetDate, now.slice(0, 10));

    return {
      id: normalizeId(payload.requestId || payload.id, '') || createRequestId(),
      role: 'agent',
      agentId: normalizeId(payload.agentId || payload.requesterId || payload.label, 'agent'),
      label: normalizePrefix(payload.label).slice(0, 80) || '智能体',
      status: 'pending',
      operation,
      targetJobId,
      subject,
      bucket: normalizeBucket(payload.bucket),
      targetDate,
      mode: operation === 'delete' ? 'delete' : sourceUrls.length ? 'files' : 'blank',
      sourceUrls,
      summary: normalizeSummary(
        payload.summary,
        operation === 'delete' ? `${subject}作业删除申请` : `${subject}作业创建申请`
      ),
      note: normalizeNote(payload.note || payload.description),
      requestedAt: now,
      completedAt: '',
      updatedAt: now,
      result: null
    };
  }

  async function listPendingRequests() {
    const state = await readState(db);
    return state.items
      .filter((item) => item.status === 'pending')
      .map(sanitizeRequest);
  }

  async function listRequests() {
    const state = await readState(db);
    return state.items.map(sanitizeRequest);
  }

  async function getRequestStatus(requestId) {
    const normalizedRequestId = normalizeId(requestId, '');

    if (!normalizedRequestId) {
      const error = new Error('missing_agent_homework_request_id');
      error.code = 'missing_agent_homework_request_id';
      throw error;
    }

    const state = await readState(db);
    const matched = state.items.find((item) => item.id === normalizedRequestId);

    if (!matched) {
      const error = new Error('agent_homework_request_not_found');
      error.code = 'agent_homework_request_not_found';
      throw error;
    }

    return sanitizeRequest(matched);
  }

  async function submitRequest(payload = {}) {
    const now = new Date().toISOString();
    const request = createRequest(payload, now);

    if (typeof ensureCollectionExists === 'function') {
      await ensureCollectionExists();
    }

    return db.runTransaction(async (transaction) => {
      const currentState = await readState(transaction);
      const existingIndex = currentState.items.findIndex((item) => item.id === request.id);
      let nextItems = currentState.items;
      let storedRequest = request;

      if (existingIndex >= 0) {
        const existing = currentState.items[existingIndex];

        if (existing.status !== 'pending') {
          const error = new Error('agent_homework_request_closed');
          error.code = 'agent_homework_request_closed';
          throw error;
        }

        storedRequest = {
          ...request,
          requestedAt: existing.requestedAt || request.requestedAt,
          updatedAt: now
        };
        nextItems = currentState.items.map((item, index) => (index === existingIndex ? storedRequest : item));
      } else {
        nextItems = [...currentState.items, storedRequest];
      }

      const trimmed = trimRequests(nextItems);
      await persistState(transaction, trimmed, now);
      return sanitizeRequest(storedRequest);
    });
  }

  async function submitDeleteRequest(payload = {}) {
    return submitRequest({
      ...payload,
      operation: 'delete'
    });
  }

  async function completeRequest(requestId, payload = {}) {
    const normalizedRequestId = normalizeId(requestId, '');

    if (!normalizedRequestId) {
      const error = new Error('missing_agent_homework_request_id');
      error.code = 'missing_agent_homework_request_id';
      throw error;
    }

    if (typeof ensureCollectionExists === 'function') {
      await ensureCollectionExists();
    }

    return db.runTransaction(async (transaction) => {
      const currentState = await readState(transaction);
      const target = currentState.items.find((item) => item.id === normalizedRequestId);

      if (!target) {
        const error = new Error('agent_homework_request_not_found');
        error.code = 'agent_homework_request_not_found';
        throw error;
      }

      if (target.status === 'completed') {
        return sanitizeRequest(target);
      }

      const now = new Date().toISOString();
      const completed = {
        ...target,
        status: 'completed',
        completedAt: now,
        updatedAt: now,
        result: {
          jobId: normalizePrefix(payload.jobId || target.targetJobId),
          totalPages:
            target.operation === 'delete'
              ? 0
              : Math.max(0, Number(payload.totalPages) || 0),
          subject: normalizeSubject(payload.subject || target.subject),
          bucket: normalizeBucket(payload.bucket || target.bucket),
          targetDate: normalizeDate(payload.targetDate || target.targetDate, target.targetDate)
        }
      };
      const nextItems = trimRequests(
        currentState.items.map((item) => (item.id === normalizedRequestId ? completed : item))
      );
      await persistState(transaction, nextItems, now);
      return sanitizeRequest(completed);
    });
  }

  return {
    completeRequest,
    getRequestStatus,
    listRequests,
    listPendingRequests,
    submitDeleteRequest,
    submitRequest
  };
}

module.exports = {
  createAgentHomeworkRuntime
};
