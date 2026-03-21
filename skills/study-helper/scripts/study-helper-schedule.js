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

function listPayloadItems(payload = {}) {
  if (Array.isArray(payload.items)) {
    return payload.items;
  }

  if (payload.item && typeof payload.item === 'object') {
    return [payload.item];
  }

  return [payload];
}

function normalizePlanScope(value, fallback = 'student') {
  const normalized = normalizeText(value).toLowerCase();

  if (['parent', 'family', 'guardian', '家长'].includes(normalized)) {
    return 'parent';
  }

  if (['student', 'child', '学生'].includes(normalized)) {
    return 'student';
  }

  return fallback;
}

function normalizeWeekdayToken(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  const weekdayMap = new Map([
    ['1', 1],
    ['周一', 1],
    ['星期一', 1],
    ['monday', 1],
    ['mon', 1],
    ['2', 2],
    ['周二', 2],
    ['星期二', 2],
    ['tuesday', 2],
    ['tue', 2],
    ['3', 3],
    ['周三', 3],
    ['星期三', 3],
    ['wednesday', 3],
    ['wed', 3],
    ['4', 4],
    ['周四', 4],
    ['星期四', 4],
    ['thursday', 4],
    ['thu', 4],
    ['5', 5],
    ['周五', 5],
    ['星期五', 5],
    ['friday', 5],
    ['fri', 5],
    ['6', 6],
    ['周六', 6],
    ['星期六', 6],
    ['saturday', 6],
    ['sat', 6],
    ['7', 7],
    ['0', 7],
    ['周日', 7],
    ['星期日', 7],
    ['周天', 7],
    ['星期天', 7],
    ['sunday', 7],
    ['sun', 7]
  ]);

  return weekdayMap.get(normalized) || 0;
}

function normalizeWeekdaysInput(rawValue) {
  const source = Array.isArray(rawValue)
    ? rawValue
    : typeof rawValue === 'string'
      ? rawValue.split(/[,\s/|，、]+/g)
      : [rawValue];
  const values = [];
  const seen = new Set();

  for (const item of source) {
    const weekday = normalizeWeekdayToken(item);

    if (!weekday || seen.has(weekday)) {
      continue;
    }

    seen.add(weekday);
    values.push(weekday);
  }

  return values.sort((left, right) => left - right);
}

function normalizeSpecificDateInput(value) {
  const normalized = normalizeText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : '';
}

function normalizeTimeInput(value) {
  const normalized = normalizeText(value);

  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(normalized)) {
    throw new Error('计划时间必须是 HH:MM 格式。');
  }

  return normalized;
}

function normalizeExceptionDatesInput(rawValue) {
  const source = Array.isArray(rawValue) ? rawValue : [rawValue];
  const values = [];
  const seen = new Set();

  for (const item of source) {
    const date = normalizeSpecificDateInput(item);

    if (!date || seen.has(date)) {
      continue;
    }

    seen.add(date);
    values.push(date);
  }

  return values.sort();
}

function normalizePlanTarget(value) {
  return normalizeText(value);
}

function normalizePlanMutationMeta(payload, fallbackPrefix) {
  return {
    requestId: normalizeText(payload.requestId) || makeRequestId(fallbackPrefix),
    agentId: normalizeText(payload.agentId) || 'openclaw',
    label: normalizeText(payload.label) || 'OpenClaw',
    summary: normalizeText(payload.summary),
    note: normalizeText(payload.note || payload.description)
  };
}

function createPlanItemFromPayload(rawItem = {}, fallbackScope = 'student') {
  const source = rawItem && typeof rawItem === 'object' ? rawItem : {};
  const planScope = normalizePlanScope(
    source.planScope || source.scope || source.targetScope || source.role,
    fallbackScope
  );
  const specificDate = normalizeSpecificDateInput(source.specificDate || source.date);
  const weekdays = specificDate ? [] : normalizeWeekdaysInput(source.weekdays || source.days);
  const title = normalizeText(source.title);

  if (!title) {
    throw new Error('计划标题不能为空。');
  }

  if (!specificDate && !weekdays.length) {
    throw new Error('计划必须提供 specificDate 或 weekdays。');
  }

  return {
    id: normalizeText(source.id),
    planScope,
    enabled: source.enabled !== false,
    title,
    target: normalizePlanTarget(source.target || source.targetId),
    time: normalizeTimeInput(source.time),
    weekdays,
    specificDate,
    exceptionDates: specificDate ? [] : normalizeExceptionDatesInput(source.exceptionDates || source.skipDates),
    message: normalizeText(source.message)
  };
}

function createMatchPayload(rawItem = {}, fallbackScope = '') {
  const source = rawItem && typeof rawItem === 'object' ? rawItem : {};
  const match = source.match && typeof source.match === 'object' ? source.match : {};
  const merged = {
    id: source.id,
    planScope: source.planScope || source.scope,
    title: source.title,
    time: source.time,
    specificDate: source.specificDate || source.date,
    weekdays: source.weekdays || source.days,
    ...match
  };

  return {
    id: normalizeText(merged.id),
    planScope: normalizePlanScope(merged.planScope || merged.scope, fallbackScope),
    title: normalizeText(merged.title),
    time: normalizeText(merged.time),
    specificDate: normalizeSpecificDateInput(merged.specificDate || merged.date),
    weekdays: normalizeWeekdaysInput(merged.weekdays || merged.days)
  };
}

function normalizeMatchPayload(rawItem, fallbackScope = '') {
  const match = createMatchPayload(rawItem, fallbackScope);

  if (!match.id && !match.title && !match.time && !match.specificDate && !match.weekdays.length) {
    throw new Error('必须提供计划 id 或足够精确的匹配条件。');
  }

  return match;
}

function normalizeUpdatePatch(rawItem) {
  const source = rawItem && typeof rawItem === 'object' ? rawItem : {};

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
    throw new Error('修改计划时必须提供 patch 或修改字段。');
  }

  return patch;
}

function normalizeCreateItems(payload) {
  return listPayloadItems(payload).map((item) =>
    createPlanItemFromPayload(item, normalizePlanScope(payload.planScope || payload.scope, 'student'))
  );
}

function normalizeUpdateItems(payload) {
  return listPayloadItems(payload).map((item) => {
    const fallbackScope = normalizePlanScope(
      item && (item.planScope || item.scope) || payload.planScope || payload.scope,
      ''
    );

    return {
      match: normalizeMatchPayload(item, fallbackScope),
      patch: normalizeUpdatePatch(item)
    };
  });
}

function normalizeDeleteItems(payload) {
  return listPayloadItems(payload).map((item) =>
    normalizeMatchPayload(item, normalizePlanScope(payload.planScope || payload.scope, ''))
  );
}

function buildScheduleCreatePayload(payload) {
  const nextPayload = ensureObjectPayload(payload, 'schedule-create');
  const meta = normalizePlanMutationMeta(nextPayload, 'openclaw-plan-create');

  return {
    action: 'addAgentPlanItems',
    requestId: meta.requestId,
    agentId: meta.agentId,
    label: meta.label,
    summary: meta.summary,
    note: meta.note,
    items: normalizeCreateItems(nextPayload)
  };
}

function buildScheduleUpdatePayload(payload) {
  const nextPayload = ensureObjectPayload(payload, 'schedule-update');
  const meta = normalizePlanMutationMeta(nextPayload, 'openclaw-plan-update');

  return {
    action: 'updateAgentPlanItems',
    requestId: meta.requestId,
    agentId: meta.agentId,
    label: meta.label,
    summary: meta.summary,
    note: meta.note,
    items: normalizeUpdateItems(nextPayload)
  };
}

function buildScheduleDeletePayload(payload) {
  const nextPayload = ensureObjectPayload(payload, 'schedule-delete');
  const meta = normalizePlanMutationMeta(nextPayload, 'openclaw-plan-delete');

  return {
    action: 'deleteAgentPlanItems',
    requestId: meta.requestId,
    agentId: meta.agentId,
    label: meta.label,
    summary: meta.summary,
    note: meta.note,
    items: normalizeDeleteItems(nextPayload)
  };
}

module.exports = {
  buildScheduleCreatePayload,
  buildScheduleDeletePayload,
  buildScheduleUpdatePayload
};
