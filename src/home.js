'use strict';

const titleNode = document.getElementById('title');
const cardGrid = document.getElementById('card-grid');
const refreshHomeButton = document.getElementById('refresh-home-button');
const studentPlanButton = document.getElementById('student-plan-button');
const scheduleDate = document.getElementById('schedule-date');
const scheduleList = document.getElementById('schedule-list');
const calendarMonth = document.getElementById('calendar-month');
const calendarGrid = document.getElementById('calendar-grid');
const calendarSelectedDate = document.getElementById('calendar-selected-date');
const calendarSelectedList = document.getElementById('calendar-selected-list');

let refreshPromise = null;
let queuedRefresh = false;
let selectedCalendarDateKey = '';
let currentCalendarModel = null;

function createEmptyNode(title) {
  const article = document.createElement('article');
  article.className = 'schedule-empty';

  const heading = document.createElement('h3');
  heading.textContent = title;

  article.append(heading);
  return article;
}

async function launchStudyTarget(payload) {
  try {
    await window.studyGate.enterStudyTarget(payload);
  } catch {
    // Ignore navigation failures on the home screen.
  }
}

async function completeSchedule(scheduleId) {
  try {
    await window.studyGate.completeStudySchedule({ scheduleId });
    await refreshHomeModel();
  } catch {
    // Ignore completion failures on the home screen.
  }
}

function renderTodaySchedule(todaySchedule) {
  scheduleDate.textContent = todaySchedule.todayLabel;
  scheduleList.replaceChildren();

  if (!todaySchedule.classes.length) {
    scheduleList.append(createEmptyNode('今天没有计划'));
    return;
  }

  todaySchedule.classes.forEach((item) => {
    const article = document.createElement('article');
    article.className = 'schedule-item';
    article.setAttribute('data-status', item.status);

    const main = document.createElement('div');
    main.className = 'schedule-item__main';

    const titleRow = document.createElement('div');
    titleRow.className = 'schedule-item__title-row';

    const time = document.createElement('span');
    time.className = 'schedule-item__time';
    time.textContent = item.time;

    const scope = document.createElement('span');
    scope.className = 'schedule-item__status';
    scope.textContent = item.planScopeLabel;

    const heading = document.createElement('h3');
    heading.textContent = item.title;

    const status = document.createElement('span');
    status.className = 'schedule-item__status';
    status.textContent = item.statusLabel;

    titleRow.append(time, scope, heading, status);
    main.append(titleRow);

    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'study-pill';
    action.disabled = item.status === 'completed';
    action.textContent = item.status === 'completed' ? '已完成' : item.entryLabel;
    action.addEventListener('click', async () => {
      if (item.canLaunch) {
        await launchStudyTarget({
          target: item.target,
          scheduleId: item.id,
          scheduleTargetId: item.scheduleTargetId,
          libraryId: item.libraryId,
          libraryTitle: item.libraryTitle
        });
        return;
      }

      await completeSchedule(item.id);
    });

    article.append(main, action);
    scheduleList.append(article);
  });
}

function renderCalendarSelectedList() {
  const entries = currentCalendarModel && currentCalendarModel.entriesByDate
    ? currentCalendarModel.entriesByDate[selectedCalendarDateKey] || []
    : [];
  calendarSelectedList.replaceChildren();

  if (!entries.length) {
    calendarSelectedList.append(createEmptyNode('这天没有计划'));
    return;
  }

  entries.forEach((entry) => {
    const article = document.createElement('article');
    article.className = 'calendar-entry';

    const time = document.createElement('span');
    time.className = 'calendar-entry__time';
    time.textContent = entry.time;

    const title = document.createElement('span');
    title.className = 'calendar-entry__title';
    title.textContent = entry.title;

    article.append(time, title);
    calendarSelectedList.append(article);
  });
}

function renderCalendarSchedule(calendarSchedule) {
  currentCalendarModel = calendarSchedule;
  calendarMonth.textContent = calendarSchedule.monthLabel;

  const cellKeys = new Set((calendarSchedule.cells || []).map((cell) => cell.dateKey));
  if (!selectedCalendarDateKey || !cellKeys.has(selectedCalendarDateKey)) {
    selectedCalendarDateKey = calendarSchedule.selectedDateKey;
  }

  calendarGrid.replaceChildren();

  (calendarSchedule.cells || []).forEach((cell) => {
    const cellNode = document.createElement('button');
    cellNode.type = 'button';
    cellNode.className = 'calendar-tile';
    if (!cell.inCurrentMonth) {
      cellNode.classList.add('calendar-tile--muted');
    }
    if (cell.isToday) {
      cellNode.classList.add('calendar-tile--today');
    }
    if (cell.dateKey === selectedCalendarDateKey) {
      cellNode.classList.add('calendar-tile--selected');
    }

    const top = document.createElement('div');
    top.className = 'calendar-tile__top';

    const day = document.createElement('span');
    day.className = 'calendar-tile__day';
    day.textContent = cell.dayLabel;

    top.append(day);

    if (cell.count) {
      const count = document.createElement('span');
      count.className = 'calendar-tile__count';
      count.textContent = String(cell.count);
      top.append(count);
    }

    cellNode.append(top);

    (cell.previewRows || []).forEach((row) => {
      const preview = document.createElement('span');
      preview.className = 'calendar-tile__preview';
      preview.textContent = row;
      cellNode.append(preview);
    });

    if (cell.extraCount) {
      const more = document.createElement('span');
      more.className = 'calendar-tile__preview calendar-tile__preview--soft';
      more.textContent = `+${cell.extraCount}`;
      cellNode.append(more);
    }

    cellNode.addEventListener('click', () => {
      selectedCalendarDateKey = cell.dateKey;
      const selectedCell = (calendarSchedule.cells || []).find((entry) => entry.dateKey === cell.dateKey);
      calendarSelectedDate.textContent = selectedCell
        ? `${calendarSchedule.monthLabel} ${selectedCell.dayLabel}日`
        : calendarSchedule.selectedDateLabel;
      renderCalendarSchedule(calendarSchedule);
    });

    calendarGrid.append(cellNode);
  });

  const selectedCell = (calendarSchedule.cells || []).find((cell) => cell.dateKey === selectedCalendarDateKey);
  calendarSelectedDate.textContent = selectedCell
    ? `${calendarSchedule.monthLabel} ${selectedCell.dayLabel}日`
    : calendarSchedule.selectedDateLabel;
  renderCalendarSelectedList();
}

function createCard(card) {
  const article = document.createElement('article');
  article.className = `card card--${card.tone}`;

  const inner = document.createElement('div');
  inner.className = 'card__inner';

  const tag = document.createElement('span');
  tag.className = 'card__tag';
  tag.textContent = card.badge || (card.target.startsWith('internal:') ? '媒体库' : '在线课堂');

  const heading = document.createElement('h2');
  heading.textContent = card.title;

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '打开';
  button.addEventListener('click', async () => {
    await launchStudyTarget({
      target: card.target,
      scheduleTargetId: card.scheduleTargetId,
      libraryId: card.libraryId,
      libraryTitle: card.title
    });
  });

  inner.append(tag, heading, button);
  article.append(inner);
  return article;
}

function renderModel(model) {
  titleNode.textContent = model.appTitle;
  cardGrid.replaceChildren();

  model.cards.forEach((card) => {
    cardGrid.append(createCard(card));
  });

  renderTodaySchedule(model.todaySchedule);
  renderCalendarSchedule(model.calendarSchedule);
}

async function refreshHomeModel() {
  if (refreshPromise) {
    queuedRefresh = true;
    return refreshPromise;
  }

  refreshPromise = (async () => {
    const model = await window.studyGate.getHomeModel();
    renderModel(model);
  })();

  try {
    await refreshPromise;
  } finally {
    refreshPromise = null;
  }

  if (queuedRefresh) {
    queuedRefresh = false;
    await refreshHomeModel();
  }
}

window.setInterval(() => {
  if (document.visibilityState === 'visible') {
    void refreshHomeModel();
  }
}, 30000);

window.addEventListener('focus', () => {
  void refreshHomeModel();
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    void refreshHomeModel();
  }
});

refreshHomeModel().catch(() => {
  cardGrid.textContent = '本地首页加载失败。';
});

studentPlanButton.addEventListener('click', async () => {
  await window.studyGate.navigate('internal:student-plan');
});

refreshHomeButton.addEventListener('click', () => {
  void refreshHomeModel();
});
