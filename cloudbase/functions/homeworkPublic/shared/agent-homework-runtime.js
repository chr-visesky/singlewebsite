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

function normalizeContentType(value) {
  return String(value || '').trim().toLowerCase();
}

function fileKindFromContentType(value) {
  const normalized = normalizeContentType(value);

  if (normalized.includes('pdf')) {
    return 'pdf';
  }

  if (normalized.startsWith('image/')) {
    return 'image';
  }

  return '';
}

function extensionFromFileName(value) {
  const fileName = String(value || '').trim().toLowerCase();
  const matched = fileName.match(/\.([a-z0-9]{2,5})$/i);
  return matched ? `.${matched[1]}` : '';
}

function fileKindFromExtension(value) {
  const normalized = String(value || '').trim().toLowerCase();

  if (normalized === '.pdf') {
    return 'pdf';
  }

  if (['.jpg', '.jpeg', '.png', '.bmp', '.gif', '.webp'].includes(normalized)) {
    return 'image';
  }

  return '';
}

function contentTypeFromExtension(value) {
  const normalized = String(value || '').trim().toLowerCase();

  if (normalized === '.pdf') {
    return 'application/pdf';
  }

  if (normalized === '.jpg' || normalized === '.jpeg') {
    return 'image/jpeg';
  }

  if (normalized === '.png') {
    return 'image/png';
  }

  if (normalized === '.bmp') {
    return 'image/bmp';
  }

  if (normalized === '.gif') {
    return 'image/gif';
  }

  if (normalized === '.webp') {
    return 'image/webp';
  }

  return '';
}

function fileKindFromUrl(url) {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return fileKindFromExtension(extensionFromFileName(pathname));
  } catch {
    return '';
  }
}

function normalizeFileName(value, fallback) {
  const baseName = String(value || '').trim().replace(/[\\/:*?"<>|]+/g, '-');
  return (baseName || fallback || 'source').slice(0, 120);
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

function decodeInlineSourceContent(rawValue) {
  const sourceText = String(rawValue || '').trim();

  if (!sourceText) {
    const error = new Error('missing_agent_homework_inline_content');
    error.code = 'missing_agent_homework_inline_content';
    throw error;
  }

  const matched = sourceText.match(/^data:([^;,]+);base64,(.*)$/is);
  const contentType = matched ? normalizeContentType(matched[1]) : '';
  const base64Text = (matched ? matched[2] : sourceText).replace(/\s+/g, '');
  const buffer = Buffer.from(base64Text, 'base64');

  if (!buffer.length) {
    const error = new Error('invalid_agent_homework_inline_content');
    error.code = 'invalid_agent_homework_inline_content';
    throw error;
  }

  return {
    buffer,
    contentType
  };
}

function normalizeInlineSources(rawInlineSources = []) {
  const source = Array.isArray(rawInlineSources) ? rawInlineSources : [];
  const items = [];

  for (let index = 0; index < source.length; index += 1) {
    const rawItem = source[index];
    const item = rawItem && typeof rawItem === 'object' ? rawItem : {};
    const decoded = decodeInlineSourceContent(item.base64 || item.data || item.content);
    const fileName = normalizeFileName(item.fileName || item.name, `source-${index + 1}`);
    const extension = extensionFromFileName(fileName);
    const contentType = normalizeContentType(item.contentType || item.mimeType || decoded.contentType)
      || contentTypeFromExtension(extension);
    const fileKind = fileKindFromContentType(contentType) || fileKindFromExtension(extension);

    if (!fileKind) {
      const error = new Error('agent_homework_source_type_not_supported');
      error.code = 'agent_homework_source_type_not_supported';
      throw error;
    }

    items.push({
      fileName,
      contentType,
      fileKind,
      buffer: decoded.buffer
    });
  }

  return items.slice(0, 16);
}

function normalizeSourceItem(value, normalizePrefix) {
  const item = value && typeof value === 'object' ? value : {};
  const sourceType = normalizePrefix(item.sourceType || item.kind || item.type).toLowerCase() === 'storage'
    ? 'storage'
    : 'url';

  if (sourceType === 'storage') {
    const fileId = normalizePrefix(item.fileId || item.fileID);
    const cloudPath = normalizePrefix(item.cloudPath);
    const fileName = normalizeFileName(item.fileName, 'source');
    const contentType = normalizeContentType(item.contentType || item.mimeType);
    const fileKind = item.fileKind === 'pdf' || item.fileKind === 'image'
      ? item.fileKind
      : fileKindFromContentType(contentType) || fileKindFromExtension(extensionFromFileName(fileName));

    if ((!fileId && !cloudPath) || !fileKind) {
      return null;
    }

    return {
      sourceType,
      fileId,
      cloudPath,
      fileName,
      contentType,
      fileKind,
      size: Math.max(0, Number(item.size) || 0)
    };
  }

  const url = normalizeUrl(item.url || item.sourceUrl || item.href);
  const fileName = normalizeFileName(item.fileName, 'source');
  const contentType = normalizeContentType(item.contentType || item.mimeType);
  const fileKind = item.fileKind === 'pdf' || item.fileKind === 'image'
    ? item.fileKind
    : fileKindFromUrl(url) || fileKindFromContentType(contentType) || fileKindFromExtension(extensionFromFileName(fileName));

  if (!url || !fileKind) {
    return null;
  }

  return {
    sourceType: 'url',
    url,
    fileName,
    contentType,
    fileKind,
    size: Math.max(0, Number(item.size) || 0)
  };
}

function normalizeStoredSourceItems(rawSourceItems, rawSourceUrls, normalizePrefix) {
  const sourceItems = Array.isArray(rawSourceItems) ? rawSourceItems : [];
  const normalized = [];
  const seen = new Set();

  for (const rawItem of sourceItems) {
    const item = normalizeSourceItem(rawItem, normalizePrefix);

    if (!item) {
      continue;
    }

    const dedupeKey = item.sourceType === 'storage'
      ? `storage:${item.fileId || item.cloudPath}`
      : `url:${item.url}`;

    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    normalized.push(item);
  }

  if (!normalized.length) {
    for (const url of normalizeSourceUrls(rawSourceUrls)) {
      const item = normalizeSourceItem({
        sourceType: 'url',
        url
      }, normalizePrefix);

      if (!item) {
        continue;
      }

      normalized.push(item);
    }
  }

  return normalized.slice(0, 16);
}

function validateSourceItems(sourceItems) {
  if (sourceItems.length > 16) {
    const error = new Error('agent_homework_too_many_sources');
    error.code = 'agent_homework_too_many_sources';
    throw error;
  }

  const pdfCount = sourceItems.filter((item) => item.fileKind === 'pdf').length;
  const imageCount = sourceItems.filter((item) => item.fileKind === 'image').length;

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

function sortRequests(items) {
  return items.slice().sort((left, right) =>
    (right.updatedAt || right.requestedAt || '').localeCompare(left.updatedAt || left.requestedAt || '')
    || left.id.localeCompare(right.id)
  );
}

function createAgentHomeworkRuntime(options = {}) {
  const {
    db,
    collectionName,
    docId,
    ensureCollectionExists,
    maxRequests = 60,
    normalizePrefix,
    normalizeId,
    sourceStore
  } = options;
  const isMissingDocError = createMissingDocMatcher(normalizePrefix);

  function createRequestId() {
    return `agent-homework-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;
  }

  function normalizeRequestOperation(value) {
    return normalizePrefix(value).toLowerCase() === 'delete' ? 'delete' : 'create';
  }

  function normalizeRequestStatus(value, operation) {
    const normalized = normalizePrefix(value).toLowerCase();

    if (normalized === 'completed') {
      return 'completed';
    }

    if (normalized === 'approved') {
      return 'approved';
    }

    if (normalized === 'rejected') {
      return 'rejected';
    }

    if (operation === 'delete') {
      return 'pending_review';
    }

    return 'pending';
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
      const sourceItems = operation === 'delete'
        ? []
        : normalizeStoredSourceItems(item.sourceItems, item.sourceUrls, normalizePrefix);
      const fallbackDate = normalizeDate(item.requestedAt, new Date().toISOString().slice(0, 10));
      const targetJobId = operation === 'delete'
        ? normalizePrefix(item.targetJobId || item.jobId || (item.result && item.result.jobId))
        : '';
      const subject = normalizeSubject(item.subject || '作业');
      const bucket = normalizeBucket(item.bucket);

      items.push({
        id,
        role: 'agent',
        agentId: normalizeId(item.agentId || item.requesterId || item.label, 'agent'),
        label: normalizePrefix(item.label).slice(0, 80) || '智能体',
        status: normalizeRequestStatus(item.status, operation),
        operation,
        targetJobId,
        subject,
        bucket,
        targetDate: normalizeDate(item.targetDate, fallbackDate),
        mode: operation === 'delete' ? 'delete' : sourceItems.length ? 'files' : 'blank',
        sourceItems,
        summary: normalizeSummary(
          item.summary,
          operation === 'delete' ? `${subject}作业删除申请` : `${subject}作业创建申请`
        ),
        note: normalizeNote(item.note || item.description),
        requestedAt: normalizePrefix(item.requestedAt),
        reviewedAt: normalizePrefix(item.reviewedAt),
        reviewedBy: normalizePrefix(item.reviewedBy),
        reviewNote: normalizeNote(item.reviewNote),
        completedAt: normalizePrefix(item.completedAt),
        updatedAt: normalizePrefix(item.updatedAt),
        result: item.result && typeof item.result === 'object'
          ? {
              jobId: normalizePrefix(item.result.jobId || targetJobId),
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

  async function resolveSourceUrls(sourceItems = []) {
    const storageItems = sourceItems.filter((item) => item.sourceType === 'storage');

    if (!storageItems.length || !sourceStore || typeof sourceStore.resolveSourceUrls !== 'function') {
      return sourceItems
        .filter((item) => item.sourceType === 'url')
        .map((item) => item.url);
    }

    const resolved = await sourceStore.resolveSourceUrls(storageItems);
    let storageIndex = 0;

    return sourceItems
      .map((item) => {
        if (item.sourceType === 'url') {
          return item.url;
        }

        const nextUrl = resolved[storageIndex] || '';
        storageIndex += 1;
        return nextUrl;
      })
      .filter(Boolean);
  }

  async function serializeRequest(item, options = {}) {
    const resolveDownloadUrls = Boolean(options.resolveDownloadUrls);
    const sourceFiles = item.sourceItems.map((sourceItem) => ({
      sourceType: sourceItem.sourceType,
      fileKind: sourceItem.fileKind,
      fileName: sourceItem.fileName,
      contentType: sourceItem.contentType,
      size: sourceItem.size
    }));

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
      sourceFiles,
      sourceFileCount: sourceFiles.length,
      sourceUrls: resolveDownloadUrls ? await resolveSourceUrls(item.sourceItems) : [],
      summary: item.summary,
      note: item.note,
      requestedAt: item.requestedAt,
      reviewedAt: item.reviewedAt,
      reviewedBy: item.reviewedBy,
      reviewNote: item.reviewNote,
      completedAt: item.completedAt,
      updatedAt: item.updatedAt,
      result: item.result
    };
  }

  function trimRequests(items) {
    const sorted = sortRequests(normalizeRequests(items));
    const openItems = sorted.filter((item) => !['completed', 'rejected'].includes(item.status));
    const closedItems = sorted.filter((item) => ['completed', 'rejected'].includes(item.status));

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
        .filter((item) => ['pending', 'completed', 'approved', 'rejected'].includes(item))
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
    if (!item || item.operation !== 'create') {
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

  async function buildSourceItems(payload = {}, requestId) {
    const uploadedSourceItems = normalizeStoredSourceItems(
      payload.sourceItems,
      [],
      normalizePrefix
    );

    const directSourceItems = normalizeSourceUrls(payload.sourceUrls).map((url) => ({
      sourceType: 'url',
      url,
      fileName: normalizeFileName(url.split('/').pop(), 'source'),
      contentType: '',
      fileKind: fileKindFromUrl(url),
      size: 0
    }));
    const inlineSources = normalizeInlineSources(payload.inlineSources);
    let storedSourceItems = [];

    if (inlineSources.length) {
      if (!sourceStore || typeof sourceStore.saveInlineSources !== 'function') {
        const error = new Error('agent_homework_inline_sources_not_supported');
        error.code = 'agent_homework_inline_sources_not_supported';
        throw error;
      }

      storedSourceItems = await sourceStore.saveInlineSources(requestId, inlineSources);
    }

    const sourceItems = normalizeStoredSourceItems(
      [...uploadedSourceItems, ...directSourceItems, ...storedSourceItems],
      [],
      normalizePrefix
    );
    validateSourceItems(sourceItems);
    return sourceItems;
  }

  async function uploadSources(payload = {}, requestId = '') {
    const normalizedRequestId = normalizeId(requestId || payload.requestId || payload.id, '') || createRequestId();
    const sourceItems = await buildSourceItems(payload, normalizedRequestId);

    return sourceItems.map((item) => ({
      sourceType: item.sourceType,
      fileId: item.fileId || '',
      cloudPath: item.cloudPath || '',
      url: item.url || '',
      fileName: item.fileName,
      contentType: item.contentType,
      fileKind: item.fileKind,
      size: item.size
    }));
  }

  async function createRequest(payload = {}, now) {
    if (normalizeRequestOperation(payload.operation || payload.mode) !== 'create') {
      throw createHomeworkRuntimeError('agent_homework_delete_not_supported');
    }

    const requestId = normalizeId(payload.requestId || payload.id, '') || createRequestId();
    const sourceItems = await buildSourceItems(payload, requestId);
    const targetDate = normalizeDate(payload.targetDate, now.slice(0, 10));
    const subject = normalizeSubject(payload.subject);

    return {
      id: requestId,
      role: 'agent',
      agentId: normalizeId(payload.agentId || payload.requesterId || payload.label, 'agent'),
      label: normalizePrefix(payload.label).slice(0, 80) || '智能体',
      status: 'pending',
      operation: 'create',
      targetJobId: '',
      subject,
      bucket: normalizeBucket(payload.bucket),
      targetDate,
      mode: sourceItems.length ? 'files' : 'blank',
      sourceItems,
      summary: normalizeSummary(payload.summary, `${subject}作业创建申请`),
      note: normalizeNote(payload.note || payload.description),
      requestedAt: now,
      reviewedAt: '',
      reviewedBy: '',
      reviewNote: '',
      completedAt: '',
      updatedAt: now,
      result: null
    };
  }

  function stripStoredSourceReferences(sourceItems = []) {
    return sourceItems.map((item) => {
      if (!item || item.sourceType !== 'storage') {
        return item;
      }

      return {
        ...item,
        fileId: '',
        cloudPath: ''
      };
    });
  }

  function hasStorageSourceItems(sourceItems = []) {
    return sourceItems.some((item) => item && item.sourceType === 'storage' && (item.fileId || item.cloudPath));
  }

  async function persistSourceCleanup(requestId, cleanedSourceItems, updatedAt) {
    return db.runTransaction(async (transaction) => {
      const currentState = await readState(transaction);
      const target = currentState.items.find((item) => item.id === requestId);

      if (!target || target.status !== 'completed') {
        return target || null;
      }

      const nextItem = {
        ...target,
        sourceItems: cleanedSourceItems,
        updatedAt
      };
      const nextItems = trimRequests(
        currentState.items.map((item) => (item.id === requestId ? nextItem : item))
      );
      await persistState(transaction, nextItems, updatedAt);
      return nextItem;
    });
  }

  async function cleanupCompletedRequestSources(item) {
    if (
      !item
      || item.operation !== 'create'
      || !hasStorageSourceItems(item.sourceItems)
      || !sourceStore
      || typeof sourceStore.deleteStoredSources !== 'function'
    ) {
      return item;
    }

    await sourceStore.deleteStoredSources(item.sourceItems);
    const cleanedSourceItems = stripStoredSourceReferences(item.sourceItems);
    const updatedAt = new Date().toISOString();
    return persistSourceCleanup(item.id, cleanedSourceItems, updatedAt) || {
      ...item,
      sourceItems: cleanedSourceItems,
      updatedAt
    };
  }

  async function serializeRequests(items, options = {}) {
    const output = [];

    for (const item of items) {
      output.push(await serializeRequest(item, options));
    }

    return output;
  }

  async function listPendingRequests() {
    const state = await readState(db);
    const pendingItems = state.items.filter((item) => item.operation !== 'delete' && item.status === 'pending');

    return serializeRequests(pendingItems, {
      resolveDownloadUrls: true
    });
  }

  async function listRequests() {
    const state = await readState(db);
    return serializeRequests(state.items.filter((item) => item.operation === 'create'));
  }

  async function queryRequests(rawFilters = {}, options = {}) {
    const filters = normalizeQueryFilters(rawFilters);
    const state = await readState(db);
    const matchedItems = sortRequests(state.items)
      .filter((item) => matchesQueryFilters(item, filters))
      .slice(0, filters.limit);

    return serializeRequests(matchedItems, options);
  }

  async function getRequestStatus(requestId, options = {}) {
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

    return serializeRequest(matched, options);
  }

  async function getRequestStatuses(requestIds = [], options = {}) {
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
      const error = new Error('missing_agent_homework_request_ids');
      error.code = 'missing_agent_homework_request_ids';
      throw error;
    }

    const state = await readState(db);
    const matchedItems = normalizedIds.map((requestId) => {
      const matched = state.items.find((item) => item.id === requestId);

      if (!matched) {
        const error = new Error('agent_homework_request_not_found');
        error.code = 'agent_homework_request_not_found';
        throw error;
      }

      return matched;
    });

    return serializeRequests(matchedItems, options);
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

        if (existing.status !== 'pending' || existing.operation !== 'create') {
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
      return serializeRequest(storedRequest);
    });
  }

  async function submitRequests(payloads = []) {
    const items = Array.isArray(payloads) ? payloads : [];

    if (!items.length) {
      const error = new Error('missing_agent_homework_requests');
      error.code = 'missing_agent_homework_requests';
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
      const error = new Error('missing_agent_homework_request_id');
      error.code = 'missing_agent_homework_request_id';
      throw error;
    }

    if (typeof ensureCollectionExists === 'function') {
      await ensureCollectionExists();
    }

    let completedRequest = await db.runTransaction(async (transaction) => {
      const currentState = await readState(transaction);
      const target = currentState.items.find((item) => item.id === normalizedRequestId);

      if (!target) {
        const error = new Error('agent_homework_request_not_found');
        error.code = 'agent_homework_request_not_found';
        throw error;
      }

      if (target.status === 'completed') {
        return target;
      }

      if (target.status !== 'pending') {
        const error = new Error('agent_homework_request_not_ready');
        error.code = 'agent_homework_request_not_ready';
        throw error;
      }

      const now = new Date().toISOString();
      const completed = {
        ...target,
        status: 'completed',
        completedAt: now,
        updatedAt: now,
        result: {
          jobId: normalizePrefix(payload.jobId || target.targetJobId),
          totalPages: Math.max(0, Number(payload.totalPages) || 0),
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

    try {
      completedRequest = await cleanupCompletedRequestSources(completedRequest);
    } catch {
      // Keep the completed request record even if cloud source cleanup fails.
    }

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
    submitRequests,
    uploadSources
  };
}

module.exports = {
  createAgentHomeworkRuntime
};
