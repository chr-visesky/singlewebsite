'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const TOOLBAR_HEIGHT = 62;
const TOOLBAR_HOST_ID = 'studygate-nav-host';
const REMINDER_HOST_ID = 'studygate-reminder-host';
const TOOLBAR_TOP_OFFSET_ATTR = 'data-studygate-original-top';
let refreshTimer = null;
let reminderHideTimer = null;
let reminderAudio = null;
let reminderAlarmContext = null;
let layoutAdjustObserver = null;
let lastReportedToolbarHeight = -1;
let zoomShortcutBound = false;
let updateDialogRuntime = null;
function readStorageArea(storageArea) {
  const snapshot = {};
  try {
    for (let index = 0; index < storageArea.length; index += 1) {
      const key = storageArea.key(index);
      if (typeof key === 'string') {
        snapshot[key] = storageArea.getItem(key);
      }
    }
  } catch {
    return {};
  }
  return snapshot;
}
function writeStorageArea(storageArea, snapshot) {
  try {
    storageArea.clear();
    for (const [key, value] of Object.entries(snapshot || {})) {
      storageArea.setItem(key, typeof value === 'string' ? value : '');
    }
  } catch {
    // Ignore storage restoration failures.
  }
}
function setInputValue(input, value) {
  if (!input || typeof value !== 'string') {
    return;
  }
  const prototype = Object.getPrototypeOf(input);
  const descriptor = prototype ? Object.getOwnPropertyDescriptor(prototype, 'value') : null;
  const fallbackDescriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
  const setter = (descriptor && descriptor.set) || (fallbackDescriptor && fallbackDescriptor.set);
  if (typeof setter === 'function') {
    setter.call(input, value);
  } else {
    input.value = value;
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
function isEditableTextInput(input) {
  if (!input || input.disabled || input.readOnly) {
    return false;
  }
  const type = String(input.getAttribute('type') || 'text').toLowerCase();
  return ['text', 'email', 'tel', 'search', 'number', ''].includes(type);
}
function isEditablePasswordInput(input) {
  return Boolean(input && !input.disabled && !input.readOnly && String(input.type).toLowerCase() === 'password');
}
function findCredentialFields(root = document) {
  const passwordInput = Array.from(root.querySelectorAll('input[type="password"]')).find(isEditablePasswordInput);
  if (!passwordInput) {
    return null;
  }
  const scope = passwordInput.form || passwordInput.closest('form') || root;
  const usernameInput = Array.from(scope.querySelectorAll('input')).find(
    (input) => input !== passwordInput && isEditableTextInput(input)
  );
  if (!usernameInput) {
    return null;
  }
  return {
    usernameInput,
    passwordInput
  };
}
function bootstrapCredentialAutofill() {
  if (!isTopFrame() || !/^https?:$/.test(window.location.protocol)) {
    return;
  }
  const credentialPromise = ipcRenderer.invoke('shell:get-site-credentials', {
    url: window.location.href
  }).catch(() => null);
  const fillCredentials = async () => {
    const saved = await credentialPromise;
    if (!saved || !saved.available) {
      return false;
    }
    const fields = findCredentialFields(document);
    if (!fields) {
      return false;
    }
    if (!fields.usernameInput.value) {
      setInputValue(fields.usernameInput, saved.username);
    }
    if (!fields.passwordInput.value) {
      setInputValue(fields.passwordInput, saved.password);
    }
    return true;
  };
  const persistCredentials = () => {
    const fields = findCredentialFields(document);
    if (!fields) {
      return;
    }
    const username = String(fields.usernameInput.value || '').trim();
    const password = String(fields.passwordInput.value || '');
    if (!username || !password) {
      return;
    }
    ipcRenderer.send('shell:save-site-credentials', {
      url: window.location.href,
      username,
      password
    });
  };
  const startFill = () => {
    void fillCredentials();
    const observer = new MutationObserver(() => {
      void fillCredentials();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
    window.setTimeout(() => {
      observer.disconnect();
    }, 20000);
  };
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', startFill, { once: true });
  } else {
    startFill();
  }
  document.addEventListener(
    'submit',
    () => {
      window.setTimeout(persistCredentials, 0);
    },
    true
  );
  document.addEventListener(
    'click',
    (event) => {
      const target = event.target && event.target.closest
        ? event.target.closest('button,input[type="submit"],.el-button')
        : null;
      if (target) {
        window.setTimeout(persistCredentials, 0);
      }
    },
    true
  );
}
function bootstrapPersistentPageStorage() {
  if (!isTopFrame() || !/^https?:$/.test(window.location.protocol)) {
    return;
  }
  let snapshot;
  try {
    snapshot = ipcRenderer.sendSync('shell:get-origin-storage-sync', {
      url: window.location.href
    });
  } catch {
    return;
  }
  if (!snapshot || !snapshot.origin) {
    return;
  }
  writeStorageArea(window.localStorage, snapshot.localStorage);
  const savePageStorage = () => {
    ipcRenderer.send('shell:save-origin-storage', {
      url: window.location.href,
      localStorage: readStorageArea(window.localStorage)
    });
  };
  window.addEventListener('beforeunload', savePageStorage);
  window.addEventListener('pagehide', savePageStorage);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      savePageStorage();
    }
  });
  window.setInterval(savePageStorage, 5000);
}
function bootstrapZoomShortcuts() {
  if (!isTopFrame() || zoomShortcutBound) {
    return;
  }
  zoomShortcutBound = true;
  window.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      const delta = event.deltaY < 0 ? 0.1 : -0.1;
      void ipcRenderer.invoke('shell:adjust-window-zoom', {
        delta
      });
    },
    { passive: false, capture: true }
  );
  window.addEventListener(
    'keydown',
    (event) => {
      if (!event.ctrlKey) {
        return;
      }
      if (event.key === '0') {
        event.preventDefault();
        void ipcRenderer.invoke('shell:reset-window-zoom');
      }
    },
    true
  );
}
function bootstrapBrowserPreloadRuntime() {
  bootstrapPersistentPageStorage();
  bootstrapCredentialAutofill();
  if (window.location.protocol === 'file:') {
    bootstrapZoomShortcuts();
  }
}
function getToolbarShadowRoot() {
  const host = document.getElementById(TOOLBAR_HOST_ID);
  return host ? host.shadowRoot : null;
}
function createUpdateDialogRuntime() {
  let pollTimer = null;
  function clearPollTimer() {
    if (pollTimer) {
      window.clearTimeout(pollTimer);
      pollTimer = null;
    }
  }
  function normalizeSnapshot(rawSnapshot = {}) {
    const snapshot = rawSnapshot && typeof rawSnapshot === 'object' ? rawSnapshot : {};
    return {
      currentVersion: typeof snapshot.currentVersion === 'string' ? snapshot.currentVersion : '',
      latestVersion: typeof snapshot.latestVersion === 'string' ? snapshot.latestVersion : '',
      hasUpdate: Boolean(snapshot.hasUpdate),
      enabled: snapshot.enabled !== false,
      state: typeof snapshot.state === 'string' ? snapshot.state : 'idle',
      percent: Number(snapshot.percent) || 0,
      message: typeof snapshot.message === 'string' ? snapshot.message : ''
    };
  }
  function ensureDialog() {
    const shadowRoot = getToolbarShadowRoot();
    if (!shadowRoot) {
      return null;
    }
    let overlay = shadowRoot.querySelector('.update-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'update-overlay';
      overlay.setAttribute('data-visible', 'false');
      overlay.innerHTML = `
        <section class="update-dialog">
          <header class="update-dialog__header">
            <div>
              <p class="update-dialog__eyebrow">客户端更新</p>
              <h2 class="update-dialog__title">检查更新</h2>
            </div>
            <button type="button" class="update-dialog__close" data-role="close" aria-label="关闭">×</button>
          </header>
          <div class="update-dialog__versions">
            <div class="update-dialog__version-row"><span>当前版本</span><strong data-role="current-version">-</strong></div>
            <div class="update-dialog__version-row"><span>最新版本</span><strong data-role="latest-version">-</strong></div>
          </div>
          <p class="update-dialog__status" data-role="status-text"></p>
          <div class="update-dialog__actions">
            <button type="button" class="update-dialog__button update-dialog__button--secondary" data-role="dismiss">关闭</button>
            <button type="button" class="update-dialog__button update-dialog__button--primary" data-role="primary" hidden></button>
          </div>
        </section>
      `;
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
          closeDialog();
        }
      });
      shadowRoot.append(overlay);
      overlay.querySelector('[data-role="close"]').addEventListener('click', closeDialog);
      overlay.querySelector('[data-role="dismiss"]').addEventListener('click', closeDialog);
    }
    return {
      overlay,
      currentVersionNode: overlay.querySelector('[data-role="current-version"]'),
      latestVersionNode: overlay.querySelector('[data-role="latest-version"]'),
      statusNode: overlay.querySelector('[data-role="status-text"]'),
      primaryButton: overlay.querySelector('[data-role="primary"]')
    };
  }
  function renderSnapshot(snapshot) {
    const elements = ensureDialog();
    if (!elements) {
      return;
    }
    let statusText = '当前已经是最新版本。';
    let primaryLabel = '';
    let primaryDisabled = false;
    let primaryAction = null;
    if (!snapshot.enabled) {
      statusText = '当前客户端没有启用自动升级，或更新源还未配置完成。';
    } else if (snapshot.state === 'checking') {
      statusText = '正在检查更新…';
      primaryLabel = '检查中';
      primaryDisabled = true;
    } else if (snapshot.state === 'downloading') {
      statusText = snapshot.percent > 0
        ? `正在下载更新… ${Math.round(snapshot.percent)}%`
        : '正在下载更新…';
      primaryLabel = '下载中';
      primaryDisabled = true;
    } else if (snapshot.state === 'downloaded' && snapshot.hasUpdate) {
      statusText = '更新已经下载完成。点击“立即升级”会退出客户端并安装新版本。';
      primaryLabel = '立即升级';
      primaryAction = () => ipcRenderer.invoke('shell:install-downloaded-update');
    } else if (snapshot.state === 'available' && snapshot.hasUpdate) {
      statusText = '检测到新版本。点击“升级”开始下载，下载完成后退出客户端会自动安装。';
      primaryLabel = '升级';
      primaryAction = async () => {
        await ipcRenderer.invoke('shell:download-available-update');
        await refreshSnapshot();
      };
    } else if (snapshot.state === 'error') {
      statusText = snapshot.message || '检查更新失败。';
    }
    elements.currentVersionNode.textContent = snapshot.currentVersion || '-';
    elements.latestVersionNode.textContent = snapshot.latestVersion || snapshot.currentVersion || '-';
    elements.statusNode.textContent = statusText;
    elements.primaryButton.hidden = !primaryLabel;
    elements.primaryButton.disabled = primaryDisabled;
    elements.primaryButton.textContent = primaryLabel;
    elements.primaryButton.onclick = primaryAction;
  }
  async function fetchSnapshot() {
    return normalizeSnapshot(await ipcRenderer.invoke('shell:get-auto-update-status'));
  }
  async function refreshSnapshot() {
    const snapshot = await fetchSnapshot();
    renderSnapshot(snapshot);
    clearPollTimer();
    if (snapshot.state === 'checking' || snapshot.state === 'downloading') {
      pollTimer = window.setTimeout(() => {
        void refreshSnapshot();
      }, 1000);
    }
    return snapshot;
  }
  function closeDialog() {
    const elements = ensureDialog();
    if (!elements) {
      return;
    }
    clearPollTimer();
    elements.overlay.setAttribute('data-visible', 'false');
  }
  async function openDialog() {
    const elements = ensureDialog();
    if (!elements) {
      return;
    }
    elements.overlay.setAttribute('data-visible', 'true');
    renderSnapshot({
      currentVersion: '',
      latestVersion: '',
      hasUpdate: false,
      enabled: true,
      state: 'checking',
      percent: 0,
      message: ''
    });
    const initialSnapshot = await fetchSnapshot();
    if (['available', 'downloaded', 'downloading'].includes(initialSnapshot.state)) {
      renderSnapshot(initialSnapshot);
      if (initialSnapshot.state === 'downloading') {
        await refreshSnapshot();
      }
      return;
    }
    renderSnapshot(normalizeSnapshot(await ipcRenderer.invoke('shell:check-for-updates')));
    await refreshSnapshot();
  }
  return {
    openDialog
  };
}
async function dispatchToolbarAction(actionId) {
  if (actionId === 'check-update') {
    if (!updateDialogRuntime) {
      updateDialogRuntime = createUpdateDialogRuntime();
    }
    await updateDialogRuntime.openDialog();
    return;
  }
  window.dispatchEvent(
    new CustomEvent('studygate:toolbar-action', {
      detail: { actionId }
    })
  );
}
function isExitVerificationPage() {
  return window.location.protocol === 'file:' && /exit-verify\.html$/i.test(window.location.pathname);
}
function isTopFrame() {
  try {
    return window.top === window;
  } catch {
    return false;
  }
}
bootstrapBrowserPreloadRuntime();
if (window.location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('studyGate', {
    getHomeModel(options) {
      return ipcRenderer.invoke('shell:get-home-model', options);
    },
    getLibraryModel(libraryId) {
      return ipcRenderer.invoke('shell:get-library-model', libraryId);
    },
    reloadLibraryModel(libraryId) {
      return ipcRenderer.invoke('shell:reload-library-model', libraryId);
    },
    getLibraryFolderModel(libraryId, folderPath) {
      return ipcRenderer.invoke('shell:get-library-folder-model', libraryId, folderPath);
    },
    getStudentPlanModel(options) {
      return ipcRenderer.invoke('shell:get-student-plan-model', options);
    },
    saveStudentPlanItems(payload) {
      return ipcRenderer.invoke('shell:save-student-plan-items', payload);
    },
    authorizeNetdisk() {
      return ipcRenderer.invoke('shell:authorize-netdisk');
    },
    toggleWindowFullscreen() {
      return ipcRenderer.invoke('shell:toggle-window-fullscreen');
    },
    getWindowFullscreenState() {
      return ipcRenderer.invoke('shell:get-window-fullscreen');
    },
    getWindowZoom() {
      return ipcRenderer.invoke('shell:get-window-zoom');
    },
    onWindowFullscreenChanged(listener) {
      if (typeof listener !== 'function') {
        return () => {};
      }
      const handler = (_event, payload) => {
        listener(Boolean(payload && payload.fullscreen));
      };
      ipcRenderer.on('window:fullscreen-changed', handler);
      return () => {
        ipcRenderer.removeListener('window:fullscreen-changed', handler);
      };
    },
    enterStudyTarget(payload) {
      return ipcRenderer.invoke('shell:enter-study-target', payload);
    },
    completeStudySchedule(payload) {
      return ipcRenderer.invoke('shell:complete-study-schedule', payload);
    },
    navigate(target) {
      return ipcRenderer.invoke('shell:navigate', target);
    },
    refreshCurrentClassroom() {
      return ipcRenderer.invoke('shell:refresh-current-classroom');
    },
    resetCourseSiteState() {
      return ipcRenderer.invoke('shell:reset-course-site-state');
    },
    getExitVerificationModel() {
      return ipcRenderer.invoke('shell:get-exit-verification-model');
    },
    submitExitPassword(password) {
      return ipcRenderer.invoke('shell:submit-exit-password', {
        password
      });
    },
    cancelExitPassword() {
      return ipcRenderer.invoke('shell:cancel-exit-password');
    }
  });
}
function applyStyles(shadowRoot) {
  if (shadowRoot.querySelector('link[data-studygate-toolbar-style="true"]')) {
    return;
  }
  const stylesheetUrl = new URL('./preload-toolbar.css', window.location.href).toString();
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = stylesheetUrl;
  link.setAttribute('data-studygate-toolbar-style', 'true');
  shadowRoot.append(link);
}
function shouldOffsetTopAnchoredElement(element, computedStyle) {
  if (!element || !computedStyle) {
    return false;
  }
  if (!['fixed', 'sticky'].includes(computedStyle.position)) {
    return false;
  }
  const topValue = computedStyle.top;
  const top = Number.parseFloat(topValue);
  if (Number.isNaN(top)) {
    return false;
  }
  if (top > TOOLBAR_HEIGHT) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.bottom > 0 && rect.top <= TOOLBAR_HEIGHT + 2;
}
function offsetTopAnchoredElements() {
  if (!isTopFrame() || window.location.protocol === 'file:' || !document.body) {
    return;
  }
  const elements = document.body.querySelectorAll('*');
  elements.forEach((element) => {
    if (element.id === TOOLBAR_HOST_ID || element.id === REMINDER_HOST_ID) {
      return;
    }
    const computedStyle = window.getComputedStyle(element);
    if (!shouldOffsetTopAnchoredElement(element, computedStyle)) {
      return;
    }
    if (!element.hasAttribute(TOOLBAR_TOP_OFFSET_ATTR)) {
      element.setAttribute(TOOLBAR_TOP_OFFSET_ATTR, computedStyle.top || '0px');
    }
    const originalTop = element.getAttribute(TOOLBAR_TOP_OFFSET_ATTR) || '0px';
    element.style.top = `calc(${originalTop} + ${TOOLBAR_HEIGHT}px)`;
  });
}
function reportToolbarHeight() {
  if (!isTopFrame() || window.location.protocol !== 'file:') {
    return;
  }
  const host = document.getElementById(TOOLBAR_HOST_ID);
  const height = host ? Math.max(0, Math.ceil(host.getBoundingClientRect().height)) : 0;
  if (height === lastReportedToolbarHeight) {
    return;
  }
  lastReportedToolbarHeight = height;
  ipcRenderer.send('shell:update-toolbar-height', {
    height
  });
}
function ensureToolbarElements() {
  if (!isTopFrame() || !document.documentElement || !document.body) {
    return null;
  }
  let host = document.getElementById(TOOLBAR_HOST_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = TOOLBAR_HOST_ID;
    host.style.position = 'sticky';
    host.style.top = '0';
    host.style.zIndex = '2147483647';
    host.style.display = 'block';
    document.body.prepend(host);
  } else if (document.body.firstChild !== host) {
    document.body.prepend(host);
  }
  if (!host.shadowRoot) {
    const shadowRoot = host.attachShadow({ mode: 'open' });
    applyStyles(shadowRoot);
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.pointerEvents = 'auto';
    const left = document.createElement('div');
    left.className = 'toolbar-left';
    const backButton = document.createElement('button');
    backButton.type = 'button';
    backButton.className = 'nav-button';
    backButton.textContent = '←';
    backButton.title = '返回';
    backButton.addEventListener('click', async () => {
      await ipcRenderer.invoke('shell:go-back');
      window.setTimeout(() => {
        void refreshToolbar();
      }, 80);
    });
    const forwardButton = document.createElement('button');
    forwardButton.type = 'button';
    forwardButton.className = 'nav-button';
    forwardButton.textContent = '→';
    forwardButton.title = '前进';
    forwardButton.addEventListener('click', async () => {
      await ipcRenderer.invoke('shell:go-forward');
      window.setTimeout(() => {
        void refreshToolbar();
      }, 80);
    });
    const homeButton = document.createElement('button');
    homeButton.type = 'button';
    homeButton.className = 'nav-button nav-button--home';
    homeButton.textContent = '⌂';
    homeButton.title = '返回首页';
    homeButton.addEventListener('click', async () => {
      await ipcRenderer.invoke('shell:navigate', 'internal:home');
      window.setTimeout(() => {
        void refreshToolbar();
      }, 80);
    });
    const actions = document.createElement('div');
    actions.className = 'toolbar-actions';
    const crumbs = document.createElement('div');
    crumbs.className = 'crumbs';
    const banner = document.createElement('div');
    banner.className = 'banner';
    banner.setAttribute('data-empty', 'true');
    const bannerImage = document.createElement('img');
    bannerImage.className = 'banner__image';
    bannerImage.alt = 'Banner';
    banner.append(bannerImage);
    const stateResetButton = document.createElement('button');
    stateResetButton.type = 'button';
    stateResetButton.className = 'nav-button nav-button--soft';
    stateResetButton.textContent = '初始化';
    stateResetButton.hidden = true;
    stateResetButton.addEventListener('click', async () => {
      if (!window.confirm('这会清空当前在线课堂的缓存、登录状态和本地站点数据，但保留已保存的账号密码。继续吗？')) {
        return;
      }
      try {
        await ipcRenderer.invoke('shell:reset-course-site-state');
        window.alert('在线课堂状态已初始化。');
      } catch {
        window.alert('初始化失败。');
      }
    });
    left.append(backButton, forwardButton, homeButton, actions, stateResetButton);
    bar.append(left, banner, crumbs);
    shadowRoot.append(bar);
  }
  offsetTopAnchoredElements();
  if (window.location.protocol !== 'file:' && !layoutAdjustObserver) {
    layoutAdjustObserver = new MutationObserver(() => {
      offsetTopAnchoredElements();
    });
    layoutAdjustObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }
  document.documentElement.style.scrollPaddingTop = `12px`;
  const shadowRoot = host.shadowRoot;
  return shadowRoot
      ? {
        left: shadowRoot.querySelector('.toolbar-left'),
        backButton: shadowRoot.querySelectorAll('.nav-button')[0],
        forwardButton: shadowRoot.querySelectorAll('.nav-button')[1],
        homeButton: shadowRoot.querySelector('.nav-button--home'),
        actions: shadowRoot.querySelector('.toolbar-actions'),
        crumbs: shadowRoot.querySelector('.crumbs'),
        banner: shadowRoot.querySelector('.banner'),
        bannerImage: shadowRoot.querySelector('.banner__image'),
        stateResetButton: shadowRoot.querySelector('.nav-button--soft')
      }
    : null;
}
function ensureReminderElements() {
  if (!isTopFrame() || !document.documentElement) {
    return null;
  }
  let host = document.getElementById(REMINDER_HOST_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = REMINDER_HOST_ID;
    host.style.position = 'fixed';
    host.style.inset = '0';
    host.style.zIndex = '2147483646';
    host.style.pointerEvents = 'none';
    document.documentElement.append(host);
  }
  if (!host.shadowRoot) {
    const shadowRoot = host.attachShadow({ mode: 'open' });
    applyStyles(shadowRoot);
    const reminder = document.createElement('section');
    reminder.className = 'reminder';
    reminder.setAttribute('data-visible', 'false');
    const timeNode = document.createElement('p');
    timeNode.className = 'reminder__time';
    const titleNode = document.createElement('h2');
    titleNode.className = 'reminder__title';
    const messageNode = document.createElement('p');
    messageNode.className = 'reminder__message';
    const actions = document.createElement('div');
    actions.className = 'reminder__actions';
    const dismissButton = document.createElement('button');
    dismissButton.type = 'button';
    dismissButton.className = 'nav-button';
    dismissButton.textContent = '知道了';
    dismissButton.addEventListener('click', () => {
      reminder.setAttribute('data-visible', 'false');
    });
    actions.append(dismissButton);
    reminder.append(timeNode, titleNode, messageNode, actions);
    shadowRoot.append(reminder);
  }
  const shadowRoot = host.shadowRoot;
  return shadowRoot
    ? {
        reminder: shadowRoot.querySelector('.reminder'),
        timeNode: shadowRoot.querySelector('.reminder__time'),
        titleNode: shadowRoot.querySelector('.reminder__title'),
        messageNode: shadowRoot.querySelector('.reminder__message')
      }
    : null;
}
function showReminder(payload) {
  const elements = ensureReminderElements();
  if (!elements) {
    return;
  }
  elements.timeNode.textContent = payload.time || '学习提醒';
  elements.titleNode.textContent = payload.title || '到学习时间了';
  elements.messageNode.textContent = payload.message || '看一下今天的学习安排。';
  elements.reminder.setAttribute('data-visible', 'true');
  if (reminderHideTimer) {
    clearTimeout(reminderHideTimer);
  }
  reminderHideTimer = window.setTimeout(() => {
    elements.reminder.setAttribute('data-visible', 'false');
    reminderHideTimer = null;
  }, 20000);
}
function speakReminder(payload) {
  if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance !== 'function') {
    return;
  }
  const speechText =
    (typeof payload.speechText === 'string' && payload.speechText) ||
    payload.message ||
    `${payload.title || '学习提醒'}，请查看今天的学习安排。`;
  const repeatCount = Number.isFinite(Number(payload.repeatCount))
    ? Math.max(1, Math.min(5, Math.round(Number(payload.repeatCount))))
    : 1;
  const textToSpeak = new Array(repeatCount).fill(speechText).join('。');
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    utterance.lang = 'zh-CN';
    utterance.rate = 1;
    utterance.volume = 1;
    window.speechSynthesis.speak(utterance);
  } catch {
    // Ignore speech synthesis failures.
  }
}
async function playReminderAudio(payload) {
  const audioUrl = typeof payload.audioUrl === 'string' ? payload.audioUrl : '';
  if (!audioUrl) {
    return false;
  }
  let audio = null;
  try {
    if (reminderAudio) {
      reminderAudio.pause();
      reminderAudio = null;
    }
    audio = new Audio(audioUrl);
    audio.preload = 'auto';
    reminderAudio = audio;
    audio.addEventListener(
      'ended',
      () => {
        if (reminderAudio === audio) {
          reminderAudio = null;
        }
      },
      { once: true }
    );
    await audio.play();
    return true;
  } catch {
    if (audio) {
      audio.pause();
    }
    if (reminderAudio === audio) {
      reminderAudio = null;
    }
    return false;
  }
}
function getReminderAlarmContext() {
  if (!('AudioContext' in window) && !('webkitAudioContext' in window)) {
    return null;
  }
  if (reminderAlarmContext && reminderAlarmContext.state !== 'closed') {
    return reminderAlarmContext;
  }
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  reminderAlarmContext = new AudioContextCtor();
  return reminderAlarmContext;
}
async function playAlarmChime() {
  const audioContext = getReminderAlarmContext();
  if (!audioContext) {
    return false;
  }
  try {
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }
    const now = audioContext.currentTime + 0.02;
    const notes = [
      { at: 0, frequency: 1046.5, duration: 0.16 },
      { at: 0.24, frequency: 1046.5, duration: 0.16 },
      { at: 0.48, frequency: 1318.5, duration: 0.24 }
    ];
    notes.forEach((note) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(note.frequency, now + note.at);
      gain.gain.setValueAtTime(0.0001, now + note.at);
      gain.gain.linearRampToValueAtTime(0.18, now + note.at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + note.at + note.duration);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(now + note.at);
      oscillator.stop(now + note.at + note.duration + 0.02);
    });
    await new Promise((resolve) => {
      window.setTimeout(resolve, 900);
    });
    return true;
  } catch {
    return false;
  }
}
async function refreshToolbar() {
  const elements = ensureToolbarElements();
  if (!elements) {
    return;
  }
  const model = await ipcRenderer.invoke('shell:get-navigation-model');
  elements.backButton.disabled = !model.canGoBack;
  elements.forwardButton.disabled = !model.canGoForward;
  elements.homeButton.hidden = Boolean(model.isHome);
  const bannerImageUrl = typeof model.bannerImageUrl === 'string' ? model.bannerImageUrl : '';
  elements.banner.setAttribute('data-empty', bannerImageUrl ? 'false' : 'true');
  if (elements.bannerImage && elements.bannerImage.getAttribute('src') !== bannerImageUrl) {
    elements.bannerImage.setAttribute('src', bannerImageUrl);
  }
  elements.stateResetButton.hidden = !model.showStateReset;
  elements.actions.replaceChildren();
  (Array.isArray(model.actions) ? model.actions : []).forEach((action) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `nav-button nav-button--soft${action.compact ? ' nav-button--icon-only' : ''}`;
    button.textContent = action.compact ? (action.icon || '•') : action.label;
    button.title = action.label;
    button.setAttribute('aria-label', action.label);
    button.dataset.actionId = action.id;
    button.addEventListener('click', () => {
      void dispatchToolbarAction(action.id);
    });
    elements.actions.append(button);
  });
  elements.crumbs.replaceChildren();
  model.crumbs.forEach((crumb, index) => {
    if (index > 0) {
      const separator = document.createElement('span');
      separator.className = 'sep';
      separator.textContent = '/';
      elements.crumbs.append(separator);
    }
    const crumbNode = document.createElement(crumb.current ? 'span' : 'button');
    crumbNode.className = 'crumb';
    crumbNode.textContent = crumb.label;
    crumbNode.setAttribute('data-current', crumb.current ? 'true' : 'false');
    if (!crumb.current) {
      crumbNode.type = 'button';
      crumbNode.addEventListener('click', async () => {
        await ipcRenderer.invoke('shell:navigate', crumb.target);
        window.setTimeout(() => {
          void refreshToolbar();
        }, 80);
      });
    }
    elements.crumbs.append(crumbNode);
  });
  window.requestAnimationFrame(() => {
    reportToolbarHeight();
  });
}
function startToolbarRefresh() {
  if (!isTopFrame()) {
    return;
  }
  void refreshToolbar();
  if (!refreshTimer) {
    refreshTimer = window.setInterval(() => {
      void refreshToolbar();
    }, 1200);
  }
}
function bootstrapToolbar() {
  if (!isTopFrame() || isExitVerificationPage() || window.location.protocol !== 'file:') {
    return;
  }
  const start = () => {
    startToolbarRefresh();
    window.addEventListener('focus', () => {
      void refreshToolbar();
    });
    window.addEventListener('hashchange', () => {
      void refreshToolbar();
    });
    window.addEventListener('popstate', () => {
      void refreshToolbar();
    });
    window.addEventListener('resize', () => {
      void refreshToolbar();
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        void refreshToolbar();
      }
    });
  };
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', start, { once: true });
    return;
  }
  start();
}
ipcRenderer.on('shell:study-reminder', async (_event, payload) => {
  const reminderPayload = payload || {};
  showReminder(reminderPayload);
});
bootstrapToolbar();
