'use strict';

function normalizePrefix(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function createError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function normalizePlanOperation(value) {
  const normalized = normalizePrefix(value).toLowerCase();

  if (normalized === 'add' || normalized === 'update' || normalized === 'delete' || normalized === 'replace') {
    return normalized;
  }

  return '';
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

function normalizeWeekdays(rawValue) {
  const source = Array.isArray(rawValue)
    ? rawValue
    : typeof rawValue === 'string'
      ? rawValue.split(/[,\s/|，、]+/g)
      : [rawValue];
  const values = [];
  const seen = new Set();

  for (const item of source) {
    const numeric = Number(item);

    if (!Number.isInteger(numeric) || numeric < 1 || numeric > 7 || seen.has(numeric)) {
      continue;
    }

    seen.add(numeric);
    values.push(numeric);
  }

  return values.sort((left, right) => left - right);
}

function listPayloadItems(payload = {}) {
  if (Array.isArray(payload.items)) {
    return payload.items;
  }

  if (payload.item && typeof payload.item === 'object') {
    return [payload.item];
  }

  return [];
}

function arrayEquals(left = [], right = []) {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

function scheduleIdentitySignature(item = {}) {
  return JSON.stringify({
    planScope: normalizePlanScope(item.planScope || item.scope, 'student'),
    title: normalizePrefix(item.title),
    time: normalizePrefix(item.time),
    specificDate: normalizeSpecificDate(item.specificDate || item.date),
    weekdays: normalizeWeekdays(item.weekdays || item.days)
  });
}

function scheduleFullSignature(item = {}) {
  return JSON.stringify({
    id: normalizePrefix(item.id),
    planScope: normalizePlanScope(item.planScope || item.scope, 'student'),
    enabled: item.enabled !== false,
    title: normalizePrefix(item.title),
    target: normalizePrefix(item.target),
    time: normalizePrefix(item.time),
    weekdays: normalizeWeekdays(item.weekdays),
    specificDate: normalizeSpecificDate(item.specificDate),
    exceptionDates: Array.isArray(item.exceptionDates) ? item.exceptionDates : [],
    message: normalizePrefix(item.message)
  });
}

function countChangesByScope(changes) {
  const summary = {
    itemCount: 0,
    parentItemCount: 0,
    studentItemCount: 0
  };

  for (const change of Array.isArray(changes) ? changes : []) {
    const planScope = normalizePlanScope(
      change && (change.planScope || change.afterItem && change.afterItem.planScope || change.beforeItem && change.beforeItem.planScope),
      ''
    );

    if (!planScope) {
      continue;
    }

    summary.itemCount += 1;

    if (planScope === 'parent') {
      summary.parentItemCount += 1;
    } else if (planScope === 'student') {
      summary.studentItemCount += 1;
    }
  }

  return summary;
}

function deriveScopeFromChanges(changes) {
  const counts = countChangesByScope(changes);

  if (counts.parentItemCount && counts.studentItemCount) {
    return 'both';
  }

  if (counts.parentItemCount) {
    return 'parent';
  }

  if (counts.studentItemCount) {
    return 'student';
  }

  return 'unknown';
}

function buildOperationSummary(operation, changes) {
  const counts = countChangesByScope(changes);
  const segments = [];

  if (counts.parentItemCount) {
    segments.push(`家长计划 ${counts.parentItemCount} 条`);
  }

  if (counts.studentItemCount) {
    segments.push(`学生计划 ${counts.studentItemCount} 条`);
  }

  if (!segments.length) {
    return '计划变更';
  }

  const prefix = operation === 'add'
    ? '新增'
    : operation === 'update'
      ? '修改'
      : operation === 'delete'
        ? '删除'
        : '替换';

  return `${prefix}${segments.join('，')}`;
}

function createNormalizedScheduleItem(rawItem, fallbackScope, options = {}) {
  const normalizeSchedule = typeof options.normalizeSchedule === 'function'
    ? options.normalizeSchedule
    : (items) => (Array.isArray(items) ? items : []);
  const createScheduleItemId = typeof options.createScheduleItemId === 'function'
    ? options.createScheduleItemId
    : (planScope) => `${planScope || 'student'}-schedule-${Date.now().toString(36)}`;
  const source = rawItem && typeof rawItem === 'object' ? { ...rawItem } : {};
  const planScope = normalizePlanScope(source.planScope || source.scope, fallbackScope || 'student');
  const itemId = normalizePrefix(source.id) || createScheduleItemId(planScope);
  const normalizedItems = normalizeSchedule(
    [
      {
        ...source,
        id: itemId,
        planScope
      }
    ],
    planScope
  );

  if (!normalizedItems.length) {
    throw createError('invalid_agent_plan_item', '计划条目格式不正确。');
  }

  return normalizedItems[0];
}

function normalizeMatchCriteria(rawMatch, fallbackScope) {
  const source = rawMatch && typeof rawMatch === 'object' ? rawMatch : {};
  const criteria = {
    id: normalizePrefix(source.id),
    planScope: normalizePlanScope(source.planScope || source.scope, fallbackScope),
    title: normalizePrefix(source.title),
    time: normalizePrefix(source.time),
    specificDate: normalizeSpecificDate(source.specificDate || source.date),
    weekdays: normalizeWeekdays(source.weekdays || source.days)
  };

  if (!criteria.id && !criteria.title && !criteria.time && !criteria.specificDate && !criteria.weekdays.length) {
    throw createError('missing_agent_plan_match', '缺少要匹配的计划条件。');
  }

  return criteria;
}

function itemMatchesCriteria(item, criteria) {
  if (criteria.id && normalizePrefix(item.id) !== criteria.id) {
    return false;
  }

  if (criteria.planScope && normalizePlanScope(item.planScope, '') !== criteria.planScope) {
    return false;
  }

  if (criteria.title && normalizePrefix(item.title) !== criteria.title) {
    return false;
  }

  if (criteria.time && normalizePrefix(item.time) !== criteria.time) {
    return false;
  }

  if (criteria.specificDate && normalizeSpecificDate(item.specificDate) !== criteria.specificDate) {
    return false;
  }

  if (criteria.weekdays.length && !arrayEquals(normalizeWeekdays(item.weekdays), criteria.weekdays)) {
    return false;
  }

  return true;
}

function resolveMatchedItem(state, rawMatch, fallbackScope) {
  const criteria = normalizeMatchCriteria(rawMatch, fallbackScope);
  const scopes = criteria.planScope ? [criteria.planScope] : ['parent', 'student'];
  const matches = [];

  for (const planScope of scopes) {
    const items = planScope === 'parent' ? state.parentItems : state.studentItems;

    for (let index = 0; index < items.length; index += 1) {
      if (itemMatchesCriteria(items[index], criteria)) {
        matches.push({
          planScope,
          index,
          item: items[index]
        });
      }
    }
  }

  if (!matches.length) {
    throw createError('agent_plan_item_not_found', '找不到要操作的计划。');
  }

  if (matches.length > 1) {
    throw createError('agent_plan_match_ambiguous', '匹配到了多条计划，请提供更精确的 id。');
  }

  return matches[0];
}

function ensureNoIdentityConflict(items, nextItem, ignoreId = '') {
  const nextSignature = scheduleIdentitySignature(nextItem);
  return !items.some((item) => item.id !== ignoreId && scheduleIdentitySignature(item) === nextSignature);
}

function extractUpdatePatch(rawChange) {
  const source = rawChange && typeof rawChange === 'object' ? rawChange : {};

  if (source.patch && typeof source.patch === 'object' && !Array.isArray(source.patch)) {
    return source.patch;
  }

  const patch = { ...source };
  delete patch.match;
  delete patch.id;
  delete patch.planScope;
  delete patch.scope;
  delete patch.requestId;
  delete patch.agentId;
  delete patch.label;
  delete patch.summary;
  delete patch.note;

  if (!Object.keys(patch).length) {
    throw createError('missing_agent_plan_patch', '缺少要修改的计划内容。');
  }

  return patch;
}

function buildAddChanges(payload, currentState, options) {
  const sourceItems = listPayloadItems(payload);

  if (!sourceItems.length) {
    throw createError('missing_agent_plan_items', '至少要提供 1 条新增计划。');
  }

  const changes = [];
  const seenIds = new Set();
  const seenIdentities = new Set();

  for (const rawItem of sourceItems) {
    const fallbackScope = normalizePlanScope(
      rawItem && (rawItem.planScope || rawItem.scope) || payload.planScope || payload.scope,
      'student'
    );
    const afterItem = createNormalizedScheduleItem(rawItem, fallbackScope, options);
    const currentItems = afterItem.planScope === 'parent' ? currentState.parentItems : currentState.studentItems;

    if (currentItems.some((item) => item.id === afterItem.id) || seenIds.has(afterItem.id)) {
      throw createError('agent_plan_item_exists', '新增计划的 id 已存在。');
    }

    if (!ensureNoIdentityConflict(currentItems, afterItem) || seenIdentities.has(scheduleIdentitySignature(afterItem))) {
      throw createError('agent_plan_duplicate_identity', '同一时间的同名计划已经存在。');
    }

    seenIds.add(afterItem.id);
    seenIdentities.add(scheduleIdentitySignature(afterItem));
    changes.push({
      planScope: afterItem.planScope,
      beforeItem: null,
      afterItem
    });
  }

  return changes;
}

function buildUpdateChanges(payload, currentState, options) {
  const sourceItems = listPayloadItems(payload);

  if (!sourceItems.length) {
    throw createError('missing_agent_plan_items', '至少要提供 1 条修改计划。');
  }

  const changes = [];
  const seenIds = new Set();

  for (const rawChange of sourceItems) {
    const fallbackScope = normalizePlanScope(
      rawChange && (rawChange.planScope || rawChange.scope) || payload.planScope || payload.scope,
      ''
    );
    const matched = resolveMatchedItem(currentState, rawChange.match || rawChange, fallbackScope);

    if (seenIds.has(matched.item.id)) {
      throw createError('agent_plan_duplicate_target', '同一条计划不能在一次请求里重复修改。');
    }

    const patch = extractUpdatePatch(rawChange);
    const afterItem = createNormalizedScheduleItem(
      {
        ...matched.item,
        ...patch,
        id: matched.item.id,
        planScope: matched.planScope
      },
      matched.planScope,
      options
    );
    const currentItems = matched.planScope === 'parent' ? currentState.parentItems : currentState.studentItems;

    if (scheduleFullSignature(afterItem) === scheduleFullSignature(matched.item)) {
      throw createError('agent_plan_no_change', '修改后的计划内容没有变化。');
    }

    if (!ensureNoIdentityConflict(currentItems, afterItem, matched.item.id)) {
      throw createError('agent_plan_duplicate_identity', '修改后的计划会与现有计划重复。');
    }

    seenIds.add(matched.item.id);
    changes.push({
      planScope: matched.planScope,
      beforeItem: matched.item,
      afterItem
    });
  }

  return changes;
}

function buildDeleteChanges(payload, currentState) {
  const sourceItems = listPayloadItems(payload);

  if (!sourceItems.length) {
    throw createError('missing_agent_plan_items', '至少要提供 1 条删除计划。');
  }

  const changes = [];
  const seenIds = new Set();

  for (const rawChange of sourceItems) {
    const fallbackScope = normalizePlanScope(
      rawChange && (rawChange.planScope || rawChange.scope) || payload.planScope || payload.scope,
      ''
    );
    const matched = resolveMatchedItem(currentState, rawChange.match || rawChange, fallbackScope);

    if (seenIds.has(matched.item.id)) {
      throw createError('agent_plan_duplicate_target', '同一条计划不能在一次请求里重复删除。');
    }

    seenIds.add(matched.item.id);
    changes.push({
      planScope: matched.planScope,
      beforeItem: matched.item,
      afterItem: null
    });
  }

  return changes;
}

function createAgentPlanOperationRequest(payload = {}, currentState, options = {}) {
  const operation = normalizePlanOperation(payload.operation)
    || (normalizePrefix(payload.action).toLowerCase().includes('delete')
      ? 'delete'
      : normalizePrefix(payload.action).toLowerCase().includes('update')
        ? 'update'
        : normalizePrefix(payload.action).toLowerCase().includes('add')
          ? 'add'
          : '');
  const normalizeId = typeof options.normalizeId === 'function'
    ? options.normalizeId
    : (value, fallback = '') => normalizePrefix(value) || fallback;
  const createRequestId = typeof options.createRequestId === 'function'
    ? options.createRequestId
    : () => `agent-request-${Date.now().toString(36)}`;
  const now = typeof options.now === 'string' ? options.now : new Date().toISOString();

  if (!operation || operation === 'replace') {
    throw createError('whole_replace_not_allowed', '整组替换计划已禁用。');
  }

  const state = currentState && typeof currentState === 'object'
    ? currentState
    : {
        parentItems: [],
        studentItems: []
      };
  const changes = operation === 'add'
    ? buildAddChanges(payload, state, options)
    : operation === 'update'
      ? buildUpdateChanges(payload, state, options)
      : buildDeleteChanges(payload, state, options);

  return {
    id: normalizeId(payload.requestId || payload.id, '') || createRequestId(),
    role: 'agent',
    agentId: normalizeId(payload.agentId || payload.clientId || payload.requesterId || payload.label, 'agent'),
    label: normalizePrefix(payload.label).slice(0, 80) || '智能体',
    status: 'pending',
    summary: normalizePrefix(payload.summary).slice(0, 240) || buildOperationSummary(operation, changes),
    note: normalizePrefix(payload.note || payload.description).slice(0, 1200),
    operation,
    scope: deriveScopeFromChanges(changes),
    changes,
    requestedAt: now,
    reviewedAt: '',
    updatedAt: now
  };
}

function applyAgentPlanOperationRequest(request, currentState, options = {}) {
  const combineItems = typeof options.combineItems === 'function'
    ? options.combineItems
    : (parentItems, studentItems) => [...parentItems, ...studentItems];
  const operation = normalizePlanOperation(request && request.operation) || 'replace';
  const baseState = currentState && typeof currentState === 'object'
    ? currentState
    : {
        parentItems: [],
        studentItems: [],
        onlineClassrooms: [],
        contentLibraries: [],
        learningTools: [],
        studentDeviceAccess: [],
        studentDeviceAccessUpdatedAt: '',
        controlSettings: {}
      };

  if (operation === 'replace') {
    const nextParentItems = request && request.replaceParentItems ? request.parentItems : baseState.parentItems;
    const nextStudentItems = request && request.replaceStudentItems ? request.studentItems : baseState.studentItems;
    return {
      ...baseState,
      parentItems: nextParentItems,
      studentItems: nextStudentItems,
      items: combineItems(nextParentItems, nextStudentItems)
    };
  }

  const nextParentItems = [...(Array.isArray(baseState.parentItems) ? baseState.parentItems : [])];
  const nextStudentItems = [...(Array.isArray(baseState.studentItems) ? baseState.studentItems : [])];
  const changeList = Array.isArray(request && request.changes) ? request.changes : [];

  for (const change of changeList) {
    const planScope = normalizePlanScope(change && change.planScope || change.afterItem && change.afterItem.planScope || change.beforeItem && change.beforeItem.planScope, '');
    const targetItems = planScope === 'parent' ? nextParentItems : nextStudentItems;

    if (!planScope) {
      throw createError('invalid_agent_plan_item', '计划条目范围无效。');
    }

    if (operation === 'add') {
      const afterItem = change && change.afterItem;

      if (!afterItem) {
        throw createError('invalid_agent_plan_item', '新增计划内容无效。');
      }

      if (targetItems.some((item) => item.id === afterItem.id)) {
        throw createError('agent_request_conflict', '新增计划与当前数据冲突，请重新提交。');
      }

      if (!ensureNoIdentityConflict(targetItems, afterItem)) {
        throw createError('agent_request_conflict', '新增计划与当前计划重复，请重新提交。');
      }

      targetItems.push(afterItem);
      continue;
    }

    const beforeItem = change && change.beforeItem;
    const index = targetItems.findIndex((item) => item.id === (beforeItem && beforeItem.id));

    if (!beforeItem || index < 0) {
      throw createError('agent_request_conflict', '计划已发生变化，请让智能体重新读取后再提交。');
    }

    if (scheduleFullSignature(targetItems[index]) !== scheduleFullSignature(beforeItem)) {
      throw createError('agent_request_conflict', '计划已发生变化，请让智能体重新读取后再提交。');
    }

    if (operation === 'delete') {
      targetItems.splice(index, 1);
      continue;
    }

    const afterItem = change && change.afterItem;

    if (!afterItem) {
      throw createError('invalid_agent_plan_item', '修改后的计划内容无效。');
    }

    if (!ensureNoIdentityConflict(targetItems, afterItem, beforeItem.id)) {
      throw createError('agent_request_conflict', '修改后的计划会与当前计划重复。');
    }

    targetItems[index] = afterItem;
  }

  return {
    ...baseState,
    parentItems: nextParentItems,
    studentItems: nextStudentItems,
    items: combineItems(nextParentItems, nextStudentItems)
  };
}

function requestNeedsApproval(request) {
  const operation = normalizePlanOperation(request && request.operation);
  return operation !== 'add';
}

module.exports = {
  applyAgentPlanOperationRequest,
  buildOperationSummary,
  countChangesByScope,
  createAgentPlanOperationRequest,
  deriveScopeFromChanges,
  normalizePlanOperation,
  requestNeedsApproval
};
