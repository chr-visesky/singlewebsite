'use strict';

const player = document.getElementById('player');
const emptyPlayer = document.getElementById('empty-player');
const emptyTitle = document.getElementById('empty-title');
const emptyDescription = document.getElementById('empty-description');
const lessonList = document.getElementById('lesson-list');
const libraryTitle = document.getElementById('library-title');
const libraryDescription = document.getElementById('library-description');
const playlistCount = document.getElementById('playlist-count');
const lessonTitle = document.getElementById('lesson-title');
const lessonDescription = document.getElementById('lesson-description');
const folderTip = document.getElementById('folder-tip');
const reloadButton = document.getElementById('reload-library');
const backButton = document.getElementById('back-home');
const authorizeButton = document.getElementById('authorize-netdisk');

const libraryId = new URLSearchParams(window.location.search).get('library') || '';

let currentModel = { items: [], status: { kind: 'ready', message: '' } };
let activeId = '';
let autoRefreshTimer = null;

function updateEmptyState(model) {
  const statusKind = model.status && model.status.kind ? model.status.kind : 'ready';
  const statusMessage = model.status && model.status.message ? model.status.message : '';

  if (statusKind === 'needs_auth') {
    emptyTitle.textContent = '先连接百度网盘';
    emptyDescription.textContent = statusMessage || '连接后才会读取这个固定目录里的视频。';
    return;
  }

  if (statusKind === 'config_error') {
    emptyTitle.textContent = '百度网盘还没配好';
    emptyDescription.textContent = statusMessage || '请先在配置里填好 app 信息。';
    return;
  }

  if (statusKind === 'load_error') {
    emptyTitle.textContent = '媒体库加载失败';
    emptyDescription.textContent = statusMessage || '刷新后重试。';
    return;
  }

  emptyTitle.textContent = '还没有视频';
  emptyDescription.textContent = statusMessage || '这个目录里暂时没有可播放的视频。';
}

function renderPlayer(item) {
  if (!item) {
    lessonTitle.textContent = '未选择视频';
    lessonDescription.textContent = '';
    player.removeAttribute('src');
    player.load();
    emptyPlayer.hidden = false;
    updateEmptyState(currentModel);
    return;
  }

  lessonTitle.textContent = item.title;
  lessonDescription.textContent = item.description;
  player.src = item.sourceUrl;
  player.load();
  emptyPlayer.hidden = true;

  player.play().catch(() => {
    // Ignore autoplay failures; manual click still works.
  });
}

function renderList() {
  lessonList.innerHTML = '';
  playlistCount.textContent = `${currentModel.items.length} 个视频`;

  for (const item of currentModel.items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `lesson-card${item.id === activeId ? ' is-active' : ''}`;

    const heading = document.createElement('h3');
    heading.textContent = item.title;

    const description = document.createElement('p');
    description.textContent = item.description;

    button.append(heading, description);
    button.addEventListener('click', () => {
      activeId = item.id;
      renderList();
      renderPlayer(item);
    });

    lessonList.append(button);
  }
}

function renderModel(model) {
  currentModel = model;
  libraryTitle.textContent = model.title;
  libraryDescription.textContent = model.description;
  folderTip.textContent = `${model.providerLabel || '媒体库'}目录：${model.folderPath || ''}`;
  authorizeButton.textContent = model.authorizeLabel || '连接百度网盘';
  authorizeButton.hidden = !model.canAuthorize;

  const activeItem =
    model.items.find((item) => item.id === activeId) ||
    model.items[0] ||
    null;

  activeId = activeItem ? activeItem.id : '';
  renderList();
  renderPlayer(activeItem);
}

async function loadModel(reload) {
  const model = reload
    ? await window.studyGate.reloadLibraryModel(libraryId)
    : await window.studyGate.getLibraryModel(libraryId);

  renderModel(model);
}

function startAutoRefresh() {
  if (autoRefreshTimer) {
    return;
  }

  autoRefreshTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible') {
      void loadModel(true);
    }
  }, 30000);
}

reloadButton.addEventListener('click', () => {
  loadModel(true).catch(() => {
    // Ignore reload failures here.
  });
});

authorizeButton.addEventListener('click', async () => {
  authorizeButton.disabled = true;

  try {
    await window.studyGate.authorizeNetdisk();
    await loadModel(true);
  } catch {
    await loadModel(true).catch(() => {
      // Ignore refresh failures after a cancelled authorization.
    });
  } finally {
    authorizeButton.disabled = false;
  }
});

backButton.addEventListener('click', () => {
  window.studyGate.navigate('internal:home').catch(() => {
    // Ignore navigation failures here.
  });
});

window.addEventListener('focus', () => {
  void loadModel(true);
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    void loadModel(true);
  }
});

startAutoRefresh();
loadModel(false).catch(() => {
  renderModel({
    title: '媒体库',
    description: '媒体库加载失败。',
    providerLabel: '百度网盘',
    folderPath: '',
    authorizeLabel: '连接百度网盘',
    canAuthorize: true,
    status: {
      kind: 'load_error',
      message: '媒体库加载失败。'
    },
    items: []
  });
});
