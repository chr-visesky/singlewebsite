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
  return String(value || '').trim().slice(0, 40) || '语文';
}

function normalizeLanguage(value, subject) {
  const normalized = String(value || '').trim();

  if (normalized) {
    return normalized.slice(0, 20);
  }

  return normalizeSubject(subject) === '英语' ? '英语' : '中文';
}

function normalizeCourseField(value, maxLength = 80) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeSourceType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || 'manual';
}

function normalizeQueryText(value) {
  return String(value || '').trim().slice(0, 40).toLowerCase();
}

function normalizeSummary(value, fallback) {
  const summary = String(value || '').trim().slice(0, 240);
  return summary || fallback;
}

function normalizeNote(value) {
  return String(value || '').trim().slice(0, 1200);
}

function normalizeItems(rawItems) {
  return (Array.isArray(rawItems) ? rawItems : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 300);
}

function sortRequests(items) {
  return items.slice().sort((left, right) =>
    (right.updatedAt || right.requestedAt || '').localeCompare(left.updatedAt || left.requestedAt || '')
    || left.id.localeCompare(right.id)
  );
}

function createAgentDictationRuntime(options = {}) {
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
    return `agent-dictation-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;
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

      const dictationItems = normalizeItems(item.items);

      if (!dictationItems.length) {
        continue;
      }

      seenIds.add(id);
      const fallbackDate = normalizeDate(item.requestedAt, new Date().toISOString().slice(0, 10));
      const subject = normalizeSubject(item.subject);
      const bucket = normalizeBucket(item.bucket);

      items.push({
        id,
        role: 'agent',
        agentId: normalizeId(item.agentId || item.requesterId || item.label, 'agent'),
        label: normalizePrefix(item.label).slice(0, 80) || '智能体',
        status: normalizePrefix(item.status).toLowerCase() === 'completed' ? 'completed' : 'pending',
        title: normalizePrefix(item.title).slice(0, 120),
        subject,
        bucket,
        targetDate: normalizeDate(item.targetDate, fallbackDate),
        language: normalizeLanguage(item.language, subject),
        sourceType: normalizeSourceType(item.sourceType || 'cloud'),
        textbook: normalizeCourseField(item.textbook, 120),
        grade: normalizeCourseField(item.grade, 40),
        term: normalizeCourseField(item.term, 40),
        unitTitle: normalizeCourseField(item.unitTitle, 80),
        lessonTitle: normalizeCourseField(item.lessonTitle, 80),
        courseKey: normalizeCourseField(item.courseKey, 120),
        items: dictationItems,
        summary: normalizeSummary(item.summary, `${subject}听写创建请求`),
        note: normalizeNote(item.note || item.description),
        requestedAt: normalizePrefix(item.requestedAt),
        completedAt: normalizePrefix(item.completedAt),
        updatedAt: normalizePrefix(item.updatedAt),
        result: item.result && typeof item.result === 'object'
          ? {
              taskId: normalizePrefix(item.result.taskId),
              itemCount: Math.max(0, Number(item.result.itemCount) || 0),
              subject: normalizeSubject(item.result.subject || subject),
              bucket: normalizeBucket(item.result.bucket || bucket),
              targetDate: normalizeDate(item.result.targetDate || item.targetDate, fallbackDate)
            }
          : null
      });
    }

    return items;
  }

  function trimRequests(items) {
    const sorted = sortRequests(normalizeRequests(items));
    const openItems = sorted.filter((item) => item.status !== 'completed');
    const closedItems = sorted.filter((item) => item.status === 'completed');

    if (openItems.length >= maxRequests) {
      return openItems.slice(0, maxRequests);
    }

    return [...openItems, ...closedItems.slice(0, Math.max(0, maxRequests - openItems.length))];
  }

  function normalizeQueryFilters(rawFilters = {}) {
    const filters = rawFilters && typeof rawFilters === 'object' ? rawFilters : {};
    const dateCandidates = [];

    if (typeof filters.targetDate === 'string') {
      dateCandidates.push(filters.targetDate);
    }

    if (Array.isArray(filters.targetDates)) {
      dateCandidates.push(...filters.targetDates);
    }

    if (Array.isArray(filters.dates)) {
      dateCandidates.push(...filters.dates);
    }

    const targetDates = Array.from(new Set(
      dateCandidates
        .map((item) => normalizeDate(item, ''))
        .filter(Boolean)
    ));
    const subjectCandidates = [];

    if (typeof filters.subject === 'string') {
      subjectCandidates.push(filters.subject);
    }

    if (Array.isArray(filters.subjects)) {
      subjectCandidates.push(...filters.subjects);
    }

    const subjects = Array.from(new Set(
      subjectCandidates
        .map((item) => normalizeQueryText(item))
        .filter(Boolean)
    ));
    const rawBucket = normalizePrefix(filters.bucket);
    const bucket = rawBucket ? normalizeBucket(rawBucket) : '';
    const statusCandidates = [];

    if (typeof filters.status === 'string') {
      statusCandidates.push(filters.status);
    }

    if (Array.isArray(filters.statuses)) {
      statusCandidates.push(...filters.statuses);
    }

    const statuses = Array.from(new Set(
      statusCandidates
        .map((item) => normalizePrefix(item).toLowerCase())
        .filter((item) => ['pending', 'completed'].includes(item))
    ));
    const numericLimit = Number(filters.limit);
    const limit = Number.isFinite(numericLimit)
      ? Math.min(maxRequests, Math.max(1, Math.trunc(numericLimit)))
      : Math.min(maxRequests, 20);

    return {
      targetDates,
      subjects,
      bucket,
      statuses,
      limit
    };
  }

  function matchesSubjectFilter(itemSubject, subjects) {
    if (!subjects.length) {
      return true;
    }

    const normalizedItemSubject = normalizeQueryText(itemSubject);
    return subjects.some((subject) =>
      normalizedItemSubject === subject
      || normalizedItemSubject.includes(subject)
      || subject.includes(normalizedItemSubject)
    );
  }

  function matchesQueryFilters(item, filters) {
    if (!item) {
      return false;
    }

    if (filters.targetDates.length && !filters.targetDates.includes(item.targetDate)) {
      return false;
    }

    if (!matchesSubjectFilter(item.subject, filters.subjects)) {
      return false;
    }

    if (filters.bucket && item.bucket !== filters.bucket) {
      return false;
    }

    if (filters.statuses.length && !filters.statuses.includes(normalizePrefix(item.status).toLowerCase())) {
      return false;
    }

    return true;
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

  function serializeRequest(item) {
    return {
      id: item.id,
      role: item.role,
      agentId: item.agentId,
      label: item.label,
      status: item.status,
      title: item.title,
      subject: item.subject,
      bucket: item.bucket,
      targetDate: item.targetDate,
      language: item.language,
      sourceType: item.sourceType,
      textbook: item.textbook,
      grade: item.grade,
      term: item.term,
      unitTitle: item.unitTitle,
      lessonTitle: item.lessonTitle,
      courseKey: item.courseKey,
      items: item.items.slice(),
      itemCount: item.items.length,
      summary: item.summary,
      note: item.note,
      requestedAt: item.requestedAt,
      completedAt: item.completedAt,
      updatedAt: item.updatedAt,
      result: item.result
    };
  }

  async function serializeRequests(items) {
    return items.map((item) => serializeRequest(item));
  }

  async function listPendingRequests() {
    const state = await readState(db);
    return serializeRequests(state.items.filter((item) => item.status === 'pending'));
  }

  async function listRequests() {
    const state = await readState(db);
    return serializeRequests(state.items);
  }

  async function queryRequests(rawFilters = {}) {
    const filters = normalizeQueryFilters(rawFilters);
    const state = await readState(db);
    const matchedItems = sortRequests(state.items)
      .filter((item) => matchesQueryFilters(item, filters))
      .slice(0, filters.limit);

    return serializeRequests(matchedItems);
  }

  async function getRequestStatus(requestId) {
    const normalizedRequestId = normalizeId(requestId, '');

    if (!normalizedRequestId) {
      const error = new Error('missing_agent_dictation_request_id');
      error.code = 'missing_agent_dictation_request_id';
      throw error;
    }

    const state = await readState(db);
    const matched = state.items.find((item) => item.id === normalizedRequestId);

    if (!matched) {
      const error = new Error('agent_dictation_request_not_found');
      error.code = 'agent_dictation_request_not_found';
      throw error;
    }

    return serializeRequest(matched);
  }

  async function getRequestStatuses(requestIds = []) {
    const ids = Array.isArray(requestIds) ? requestIds : [requestIds];
    const normalizedIds = [];
    const seenIds = new Set();

    for (const requestId of ids) {
      const normalizedRequestId = normalizeId(requestId, '');

      if (!normalizedRequestId || seenIds.has(normalizedRequestId)) {
        continue;
      }

      seenIds.add(normalizedRequestId);
      normalizedIds.push(normalizedRequestId);
    }

    if (!normalizedIds.length) {
      const error = new Error('missing_agent_dictation_request_ids');
      error.code = 'missing_agent_dictation_request_ids';
      throw error;
    }

    const state = await readState(db);
    return serializeRequests(normalizedIds.map((requestId) => {
      const matched = state.items.find((item) => item.id === requestId);

      if (!matched) {
        const error = new Error('agent_dictation_request_not_found');
        error.code = 'agent_dictation_request_not_found';
        throw error;
      }

      return matched;
    }));
  }

  async function createRequest(payload = {}, now) {
    const requestId = normalizeId(payload.requestId || payload.id, '') || createRequestId();
    const subject = normalizeSubject(payload.subject);
    const items = normalizeItems(payload.items);

    if (!items.length) {
      const error = new Error('agent_dictation_items_required');
      error.code = 'agent_dictation_items_required';
      throw error;
    }

    return {
      id: requestId,
      role: 'agent',
      agentId: normalizeId(payload.agentId || payload.requesterId || payload.label, 'agent'),
      label: normalizePrefix(payload.label).slice(0, 80) || '智能体',
      status: 'pending',
      title: normalizePrefix(payload.title).slice(0, 120) || `${subject}听写 ${normalizeDate(payload.targetDate, now.slice(0, 10))}`,
      subject,
      bucket: normalizeBucket(payload.bucket),
      targetDate: normalizeDate(payload.targetDate, now.slice(0, 10)),
      language: normalizeLanguage(payload.language, subject),
      sourceType: normalizeSourceType(payload.sourceType || 'cloud'),
      textbook: normalizeCourseField(payload.textbook, 120),
      grade: normalizeCourseField(payload.grade, 40),
      term: normalizeCourseField(payload.term, 40),
      unitTitle: normalizeCourseField(payload.unitTitle, 80),
      lessonTitle: normalizeCourseField(payload.lessonTitle, 80),
      courseKey: normalizeCourseField(payload.courseKey, 120),
      items,
      summary: normalizeSummary(payload.summary, `${subject}听写创建请求`),
      note: normalizeNote(payload.note || payload.description),
      requestedAt: now,
      completedAt: '',
      updatedAt: now,
      result: null
    };
  }

  async function submitRequest(payload = {}) {
    const now = new Date().toISOString();
    const request = await createRequest(payload, now);

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
          const error = new Error('agent_dictation_request_closed');
          error.code = 'agent_dictation_request_closed';
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

      await persistState(transaction, trimRequests(nextItems), now);
      return serializeRequest(storedRequest);
    });
  }

  async function submitRequests(payloads = []) {
    const items = Array.isArray(payloads) ? payloads : [];

    if (!items.length) {
      const error = new Error('missing_agent_dictation_requests');
      error.code = 'missing_agent_dictation_requests';
      throw error;
    }

    const results = [];

    for (const payload of items) {
      results.push(await submitRequest(payload));
    }

    return results;
  }

  async function completeRequest(requestId, payload = {}) {
    const normalizedRequestId = normalizeId(requestId, '');

    if (!normalizedRequestId) {
      const error = new Error('missing_agent_dictation_request_id');
      error.code = 'missing_agent_dictation_request_id';
      throw error;
    }

    if (typeof ensureCollectionExists === 'function') {
      await ensureCollectionExists();
    }

    const completedRequest = await db.runTransaction(async (transaction) => {
      const currentState = await readState(transaction);
      const target = currentState.items.find((item) => item.id === normalizedRequestId);

      if (!target) {
        const error = new Error('agent_dictation_request_not_found');
        error.code = 'agent_dictation_request_not_found';
        throw error;
      }

      if (target.status === 'completed') {
        return target;
      }

      if (target.status !== 'pending') {
        const error = new Error('agent_dictation_request_not_ready');
        error.code = 'agent_dictation_request_not_ready';
        throw error;
      }

      const now = new Date().toISOString();
      const completed = {
        ...target,
        status: 'completed',
        completedAt: now,
        updatedAt: now,
        result: {
          taskId: normalizePrefix(payload.taskId),
          itemCount: Math.max(0, Number(payload.itemCount) || target.items.length),
          subject: normalizeSubject(payload.subject || target.subject),
          bucket: normalizeBucket(payload.bucket || target.bucket),
          targetDate: normalizeDate(payload.targetDate || target.targetDate, target.targetDate)
        }
      };
      const nextItems = trimRequests(
        currentState.items.map((item) => (item.id === normalizedRequestId ? completed : item))
      );
      await persistState(transaction, nextItems, now);
      return completed;
    });

    return serializeRequest(completedRequest);
  }

  return {
    completeRequest,
    getRequestStatus,
    getRequestStatuses,
    listRequests,
    listPendingRequests,
    queryRequests,
    submitRequest,
    submitRequests
  };
}

module.exports = {
  createAgentDictationRuntime
};
