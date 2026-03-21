const config = require('../config');

const WEEKDAY_OPTIONS = [
  { value: '1', label: '周一' },
  { value: '2', label: '周二' },
  { value: '3', label: '周三' },
  { value: '4', label: '周四' },
  { value: '5', label: '周五' },
  { value: '6', label: '周六' },
  { value: '7', label: '周日' }
];

function emptyScheduleForm() {
  return {
    scheduleType: 'weekly',
    title: '',
    time: '19:00',
    target: '',
    message: '',
    weekdays: [],
    specificDate: ''
  };
}

async function callAdmin(action, extra = {}) {
  const response = await wx.cloud.callFunction({
    name: config.adminFunctionName,
    data: {
      action,
      ...extra
    }
  });

  return response && response.result ? response.result : {};
}

async function callNamedFunction(functionName, action, extra = {}) {
  const response = await wx.cloud.callFunction({
    name: functionName,
    data: {
      action,
      ...extra
    }
  });

  return response && response.result ? response.result : {};
}

async function callAgentAccessAdmin(action, extra = {}) {
  return callNamedFunction(config.agentAccessAdminFunctionName, action, extra);
}

function normalizeWeekdayValues(values) {
  return Array.from(new Set((values || []).map((item) => String(item))))
    .filter((item) => /^(?:[1-7])$/.test(item))
    .sort();
}

function weekdayMap(values) {
  return normalizeWeekdayValues(values).reduce((result, item) => {
    result[item] = true;
    return result;
  }, {});
}

function decorateWeekdayOptions(values) {
  const selectedMap = weekdayMap(values);
  return WEEKDAY_OPTIONS.map((option) => ({
    ...option,
    checked: Boolean(selectedMap[option.value])
  }));
}

function weekdayLabel(values) {
  const daySet = new Set(normalizeWeekdayValues(values));
  return WEEKDAY_OPTIONS.filter((option) => daySet.has(option.value))
    .map((option) => option.label)
    .join('、');
}

function normalizeSpecificDate(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';

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

function normalizeDateList(values) {
  const source = Array.isArray(values) ? values : [values];
  const items = [];
  const seen = new Set();

  for (const item of source) {
    const normalized = normalizeSpecificDate(item);

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    items.push(normalized);
  }

  return items.sort();
}

function decorateScheduleItems(items, options = {}) {
  const planScope = options.planScope === 'student' ? 'student' : 'parent';
  const planScopeLabel = planScope === 'student' ? '学生' : '家长';

  return Array.isArray(items)
    ? items.map((item) => ({
        ...item,
        planScope,
        planScopeLabel,
        scheduleType: item.mode === 'date' || item.specificDate ? 'date' : 'weekly',
        exceptionDates: normalizeDateList(item.exceptionDates || item.skipDates),
        weekdayLabel: weekdayLabel(item.weekdays),
        patternLabel: item.mode === 'date' || item.specificDate ? normalizeSpecificDate(item.specificDate) : weekdayLabel(item.weekdays),
        targetLabel: item.target || '只提醒',
        pillLabel: item.target ? '会进入指定入口' : '只提醒',
        messageText: item.message || `到${item.title}时间了。`
      }))
    : [];
}

function decorateLibraryItems(items) {
  return Array.isArray(items)
    ? items.map((item, index) => ({
        id: item.id || `library-${index + 1}`,
        title: item.title || '',
        folderPath: item.folderPath || item.path || '',
        description: item.description || ''
      }))
    : [];
}

function decorateClassroomItems(items) {
  return Array.isArray(items)
    ? items.map((item, index) => ({
        id: item.id || (index === 0 ? 'english-course' : `classroom-${index + 1}`),
        title: item.title || '',
        entryUrl: item.entryUrl || item.url || item.startUrl || '',
        description: item.description || ''
      }))
    : [];
}

function decorateLearningToolItems(items) {
  return Array.isArray(items)
    ? items.map((item, index) => ({
        id: item.id || `tool-${index + 1}`,
        title: item.title || '',
        appPath: item.appPath || item.path || item.executablePath || '',
        description: item.description || '',
        tone: item.tone || ''
      }))
    : [];
}

function decorateAdmins(openIds, currentOpenId) {
  return Array.isArray(openIds)
    ? openIds.map((openId) => ({
        openId,
        isSelf: Boolean(openId && openId === currentOpenId)
      }))
    : [];
}

function decorateStudentDevices(items) {
  return Array.isArray(items)
    ? items
        .map((item) => {
          const status = item && item.status === 'approved' ? 'approved' : 'pending';

          return {
            id: item.id || '',
            label: item.label || '桌面客户端',
            status,
            statusLabel: status === 'approved' ? '已批准' : '待批准',
            requestedAt: item.requestedAt || '',
            requestedAtDisplay: formatCloudTimestamp(item.requestedAt, {
              emptyText: '未记录'
            }),
            approvedAt: item.approvedAt || '',
            approvedAtDisplay: formatCloudTimestamp(item.approvedAt, {
              emptyText: '未记录'
            }),
            updatedAt: item.updatedAt || ''
          };
        })
        .sort(
          (left, right) =>
            Number(left.status !== 'pending') - Number(right.status !== 'pending') ||
            (right.updatedAt || right.requestedAt || '').localeCompare(left.updatedAt || left.requestedAt || '') ||
            left.label.localeCompare(right.label)
        )
    : [];
}

function decorateAgentPlanRequests(items) {
  return Array.isArray(items)
    ? items
        .map((item) => {
          const status = item && item.status === 'approved'
            ? 'approved'
            : item && item.status === 'rejected'
              ? 'rejected'
              : 'pending';
          const scope = item && item.scope === 'parent'
            ? 'parent'
            : item && item.scope === 'student'
              ? 'student'
              : item && item.scope === 'both'
                ? 'both'
                : 'unknown';
          const operation = item && item.operation === 'add'
            ? 'add'
            : item && item.operation === 'update'
              ? 'update'
              : item && item.operation === 'delete'
                ? 'delete'
                : 'replace';
          const previewRows = [];
          const changeItems = Array.isArray(item.changes) ? item.changes : [];
          const previewSource = changeItems.length
            ? changeItems
            : [
                ...(Array.isArray(item.parentItems) ? item.parentItems.map((entry) => ({
                  planScope: 'parent',
                  beforeItem: null,
                  afterItem: entry
                })) : []),
                ...(Array.isArray(item.studentItems) ? item.studentItems.map((entry) => ({
                  planScope: 'student',
                  beforeItem: null,
                  afterItem: entry
                })) : [])
              ];

          for (const change of previewSource.slice(0, 4)) {
            const planScopeLabel = change.planScope === 'student' ? '学生' : '家长';
            const beforeItem = change.beforeItem;
            const afterItem = change.afterItem;

            if (operation === 'delete' && beforeItem) {
              previewRows.push(`${planScopeLabel} · 删除 · ${beforeItem.time} · ${beforeItem.title}`);
              continue;
            }

            if (operation === 'update' && beforeItem && afterItem) {
              previewRows.push(`${planScopeLabel} · 修改 · ${beforeItem.time} · ${beforeItem.title} → ${afterItem.time} · ${afterItem.title}`);
              continue;
            }

            const previewItem = afterItem || beforeItem;

            if (previewItem) {
              previewRows.push(`${planScopeLabel} · 新增 · ${previewItem.time} · ${previewItem.title}`);
            }
          }

          return {
            id: item.id || '',
            role: item.role || 'agent',
            label: item.label || '智能体',
            agentId: item.agentId || '',
            status,
            statusLabel: status === 'approved' ? '已批准' : status === 'rejected' ? '已驳回' : '待确认',
            operation,
            operationLabel: operation === 'add' ? '新增' : operation === 'update' ? '修改' : operation === 'delete' ? '删除' : '旧版替换',
            scope,
            scopeLabel: scope === 'parent' ? '家长计划' : scope === 'student' ? '学生计划' : scope === 'both' ? '家长+学生计划' : '计划申请',
            summary: item.summary || '申请变更计划',
            note: item.note || '',
            itemCount: Number(item.itemCount) || 0,
            parentItemCount: Number(item.parentItemCount) || 0,
            studentItemCount: Number(item.studentItemCount) || 0,
            requestedAt: item.requestedAt || '',
            requestedAtDisplay: formatCloudTimestamp(item.requestedAt, {
              emptyText: '未记录'
            }),
            reviewedAt: item.reviewedAt || '',
            reviewedAtDisplay: formatCloudTimestamp(item.reviewedAt, {
              emptyText: '未处理'
            }),
            updatedAt: item.updatedAt || '',
            previewRows: previewRows.slice(0, 4),
            extraPreviewCount: Math.max(0, (Number(item.itemCount) || 0) - previewRows.slice(0, 4).length)
          };
        })
        .sort(
          (left, right) =>
            Number(left.status !== 'pending') - Number(right.status !== 'pending') ||
            (right.updatedAt || right.requestedAt || '').localeCompare(left.updatedAt || left.requestedAt || '') ||
            left.label.localeCompare(right.label)
        )
    : [];
}

function decorateAgentAccessRequests(items) {
  return Array.isArray(items)
    ? items
        .map((item) => {
          const status = item && item.status === 'approved'
            ? 'approved'
            : item && item.status === 'rejected'
              ? 'rejected'
              : 'pending';

          return {
            id: item.id || '',
            clientId: item.clientId || '',
            label: item.label || '学习助手',
            summary: item.summary || '学习助手请求接入',
            status,
            statusLabel: status === 'approved' ? '已批准' : status === 'rejected' ? '已驳回' : '待确认',
            requestedAt: item.requestedAt || '',
            requestedAtDisplay: formatCloudTimestamp(item.requestedAt, {
              emptyText: '未记录'
            }),
            reviewedAt: item.reviewedAt || '',
            reviewedAtDisplay: formatCloudTimestamp(item.reviewedAt, {
              emptyText: '未处理'
            }),
            issuedAt: item.issuedAt || '',
            issuedAtDisplay: formatCloudTimestamp(item.issuedAt, {
              emptyText: '未领取'
            }),
            updatedAt: item.updatedAt || ''
          };
        })
        .sort(
          (left, right) =>
            Number(left.status !== 'pending') - Number(right.status !== 'pending') ||
            (right.updatedAt || right.requestedAt || '').localeCompare(left.updatedAt || left.requestedAt || '') ||
            left.label.localeCompare(right.label)
        )
    : [];
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatCloudTimestamp(value, options = {}) {
  const raw = typeof value === 'string' ? value.trim() : '';

  if (!raw) {
    return options.emptyText || '';
  }

  const date = new Date(raw);

  if (Number.isNaN(date.getTime())) {
    return raw;
  }

  const prefix = options.prefix || '';
  return `${prefix}${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function buildHomeTiles(summary = {}) {
  const adminCount = summary.authorized ? summary.adminCount || 0 : 0;
  const scheduleCount = summary.authorized ? summary.scheduleCount || 0 : 0;

  return [
    {
      id: 'system',
      title: '系统管理',
      summary: summary.authorized ? `${adminCount} 个管理员` : '身份与管理员',
      description: '查看身份、复制 OPENID、添加或移除家长管理员。',
      tone: 'amber',
      wide: false,
      target: '/pages/system/index'
    },
    {
      id: 'plan',
      title: '计划管理',
      summary: summary.authorized ? `${scheduleCount} 条计划` : '课表与提醒',
      description: '设置上课、看书、作业等计划和提醒内容。',
      tone: 'teal',
      wide: false,
      target: '/pages/plan/index'
    },
    {
      id: 'usage',
      title: '使用管理',
      summary: '守护模式与放开时段',
      description: '后续放守护模式、周期放开和临时放开入口。',
      tone: 'clay',
      wide: true,
      target: '/pages/usage/index'
    }
  ];
}

module.exports = {
  WEEKDAY_OPTIONS,
  emptyScheduleForm,
  callAdmin,
  callAgentAccessAdmin,
  callNamedFunction,
  normalizeWeekdayValues,
  normalizeSpecificDate,
  normalizeDateList,
  decorateWeekdayOptions,
  decorateScheduleItems,
  decorateClassroomItems,
  decorateLibraryItems,
  decorateLearningToolItems,
  decorateAdmins,
  decorateStudentDevices,
  decorateAgentPlanRequests,
  decorateAgentAccessRequests,
  buildHomeTiles,
  formatCloudTimestamp
};
