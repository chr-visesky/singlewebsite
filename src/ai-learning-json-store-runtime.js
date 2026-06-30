'use strict';

function createAiLearningJsonStoreRuntime(dependencies = {}) {
  const {
    fs,
    pathModule
  } = dependencies;

  if (!fs) {
    throw new Error('ai-learning json store requires fs.');
  }

  const path = pathModule || require('path');

  function ensureDirectoryForFile(filePath) {
    const directoryPath = path.dirname(filePath);

    if (directoryPath && !fs.existsSync(directoryPath)) {
      fs.mkdirSync(directoryPath, { recursive: true });
    }
  }

  function brokenFilePath(filePath) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `${filePath}.broken-${timestamp}.json`;
  }

  function readJsonFile(filePath, fallback) {
    if (!filePath || !fs.existsSync(filePath)) {
      return typeof fallback === 'function' ? fallback() : fallback;
    }

    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
    } catch {
      try {
        fs.renameSync(filePath, brokenFilePath(filePath));
      } catch {
        // If quarantine fails, still return fallback so startup is not blocked by runtime state.
      }

      return typeof fallback === 'function' ? fallback() : fallback;
    }
  }

  function writeJsonFileAtomic(filePath, payload) {
    ensureDirectoryForFile(filePath);

    const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;

    try {
      fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), 'utf8');
      fs.renameSync(tempPath, filePath);
    } catch (error) {
      try {
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      } catch {
        // Best effort cleanup.
      }

      throw error;
    }
  }

  function updateJsonFile(filePath, updater, fallback) {
    const current = readJsonFile(filePath, fallback);
    const next = updater(current);
    writeJsonFileAtomic(filePath, next);
    return next;
  }

  function appendJsonArrayItem(filePath, item) {
    return updateJsonFile(
      filePath,
      (items) => {
        const list = Array.isArray(items) ? items : [];
        return [...list, item];
      },
      []
    );
  }

  return {
    appendJsonArrayItem,
    readJsonFile,
    updateJsonFile,
    writeJsonFileAtomic
  };
}

module.exports = {
  createAiLearningJsonStoreRuntime
};
