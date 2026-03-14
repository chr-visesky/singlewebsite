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
const playlistRefreshButton = document.getElementById('playlist-refresh');
const authorizeButton = document.getElementById('authorize-netdisk');
const toggleButton = document.getElementById('player-toggle');
const backwardButton = document.getElementById('player-backward');
const forwardButton = document.getElementById('player-forward');
const fullscreenButton = document.getElementById('player-fullscreen');
const seekbar = document.getElementById('player-seek');
const playerTime = document.getElementById('player-time');

const libraryId = new URLSearchParams(window.location.search).get('library') || '';

let currentModel = { items: [], tree: null, status: { kind: 'ready', message: '' } };
let activeId = '';
let currentPlaybackItem = null;
let autoAuthorizeAttempted = false;
let modelLoadSerial = 0;
const expandedFolders = new Set();
let removeFullscreenListener = null;

function formatTime(seconds) {
  const total = Number.isFinite(seconds) && seconds >= 0 ? Math.floor(seconds) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function updateControls() {
  const hasSource = Boolean(player.getAttribute('src'));
  const duration = Number.isFinite(player.duration) ? player.duration : 0;
  const currentTime = Number.isFinite(player.currentTime) ? player.currentTime : 0;
  const canSeek = hasSource && duration > 0;

  toggleButton.disabled = !hasSource;
  backwardButton.disabled = !hasSource;
  forwardButton.disabled = !hasSource;
  fullscreenButton.disabled = !hasSource;
  seekbar.disabled = !canSeek;
  seekbar.value = canSeek ? String(Math.max(0, Math.min(1000, Math.round((currentTime / duration) * 1000)))) : '0';
  toggleButton.textContent = hasSource && !player.paused && !player.ended ? '暂停' : '播放';
  playerTime.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
}

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

  if (hasBrowsableContent(model.tree)) {
    emptyTitle.textContent = '从左边选视频';
    emptyDescription.textContent = '先展开目录，再点视频播放。';
    return;
  }

  emptyTitle.textContent = '还没有视频';
  emptyDescription.textContent = statusMessage || '这个目录里暂时没有可播放的视频。';
}

function renderPlayer(item) {
  if (!item) {
    currentPlaybackItem = null;
    lessonTitle.textContent = '未选择视频';
    lessonDescription.textContent = '';
    player.removeAttribute('src');
    player.load();
    emptyPlayer.hidden = false;
    updateEmptyState(currentModel);
    updateControls();
    return;
  }

  currentPlaybackItem = item;
  lessonTitle.textContent = item.title;
  lessonDescription.textContent = item.description;
  player.src = item.sourceUrl;
  player.load();
  emptyPlayer.hidden = true;

  player.play().catch(() => {
    // Ignore autoplay failures; manual click still works.
  });
  updateControls();
}

function treeContainsActive(node, targetId) {
  if (!node || !targetId) {
    return false;
  }

  if (Array.isArray(node.files) && node.files.some((item) => item.id === targetId)) {
    return true;
  }

  return Array.isArray(node.folders) && node.folders.some((child) => treeContainsActive(child, targetId));
}

function hasBrowsableContent(node) {
  if (!node || typeof node !== 'object') {
    return false;
  }

  if (Array.isArray(node.files) && node.files.length) {
    return true;
  }

  return Array.isArray(node.folders) && node.folders.length > 0;
}

function findTreeNode(node, targetPath) {
  if (!node || typeof node !== 'object') {
    return null;
  }

  if (node.path === targetPath) {
    return node;
  }

  for (const child of Array.isArray(node.folders) ? node.folders : []) {
    const found = findTreeNode(child, targetPath);

    if (found) {
      return found;
    }
  }

  return null;
}

function replaceTreeNode(node, targetPath, nextNode) {
  if (!node || typeof node !== 'object') {
    return node;
  }

  if (node.path === targetPath) {
    return nextNode;
  }

  return {
    ...node,
    folders: Array.isArray(node.folders)
      ? node.folders.map((child) => replaceTreeNode(child, targetPath, nextNode))
      : []
  };
}

function createFileNode(item) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `tree-file${item.id === activeId ? ' is-active' : ''}`;
  button.setAttribute('data-file-id', item.id);
  button.textContent = item.title;
  button.addEventListener('click', () => {
    activeId = item.id;
    updateActiveSelection();
    renderPlayer(item);
  });

  return button;
}

function createFolderNode(node, depth = 0) {
  const details = document.createElement('details');
  details.className = 'tree-folder';
  details.setAttribute('data-folder-path', node.path);
  details.setAttribute('data-depth', String(depth));
  details.open = depth === 0 || expandedFolders.has(node.path) || treeContainsActive(node, activeId);

  const summary = document.createElement('summary');

  const chevron = document.createElement('span');
  chevron.className = 'tree-folder__chevron';
  chevron.textContent = '›';

  const name = document.createElement('span');
  name.className = 'tree-folder__name';
  name.textContent = node.name;

  const status = document.createElement('span');
  status.className = 'tree-folder__status';
  status.textContent = node.isLoading ? '读取中...' : '';

  summary.append(chevron, name, status);
  details.append(summary);

  const children = document.createElement('div');
  children.className = 'tree-children';

  (node.folders || []).forEach((child) => {
    children.append(createFolderNode(child, depth + 1));
  });

  (node.files || []).forEach((item) => {
    children.append(createFileNode(item));
  });

  details.append(children);
  details.addEventListener('toggle', () => {
    if (details.open) {
      expandedFolders.add(node.path);
      void loadFolderNode(node.path, { force: true });
      return;
    }

    expandedFolders.delete(node.path);
  });

  return details;
}

function countVideos(node) {
  if (!node || typeof node !== 'object') {
    return 0;
  }

  const fileCount = Array.isArray(node.files) ? node.files.length : 0;
  const childCount = Array.isArray(node.folders)
    ? node.folders.reduce((total, child) => total + countVideos(child), 0)
    : 0;

  return fileCount + childCount;
}

function updatePlaylistCount() {
  playlistCount.textContent = currentModel.items.length ? `${currentModel.items.length} 个视频` : '';
}

function findFolderElement(folderPath) {
  return Array.from(lessonList.querySelectorAll('.tree-folder')).find((node) => node.dataset.folderPath === folderPath) || null;
}

function updateFolderStatus(folderPath, text) {
  const folderElement = findFolderElement(folderPath);

  if (!folderElement) {
    return;
  }

  const statusNode = folderElement.querySelector(':scope > summary .tree-folder__status');

  if (statusNode) {
    statusNode.textContent = text || '';
  }
}

function updateActiveSelection() {
  lessonList.querySelectorAll('.tree-file.is-active').forEach((node) => {
    node.classList.remove('is-active');
  });

  if (!activeId) {
    return;
  }

  const activeNode = Array.from(lessonList.querySelectorAll('.tree-file')).find((node) => node.dataset.fileId === activeId);

  if (activeNode) {
    activeNode.classList.add('is-active');
  }
}

function createTreeNoteNode(text) {
  const note = document.createElement('div');
  note.className = 'tree-folder__note';
  note.textContent = text;
  return note;
}

function makeReadyStatus() {
  return {
    kind: 'ready',
    message: currentModel.items.length ? '' : '这个目录里还没有可播放的视频。'
  };
}

function renderFolderChildren(folderPath, node) {
  const folderElement = findFolderElement(folderPath);

  if (!folderElement) {
    renderTree();
    return;
  }

  const childContainer = folderElement.querySelector(':scope > .tree-children');

  if (!childContainer) {
    renderTree();
    return;
  }

  childContainer.replaceChildren();
  const parentDepth = Number(folderElement.dataset.depth || 0);

  if (node.loadError) {
    childContainer.append(createTreeNoteNode(`刷新失败，下面是旧列表：${node.loadError}`));
  }

  (node.folders || []).forEach((child) => {
    childContainer.append(createFolderNode(child, parentDepth + 1));
  });

  (node.files || []).forEach((item) => {
    childContainer.append(createFileNode(item));
  });

  updateFolderStatus(folderPath, '');
  updateActiveSelection();
}

async function loadFolderNode(folderPath, options = {}) {
  const currentNode = findTreeNode(currentModel.tree, folderPath);

  if (!currentNode || currentNode.isLoading) {
    return;
  }

  const force = Boolean(options.force);
  if (!force && currentNode.isLoaded) {
    return;
  }

  currentNode.isLoading = true;
  currentNode.loadError = '';
  updateFolderStatus(folderPath, '读取中...');

  try {
    const nextNode = await window.studyGate.getLibraryFolderModel(libraryId, folderPath);
    nextNode.loadError = '';
    currentModel.tree = replaceTreeNode(currentModel.tree, folderPath, nextNode);
    currentModel.items = [];
    collectLoadedFiles(currentModel.tree, currentModel.items);
    currentModel.status = makeReadyStatus();
    updatePlaylistCount();
    renderFolderChildren(folderPath, nextNode);
    void syncExpandedFolders();
  } catch (error) {
    currentNode.isLoading = false;
    currentNode.loadError = error && error.message ? error.message : '目录读取失败。';
    currentModel.status = {
      kind: 'load_error',
      message: currentNode.loadError
    };
    renderFolderChildren(folderPath, currentNode);
  }
}

async function syncExpandedFolders() {
  const tried = new Set();
  let advanced = true;

  while (advanced) {
    advanced = false;

    for (const folderPath of Array.from(expandedFolders).sort((left, right) => left.length - right.length)) {
      if (tried.has(folderPath)) {
        continue;
      }

      const node = findTreeNode(currentModel.tree, folderPath);

      if (!node || node.isLoaded || node.isLoading) {
        continue;
      }

      tried.add(folderPath);
      await loadFolderNode(folderPath);
      advanced = true;
    }
  }
}

function collectLoadedFiles(node, result = []) {
  if (!node || typeof node !== 'object') {
    return result;
  }

  if (Array.isArray(node.files)) {
    result.push(...node.files);
  }

  for (const child of Array.isArray(node.folders) ? node.folders : []) {
    if (child && child.isLoaded) {
      collectLoadedFiles(child, result);
    }
  }

  return result;
}

function renderTree() {
  const previousScrollTop = lessonList.scrollTop;
  lessonList.innerHTML = '';
  updatePlaylistCount();

  if (!currentModel.tree) {
    return;
  }

  lessonList.append(createFolderNode(currentModel.tree));
  lessonList.scrollTop = previousScrollTop;
}

function renderModel(model) {
  currentModel = model;
  libraryTitle.textContent = model.title;
  document.title = model.title || '媒体库';
  libraryDescription.textContent = model.description;
  folderTip.textContent = `${model.providerLabel || '媒体库'}目录：${model.folderPath || ''}`;
  authorizeButton.textContent = model.authorizeLabel || '连接百度网盘';
  authorizeButton.hidden = !model.canAuthorize;

  const activeItem = model.items.find((item) => item.id === activeId) || null;
  const detachedPlaybackItem = currentPlaybackItem && !model.items.some((item) => item.id === currentPlaybackItem.id)
    ? currentPlaybackItem
    : null;
  if (activeItem) {
    activeId = activeItem.id;
  }
  renderTree();

  if (model.status && model.status.kind === 'ready' && currentPlaybackItem && player.getAttribute('src')) {
    emptyPlayer.hidden = true;
    lessonTitle.textContent = currentPlaybackItem.title;
    lessonDescription.textContent = detachedPlaybackItem
      ? `${currentPlaybackItem.description}（当前视频已不在最新列表）`
      : currentPlaybackItem.description;
    updateControls();
    updateActiveSelection();
    void syncExpandedFolders();
    return;
  }

  if (activeItem) {
    renderPlayer(activeItem);
    void syncExpandedFolders();
    return;
  }

  activeId = '';
  renderPlayer(null);
  if (model.status && model.status.kind === 'ready') {
    void syncExpandedFolders();
  }

  if (model.status && model.status.kind === 'needs_auth' && model.canAuthorize && !autoAuthorizeAttempted) {
    autoAuthorizeAttempted = true;
    window.setTimeout(() => {
      void runAuthorizeFlow();
    }, 150);
  }
}

async function loadModel(reload) {
  const requestSerial = ++modelLoadSerial;
  const model = reload
    ? await window.studyGate.reloadLibraryModel(libraryId)
    : await window.studyGate.getLibraryModel(libraryId);

  if (requestSerial !== modelLoadSerial) {
    return;
  }

  renderModel(model);
}

playlistRefreshButton.addEventListener('click', () => {
  loadModel(true).catch(() => {
    // Ignore reload failures here.
  });
});

async function runAuthorizeFlow() {
  authorizeButton.disabled = true;
  authorizeButton.textContent = '正在打开...';

  try {
    try {
      await window.studyGate.authorizeNetdisk();
    } catch (error) {
      emptyPlayer.hidden = false;
      currentModel.status = {
        kind: 'needs_auth',
        message: error && error.message ? error.message : '百度网盘授权没有完成。'
      };
      updateEmptyState(currentModel);
      return;
    }

    try {
      await loadModel(true);
    } catch (error) {
      currentModel.status = {
        kind: 'load_error',
        message: error && error.message ? error.message : '百度网盘目录刷新失败。'
      };
      updateEmptyState(currentModel);
    }
  } finally {
    authorizeButton.disabled = false;
    if (authorizeButton.textContent === '正在打开...') {
      authorizeButton.textContent = currentModel.authorizeLabel || '连接百度网盘';
    }
  }
}

authorizeButton.addEventListener('click', async () => {
  await runAuthorizeFlow();
});

toggleButton.addEventListener('click', () => {
  if (!player.getAttribute('src')) {
    return;
  }

  if (player.paused || player.ended) {
    player.play().catch(() => {
      // Ignore playback failures here.
    });
  } else {
    player.pause();
  }
});

backwardButton.addEventListener('click', () => {
  if (!player.getAttribute('src')) {
    return;
  }

  player.currentTime = Math.max(0, player.currentTime - 10);
});

forwardButton.addEventListener('click', () => {
  if (!player.getAttribute('src')) {
    return;
  }

  const duration = Number.isFinite(player.duration) ? player.duration : player.currentTime + 10;
  player.currentTime = Math.min(duration, player.currentTime + 10);
});

fullscreenButton.addEventListener('click', async () => {
  try {
    if (window.studyGate && typeof window.studyGate.toggleWindowFullscreen === 'function') {
      const result = await window.studyGate.toggleWindowFullscreen();
      fullscreenButton.textContent = result && result.fullscreen ? '退出全屏' : '全屏';
      return;
    }

    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else if (document.documentElement && typeof document.documentElement.requestFullscreen === 'function') {
      await document.documentElement.requestFullscreen();
    }
  } catch {
    // Ignore fullscreen failures here.
  }
});

function updateFullscreenButtonLabel(isFullscreen) {
  fullscreenButton.textContent = isFullscreen ? '退出全屏' : '全屏';
}

seekbar.addEventListener('input', () => {
  const duration = Number.isFinite(player.duration) ? player.duration : 0;

  if (!duration) {
    return;
  }

  player.currentTime = (Number(seekbar.value) / 1000) * duration;
});

player.addEventListener('loadedmetadata', updateControls);
player.addEventListener('timeupdate', updateControls);
player.addEventListener('play', updateControls);
player.addEventListener('pause', updateControls);
player.addEventListener('ended', updateControls);
if (window.studyGate && typeof window.studyGate.onWindowFullscreenChanged === 'function') {
  removeFullscreenListener = window.studyGate.onWindowFullscreenChanged((isFullscreen) => {
    updateFullscreenButtonLabel(isFullscreen);
  });
}
window.addEventListener('beforeunload', () => {
  if (typeof removeFullscreenListener === 'function') {
    removeFullscreenListener();
    removeFullscreenListener = null;
  }
});
updateFullscreenButtonLabel(false);
if (window.studyGate && typeof window.studyGate.getWindowFullscreenState === 'function') {
  window.studyGate.getWindowFullscreenState().then((result) => {
    updateFullscreenButtonLabel(Boolean(result && result.fullscreen));
  }).catch(() => {
    // Ignore initial fullscreen state failures here.
  });
}
updateControls();
loadModel(false).catch(() => {
  renderModel({
    title: '媒体库',
    description: '媒体库加载失败。',
    providerLabel: '百度网盘',
    folderPath: '',
    authorizeLabel: '连接百度网盘',
    canAuthorize: true,
    tree: null,
    status: {
      kind: 'load_error',
      message: '媒体库加载失败。'
    },
    items: []
  });
});
