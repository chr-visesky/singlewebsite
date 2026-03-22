'use strict';

const fs = require('fs');

function createAppIconRuntime(dependencies = {}) {
  const {
    app,
    pathModule,
    processExecPath,
    projectRootPath
  } = dependencies;

  function packagedIconPath() {
    return pathModule.join(pathModule.dirname(processExecPath), 'studygate.ico');
  }

  function developmentIconPath() {
    return pathModule.join(projectRootPath, 'build', 'branding', 'studygate.ico');
  }

  function resolveWindowIconPath() {
    const candidate = app && app.isPackaged ? packagedIconPath() : developmentIconPath();
    return fs.existsSync(candidate) ? candidate : '';
  }

  return {
    resolveWindowIconPath
  };
}

module.exports = {
  createAppIconRuntime
};
