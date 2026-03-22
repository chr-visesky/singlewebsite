'use strict';

function createStartupDebugRuntime(options = {}) {
  const {
    fs,
    logPath,
    os
  } = options;

  function append(message, details) {
    try {
      const suffix = details === undefined ? '' : ` ${JSON.stringify(details)}`;
      fs.appendFileSync(
        logPath,
        `[${new Date().toISOString()}] ${message}${suffix}${os.EOL}`,
        'utf8'
      );
    } catch {
      // Ignore startup debug logging failures.
    }
  }

  return {
    append
  };
}

module.exports = {
  createStartupDebugRuntime
};
