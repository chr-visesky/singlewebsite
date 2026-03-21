'use strict';

const {
  buildOperationSummary,
  countChangesByScope,
  deriveScopeFromChanges,
  normalizePlanOperation
} = require('./agent-plan-operations');

function normalizePrefix(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeAgentRequestStatus(value) {
  const normalized = normalizePrefix(value).toLowerCase();

  if (normalized === 'approved' || normalized === 'rejected') {
    return normalized;
  }

  return 'pending';
}

function normalizeAgentLabel(value, fallback = '智能体') {
  return normalizePrefix(value).slice(0, 80) || fallback;
}

function normalizeAgentSummary(value) {
  return normalizePrefix(value).slice(0, 240);
}

function normalizeAgentNote(value) {
  return normalizePrefix(value).slice(0, 1200);
}

function normalizePlanScope(value, fallback = '') {
  const normalized = normalizePrefix(value).toLowerCase();

  if (normalized === 'student' || normalized === '学生') {
    return 'student';
  }

  if (normalized === 'parent' || normalized === '家长') {
    return 'parent';
  }

  return fallback;
}

function createLegacyChanges(item) {
  const changes = [];

  if (item.replaceParentItems) {
    for (const parentItem of item.parentItems) {
      changes.push({
        planScope: 'parent',
        beforeItem: null,
        afterItem: parentItem
      });
    }
  }

  if (item.replaceStudentItems) {
    for (const studentItem of item.studentItems) {
      changes.push({
        planScope: 'student',
        beforeItem: null,
        afterItem: studentItem
      });
    }
  }

  return changes;
}

function normalizeChangeItem(rawChange, options = {}) {
  const normalizeSchedule = typeof options.normalizeSchedule === 'function'
    ? options.normalizeSchedule
    : (items) => (Array.isArray(items) ? items : []);
  const source = rawChange && typeof rawChange === 'object' ? rawChange : {};
  const hintedScope = normalizePlanScope(
    source.planScope
      || source.scope
      || source.afterItem && source.afterItem.planScope
      || source.beforeItem && source.beforeItem.planScope,
    'student'
  );
  const beforeItems = source.beforeItem ? normalizeSchedule([source.beforeItem], hintedScope) : [];
  const afterItems = source.afterItem ? normalizeSchedule([source.afterItem], hintedScope) : [];
  const beforeItem = beforeItems[0] || null;
  const afterItem = afterItems[0] || null;
  const planScope = afterItem && afterItem.planScope
    ? afterItem.planScope
    : beforeItem && beforeItem.planScope
      ? beforeItem.planScope
      : hintedScope;

  if (!beforeItem && !afterItem) {
    return null;
  }

  return {
    planScope,
    beforeItem,
    afterItem
  };
}

function normalizeAgentPlanRequests(rawItems, options = {}) {
  const normalizeSchedule = typeof options.normalizeSchedule === 'function'
    ? options.normalizeSchedule
    : (items) => (Array.isArray(items) ? items : []);
  const normalizeId = typeof options.normalizeId === 'function'
    ? options.normalizeId
    : (value, fallback = '') => normalizePrefix(value) || fallback;
  const source = Array.isArray(rawItems) ? rawItems : [];
  const items = [];
  const seenIds = new Set();

  for (let index = 0; index < source.length; index += 1) {
    const item = source[index] && typeof source[index] === 'object' ? source[index] : {};
    const id = normalizeId(item.id || item.requestId, '');

    if (!id || seenIds.has(id)) {
      continue;
    }

    const explicitOperation = normalizePlanOperation(item.operation);
    const legacyReplaceParentItems = Object.prototype.hasOwnProperty.call(item, 'replaceParentItems')
      ? item.replaceParentItems === true
      : false;
    const legacyReplaceStudentItems = Object.prototype.hasOwnProperty.call(item, 'replaceStudentItems')
      ? item.replaceStudentItems === true
      : false;
    const legacyParentItems = legacyReplaceParentItems ? normalizeSchedule(item.parentItems, 'parent') : [];
    const legacyStudentItems = legacyReplaceStudentItems ? normalizeSchedule(item.studentItems, 'student') : [];
    const changes = explicitOperation
      ? (Array.isArray(item.changes) ? item.changes : [])
          .map((entry) => normalizeChangeItem(entry, options))
          .filter(Boolean)
      : createLegacyChanges({
          replaceParentItems: legacyReplaceParentItems,
          replaceStudentItems: legacyReplaceStudentItems,
          parentItems: legacyParentItems,
          studentItems: legacyStudentItems
        });
    const operation = explicitOperation || 'replace';

    if (!changes.length && operation !== 'replace') {
      continue;
    }

    seenIds.add(id);
    const counts = countChangesByScope(changes);
    const scope = operation === 'replace'
      ? legacyReplaceParentItems && legacyReplaceStudentItems
        ? 'both'
        : legacyReplaceParentItems
          ? 'parent'
          : legacyReplaceStudentItems
            ? 'student'
            : 'unknown'
      : deriveScopeFromChanges(changes);

    items.push({
      id,
      role: 'agent',
      agentId: normalizeId(item.agentId || item.requesterId || item.clientId || item.label, 'agent'),
      label: normalizeAgentLabel(item.label || item.agentLabel, '智能体'),
      status: normalizeAgentRequestStatus(item.status),
      summary: normalizeAgentSummary(item.summary) || buildOperationSummary(operation, changes),
      note: normalizeAgentNote(item.note || item.description),
      operation,
      scope,
      changes,
      parentItems: operation === 'replace'
        ? legacyParentItems
        : changes.filter((entry) => entry.planScope === 'parent').map((entry) => entry.afterItem || entry.beforeItem).filter(Boolean),
      studentItems: operation === 'replace'
        ? legacyStudentItems
        : changes.filter((entry) => entry.planScope === 'student').map((entry) => entry.afterItem || entry.beforeItem).filter(Boolean),
      requestedAt: normalizePrefix(item.requestedAt),
      reviewedAt: normalizePrefix(item.reviewedAt),
      updatedAt: normalizePrefix(item.updatedAt),
      itemCount: counts.itemCount,
      parentItemCount: counts.parentItemCount,
      studentItemCount: counts.studentItemCount
    });
  }

  return items;
}

function sanitizeAgentPlanRequests(rawItems, options = {}) {
  return normalizeAgentPlanRequests(rawItems, options).map((item) => ({
    id: item.id,
    role: item.role,
    agentId: item.agentId,
    label: item.label,
    status: item.status,
    summary: item.summary,
    note: item.note,
    operation: item.operation,
    scope: item.scope,
    changes: item.changes.map((change) => ({
      planScope: change.planScope,
      beforeItem: change.beforeItem,
      afterItem: change.afterItem
    })),
    parentItems: item.parentItems,
    studentItems: item.studentItems,
    itemCount: item.itemCount,
    parentItemCount: item.parentItemCount,
    studentItemCount: item.studentItemCount,
    requestedAt: item.requestedAt,
    reviewedAt: item.reviewedAt,
    updatedAt: item.updatedAt
  }));
}

function createAgentPlanRequest(payload = {}, options = {}) {
  const normalizeSchedule = typeof options.normalizeSchedule === 'function'
    ? options.normalizeSchedule
    : (items) => (Array.isArray(items) ? items : []);
  const normalizeId = typeof options.normalizeId === 'function'
    ? options.normalizeId
    : (value, fallback = '') => normalizePrefix(value) || fallback;
  const createId = typeof options.createId === 'function'
    ? options.createId
    : () => `agent-request-${Date.now().toString(36)}`;
  const now = typeof options.now === 'string' ? options.now : new Date().toISOString();
  const replaceParentItems = Object.prototype.hasOwnProperty.call(payload, 'parentItems');
  const replaceStudentItems = Object.prototype.hasOwnProperty.call(payload, 'studentItems');

  if (!replaceParentItems && !replaceStudentItems) {
    const error = new Error('missing_agent_plan_payload');
    error.code = 'missing_agent_plan_payload';
    throw error;
  }

  const parentItems = replaceParentItems ? normalizeSchedule(payload.parentItems, 'parent') : [];
  const studentItems = replaceStudentItems ? normalizeSchedule(payload.studentItems, 'student') : [];
  const changes = createLegacyChanges({
    replaceParentItems,
    replaceStudentItems,
    parentItems,
    studentItems
  });

  return {
    id: normalizeId(payload.requestId || payload.id, '') || createId(),
    role: 'agent',
    agentId: normalizeId(payload.agentId || payload.clientId || payload.requesterId || payload.label, 'agent'),
    label: normalizeAgentLabel(payload.label || payload.agentLabel, '智能体'),
    status: 'pending',
    summary: normalizeAgentSummary(payload.summary) || buildOperationSummary('replace', changes),
    note: normalizeAgentNote(payload.note || payload.description),
    operation: 'replace',
    scope: replaceParentItems && replaceStudentItems ? 'both' : replaceParentItems ? 'parent' : 'student',
    changes,
    replaceParentItems,
    replaceStudentItems,
    parentItems,
    studentItems,
    itemCount: changes.length,
    parentItemCount: changes.filter((item) => item.planScope === 'parent').length,
    studentItemCount: changes.filter((item) => item.planScope === 'student').length,
    requestedAt: now,
    reviewedAt: '',
    updatedAt: now
  };
}

function trimAgentPlanRequests(rawItems, options = {}) {
  const limit = Math.max(1, Number(options.limit) || 40);
  const items = normalizeAgentPlanRequests(rawItems, options);

  return items
    .sort((left, right) =>
      (right.updatedAt || right.requestedAt || '').localeCompare(left.updatedAt || left.requestedAt || '') ||
      left.id.localeCompare(right.id)
    )
    .slice(0, limit);
}

module.exports = {
  createAgentPlanRequest,
  normalizeAgentPlanRequests,
  sanitizeAgentPlanRequests,
  trimAgentPlanRequests
};
