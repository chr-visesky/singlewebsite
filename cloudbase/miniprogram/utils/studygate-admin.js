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
  normalizeWeekdayValues,
  normalizeSpecificDate,
  normalizeDateList,
  decorateWeekdayOptions,
  decorateScheduleItems,
  decorateClassroomItems,
  decorateLibraryItems,
  decorateAdmins,
  decorateStudentDevices,
  buildHomeTiles,
  formatCloudTimestamp
};
