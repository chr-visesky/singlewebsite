'use strict';

const COURSE_ECOSYSTEM_HOST_SUFFIXES = ['talk915.com', 'csslcloud.net', 'chindle.com', 'keyclass.cn', 'xuedianyun.com'];
const MEDIA_LOG_PREFIX = '[STUDYGATE_MEDIA]';

function isHttpPage(windowObject) {
  return Boolean(windowObject && windowObject.location && /^https?:$/i.test(windowObject.location.protocol));
}

function isCourseEcosystemPage(windowObject) {
  if (!isHttpPage(windowObject) || !windowObject.location || typeof windowObject.location.hostname !== 'string') {
    return false;
  }

  const hostname = windowObject.location.hostname.toLowerCase();
  return COURSE_ECOSYSTEM_HOST_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
}

function safeSerialize(value) {
  const seen = new WeakSet();

  try {
    return JSON.stringify(value, (_key, currentValue) => {
      if (typeof currentValue === 'function') {
        return '[function]';
      }

      if (typeof currentValue === 'undefined') {
        return '[undefined]';
      }

      if (!currentValue || typeof currentValue !== 'object') {
        return currentValue;
      }

      if (seen.has(currentValue)) {
        return '[circular]';
      }

      seen.add(currentValue);
      return currentValue;
    });
  } catch {
    return '"[unserializable]"';
  }
}

function createMediaLogger(windowObject, consoleObject, sendLog) {
  return function logMediaEvent(eventName, payload = {}) {
    if (!isCourseEcosystemPage(windowObject)) {
      return;
    }

    const logPayload = {
      at: new Date().toISOString(),
      event: eventName,
      href: windowObject.location.href,
      ...payload
    };

    if (typeof sendLog === 'function') {
      try {
        sendLog(logPayload);
        return;
      } catch {
        // Fall back to console logging.
      }
    }

    if (consoleObject && typeof consoleObject.log === 'function') {
      consoleObject.log(`${MEDIA_LOG_PREFIX} ${safeSerialize(logPayload)}`);
    }
  };
}

function normalizeTrackConstraints(value) {
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
}

function normalizeConstraints(constraints) {
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
}

function installCompatibilityShims(windowObject, logMediaEvent) {
  if (!isHttpPage(windowObject) || !windowObject.navigator) {
    return;
  }

  const navigatorObject = windowObject.navigator;
  const originalMediaDevices = navigatorObject.mediaDevices || {};
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
    logMediaEvent('getUserMedia-call', {
      requestedConstraints: constraints,
      normalizedConstraints
    });

    const streamPromise = nativeModernGetUserMedia
      ? nativeModernGetUserMedia(normalizedConstraints)
      : new Promise((resolve, reject) => {
          nativeLegacyGetUserMedia(normalizedConstraints, resolve, reject);
        });

    return streamPromise.then(
      (stream) => {
        logMediaEvent('getUserMedia-success', {
          audioTracks: stream.getAudioTracks().map((track) => track.label),
          videoTracks: stream.getVideoTracks().map((track) => track.label)
        });
        return stream;
      },
      (error) => {
        logMediaEvent('getUserMedia-fail', {
          normalizedConstraints,
          name: error && error.name ? error.name : '',
          message: error && error.message ? error.message : ''
        });
        throw error;
      }
    );
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

  if (!windowObject.AudioContext && windowObject.webkitAudioContext) {
    windowObject.AudioContext = windowObject.webkitAudioContext;
  }

  if (
    typeof windowObject.HTMLMediaElement !== 'undefined' &&
    windowObject.HTMLMediaElement.prototype &&
    typeof windowObject.HTMLMediaElement.prototype.setSinkId === 'function'
  ) {
    const nativeSetSinkId = windowObject.HTMLMediaElement.prototype.setSinkId;

    windowObject.HTMLMediaElement.prototype.setSinkId = function patchedSetSinkId(deviceId) {
      logMediaEvent('setSinkId-call', {
        deviceIdPresent: Boolean(deviceId)
      });
      return nativeSetSinkId.call(this, deviceId).then(
        (result) => {
          logMediaEvent('setSinkId-success', {});
          return result;
        },
        (error) => {
          logMediaEvent('setSinkId-fail', {
            name: error && error.name ? error.name : '',
            message: error && error.message ? error.message : ''
          });
          throw error;
        }
      );
    };
  }
}

function scheduleMediaDiagnostics(windowObject, logMediaEvent) {
  if (!isCourseEcosystemPage(windowObject) || !windowObject.navigator || !windowObject.navigator.mediaDevices) {
    return;
  }

  const runDiagnostics = async () => {
    const permissions = {};

    for (const name of ['camera', 'microphone', 'speaker-selection']) {
      try {
        permissions[name] = await windowObject.navigator.permissions.query({ name }).then((result) => result.state);
      } catch (error) {
        permissions[name] = `error:${error && error.message ? error.message : ''}`;
      }
    }

    let devices = [];

    try {
      devices = await windowObject.navigator.mediaDevices.enumerateDevices();
    } catch (error) {
      logMediaEvent('media-diagnostics-enumerate-fail', {
        name: error && error.name ? error.name : '',
        message: error && error.message ? error.message : ''
      });
    }

    logMediaEvent('media-diagnostics', {
      title: windowObject.document ? windowObject.document.title : '',
      isSecureContext: windowObject.isSecureContext,
      permissions,
      hasMediaDevices: Boolean(windowObject.navigator.mediaDevices),
      hasGetUserMedia: Boolean(windowObject.navigator.mediaDevices && windowObject.navigator.mediaDevices.getUserMedia),
      hasEnumerateDevices: Boolean(windowObject.navigator.mediaDevices && windowObject.navigator.mediaDevices.enumerateDevices),
      hasSelectAudioOutput: Boolean(windowObject.navigator.mediaDevices && windowObject.navigator.mediaDevices.selectAudioOutput),
      hasSetSinkId:
        typeof windowObject.HTMLMediaElement !== 'undefined' &&
        typeof windowObject.HTMLMediaElement.prototype.setSinkId === 'function',
      devices: devices.map((device) => ({
        kind: device.kind,
        label: device.label || '',
        deviceIdPresent: Boolean(device.deviceId)
      }))
    });
  };

  if (windowObject.document && windowObject.document.readyState === 'loading') {
    windowObject.addEventListener('DOMContentLoaded', () => {
      windowObject.setTimeout(() => {
        void runDiagnostics();
      }, 1500);
    }, { once: true });
    return;
  }

  windowObject.setTimeout(() => {
    void runDiagnostics();
  }, 1500);
}

function bootstrapClassroomMediaRuntime({ windowObject, consoleObject, sendLog }) {
  const logMediaEvent = createMediaLogger(windowObject, consoleObject, sendLog);
  installCompatibilityShims(windowObject, logMediaEvent);
  scheduleMediaDiagnostics(windowObject, logMediaEvent);
}

module.exports = {
  bootstrapClassroomMediaRuntime
};
