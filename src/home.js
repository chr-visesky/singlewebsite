'use strict';

const cardGrid = document.getElementById('card-grid');
const scheduleDate = document.getElementById('schedule-date');
const scheduleList = document.getElementById('schedule-list');
const calendarMonth = document.getElementById('calendar-month');
const calendarGrid = document.getElementById('calendar-grid');
const homeNoticeNode = document.getElementById('home-notice');
const homeNoticeImage = document.getElementById('home-notice-image');
const homeNoticeDismiss = document.getElementById('home-notice-dismiss');

let refreshPromise = null;
let queuedRefreshOptions = null;
let selectedCalendarDateKey = '';
let currentHomeNotice = null;
let noticeArmed = true;

function createEmptyNode(title) {
  const article = document.createElement('article');
  article.className = 'schedule-empty';

  const heading = document.createElement('h3');
  heading.textContent = title;

  article.append(heading);
  return article;
}

function hideHomeNotice() {
  homeNoticeNode.hidden = true;
}

function maybeShowHomeNotice() {
  if (!currentHomeNotice || !currentHomeNotice.enabled || !noticeArmed) {
    return;
  }

  homeNoticeImage.src = currentHomeNotice.imageUrl || '';
  homeNoticeDismiss.textContent = currentHomeNotice.buttonText || '知道了';
  homeNoticeNode.hidden = false;
  noticeArmed = false;
}

async function launchStudyTarget(payload) {
  try {
    const result = await window.studyGate.enterStudyTarget(payload);

    if (result && result.success === false) {
      window.alert(result.message || '打开失败。');
    }
  } catch (error) {
    window.alert((error && error.message) || '打开失败。');
  }
}

async function completeSchedule(scheduleId) {
  try {
    await window.studyGate.completeStudySchedule({ scheduleId });
    await refreshHomeModel();
  } catch (error) {
    window.alert((error && error.message) || '打卡失败。');
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
    scope.className = 'schedule-item__scope';
    scope.textContent = item.planScopeLabel;

    const heading = document.createElement('h3');
    heading.textContent = item.title;

    titleRow.append(time, scope, heading);
    main.append(titleRow);

    const action = document.createElement('button');
    action.type = 'button';
    action.className = `study-check study-check--${item.status}`;
    action.disabled = item.status !== 'pending';
    action.textContent = '✓';
    action.setAttribute(
      'aria-label',
      item.status === 'completed' ? '已完成' : item.status === 'pending' ? '打卡' : '未到时间'
    );
    action.title = item.status === 'completed' ? '已完成' : item.status === 'pending' ? '打卡' : '未到时间';
    action.addEventListener('click', async () => {
      await completeSchedule(item.id);
    });

    article.append(main, action);
    scheduleList.append(article);
  });
}

function renderCalendarSchedule(calendarSchedule) {
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
      renderCalendarSchedule(calendarSchedule);
    });

    calendarGrid.append(cellNode);
  });
}

function createCard(card) {
  const article = document.createElement('article');
  article.className = `card card--${card.tone || 'slate'}`;
  const target = typeof card.target === 'string' ? card.target : '';
  const hasTarget = Boolean(target);

  const inner = document.createElement('div');
  inner.className = 'card__inner';

  const top = document.createElement('div');
  top.className = 'card__top';

  const tag = document.createElement('span');
  tag.className = 'card__tag';
  tag.textContent = card.badge || (target.startsWith('internal:') ? '媒体库' : '在线课堂');

  const heading = document.createElement('h2');
  heading.textContent = card.title;

  top.append(tag, heading);

  const actions = document.createElement('div');
  actions.className = 'card__actions';

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '打开';
  button.disabled = !hasTarget;
  button.title = hasTarget ? '打开' : '未配置';
  button.addEventListener('click', async () => {
    if (!hasTarget) {
      return;
    }

    await launchStudyTarget({
      target,
      scheduleTargetId: card.scheduleTargetId,
      libraryId: card.libraryId,
      libraryTitle: card.title
    });
  });

  actions.append(button);

  inner.append(top, actions);
  article.append(inner);
  return article;
}

function renderModel(model) {
  document.title = (model && model.appTitle) || 'StudyGate';
  currentHomeNotice = model.homeNotice || null;
  cardGrid.replaceChildren();

  model.cards.forEach((card) => {
    cardGrid.append(createCard(card));
  });

  renderTodaySchedule(model.todaySchedule);
  renderCalendarSchedule(model.calendarSchedule);
  maybeShowHomeNotice();
}

async function refreshHomeModel(options = {}) {
  if (refreshPromise) {
    queuedRefreshOptions = {
      syncRemote: Boolean(options.syncRemote) || Boolean(queuedRefreshOptions && queuedRefreshOptions.syncRemote)
    };
    return refreshPromise;
  }

  refreshPromise = (async () => {
    const model = await window.studyGate.getHomeModel({
      syncRemote: Boolean(options.syncRemote)
    });
    renderModel(model);
  })();

  try {
    await refreshPromise;
  } finally {
    refreshPromise = null;
  }

  if (queuedRefreshOptions) {
    const nextOptions = queuedRefreshOptions;
    queuedRefreshOptions = null;
    await refreshHomeModel(nextOptions);
  }
}

window.setInterval(() => {
  if (document.visibilityState === 'visible') {
    void refreshHomeModel();
  }
}, 30000);

window.addEventListener('focus', () => {
  maybeShowHomeNotice();
  void refreshHomeModel();
});

window.addEventListener('blur', () => {
  noticeArmed = true;
  hideHomeNotice();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    noticeArmed = true;
    hideHomeNotice();
    return;
  }

  maybeShowHomeNotice();
  void refreshHomeModel();
});

homeNoticeDismiss.addEventListener('click', () => {
  hideHomeNotice();
});

refreshHomeModel().catch((error) => {
  console.error('home-refresh-failed', error);
  cardGrid.textContent = '本地首页加载失败。';
});

window.addEventListener('studygate:toolbar-action', async (event) => {
  const actionId = event && event.detail ? event.detail.actionId : '';

  if (actionId === 'student-plan') {
    await window.studyGate.navigate('internal:student-plan');
    return;
  }

  if (actionId === 'refresh-home') {
    void refreshHomeModel({
      syncRemote: true
    });
  }
});
