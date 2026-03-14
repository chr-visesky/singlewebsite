'use strict';

const backHomeButton = document.getElementById('back-home');
const refreshPlanButton = document.getElementById('refresh-plan');
const accessStatusNode = document.getElementById('access-status');
const accessStatusTitleNode = document.getElementById('access-status-title');
const accessStatusMessageNode = document.getElementById('access-status-message');
const prevMonthButton = document.getElementById('prev-month');
const nextMonthButton = document.getElementById('next-month');
const monthLabelNode = document.getElementById('month-label');
const calendarGridNode = document.getElementById('calendar-grid');
const selectedDateLabelNode = document.getElementById('selected-date-label');
const selectedDateListNode = document.getElementById('selected-date-list');
const titleInput = document.getElementById('title-input');
const timeInput = document.getElementById('time-input');
const messageInput = document.getElementById('message-input');
const includeDateInput = document.getElementById('include-date');
const includeDateLabel = document.getElementById('include-date-label');
const weekdayGridNode = document.getElementById('weekday-grid');
const savePlanButton = document.getElementById('save-plan');
const resetFormButton = document.getElementById('reset-form');
const weeklyListNode = document.getElementById('weekly-list');

const WEEKDAY_OPTIONS = [
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
  { value: 7, label: '周日' }
];

let currentMonthKey = '';
let selectedDateKey = '';
let studentItems = [];
let pendingRefresh = null;
let queuedRefreshOptions = null;
let formState = createEmptyFormState();
let autoRefreshTimer = null;
let refreshRequestSerial = 0;
let viewMutationSerial = 0;
let accessStatus = {
  mode: 'local',
  approved: true,
  message: '当前使用本机学生计划。'
};

function createEmptyFormState() {
  return {
    title: '',
    time: '19:00',
    message: '',
    includeSelectedDate: true,
    weekdays: []
  };
}

function normalizeSpecificDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? value.trim() : '';
}

function normalizeWeekdays(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((item) => Number(item)).filter((item) => item >= 1 && item <= 7))].sort(
    (left, right) => left - right
  );
}

function shiftMonthKey(monthKey, delta) {
  if (!/^\d{4}-\d{2}$/.test(monthKey || '')) {
    return monthKey;
  }

  const [year, month] = monthKey.split('-').map((item) => Number(item));
  const date = new Date(year, month - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function createEmptyNode(text) {
  const node = document.createElement('article');
  node.className = 'empty';
  node.textContent = text;
  return node;
}

function syncFormToView() {
  titleInput.value = formState.title;
  timeInput.value = formState.time;
  messageInput.value = formState.message;
  includeDateInput.checked = formState.includeSelectedDate;
  includeDateLabel.textContent = selectedDateKey ? selectedDateKey : '所选日期';

  weekdayGridNode.replaceChildren();

  WEEKDAY_OPTIONS.forEach((option) => {
    const label = document.createElement('label');
    label.className = 'weekday-chip';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = formState.weekdays.includes(option.value);
    checkbox.addEventListener('change', () => {
      const nextWeekdays = new Set(formState.weekdays);

      if (checkbox.checked) {
        nextWeekdays.add(option.value);
      } else {
        nextWeekdays.delete(option.value);
      }

      formState.weekdays = normalizeWeekdays([...nextWeekdays]);
    });

    const text = document.createElement('span');
    text.textContent = option.label;
    label.append(checkbox, text);
    weekdayGridNode.append(label);
  });
}

function resetForm() {
  formState = createEmptyFormState();
  syncFormToView();
}

function renderSelectedDateItems(items) {
  selectedDateListNode.replaceChildren();

  if (!items.length) {
    selectedDateListNode.append(createEmptyNode('这天没有计划'));
    return;
  }

  items.forEach((item) => {
    const article = document.createElement('article');
    article.className = `selected-item${item.isSkipped ? ' selected-item--skipped' : ''}`;

    const main = document.createElement('div');
    main.className = 'selected-item__main';

    const top = document.createElement('div');
    top.className = 'selected-item__top';

    const ownerBadge = document.createElement('span');
    ownerBadge.className = `badge ${item.planScope === 'student' ? 'badge--student' : 'badge--parent'}`;
    ownerBadge.textContent = item.planScopeLabel;

    const stateBadge = document.createElement('span');
    stateBadge.className = 'badge badge--state';
    stateBadge.textContent = item.stateLabel;

    const title = document.createElement('span');
    title.className = 'selected-item__title';
    title.textContent = item.title;

    top.append(ownerBadge, stateBadge, title);

    const meta = document.createElement('div');
    meta.className = 'selected-item__meta';
    meta.textContent = item.time;

    main.append(top, meta);
    article.append(main);

    if (item.canEdit && item.actionLabel) {
      const action = document.createElement('button');
      action.type = 'button';
      action.className = `action-chip ${item.kindLabel === '单次' ? 'action-chip--delete' : 'action-chip--skip'}`;
      action.textContent = item.actionLabel;
      action.disabled = !canMutateStudentPlans();
      action.addEventListener('click', async () => {
        await applySelectedItemAction(item);
      });
      article.append(action);
    }

    selectedDateListNode.append(article);
  });
}

function renderWeeklyItems(items) {
  weeklyListNode.replaceChildren();

  if (!items.length) {
    weeklyListNode.append(createEmptyNode('还没有学生周期计划'));
    return;
  }

  items.forEach((item) => {
    const article = document.createElement('article');
    article.className = 'weekly-item';

    const main = document.createElement('div');
    main.className = 'weekly-item__main';

    const top = document.createElement('div');
    top.className = 'weekly-item__top';

    const badge = document.createElement('span');
    badge.className = 'badge badge--student';
    badge.textContent = '学生';

    const title = document.createElement('span');
    title.className = 'weekly-item__title';
    title.textContent = item.title;

    top.append(badge, title);

    const meta = document.createElement('div');
    meta.className = 'weekly-item__meta';
    meta.textContent = `${item.time} · ${item.patternLabel}`;

    main.append(top, meta);

    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'action-chip action-chip--delete';
    action.textContent = '删除';
    action.disabled = !canMutateStudentPlans();
    action.addEventListener('click', async () => {
      const nextItems = studentItems.filter((entry) => entry.id !== item.id);
      await saveStudentItems(nextItems);
    });

    article.append(main, action);
    weeklyListNode.append(article);
  });
}

function canMutateStudentPlans() {
  return Boolean(accessStatus && (accessStatus.approved || accessStatus.mode === 'local' || accessStatus.mode === 'token'));
}

function renderAccessStatus(nextStatus) {
  accessStatus = nextStatus && typeof nextStatus === 'object'
    ? nextStatus
    : {
        mode: 'local',
        approved: true,
        message: '当前使用本机学生计划。'
      };

  let title = '本机模式';
  let message = accessStatus.message || '当前使用本机学生计划。';
  let toneClass = 'status-banner--muted';

  if (accessStatus.mode === 'token' || accessStatus.approved) {
    title = '已授权';
    toneClass = 'status-banner--ok';
    message = accessStatus.message || '当前客户端已获准修改学生计划。';
  } else if (accessStatus.mode === 'approval') {
    title = '等待批准';
    toneClass = 'status-banner--warn';
    message = accessStatus.message || '已自动提交学生计划写入申请，等待家长在手机端批准。';
  } else if (accessStatus.mode === 'error') {
    title = '授权异常';
    toneClass = 'status-banner--danger';
    message = accessStatus.message || '学生计划授权状态同步失败。';
  }

  accessStatusNode.className = `status-banner ${toneClass}`;
  accessStatusTitleNode.textContent = title;
  accessStatusMessageNode.textContent = message;
  savePlanButton.disabled = !canMutateStudentPlans();
}

function renderCalendar(model) {
  monthLabelNode.textContent = model.monthLabel;
  selectedDateLabelNode.textContent = model.selectedDateLabel;
  includeDateLabel.textContent = selectedDateKey ? selectedDateKey : '所选日期';
  calendarGridNode.replaceChildren();

  model.calendarCells.forEach((cell) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `calendar-cell${cell.inCurrentMonth ? '' : ' calendar-cell--muted'}${cell.isToday ? ' calendar-cell--today' : ''}${
      cell.isSelected ? ' calendar-cell--selected' : ''
    }`;

    const top = document.createElement('div');
    top.className = 'calendar-cell__top';

    const day = document.createElement('span');
    day.className = 'calendar-cell__day';
    day.textContent = cell.dayLabel;
    top.append(day);

    if (cell.planCount) {
      const count = document.createElement('span');
      count.className = 'calendar-cell__count';
      count.textContent = String(cell.planCount);
      top.append(count);
    }

    button.append(top);

    (cell.previewRows || []).forEach((row) => {
      const preview = document.createElement('span');
      preview.className = 'calendar-cell__preview';
      preview.textContent = row;
      button.append(preview);
    });

    if (cell.extraCount) {
      const more = document.createElement('span');
      more.className = 'calendar-cell__preview calendar-cell__preview--soft';
      more.textContent = `+${cell.extraCount}`;
      button.append(more);
    }

    button.addEventListener('click', () => {
      void refreshModel({
        monthKey: cell.monthKey,
        selectedDate: cell.dateKey
      });
    });

    calendarGridNode.append(button);
  });
}

function renderModel(response) {
  const model = response.model || {};
  renderAccessStatus(response.accessStatus || null);
  studentItems = Array.isArray(response.studentItems) ? response.studentItems : [];
  currentMonthKey = model.currentMonthKey || currentMonthKey;
  selectedDateKey = model.selectedDateKey || selectedDateKey;
  renderCalendar(model);
  renderSelectedDateItems(model.selectedDateItems || []);
  renderWeeklyItems(model.studentWeeklyItems || []);
  syncFormToView();
}

async function refreshModel(options = {}) {
  if (pendingRefresh) {
    queuedRefreshOptions = {
      monthKey: options.monthKey || currentMonthKey,
      selectedDate: options.selectedDate || selectedDateKey
    };
    return pendingRefresh;
  }

  const requestOptions = {
    monthKey: options.monthKey || currentMonthKey,
    selectedDate: options.selectedDate || selectedDateKey
  };
  const requestSerial = ++refreshRequestSerial;
  const mutationSerialAtStart = viewMutationSerial;

  pendingRefresh = (async () => {
    const response = await window.studyGate.getStudentPlanModel(requestOptions);

    if (requestSerial !== refreshRequestSerial || mutationSerialAtStart !== viewMutationSerial) {
      return;
    }

    renderModel(response);
  })();

  try {
    await pendingRefresh;
  } finally {
    pendingRefresh = null;
  }

  if (queuedRefreshOptions) {
    const nextOptions = queuedRefreshOptions;
    queuedRefreshOptions = null;
    await refreshModel(nextOptions);
  }
}

function startAutoRefresh() {
  if (autoRefreshTimer) {
    return;
  }

  autoRefreshTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible') {
      void refreshModel();
    }
  }, 30000);
}

async function saveStudentItems(items) {
  const mutationSerial = ++viewMutationSerial;

  try {
    const response = await window.studyGate.saveStudentPlanItems({
      items,
      monthKey: currentMonthKey,
      selectedDate: selectedDateKey
    });

    if (mutationSerial !== viewMutationSerial) {
      return false;
    }

    renderModel(response);
    return true;
  } catch (error) {
    if (mutationSerial === viewMutationSerial) {
      window.alert((error && error.message) || '学生计划保存失败。');
      await refreshModel();
    }

    return false;
  }
}

async function applySelectedItemAction(item) {
  if (!item || !item.id) {
    return;
  }

  if (!canMutateStudentPlans()) {
    window.alert(accessStatus.message || '已自动提交学生计划写入申请，等待家长批准。');
    return;
  }

  const targetItem = studentItems.find((entry) => entry.id === item.id);

  if (!targetItem) {
    return;
  }

  if (targetItem.mode === 'date' || targetItem.specificDate) {
    await saveStudentItems(studentItems.filter((entry) => entry.id !== item.id));
    return;
  }

  const currentDates = Array.isArray(targetItem.exceptionDates) ? targetItem.exceptionDates.filter(Boolean) : [];
  const shouldRestore = currentDates.includes(selectedDateKey);
  const nextItems = studentItems.map((entry) => {
    if (entry.id !== item.id) {
      return entry;
    }

    return {
      ...entry,
      exceptionDates: shouldRestore
        ? currentDates.filter((dateKey) => dateKey !== selectedDateKey)
        : [...currentDates, selectedDateKey]
    };
  });

  await saveStudentItems(nextItems);
}

async function saveForm() {
  if (!canMutateStudentPlans()) {
    window.alert(accessStatus.message || '已自动提交学生计划写入申请，等待家长批准。');
    return;
  }

  const title = titleInput.value.trim();
  const time = timeInput.value || '19:00';
  const message = messageInput.value.trim();
  const includeSelectedDate = includeDateInput.checked;
  const weekdays = normalizeWeekdays(formState.weekdays);

  if (!title) {
    window.alert('事项名称不能为空。');
    return;
  }

  if (!includeSelectedDate && !weekdays.length) {
    window.alert('至少选一个日期或星期。');
    return;
  }

  const baseId = `schedule-${Date.now().toString(36)}`;
  const additions = [];

  if (includeSelectedDate && normalizeSpecificDate(selectedDateKey)) {
    additions.push({
      id: `${baseId}-date`,
      mode: 'date',
      title,
      time,
      weekdays: [],
      specificDate: selectedDateKey,
      exceptionDates: [],
      message
    });
  }

  if (weekdays.length) {
    additions.push({
      id: `${baseId}-weekly`,
      mode: 'weekly',
      title,
      time,
      weekdays,
      specificDate: '',
      exceptionDates: [],
      message
    });
  }

  const saved = await saveStudentItems([...studentItems, ...additions]);

  if (saved) {
    resetForm();
  }
}

backHomeButton.addEventListener('click', async () => {
  await window.studyGate.navigate('internal:home');
});

refreshPlanButton.addEventListener('click', () => {
  void refreshModel();
});

prevMonthButton.addEventListener('click', () => {
  void refreshModel({
    monthKey: shiftMonthKey(currentMonthKey, -1),
    selectedDate: selectedDateKey
  });
});

nextMonthButton.addEventListener('click', () => {
  void refreshModel({
    monthKey: shiftMonthKey(currentMonthKey, 1),
    selectedDate: selectedDateKey
  });
});

titleInput.addEventListener('input', () => {
  formState.title = titleInput.value;
});

timeInput.addEventListener('input', () => {
  formState.time = timeInput.value;
});

messageInput.addEventListener('input', () => {
  formState.message = messageInput.value;
});

includeDateInput.addEventListener('change', () => {
  formState.includeSelectedDate = includeDateInput.checked;
});

savePlanButton.addEventListener('click', () => {
  void saveForm();
});

resetFormButton.addEventListener('click', () => {
  resetForm();
});

resetForm();
startAutoRefresh();
window.addEventListener('focus', () => {
  void refreshModel();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    void refreshModel();
  }
});
void refreshModel();
