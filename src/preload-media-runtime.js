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

function safeCloneForLog(value) {
  try {
    return JSON.parse(safeSerialize(value));
  } catch {
    return '[unserializable]';
  }
}

function safeRead(getter, fallback = '') {
  try {
    return getter();
  } catch {
    return fallback;
  }
}

function summarizeError(error) {
  if (!error) {
    return {};
  }

  return {
    name: typeof error.name === 'string' ? error.name : '',
    message: typeof error.message === 'string' ? error.message : '',
    constraint: typeof error.constraint === 'string' ? error.constraint : '',
    code: typeof error.code === 'string' || typeof error.code === 'number' ? error.code : '',
    stack:
      typeof error.stack === 'string'
        ? error.stack.split('\n').slice(0, 6).join('\n')
        : '',
    serialized: safeCloneForLog(error)
  };
}

function frameSnapshot(windowObject) {
  return {
    href: safeRead(() => windowObject.location.href),
    hostname: safeRead(() => windowObject.location.hostname),
    origin: safeRead(() => windowObject.location.origin),
    protocol: safeRead(() => windowObject.location.protocol),
    isTopFrame: safeRead(() => windowObject.top === windowObject, false),
    parentHref:
      safeRead(() => (windowObject.parent && windowObject.parent !== windowObject ? windowObject.parent.location.href : '')) || '',
    topHref: safeRead(() => windowObject.top.location.href),
    referrer: safeRead(() => windowObject.document.referrer),
    ancestorOrigins: safeRead(() => Array.from(windowObject.location.ancestorOrigins || []), [])
  };
}

function summarizeDevice(device) {
  return {
    kind: device && typeof device.kind === 'string' ? device.kind : '',
    label: device && typeof device.label === 'string' ? device.label : '',
    deviceIdPresent: Boolean(device && device.deviceId),
    groupIdPresent: Boolean(device && device.groupId)
  };
}

function summarizeTrack(track) {
  if (!track) {
    return {};
  }

  return {
    kind: typeof track.kind === 'string' ? track.kind : '',
    label: typeof track.label === 'string' ? track.label : '',
    enabled: track.enabled !== false,
    muted: track.muted === true,
    readyState: typeof track.readyState === 'string' ? track.readyState : '',
    settings: safeRead(() => safeCloneForLog(track.getSettings()), {}),
    constraints: safeRead(() => safeCloneForLog(track.getConstraints()), {}),
    capabilities: safeRead(() => safeCloneForLog(track.getCapabilities()), {})
  };
}

function createMediaLogger(windowObject, consoleObject, sendLog) {
  return function logMediaEvent(eventName, payload = {}) {
    if (!isCourseEcosystemPage(windowObject)) {
      return;
    }

    const logPayload = {
      at: new Date().toISOString(),
      event: eventName,
      href: safeRead(() => windowObject.location.href),
      frame: frameSnapshot(windowObject),
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
          streamIdPresent: Boolean(stream.id),
          audioTracks: stream.getAudioTracks().map(summarizeTrack),
          videoTracks: stream.getVideoTracks().map(summarizeTrack)
        });

        for (const track of [...stream.getAudioTracks(), ...stream.getVideoTracks()]) {
          for (const eventName of ['ended', 'mute', 'unmute']) {
            track.addEventListener(eventName, () => {
              logMediaEvent('media-track-event', {
                eventName,
                track: summarizeTrack(track)
              });
            });
          }
        }

        return stream;
      },
      (error) => {
        logMediaEvent('getUserMedia-fail', {
          normalizedConstraints,
          error: summarizeError(error)
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

function installMediaDeviceDiagnostics(windowObject, logMediaEvent) {
  if (!isCourseEcosystemPage(windowObject) || !windowObject.navigator) {
    return;
  }

  const navigatorObject = windowObject.navigator;
  const mediaDevices = navigatorObject.mediaDevices;

  if (mediaDevices && typeof mediaDevices.enumerateDevices === 'function') {
    const nativeEnumerateDevices = mediaDevices.enumerateDevices.bind(mediaDevices);

    mediaDevices.enumerateDevices = () => {
      logMediaEvent('enumerateDevices-call', {});
      return nativeEnumerateDevices().then(
        (devices) => {
          logMediaEvent('enumerateDevices-success', {
            devices: Array.isArray(devices) ? devices.map(summarizeDevice) : []
          });
          return devices;
        },
        (error) => {
          logMediaEvent('enumerateDevices-fail', {
            error: summarizeError(error)
          });
          throw error;
        }
      );
    };

    if (typeof mediaDevices.addEventListener === 'function') {
      mediaDevices.addEventListener('devicechange', async () => {
        try {
          const devices = await nativeEnumerateDevices();
          logMediaEvent('devicechange', {
            devices: Array.isArray(devices) ? devices.map(summarizeDevice) : []
          });
        } catch (error) {
          logMediaEvent('devicechange-enumerate-fail', {
            error: summarizeError(error)
          });
        }
      });
    }
  }

  if (mediaDevices && typeof mediaDevices.selectAudioOutput === 'function') {
    const nativeSelectAudioOutput = mediaDevices.selectAudioOutput.bind(mediaDevices);

    mediaDevices.selectAudioOutput = (...args) => {
      logMediaEvent('selectAudioOutput-call', {
        argumentsLength: args.length
      });
      return nativeSelectAudioOutput(...args).then(
        (deviceInfo) => {
          logMediaEvent('selectAudioOutput-success', {
            device: summarizeDevice(deviceInfo)
          });
          return deviceInfo;
        },
        (error) => {
          logMediaEvent('selectAudioOutput-fail', {
            error: summarizeError(error)
          });
          throw error;
        }
      );
    };
  }

  if (navigatorObject.permissions && typeof navigatorObject.permissions.query === 'function') {
    const nativePermissionsQuery = navigatorObject.permissions.query.bind(navigatorObject.permissions);

    navigatorObject.permissions.query = (descriptor) => {
      logMediaEvent('permissions-query-call', {
        descriptor: safeCloneForLog(descriptor)
      });
      return nativePermissionsQuery(descriptor).then(
        (result) => {
          logMediaEvent('permissions-query-success', {
            descriptor: safeCloneForLog(descriptor),
            state: result && result.state ? result.state : ''
          });
          return result;
        },
        (error) => {
          logMediaEvent('permissions-query-fail', {
            descriptor: safeCloneForLog(descriptor),
            error: summarizeError(error)
          });
          throw error;
        }
      );
    };
  }
}

function installGlobalDiagnostics(windowObject, logMediaEvent) {
  if (!isCourseEcosystemPage(windowObject)) {
    return;
  }

  windowObject.addEventListener('error', (event) => {
    logMediaEvent('window-error', {
      message: typeof event.message === 'string' ? event.message : '',
      filename: typeof event.filename === 'string' ? event.filename : '',
      lineno: Number(event.lineno) || 0,
      colno: Number(event.colno) || 0,
      error: summarizeError(event.error)
    });
  });

  windowObject.addEventListener('unhandledrejection', (event) => {
    logMediaEvent('window-unhandledrejection', {
      reason: summarizeError(event.reason)
    });
  });

  if (windowObject.document) {
    windowObject.document.addEventListener('visibilitychange', () => {
      logMediaEvent('document-visibilitychange', {
        visibilityState: windowObject.document.visibilityState
      });
    });

    for (const eventName of ['loadedmetadata', 'play', 'pause', 'error']) {
      windowObject.document.addEventListener(
        eventName,
        (event) => {
          const target = event.target;

          if (
            typeof windowObject.HTMLMediaElement === 'undefined' ||
            !(target instanceof windowObject.HTMLMediaElement)
          ) {
            return;
          }

          logMediaEvent('media-element-event', {
            eventName,
            tagName: target.tagName,
            currentSrc: typeof target.currentSrc === 'string' ? target.currentSrc : '',
            sinkId: typeof target.sinkId === 'string' ? target.sinkId : '',
            muted: target.muted === true,
            autoplay: target.autoplay === true,
            paused: target.paused === true,
            readyState: Number(target.readyState) || 0,
            networkState: Number(target.networkState) || 0,
            error: target.error
              ? {
                  code: Number(target.error.code) || 0,
                  message: typeof target.error.message === 'string' ? target.error.message : ''
                }
              : {}
          });
        },
        true
      );
    }
  }
}

function scheduleMediaDiagnostics(windowObject, logMediaEvent) {
  if (!isCourseEcosystemPage(windowObject) || !windowObject.navigator || !windowObject.navigator.mediaDevices) {
    return;
  }

  const runDiagnostics = async () => {
    const permissions = {};
    const permissionsPolicy =
      windowObject.document &&
      (windowObject.document.permissionsPolicy || windowObject.document.featurePolicy);

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
      userAgent: safeRead(() => windowObject.navigator.userAgent),
      platform: safeRead(() => windowObject.navigator.platform),
      featurePolicy: safeRead(() => ({
        camera:
          permissionsPolicy && typeof permissionsPolicy.allowsFeature === 'function'
            ? permissionsPolicy.allowsFeature('camera')
            : '[unsupported]',
        microphone:
          permissionsPolicy && typeof permissionsPolicy.allowsFeature === 'function'
            ? permissionsPolicy.allowsFeature('microphone')
            : '[unsupported]',
        speakerSelection:
          permissionsPolicy && typeof permissionsPolicy.allowsFeature === 'function'
            ? permissionsPolicy.allowsFeature('speaker-selection')
            : '[unsupported]'
      }), {}),
      supportedConstraints:
        windowObject.navigator.mediaDevices && typeof windowObject.navigator.mediaDevices.getSupportedConstraints === 'function'
          ? safeCloneForLog(windowObject.navigator.mediaDevices.getSupportedConstraints())
          : {},
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
  logMediaEvent('media-runtime-bootstrap', {
    title: windowObject.document ? windowObject.document.title : '',
    readyState: windowObject.document ? windowObject.document.readyState : '',
    isSecureContext: windowObject.isSecureContext
  });
  installCompatibilityShims(windowObject, logMediaEvent);
  installMediaDeviceDiagnostics(windowObject, logMediaEvent);
  installGlobalDiagnostics(windowObject, logMediaEvent);
  scheduleMediaDiagnostics(windowObject, logMediaEvent);
}

module.exports = {
  bootstrapClassroomMediaRuntime
};
