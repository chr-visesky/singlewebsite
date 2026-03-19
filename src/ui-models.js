'use strict';

function buildHomeUiModel(options = {}) {
  const nativeModules = Array.isArray(options.nativeModules) ? options.nativeModules : [];
  const classrooms = Array.isArray(options.classrooms) ? options.classrooms : [];
  const libraries = Array.isArray(options.libraries) ? options.libraries : [];
  const learningTools = Array.isArray(options.learningTools) ? options.learningTools : [];
  const cards = [
    ...nativeModules.map((moduleDefinition) => ({
      id: moduleDefinition.id,
      title: moduleDefinition.title,
      tone: moduleDefinition.tone,
      badge: '作业模块',
      target: options.nativeModuleTarget(moduleDefinition.id),
      scheduleTargetId: moduleDefinition.id,
      libraryId: '',
      supportsStateReset: false
    })),
    ...classrooms.map((classroom) => ({
      id: classroom.id,
      title: classroom.title,
      tone: classroom.tone,
      badge: '在线课堂',
      target: classroom.entryUrl,
      scheduleTargetId: classroom.id,
      classroomId: classroom.id,
      libraryId: '',
      supportsStateReset: true
    })),
    ...libraries.map((library) => ({
      id: library.id,
      title: library.title,
      tone: library.tone,
      badge: '百度网盘',
      target: options.libraryTarget(library.id),
      scheduleTargetId: library.id,
      libraryId: library.id,
      supportsStateReset: false
    })),
    ...learningTools.map((learningTool) => ({
      id: learningTool.id,
      title: learningTool.title,
      tone: learningTool.tone,
      badge: '学习工具',
      target: options.learningToolEntryTarget(learningTool.id),
      scheduleTargetId: learningTool.id,
      libraryId: '',
      supportsStateReset: false
    }))
  ];

  cards.sort((left, right) => {
    if (left.id === 'homework-module') {
      return -1;
    }

    if (right.id === 'homework-module') {
      return 1;
    }

    return 0;
  });

  return {
    appTitle: options.appTitle || 'StudyGate',
    homeNotice: options.homeNotice || null,
    todaySchedule: options.todaySchedule || { todayLabel: '', classes: [] },
    calendarSchedule: options.calendarSchedule || { monthLabel: '', cells: [], selectedDateLabel: '', entriesByDate: {} },
    cards
  };
}

function buildNavigationUiModel(options = {}) {
  const model = {
    canGoBack: Boolean(options.canGoBack),
    canGoForward: Boolean(options.canGoForward),
    bannerText: typeof options.bannerText === 'string' ? options.bannerText : '',
    bannerImageUrl: typeof options.bannerImageUrl === 'string' ? options.bannerImageUrl : '',
    isHome: false,
    showStateReset: false,
    actions: [],
    crumbs: []
  };

  const parsed = options.parseUrl(options.url);

  if (!parsed) {
    model.crumbs = [{ label: '首页', target: 'internal:home', current: true }];
    model.isHome = true;
    model.actions = [
      { id: 'refresh-home', label: '刷新' },
      { id: 'student-plan', label: '学生计划' }
    ];
    return model;
  }

  if (parsed.protocol === 'file:') {
    const fileName = options.pathModule.basename(options.fileURLToPath(parsed)).toLowerCase();

    if (fileName === 'library.html') {
      const library = options.resolveLibrary(parsed.searchParams.get('library'));
      model.crumbs = [
        { label: '首页', target: 'internal:home', current: false },
        {
          label: library ? library.title : '媒体库',
          target: library ? options.libraryTarget(library.id) : 'internal:home',
          current: true
        }
      ];
      return model;
    }

    if (fileName === 'student-plan.html') {
      model.crumbs = [
        { label: '首页', target: 'internal:home', current: false },
        { label: '学生计划', target: options.studentPlanTarget, current: true }
      ];
      return model;
    }

    model.crumbs = [{ label: '首页', target: 'internal:home', current: true }];
    model.isHome = true;
    model.actions = [
      { id: 'refresh-home', label: '刷新' },
      { id: 'student-plan', label: '学生计划' }
    ];
    return model;
  }

  const classroom = options.resolveClassroomForUrl(options.url);
  model.crumbs.push({ label: '首页', target: 'internal:home', current: false });

  if (classroom) {
    model.crumbs.push({ label: classroom.title, target: classroom.entryUrl, current: true });
    model.showStateReset = true;
    return model;
  }

  model.crumbs.push({
    label: '当前页面',
    target: options.url,
    current: true
  });
  model.showStateReset = Boolean(options.allowStateReset);
  return model;
}

function buildClassroomNavigationUiModel(options = {}) {
  const classroom = options.classroom || null;

  return {
    canGoBack: Boolean(options.canGoBack),
    canGoForward: Boolean(options.canGoForward),
    bannerText: typeof options.bannerText === 'string' ? options.bannerText : '',
    bannerImageUrl: typeof options.bannerImageUrl === 'string' ? options.bannerImageUrl : '',
    isHome: false,
    showStateReset: true,
    actions: [
      { id: 'refresh-classroom', label: '刷新' },
      { id: 'student-plan', label: '学生计划' }
    ],
    crumbs: [
      { label: '首页', target: 'internal:home', current: false },
      {
        label: classroom ? classroom.title : '在线课堂',
        target: classroom ? classroom.entryUrl : (options.currentTarget || 'internal:home'),
        current: true
      }
    ]
  };
}

module.exports = {
  buildHomeUiModel,
  buildNavigationUiModel,
  buildClassroomNavigationUiModel
};
