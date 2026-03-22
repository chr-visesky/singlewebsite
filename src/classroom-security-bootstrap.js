'use strict';

const LEGACY_MEDIA_COMPATIBILITY_SCRIPT = String.raw`
(() => {
  if (!window || !window.navigator || !/^https?:$/.test(window.location.protocol)) {
    return;
  }

  const navigatorObject = window.navigator;
  const originalMediaDevices = navigatorObject.mediaDevices || {};

  const normalizeTrackConstraints = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return value;
    }

    const nextValue = { ...value };
    let sourceId = '';

    if (typeof nextValue.sourceId === 'string' && nextValue.sourceId) {
      sourceId = nextValue.sourceId;
    }

    if (nextValue.mandatory && typeof nextValue.mandatory.sourceId === 'string' && nextValue.mandatory.sourceId) {
      sourceId = nextValue.mandatory.sourceId;
    }

    if (Array.isArray(nextValue.optional)) {
      for (const option of nextValue.optional) {
        if (option && typeof option.sourceId === 'string' && option.sourceId) {
          sourceId = option.sourceId;
          break;
        }
      }
    }

    delete nextValue.sourceId;
    delete nextValue.optional;
    delete nextValue.mandatory;

    if (sourceId) {
      nextValue.deviceId = { exact: sourceId };
    }

    return Object.keys(nextValue).length ? nextValue : true;
  };

  const normalizeConstraints = (constraints) => {
    if (constraints === 'video') {
      return { video: true };
    }

    if (constraints === 'audio') {
      return { audio: true };
    }

    if (!constraints || typeof constraints !== 'object' || Array.isArray(constraints)) {
      return constraints;
    }

    const nextConstraints = { ...constraints };

    if ('video' in nextConstraints) {
      nextConstraints.video = normalizeTrackConstraints(nextConstraints.video);
    }

    if ('audio' in nextConstraints) {
      nextConstraints.audio = normalizeTrackConstraints(nextConstraints.audio);
    }

    return nextConstraints;
  };

  const nativeLegacyGetUserMedia =
    (typeof navigatorObject.getUserMedia === 'function' && navigatorObject.getUserMedia.bind(navigatorObject)) ||
    (typeof navigatorObject.webkitGetUserMedia === 'function' && navigatorObject.webkitGetUserMedia.bind(navigatorObject)) ||
    (typeof navigatorObject.mozGetUserMedia === 'function' && navigatorObject.mozGetUserMedia.bind(navigatorObject)) ||
    (typeof navigatorObject.msGetUserMedia === 'function' && navigatorObject.msGetUserMedia.bind(navigatorObject)) ||
    null;

  const nativeModernGetUserMedia =
    originalMediaDevices && typeof originalMediaDevices.getUserMedia === 'function'
      ? originalMediaDevices.getUserMedia.bind(originalMediaDevices)
      : null;

  if (!nativeModernGetUserMedia && !nativeLegacyGetUserMedia) {
    return;
  }

  const modernShim = (constraints) => {
    const normalizedConstraints = normalizeConstraints(constraints);

    if (nativeModernGetUserMedia) {
      return nativeModernGetUserMedia(normalizedConstraints);
    }

    return new Promise((resolve, reject) => {
      nativeLegacyGetUserMedia(normalizedConstraints, resolve, reject);
    });
  };

  const legacyShim = (constraints, successCallback, errorCallback) =>
    modernShim(constraints).then(
      (stream) => {
        if (typeof successCallback === 'function') {
          successCallback(stream);
        }

        return stream;
      },
      (error) => {
        if (typeof errorCallback === 'function') {
          errorCallback(error);
        }

        throw error;
      }
    );

  try {
    if (!navigatorObject.mediaDevices) {
      Object.defineProperty(navigatorObject, 'mediaDevices', {
        configurable: true,
        enumerable: true,
        value: originalMediaDevices
      });
    }
  } catch {
    // Ignore read-only navigator properties.
  }

  try {
    navigatorObject.mediaDevices.getUserMedia = modernShim;
  } catch {
    // Ignore read-only mediaDevices methods.
  }

  for (const key of ['getUserMedia', 'webkitGetUserMedia', 'mozGetUserMedia', 'msGetUserMedia']) {
    try {
      navigatorObject[key] = legacyShim;
    } catch {
      // Ignore read-only legacy navigator properties.
    }
  }

  if (!window.AudioContext && window.webkitAudioContext) {
    window.AudioContext = window.webkitAudioContext;
  }
})();
`;

const CLASSROOM_TOPFRAME_ZOOM_SCRIPT = String.raw`
(() => {
  if (!window || window.top !== window || window.__studygateClassroomTopframeZoomInstalled) {
    return;
  }

  Object.defineProperty(window, '__studygateClassroomTopframeZoomInstalled', {
    configurable: false,
    enumerable: false,
    value: true
  });

  const minimumZoom = 0.6;
  const maximumZoom = 2.5;
  const zoomStep = 0.1;
  const messageType = '__studygateClassroomZoomCommand';
  const normalizeZoom = (value) => {
    const numeric = Number(value) || 1;
    const stepped = Math.round(numeric / zoomStep) * zoomStep;
    return Math.max(minimumZoom, Math.min(Number(stepped.toFixed(2)), maximumZoom));
  };
  const sendCommandToChildFrames = (command, value) => {
    const payload = {
      type: messageType,
      command,
      value
    };

    for (const frame of Array.from(window.frames || [])) {
      try {
        frame.postMessage(payload, '*');
      } catch {
        // Ignore inaccessible child frames.
      }
    }
  };
  const sendZoomDelta = (rawDeltaY) => {
    const numeric = Number(rawDeltaY) || 0;
    if (!numeric) {
      return 1;
    }

    sendCommandToChildFrames('delta', numeric < 0 ? zoomStep : -zoomStep);
    return 1;
  };
  const sendZoomReset = () => {
    sendCommandToChildFrames('reset', 1);
    return 1;
  };

  window.__studygateClassroomTopframeTestHooks = Object.freeze({
    triggerWheel(rawDeltaY) {
      return sendZoomDelta(rawDeltaY);
    },
    resetZoom() {
      return sendZoomReset();
    }
  });
  if (window.document && window.document.documentElement) {
    window.document.documentElement.style.zoom = '1';
  }

  window.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      sendZoomDelta(event.deltaY);
    },
    { passive: false, capture: true }
  );

  window.addEventListener(
    'keydown',
    (event) => {
      if (!event.ctrlKey || event.key !== '0') {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      sendZoomReset();
    },
    true
  );
})();
`;

const CLASSROOM_SUBFRAME_ZOOM_SCRIPT = String.raw`
(() => {
  if (!window || window.top === window || window.__studygateClassroomSubframeZoomInstalled) {
    return;
  }

  Object.defineProperty(window, '__studygateClassroomSubframeZoomInstalled', {
    configurable: false,
    enumerable: false,
    value: true
  });

  const minimumZoom = 0.6;
  const maximumZoom = 2.5;
  const zoomStep = 0.1;
  const storageKey = '__studygateClassroomPageZoom';
  const messageType = '__studygateClassroomZoomCommand';
  const normalizeZoom = (value) => {
    const numeric = Number(value) || 1;
    const stepped = Math.round(numeric / zoomStep) * zoomStep;
    return Math.max(minimumZoom, Math.min(Number(stepped.toFixed(2)), maximumZoom));
  };
  const readZoom = () => {
    try {
      return normalizeZoom(window.sessionStorage.getItem(storageKey) || 1);
    } catch {
      return 1;
    }
  };
  const applyZoom = (value) => {
    const zoom = normalizeZoom(value);

    if (window.document && window.document.documentElement) {
      window.document.documentElement.style.zoom = zoom.toFixed(2);
    }

    try {
      window.sessionStorage.setItem(storageKey, String(zoom));
    } catch {
      // Ignore sessionStorage failures.
    }

    return zoom;
  };
  const sendZoomDelta = (rawDeltaY) => {
    const numeric = Number(rawDeltaY) || 0;
    return applyZoom(readZoom() + (numeric < 0 ? zoomStep : -zoomStep));
  };
  const sendZoomReset = () => {
    return applyZoom(1);
  };

  window.__studygateClassroomSubframeTestHooks = Object.freeze({
    triggerWheel(rawDeltaY) {
      return sendZoomDelta(rawDeltaY);
    },
    resetZoom() {
      sendZoomReset();
    }
  });
  applyZoom(readZoom());

  window.addEventListener('message', (event) => {
    const data = event && event.data;

    if (!data || data.type !== messageType) {
      return;
    }

    if (data.command === 'delta') {
      const delta = Number(data.value) || 0;
      if (delta) {
        applyZoom(readZoom() + delta);
      }
      return;
    }

    if (data.command === 'reset') {
      sendZoomReset();
    }
  });

  window.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      sendZoomDelta(event.deltaY);
    },
    { passive: false, capture: true }
  );

  window.addEventListener(
    'keydown',
    (event) => {
      if (!event.ctrlKey || event.key !== '0') {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      sendZoomReset();
    },
    true
  );
})();
`;

function normalizePrefix(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function safeReadJson(fs, filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function pushClassroomUrls(target, rawConfig) {
  if (!rawConfig || typeof rawConfig !== 'object') {
    return;
  }

  const startUrl = normalizePrefix(rawConfig.startUrl);

  if (startUrl) {
    target.push(startUrl);
  }

  for (const listKey of ['onlineClassrooms', 'classrooms']) {
    const source = Array.isArray(rawConfig[listKey]) ? rawConfig[listKey] : [];

    for (const item of source) {
      const entryUrl = normalizePrefix(item && item.entryUrl);

      if (entryUrl) {
        target.push(entryUrl);
      }
    }
  }
}

function collectInsecureClassroomOrigins({ fs, path, processCwd, processExecPath, stableUserDataDir, configFile }) {
  const sources = [];
  const packagedConfigPath = path.join(path.dirname(processExecPath), 'resources', 'app', configFile);
  const cwdConfigPath = path.join(processCwd, configFile);
  const cacheConfigPath = path.join(stableUserDataDir, 'study-schedule-cache.json');

  pushClassroomUrls(sources, safeReadJson(fs, packagedConfigPath));
  pushClassroomUrls(sources, safeReadJson(fs, cwdConfigPath));
  pushClassroomUrls(sources, safeReadJson(fs, cacheConfigPath));

  const origins = new Set();

  for (const sourceUrl of sources) {
    try {
      const parsed = new URL(sourceUrl);

      if (parsed.protocol === 'http:') {
        origins.add(parsed.origin);
      }
    } catch {
      // Ignore malformed URLs.
    }
  }

  return Array.from(origins);
}

function configureClassroomSecurityBootstrap(options = {}) {
  const {
    app,
    fs,
    path,
    processCwd,
    processExecPath,
    stableUserDataDir,
    configFile
  } = options;

  const insecureOrigins = collectInsecureClassroomOrigins({
    fs,
    path,
    processCwd,
    processExecPath,
    stableUserDataDir,
    configFile
  });

  if (!insecureOrigins.length) {
    return insecureOrigins;
  }

  app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', insecureOrigins.join(','));
  return insecureOrigins;
}

module.exports = {
  CLASSROOM_SUBFRAME_ZOOM_SCRIPT,
  CLASSROOM_TOPFRAME_ZOOM_SCRIPT,
  LEGACY_MEDIA_COMPATIBILITY_SCRIPT,
  configureClassroomSecurityBootstrap
};
