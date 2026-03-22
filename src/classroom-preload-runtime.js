'use strict';

const { bootstrapClassroomMediaRuntime } = require('./preload-media-runtime');

function isHttpPage(windowObject) {
  return Boolean(windowObject && windowObject.location && /^https?:$/i.test(windowObject.location.protocol));
}

function bootstrapClassroomPreloadRuntime(options = {}) {
  const {
    ipcRenderer,
    windowObject,
    consoleObject
  } = options;

  if (!isHttpPage(windowObject)) {
    return false;
  }

  try {
    bootstrapClassroomMediaRuntime({
      windowObject,
      consoleObject,
      sendLog(payload) {
        ipcRenderer.send('shell:log-classroom-media-event', payload);
      }
    });
    return true;
  } catch (error) {
    if (consoleObject && typeof consoleObject.error === 'function') {
      consoleObject.error('[STUDYGATE_MEDIA] preload bootstrap failed', error);
    }
    return false;
  }
}

module.exports = {
  bootstrapClassroomPreloadRuntime
};
