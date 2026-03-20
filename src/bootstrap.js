'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const BOOTSTRAP_LOG = path.join(os.tmpdir(), 'studygate-bootstrap.log');

function appendBootstrapLog(event, details) {
  const line = `[${new Date().toISOString()}] ${event}${details ? ` ${JSON.stringify(details)}` : ''}`;
  try {
    fs.appendFileSync(BOOTSTRAP_LOG, `${line}${os.EOL}`, 'utf8');
  } catch {
    // Ignore bootstrap logging failures.
  }
}

function formatError(error) {
  if (!error) {
    return 'Unknown error';
  }

  if (error && typeof error.stack === 'string' && error.stack.trim()) {
    return error.stack;
  }

  if (error && typeof error.message === 'string' && error.message.trim()) {
    return error.message;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

appendBootstrapLog('bootstrap-start', {
  pid: process.pid,
  cwd: process.cwd(),
  execPath: process.execPath,
  argv: process.argv
});

process.on('uncaughtException', (error) => {
  appendBootstrapLog('uncaught-exception', {
    error: formatError(error)
  });
});

process.on('unhandledRejection', (reason) => {
  appendBootstrapLog('unhandled-rejection', {
    error: formatError(reason)
  });
});

try {
  require('./main');
  appendBootstrapLog('main-required');
} catch (error) {
  const formattedError = formatError(error);
  appendBootstrapLog('main-require-failed', {
    error: formattedError
  });

  try {
    const { dialog } = require('electron');
    dialog.showErrorBox('StudyGate 启动失败', formattedError);
  } catch {
    // Ignore if Electron dialog is unavailable.
  }

  throw error;
}
