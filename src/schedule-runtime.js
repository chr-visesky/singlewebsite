'use strict';

function createStudyScheduleRuntime(dependencies = {}) {
  const {
    buildHomeUiModel,
    formatDisplayTime,
    formatLocalDateKey,
    formatLocalTime,
    formatStudyDayLabel,
    formatWeekdayLabel,
    localWeekdayNumber,
    normalizeDateList,
    normalizePlanScope,
    normalizePrefix,
    normalizeScheduleTargetId,
    normalizeSpecificDate,
    normalizeWeekdays,
    getAppConfig,
    getStudyToolsState,
    saveStudyToolsState,
    resolveStudyTargetById,
    getNativeModuleDefinitions,
    getClassroomDefinitions,
    getLibraryDefinitions,
    getLearningToolDefinitions,
    nativeModuleTarget,
    libraryTarget,
    learningToolEntryTarget,
    syncStudentDeviceAccessStatus,
    serializeStudySchedule
  } = dependencies;

  const appConfig = () => (typeof getAppConfig === 'function' ? getAppConfig() : null);
  const studyToolsState = () => (typeof getStudyToolsState === 'function' ? getStudyToolsState() : { classMarks: {} });

  function scheduleMessage(schedule) {
    return schedule.message || `到${schedule.title}时间了。`;
  }

  function studyScheduleOccurrenceKey(scheduleId, dateKey = formatLocalDateKey()) {
    return `${scheduleId}:${dateKey}`;
  }

  function getScheduleMark(scheduleId, dateKey = formatLocalDateKey()) {
    const occurrenceKey = studyScheduleOccurrenceKey(scheduleId, dateKey);
    const mark = studyToolsState().classMarks[occurrenceKey];
    return mark && typeof mark === 'object' ? mark : null;
  }

  function normalizeReminderMarks(mark) {
    if (!mark || typeof mark !== 'object' || !mark.reminderMarks || typeof mark.reminderMarks !== 'object') {
      return {};
    }

    const result = {};

    for (const [key, value] of Object.entries(mark.reminderMarks)) {
      const offset = Number(key);

      if (!Number.isFinite(offset) || typeof value !== 'string' || !value) {
        continue;
      }

      result[String(offset)] = value;
    }

    return result;
  }

  function upsertScheduleMark(schedule, updates, date = new Date()) {
    const toolsState = studyToolsState();
    const dateKey = formatLocalDateKey(date);
    const occurrenceKey = studyScheduleOccurrenceKey(schedule.id, dateKey);
    const existing = getScheduleMark(schedule.id, dateKey) || {};
    const timestamp = date.toISOString();

    toolsState.classMarks[occurrenceKey] = {
      scheduleId: schedule.id,
      targetId: schedule.targetId,
      title: schedule.title,
      time: schedule.time,
      dateKey,
      remindedAt: existing.remindedAt || '',
      reminderMarks: normalizeReminderMarks(existing),
      completedAt: existing.completedAt || '',
      updatedAt: timestamp,
      ...updates
    };

    if (typeof saveStudyToolsState === 'function') {
      saveStudyToolsState();
    }

    return toolsState.classMarks[occurrenceKey];
  }

  function getTodaySchedules(date = new Date()) {
    const config = appConfig();
    const weekday = localWeekdayNumber(date);
    const dateKey = formatLocalDateKey(date);

    return (config && Array.isArray(config.studySchedule) ? config.studySchedule : [])
      .filter((schedule) => {
        if (!schedule.enabled) {
          return false;
        }

        if (schedule.mode === 'date' || schedule.specificDate) {
          return schedule.specificDate === dateKey;
        }

        if (normalizeDateList(schedule.exceptionDates).includes(dateKey)) {
          return false;
        }

        return schedule.weekdays.includes(weekday);
      })
      .sort((left, right) => left.time.localeCompare(right.time) || left.title.localeCompare(right.title));
  }

  function describeScheduleStatus(schedule, mark, now = new Date()) {
    if (mark && mark.completedAt) {
      return {
        code: 'completed',
        label: '已完成',
        detail: `已于 ${formatDisplayTime(mark.completedAt)} 打卡。`
      };
    }

    if (formatLocalTime(now) >= schedule.time) {
      return {
        code: 'pending',
        label: '打卡',
        detail: '已到打卡时间。'
      };
    }

    return {
      code: 'upcoming',
      label: '未到时间',
      detail: '还没到打卡时间。'
    };
  }

  function findScheduleForLaunch(options = {}, date = new Date()) {
    const todaySchedules = getTodaySchedules(date);
    const requestedScheduleId = normalizePrefix(options.scheduleId);

    if (requestedScheduleId) {
      return todaySchedules.find((schedule) => schedule.id === requestedScheduleId) || null;
    }

    const targetId = normalizeScheduleTargetId(options.scheduleTargetId || options.libraryId || '');

    if (!targetId) {
      return null;
    }

    const matchingSchedules = todaySchedules.filter((schedule) => schedule.targetId === targetId);

    if (!matchingSchedules.length) {
      return null;
    }

    const incompleteSchedule = matchingSchedules.find((schedule) => {
      const mark = getScheduleMark(schedule.id, formatLocalDateKey(date));
      return !(mark && mark.completedAt);
    });

    return incompleteSchedule || matchingSchedules[matchingSchedules.length - 1];
  }

  function getScheduleLaunchStatusForToday(options = {}, date = new Date()) {
    const schedule = findScheduleForLaunch(options, date);

    if (!schedule) {
      return null;
    }

    const mark = getScheduleMark(schedule.id, formatLocalDateKey(date));
    const status = describeScheduleStatus(schedule, mark, date);

    return {
      schedule,
      mark,
      status,
      blocked: status.code === 'upcoming',
      alreadyCompleted: Boolean(mark && mark.completedAt)
    };
  }

  function markScheduleCompletedForToday(options = {}, date = new Date()) {
    const launchStatus = getScheduleLaunchStatusForToday(options, date);

    if (!launchStatus) {
      return null;
    }

    const { schedule, mark: existing, status } = launchStatus;

    if (status.code === 'upcoming') {
      return {
        schedule,
        mark: existing || null,
        blocked: true,
        reason: 'not_started'
      };
    }

    if (existing && existing.completedAt) {
      return {
        schedule,
        mark: existing
      };
    }

    return {
      schedule,
      mark: upsertScheduleMark(
        schedule,
        {
          completedAt: date.toISOString()
        },
        date
      )
    };
  }

  function buildStudyScheduleModel(date = new Date()) {
    const todayKey = formatLocalDateKey(date);
    const todaySchedules = getTodaySchedules(date);
    const classes = todaySchedules.map((schedule) => {
      const mark = getScheduleMark(schedule.id, todayKey);
      const status = describeScheduleStatus(schedule, mark, date);
      const target = typeof resolveStudyTargetById === 'function' ? resolveStudyTargetById(schedule.targetId) : null;

      return {
        id: schedule.id,
        planScope: normalizePlanScope(schedule.planScope, 'parent'),
        planScopeLabel: normalizePlanScope(schedule.planScope, 'parent') === 'student' ? '学生' : '家长',
        time: schedule.time,
        title: schedule.title,
        message: scheduleMessage(schedule),
        status: status.code,
        statusLabel: status.label,
        statusDetail: status.detail,
        canCheckIn: status.code === 'pending',
        target: target ? target.target : '',
        scheduleTargetId: schedule.targetId,
        libraryId: target ? target.libraryId : '',
        libraryTitle: target ? target.libraryTitle : '',
        canLaunch: Boolean(target),
        entryLabel: target ? target.entryLabel : '记完成'
      };
    });
    const completedCount = classes.filter((item) => item.status === 'completed').length;
    const pendingCount = classes.filter((item) => item.status === 'pending').length;
    const upcomingCount = classes.filter((item) => item.status === 'upcoming').length;
    const summary = !classes.length
      ? '今天没有排课，不会触发提醒。'
      : `今天共 ${classes.length} 节，已完成 ${completedCount} 节，待完成 ${pendingCount} 节。`;

    return {
      todayLabel: formatStudyDayLabel(date),
      classes,
      totalCount: classes.length,
      completedCount,
      pendingCount,
      upcomingCount,
      summary
    };
  }

  function monthKeyFromDate(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  function parseMonthKey(monthKey) {
    const normalized = normalizePrefix(monthKey);

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

  function monthLabelFromDate(date = new Date()) {
    return `${date.getFullYear()}年${date.getMonth() + 1}月`;
  }

  function selectedDateLabelFromDate(date = new Date()) {
    return `${date.getMonth() + 1}月${date.getDate()}日 ${formatWeekdayLabel(localWeekdayNumber(date))}`;
  }

  function formatCalendarItem(schedule, date = new Date()) {
    return {
      id: schedule.id,
      time: schedule.time,
      title: schedule.title,
      message: scheduleMessage(schedule),
      dateKey: formatLocalDateKey(date)
    };
  }

  function buildStudyCalendarModel(selectedDate = new Date()) {
    const monthDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const startOffset = localWeekdayNumber(firstDay) - 1;
    const gridStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1 - startOffset);
    const selectedDateKey = formatLocalDateKey(selectedDate);
    const todayKey = formatLocalDateKey(new Date());
    const entriesByDate = {};
    const cells = [];

    for (let index = 0; index < 42; index += 1) {
      const cellDate = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index);
      const dateKey = formatLocalDateKey(cellDate);
      const items = getTodaySchedules(cellDate).map((schedule) => formatCalendarItem(schedule, cellDate));
      const previewRows = items.slice(0, 2).map((item) => item.title);

      if (items.length) {
        entriesByDate[dateKey] = items;
      }

      cells.push({
        dateKey,
        dayLabel: String(cellDate.getDate()),
        inCurrentMonth: cellDate.getMonth() === monthDate.getMonth(),
        isToday: dateKey === todayKey,
        isSelected: dateKey === selectedDateKey,
        count: items.length,
        previewRows,
        extraCount: Math.max(0, items.length - previewRows.length)
      });
    }

    return {
      monthKey: monthKeyFromDate(monthDate),
      monthLabel: monthLabelFromDate(monthDate),
      selectedDateKey,
      selectedDateLabel: selectedDateLabelFromDate(selectedDate),
      cells,
      entriesByDate
    };
  }

  function buildHomeModel() {
    const config = appConfig() || {};

    return buildHomeUiModel({
      appTitle: config.appTitle,
      homeNotice: config.homeNotice,
      todaySchedule: buildStudyScheduleModel(),
      calendarSchedule: buildStudyCalendarModel(),
      nativeModules: typeof getNativeModuleDefinitions === 'function' ? getNativeModuleDefinitions() : [],
      classrooms: typeof getClassroomDefinitions === 'function' ? getClassroomDefinitions() : [],
      libraries: typeof getLibraryDefinitions === 'function' ? getLibraryDefinitions() : [],
      learningTools: typeof getLearningToolDefinitions === 'function' ? getLearningToolDefinitions() : [],
      nativeModuleTarget,
      libraryTarget,
      learningToolEntryTarget
    });
  }

  function buildPlanItemsForDate(dateKey, options = {}) {
    const config = appConfig();
    const normalizedDateKey = normalizeSpecificDate(dateKey) || formatLocalDateKey(new Date());
    const date = new Date(`${normalizedDateKey}T00:00:00`);
    const weekday = localWeekdayNumber(date);
    const includeSkippedWeekly = Boolean(options.includeSkippedWeekly);

    return (Array.isArray(config && config.studySchedule) ? config.studySchedule : [])
      .filter((schedule) => {
        if (!schedule || !schedule.enabled) {
          return false;
        }

        if (schedule.mode === 'date' || schedule.specificDate) {
          return schedule.specificDate === normalizedDateKey;
        }

        if (!Array.isArray(schedule.weekdays) || !schedule.weekdays.includes(weekday)) {
          return false;
        }

        const isSkipped = normalizeDateList(schedule.exceptionDates).includes(normalizedDateKey);
        return includeSkippedWeekly || !isSkipped;
      })
      .map((schedule) => {
        const isDatePlan = schedule.mode === 'date' || Boolean(schedule.specificDate);
        const isSkipped = !isDatePlan && normalizeDateList(schedule.exceptionDates).includes(normalizedDateKey);
        const planScope = normalizePlanScope(schedule.planScope, 'parent');
        const editable = planScope === 'student';

        if (!editable) {
          return {
            id: schedule.id,
            title: schedule.title,
            time: schedule.time,
            planScope,
            planScopeLabel: '家长',
            kindLabel: isDatePlan ? '单次' : '周期',
            stateLabel: isDatePlan ? '单次' : isSkipped ? '已跳过' : '周期',
            isSkipped,
            canEdit: false,
            actionLabel: ''
          };
        }

        return {
          id: schedule.id,
          title: schedule.title,
          time: schedule.time,
          planScope,
          planScopeLabel: '学生',
          kindLabel: isDatePlan ? '单次' : '周期',
          stateLabel: isDatePlan ? '单次' : isSkipped ? '已跳过' : '周期',
          isSkipped,
          canEdit: true,
          actionLabel: isDatePlan ? '删除' : isSkipped ? '恢复' : '跳过'
        };
      })
      .sort(
        (left, right) =>
          Number(Boolean(left.isSkipped)) - Number(Boolean(right.isSkipped)) ||
          left.time.localeCompare(right.time) ||
          left.title.localeCompare(right.title)
      );
  }

  function buildStudentPlanModel(options = {}) {
    const config = appConfig() || {};
    const selectedDateKey = normalizeSpecificDate(options.selectedDate) || formatLocalDateKey(new Date());
    const monthDate = parseMonthKey(options.monthKey || selectedDateKey.slice(0, 7)) || new Date();
    const monthKey = monthKeyFromDate(monthDate);
    const monthLabel = monthLabelFromDate(monthDate);
    const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const startOffset = localWeekdayNumber(firstDay) - 1;
    const gridStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1 - startOffset);
    const todayKey = formatLocalDateKey(new Date());
    const selectedDateItems = buildPlanItemsForDate(selectedDateKey, {
      includeSkippedWeekly: true
    });
    const calendarCells = [];

    for (let index = 0; index < 42; index += 1) {
      const cellDate = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index);
      const cellDateKey = formatLocalDateKey(cellDate);
      const previewItems = buildPlanItemsForDate(cellDateKey);
      const previewRows = previewItems.slice(0, 2).map((item) => item.title);

      calendarCells.push({
        dateKey: cellDateKey,
        monthKey: monthKeyFromDate(cellDate),
        dayLabel: String(cellDate.getDate()),
        inCurrentMonth: cellDate.getMonth() === monthDate.getMonth(),
        isToday: cellDateKey === todayKey,
        isSelected: cellDateKey === selectedDateKey,
        planCount: previewItems.length,
        previewRows,
        extraCount: Math.max(0, previewItems.length - previewRows.length)
      });
    }

    const studentWeeklyItems = (config.studentStudySchedule || [])
      .filter((item) => item.mode !== 'date' && !item.specificDate)
      .sort((left, right) => left.time.localeCompare(right.time) || left.title.localeCompare(right.title))
      .map((item) => ({
        id: item.id,
        title: item.title,
        time: item.time,
        message: item.message || '',
        patternLabel: normalizeWeekdays(item.weekdays).map((weekday) => formatWeekdayLabel(weekday)).join('、')
      }));

    return {
      currentMonthKey: monthKey,
      monthLabel,
      selectedDateKey,
      selectedDateLabel: selectedDateLabelFromDate(new Date(`${selectedDateKey}T00:00:00`)),
      calendarCells,
      selectedDateItems,
      studentWeeklyItems
    };
  }

  async function buildStudentPlanResponse(options = {}) {
    const config = appConfig();
    const accessStatus = typeof syncStudentDeviceAccessStatus === 'function'
      ? await syncStudentDeviceAccessStatus({ throwOnError: false })
      : {};

    return {
      model: buildStudentPlanModel(options),
      studentItems: typeof serializeStudySchedule === 'function'
        ? serializeStudySchedule((config && config.studentStudySchedule) || [])
        : [],
      accessStatus
    };
  }

  return {
    buildHomeModel,
    buildPlanItemsForDate,
    buildStudentPlanModel,
    buildStudentPlanResponse,
    getScheduleLaunchStatusForToday,
    buildStudyCalendarModel,
    buildStudyScheduleModel,
    describeScheduleStatus,
    findScheduleForLaunch,
    getScheduleMark,
    getTodaySchedules,
    markScheduleCompletedForToday,
    normalizeReminderMarks,
    scheduleMessage,
    upsertScheduleMark
  };
}

module.exports = {
  createStudyScheduleRuntime
};
