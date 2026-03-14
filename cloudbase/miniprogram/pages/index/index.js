const {
  callAdmin,
  normalizeWeekdayValues,
  normalizeSpecificDate,
  normalizeDateList,
  decorateWeekdayOptions,
  decorateScheduleItems,
  formatCloudTimestamp
} = require('../../utils/studygate-admin');

const CALENDAR_WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
const AUTO_REFRESH_INTERVAL_MS = 30000;

let autoRefreshTimer = null;
let identityRequestSerial = 0;
let itemsRequestSerial = 0;
let planMutationSerial = 0;

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatDateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function monthKeyFromDate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

function parseDateKey(dateKey) {
  const normalized = normalizeSpecificDate(dateKey);

  if (!normalized) {
    return null;
  }

  const [year, month, day] = normalized.split('-').map((item) => Number(item));
  return new Date(year, month - 1, day);
}

function parseMonthKey(monthKey) {
  const normalized = typeof monthKey === 'string' ? monthKey.trim() : '';

  if (!/^\d{4}-\d{2}$/.test(normalized)) {
    return null;
  }

  const [year, month] = normalized.split('-').map((item) => Number(item));
  return new Date(year, month - 1, 1);
}

function shiftMonthKey(monthKey, delta) {
  const date = parseMonthKey(monthKey) || new Date();
  return monthKeyFromDate(new Date(date.getFullYear(), date.getMonth() + delta, 1));
}

function localWeekdayNumber(date) {
  const weekday = date.getDay();
  return weekday === 0 ? 7 : weekday;
}

function formatMonthLabel(monthKey) {
  const date = parseMonthKey(monthKey) || new Date();
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

function formatSelectedDateLabel(dateKey) {
  const date = parseDateKey(dateKey) || new Date();
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function emptyComposerForm() {
  return {
    title: '',
    time: '19:00',
    message: '',
    includeSelectedDate: true,
    weekdays: [],
    planScope: 'student'
  };
}

function mergeItems(parentItems, studentItems) {
  return [...(Array.isArray(parentItems) ? parentItems : []), ...(Array.isArray(studentItems) ? studentItems : [])];
}

function isDateItem(item) {
  return Boolean(item && (item.mode === 'date' || item.scheduleType === 'date' || item.specificDate));
}

function isSkippedOccurrence(item, dateKey) {
  return !isDateItem(item) && normalizeDateList(item.exceptionDates).includes(dateKey);
}

function itemsForDate(items, dateKey, options = {}) {
  const date = parseDateKey(dateKey) || new Date();
  const weekday = localWeekdayNumber(date);
  const includeSkippedWeekly = Boolean(options.includeSkippedWeekly);

  return (Array.isArray(items) ? items : [])
    .filter((item) => {
      if (!item || item.enabled === false) {
        return false;
      }

      if (isDateItem(item)) {
        return item.specificDate === dateKey;
      }

      if (!Array.isArray(item.weekdays) || !item.weekdays.includes(weekday)) {
        return false;
      }

      return includeSkippedWeekly || !isSkippedOccurrence(item, dateKey);
    })
    .map((item) => ({
      ...item,
      sourceKind: isDateItem(item) ? 'date' : 'weekly',
      stateLabel: isDateItem(item) ? '单次' : isSkippedOccurrence(item, dateKey) ? '已跳过' : '周期',
      actionLabel: isDateItem(item) ? '删除' : isSkippedOccurrence(item, dateKey) ? '恢复' : '跳过',
      actionClass: isDateItem(item)
        ? 'selected-action--danger'
        : isSkippedOccurrence(item, dateKey)
          ? 'selected-action--restore'
          : 'selected-action--skip',
      isSkipped: isSkippedOccurrence(item, dateKey)
    }))
    .sort(
      (left, right) =>
        Number(Boolean(left.isSkipped)) - Number(Boolean(right.isSkipped)) ||
        left.time.localeCompare(right.time) ||
        left.title.localeCompare(right.title)
    );
}

function buildCalendarCells(monthKey, items, selectedDate) {
  const monthDate = parseMonthKey(monthKey) || new Date();
  const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const startOffset = localWeekdayNumber(firstDay) - 1;
  const gridStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1 - startOffset);
  const todayKey = formatDateKey(new Date());
  const cells = [];

  for (let index = 0; index < 42; index += 1) {
    const cellDate = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index);
    const dateKey = formatDateKey(cellDate);
    const previewItems = itemsForDate(items, dateKey);
    const previewRows = previewItems.slice(0, 2).map((item) => item.title);

    cells.push({
      dateKey,
      monthKey: monthKeyFromDate(cellDate),
      dayLabel: String(cellDate.getDate()),
      inCurrentMonth: cellDate.getMonth() === monthDate.getMonth(),
      isToday: dateKey === todayKey,
      isSelected: dateKey === selectedDate,
      planCount: previewItems.length,
      previewRows,
      extraCount: Math.max(0, previewItems.length - previewRows.length)
    });
  }

  return cells;
}

function buildViewState(items, monthKey, selectedDate) {
  const safeSelectedDate = normalizeSpecificDate(selectedDate) || formatDateKey(new Date());
  const safeMonthKey = /^\d{4}-\d{2}$/.test(monthKey || '') ? monthKey : safeSelectedDate.slice(0, 7);
  const selectedDateItems = itemsForDate(items, safeSelectedDate, {
    includeSkippedWeekly: true
  });
  const weeklyItems = (Array.isArray(items) ? items : [])
    .filter((item) => item.mode !== 'date' && item.scheduleType !== 'date' && !item.specificDate)
    .sort((left, right) => left.time.localeCompare(right.time) || left.title.localeCompare(right.title));

  return {
    currentMonthKey: safeMonthKey,
    monthLabel: formatMonthLabel(safeMonthKey),
    calendarWeekdays: CALENDAR_WEEKDAYS,
    calendarCells: buildCalendarCells(safeMonthKey, items, safeSelectedDate),
    selectedDate: safeSelectedDate,
    selectedDateLabel: formatSelectedDateLabel(safeSelectedDate),
    selectedDateItems,
    hasSelectedDateItems: selectedDateItems.length > 0,
    weeklyItems,
    hasWeeklyItems: weeklyItems.length > 0
  };
}

function emptyPlanState(monthKey, selectedDate) {
  return {
    parentItems: [],
    studentItems: [],
    contentLibraries: [],
    items: [],
    updatedAtDisplay: '还没有保存记录。',
    ...buildViewState([], monthKey, selectedDate)
  };
}

Page({
  data: {
    authorized: false,
    identityHint: '当前账号还不是管理员。',
    updatedAtDisplay: '还没有保存记录。',
    parentItems: [],
    studentItems: [],
    contentLibraries: [],
    items: [],
    currentMonthKey: monthKeyFromDate(new Date()),
    monthLabel: '',
    calendarWeekdays: CALENDAR_WEEKDAYS,
    calendarCells: [],
    selectedDate: formatDateKey(new Date()),
    selectedDateLabel: '',
    selectedDateItems: [],
    hasSelectedDateItems: false,
    composerForm: emptyComposerForm(),
    weekdayOptions: decorateWeekdayOptions([]),
    weeklyItems: [],
    hasWeeklyItems: false
  },

  onShow() {
    void this.boot();
    this.startAutoRefresh();
  },

  onHide() {
    this.stopAutoRefresh();
  },

  onUnload() {
    this.stopAutoRefresh();
  },

  async onPullDownRefresh() {
    await this.boot();
    wx.stopPullDownRefresh();
  },

  openSystemPage() {
    wx.navigateTo({
      url: '/pages/system/index'
    });
  },

  async boot() {
    await this.refreshIdentity();

    if (this.data.authorized) {
      await this.reloadItems();
    }
  },

  startAutoRefresh() {
    if (autoRefreshTimer) {
      return;
    }

    autoRefreshTimer = setInterval(() => {
      if (this.data.authorized) {
        void this.reloadItems();
      } else {
        void this.refreshIdentity();
      }
    }, AUTO_REFRESH_INTERVAL_MS);
  },

  stopAutoRefresh() {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }
  },

  async manualRefresh() {
    await this.boot();
  },

  async refreshIdentity() {
    const requestSerial = ++identityRequestSerial;

    try {
      const result = await callAdmin('whoami');

      if (requestSerial !== identityRequestSerial) {
        return;
      }

      const authorized = Boolean(result.authorized);
      this.setData({
        authorized,
        identityHint: authorized ? '已授权' : '未授权'
      });

      if (!authorized) {
        this.setData(emptyPlanState(this.data.currentMonthKey, this.data.selectedDate));
      }
    } catch (error) {
      if (requestSerial !== identityRequestSerial) {
        return;
      }

      this.setData({
        authorized: false,
        identityHint: '身份获取失败，请刷新重试。',
        ...emptyPlanState(this.data.currentMonthKey, this.data.selectedDate)
      });

      wx.showToast({
        title: (error && (error.errMsg || error.message)) || '身份获取失败',
        icon: 'none'
      });
    }
  },

  async reloadItems() {
    const requestSerial = ++itemsRequestSerial;
    const mutationSerialAtStart = planMutationSerial;

    try {
      const result = await callAdmin('list');

      if (requestSerial !== itemsRequestSerial || mutationSerialAtStart !== planMutationSerial) {
        return;
      }

      const parentItems = decorateScheduleItems(result.parentItems, {
        planScope: 'parent'
      });
      const studentItems = decorateScheduleItems(result.studentItems, {
        planScope: 'student'
      });
      const items = mergeItems(parentItems, studentItems);

      this.setData({
        parentItems,
        studentItems,
        contentLibraries: Array.isArray(result.contentLibraries) ? result.contentLibraries : [],
        items,
        updatedAtDisplay: formatCloudTimestamp(result.updatedAt, {
          prefix: '最近保存：',
          emptyText: '还没有保存记录。'
        }),
        ...buildViewState(items, this.data.currentMonthKey, this.data.selectedDate)
      });
    } catch (error) {
      if (requestSerial !== itemsRequestSerial) {
        return;
      }

      wx.showToast({
        title: error && error.message ? error.message : '加载失败',
        icon: 'none'
      });
    }
  },

  refreshCalendar(items = this.data.items, monthKey = this.data.currentMonthKey, selectedDate = this.data.selectedDate) {
    this.setData({
      ...buildViewState(items, monthKey, selectedDate)
    });
  },

  prevMonth() {
    this.refreshCalendar(this.data.items, shiftMonthKey(this.data.currentMonthKey, -1), this.data.selectedDate);
  },

  nextMonth() {
    this.refreshCalendar(this.data.items, shiftMonthKey(this.data.currentMonthKey, 1), this.data.selectedDate);
  },

  selectDate(event) {
    const dateKey = normalizeSpecificDate(event.currentTarget.dataset.date);
    const monthKey = event.currentTarget.dataset.month;

    if (!dateKey) {
      return;
    }

    this.refreshCalendar(this.data.items, monthKey || dateKey.slice(0, 7), dateKey);
  },

  onComposerInput(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({
      [`composerForm.${field}`]: event.detail.value
    });
  },

  onTimeChange(event) {
    this.setData({
      'composerForm.time': event.detail.value
    });
  },

  toggleSelectedDate() {
    this.setData({
      'composerForm.includeSelectedDate': !this.data.composerForm.includeSelectedDate
    });
  },

  onComposerWeekdayChange(event) {
    const values = normalizeWeekdayValues(event.detail.value);
    this.setData({
      'composerForm.weekdays': values,
      weekdayOptions: decorateWeekdayOptions(values)
    });
  },

  chooseParentScope() {
    this.setData({
      'composerForm.planScope': 'parent'
    });
  },

  chooseStudentScope() {
    this.setData({
      'composerForm.planScope': 'student'
    });
  },

  resetComposer() {
    this.setData({
      composerForm: emptyComposerForm(),
      weekdayOptions: decorateWeekdayOptions([])
    });
  },

  async saveComposer() {
    const form = this.data.composerForm;
    const selectedDate = normalizeSpecificDate(this.data.selectedDate);
    const weekdays = normalizeWeekdayValues(form.weekdays);

    if (!form.title.trim()) {
      wx.showToast({
        title: '事项名称不能为空',
        icon: 'none'
      });
      return;
    }

    if (!form.includeSelectedDate && !weekdays.length) {
      wx.showToast({
        title: '至少选一个日期或星期',
        icon: 'none'
      });
      return;
    }

    const additions = [];
    const baseId = `schedule-${Date.now().toString(36)}`;

    if (form.includeSelectedDate && selectedDate) {
      additions.push({
        id: `${baseId}-date`,
        mode: 'date',
        title: form.title.trim(),
        time: form.time || '19:00',
        target: '',
        weekdays: [],
        specificDate: selectedDate,
        exceptionDates: [],
        message: (form.message || '').trim()
      });
    }

    if (weekdays.length) {
      additions.push({
        id: `${baseId}-weekly`,
        mode: 'weekly',
        title: form.title.trim(),
        time: form.time || '19:00',
        target: '',
        weekdays: weekdays.map((item) => Number(item)),
        specificDate: '',
        exceptionDates: [],
        message: (form.message || '').trim()
      });
    }

    const isParent = form.planScope === 'parent';
    const nextParentItems = isParent ? [...this.data.parentItems, ...additions] : this.data.parentItems;
    const nextStudentItems = isParent ? this.data.studentItems : [...this.data.studentItems, ...additions];

    await this.persistState(nextParentItems, nextStudentItems, '已添加', {
      resetComposer: true
    });
  },

  async handleSelectedDateAction(event) {
    const itemId = event.currentTarget.dataset.id;
    const selectedDate = normalizeSpecificDate(this.data.selectedDate);
    const targetItem = this.data.items.find((entry) => entry.id === itemId);

    if (!targetItem) {
      return;
    }

    const sourceKey = targetItem.planScope === 'student' ? 'studentItems' : 'parentItems';
    const sourceItems = this.data[sourceKey];

    if (isDateItem(targetItem)) {
      const nextItems = sourceItems.filter((entry) => entry.id !== itemId);
      await this.persistByScope(sourceKey, nextItems, '已删除');
      return;
    }

    if (!selectedDate) {
      return;
    }

    const nextItems = sourceItems.map((entry) => {
      if (entry.id !== itemId) {
        return entry;
      }

      const currentDates = normalizeDateList(entry.exceptionDates || []);
      const shouldRestore = currentDates.includes(selectedDate);

      return {
        ...entry,
        exceptionDates: shouldRestore
          ? currentDates.filter((item) => item !== selectedDate)
          : normalizeDateList([...currentDates, selectedDate])
      };
    });

    await this.persistByScope(
      sourceKey,
      nextItems,
      normalizeDateList(targetItem.exceptionDates || []).includes(selectedDate) ? '已恢复当天' : '已跳过当天'
    );
  },

  async deleteWeeklyItem(event) {
    const itemId = event.currentTarget.dataset.id;
    const planScope = event.currentTarget.dataset.scope === 'student' ? 'student' : 'parent';
    const sourceKey = planScope === 'student' ? 'studentItems' : 'parentItems';
    const nextItems = this.data[sourceKey].filter((entry) => entry.id !== itemId);

    await this.persistByScope(sourceKey, nextItems, '已删除');
  },

  async persistByScope(sourceKey, nextItems, successText) {
    if (sourceKey === 'parentItems') {
      await this.persistState(nextItems, this.data.studentItems, successText);
      return;
    }

    await this.persistState(this.data.parentItems, nextItems, successText);
  },

  async persistState(parentItems, studentItems, successText, options = {}) {
    const mutationSerial = ++planMutationSerial;

    try {
      const result = await callAdmin('saveAll', {
        parentItems,
        studentItems,
        contentLibraries: this.data.contentLibraries
      });

      if (mutationSerial !== planMutationSerial) {
        return;
      }

      const decoratedParentItems = decorateScheduleItems(result.parentItems, {
        planScope: 'parent'
      });
      const decoratedStudentItems = decorateScheduleItems(result.studentItems, {
        planScope: 'student'
      });
      const items = mergeItems(decoratedParentItems, decoratedStudentItems);
      const nextState = {
        parentItems: decoratedParentItems,
        studentItems: decoratedStudentItems,
        contentLibraries: Array.isArray(result.contentLibraries) ? result.contentLibraries : [],
        items,
        updatedAtDisplay: formatCloudTimestamp(result.updatedAt, {
          prefix: '最近保存：',
          emptyText: '还没有保存记录。'
        }),
        ...buildViewState(items, this.data.currentMonthKey, this.data.selectedDate)
      };

      if (options.resetComposer) {
        nextState.composerForm = emptyComposerForm();
        nextState.weekdayOptions = decorateWeekdayOptions([]);
      }

      this.setData(nextState);

      wx.showToast({
        title: successText,
        icon: 'success'
      });
    } catch (error) {
      wx.showToast({
        title: error && error.message ? error.message : '保存失败',
        icon: 'none'
      });
    }
  }
});
