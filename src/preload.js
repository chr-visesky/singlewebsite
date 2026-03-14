'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const TOOLBAR_HEIGHT = 54;
const TOOLBAR_HOST_ID = 'studygate-nav-host';
const REMINDER_HOST_ID = 'studygate-reminder-host';
const TOOLBAR_BODY_MARGIN_ATTR = 'data-studygate-original-margin-top';
const TOOLBAR_TOP_OFFSET_ATTR = 'data-studygate-original-top';
let refreshTimer = null;
let reminderHideTimer = null;
let reminderAudio = null;
let reminderAlarmContext = null;
let zoomShortcutBound = false;
let layoutAdjustObserver = null;

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

bootstrapPersistentPageStorage();
bootstrapCredentialAutofill();

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

      const delta = event.deltaY < 0 ? 0.1 : -0.1;
      void ipcRenderer.invoke('shell:adjust-window-zoom', {
        delta
      });
    },
    { passive: false }
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

bootstrapZoomShortcuts();

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
  const cssText = `
    .bar {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: ${TOOLBAR_HEIGHT}px;
      padding: 8px 14px;
      background: rgba(8, 15, 25, 0.88);
      color: #f4f7fb;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      backdrop-filter: blur(16px);
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.22);
      font: 13px/1.2 "Microsoft YaHei UI", "Segoe UI Variable", "Segoe UI", sans-serif;
    }

    .nav-button {
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 999px;
      padding: 6px 12px;
      background: rgba(255, 255, 255, 0.06);
      color: inherit;
      cursor: pointer;
      font: inherit;
    }

    .nav-button[disabled] {
      opacity: 0.38;
      cursor: default;
    }

    .crumbs {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      flex: 1 1 auto;
    }

    .crumb {
      border: none;
      background: transparent;
      color: inherit;
      cursor: pointer;
      font: inherit;
      padding: 0;
      max-width: 22ch;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .crumb[data-current="true"] {
      color: #ffd37c;
      cursor: default;
      font-weight: 700;
    }

    .sep {
      color: rgba(255, 255, 255, 0.36);
      flex: 0 0 auto;
    }

    .reminder {
      position: fixed;
      right: 18px;
      bottom: 18px;
      width: min(360px, calc(100vw - 28px));
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 22px;
      padding: 16px 16px 14px;
      background: rgba(12, 18, 28, 0.94);
      color: #f4f7fb;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
      backdrop-filter: blur(18px);
      pointer-events: auto;
      display: none;
    }

    .reminder[data-visible="true"] {
      display: block;
    }

    .reminder__time {
      margin: 0 0 8px;
      color: #ffd37c;
      font-size: 12px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }

    .reminder__title {
      margin: 0;
      font-size: 24px;
      line-height: 1.08;
    }

    .reminder__message {
      margin: 10px 0 0;
      color: rgba(244, 247, 251, 0.8);
      font-size: 14px;
      line-height: 1.55;
    }

    .reminder__actions {
      display: flex;
      justify-content: flex-end;
      margin-top: 14px;
    }
  `;

  if ('adoptedStyleSheets' in shadowRoot && 'replaceSync' in CSSStyleSheet.prototype) {
    const styleSheet = new CSSStyleSheet();
    styleSheet.replaceSync(cssText);
    shadowRoot.adoptedStyleSheets = [styleSheet];
    return;
  }

  const style = document.createElement('style');
  style.textContent = cssText;
  shadowRoot.append(style);
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

function ensureToolbarElements() {
  if (!isTopFrame() || !document.documentElement || !document.body) {
    return null;
  }

  let host = document.getElementById(TOOLBAR_HOST_ID);

  if (!host) {
    host = document.createElement('div');
    host.id = TOOLBAR_HOST_ID;
    host.style.position = 'fixed';
    host.style.top = '0';
    host.style.left = '0';
    host.style.right = '0';
    host.style.zIndex = '2147483647';
    host.style.pointerEvents = 'none';
    document.documentElement.append(host);
  }

  if (!host.shadowRoot) {
    const shadowRoot = host.attachShadow({ mode: 'open' });
    applyStyles(shadowRoot);

    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.pointerEvents = 'auto';

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

    const crumbs = document.createElement('div');
    crumbs.className = 'crumbs';

    bar.append(backButton, forwardButton, crumbs);
    shadowRoot.append(bar);
  }

  if (window.location.protocol !== 'file:' && !document.body.hasAttribute(TOOLBAR_BODY_MARGIN_ATTR)) {
    const originalMarginTop = window.getComputedStyle(document.body).marginTop || '0px';
    document.body.setAttribute(TOOLBAR_BODY_MARGIN_ATTR, originalMarginTop);
    document.body.style.marginTop = `calc(${originalMarginTop} + ${TOOLBAR_HEIGHT}px)`;
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

  document.documentElement.style.scrollPaddingTop = `${TOOLBAR_HEIGHT + 12}px`;

  const shadowRoot = host.shadowRoot;
  return shadowRoot
    ? {
        backButton: shadowRoot.querySelectorAll('.nav-button')[0],
        forwardButton: shadowRoot.querySelectorAll('.nav-button')[1],
        crumbs: shadowRoot.querySelector('.crumbs')
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
  if (!isTopFrame() || isExitVerificationPage()) {
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
