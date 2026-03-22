'use strict';

const { ipcRenderer } = require('electron');

require('./preload');

const { bootstrapClassroomPreloadRuntime } = require('./classroom-preload-runtime');

bootstrapClassroomPreloadRuntime({
  ipcRenderer,
  windowObject: window,
  consoleObject: console
});
