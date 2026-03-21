'use strict';

function normalizePrefix(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeFileName(value, fallback) {
  return (String(value || '').trim().replace(/[\\/:*?"<>|]+/g, '-') || fallback || 'source').slice(0, 120);
}

function extensionFromFileName(value) {
  const fileName = String(value || '').trim().toLowerCase();
  const matched = fileName.match(/\.([a-z0-9]{2,5})$/i);
  return matched ? `.${matched[1]}` : '';
}

function extensionFromContentType(value) {
  const normalized = normalizePrefix(value).toLowerCase();

  if (normalized.includes('pdf')) {
    return '.pdf';
  }

  if (normalized.includes('jpeg') || normalized.includes('jpg')) {
    return '.jpg';
  }

  if (normalized.includes('png')) {
    return '.png';
  }

  if (normalized.includes('bmp')) {
    return '.bmp';
  }

  if (normalized.includes('gif')) {
    return '.gif';
  }

  if (normalized.includes('webp')) {
    return '.webp';
  }

  return '';
}

function fileKindFromExtension(value) {
  const normalized = String(value || '').trim().toLowerCase();

  if (normalized === '.pdf') {
    return 'pdf';
  }

  if (['.jpg', '.jpeg', '.png', '.bmp', '.gif', '.webp'].includes(normalized)) {
    return 'image';
  }

  return '';
}

function chunk(items, size) {
  const groups = [];

  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }

  return groups;
}

function createAgentHomeworkSourceStore(options = {}) {
  const {
    cloud,
    storagePrefix = 'studygate-agent-homework'
  } = options;

  async function saveInlineSources(requestId, inlineSources = []) {
    const source = Array.isArray(inlineSources) ? inlineSources : [];
    const storedItems = [];

    for (let index = 0; index < source.length; index += 1) {
      const item = source[index] || {};
      const fileName = normalizeFileName(item.fileName, `source-${index + 1}`);
      const extension = extensionFromFileName(fileName) || extensionFromContentType(item.contentType);
      const cloudPath = `${storagePrefix}/${requestId}/${String(index + 1).padStart(2, '0')}-${fileName}${extension && !fileName.toLowerCase().endsWith(extension) ? extension : ''}`;
      const uploadResult = await cloud.uploadFile({
        cloudPath,
        fileContent: item.buffer
      });
      const fileId = normalizePrefix(uploadResult && (uploadResult.fileID || uploadResult.fileId));

      storedItems.push({
        sourceType: 'storage',
        fileId,
        cloudPath,
        fileName,
        contentType: normalizePrefix(item.contentType).toLowerCase(),
        fileKind: item.fileKind || fileKindFromExtension(extension),
        size: item.buffer ? item.buffer.length : 0
      });
    }

    return storedItems;
  }

  async function resolveSourceUrls(sourceItems = []) {
    const items = Array.isArray(sourceItems) ? sourceItems : [];
    const storageItems = items.filter((item) => item && item.fileId);

    if (!storageItems.length) {
      return [];
    }

    const urlMap = new Map();

    for (const itemGroup of chunk(storageItems, 50)) {
      const response = await cloud.getTempFileURL({
        fileList: itemGroup.map((item) => item.fileId)
      });
      const fileList = Array.isArray(response && response.fileList) ? response.fileList : [];

      for (const fileInfo of fileList) {
        const fileId = normalizePrefix(fileInfo && (fileInfo.fileID || fileInfo.fileId));
        const tempUrl = normalizePrefix(fileInfo && (fileInfo.tempFileURL || fileInfo.tempFileUrl));

        if (fileId && tempUrl) {
          urlMap.set(fileId, tempUrl);
        }
      }
    }

    return storageItems
      .map((item) => urlMap.get(item.fileId) || '')
      .filter(Boolean);
  }

  async function deleteStoredSources(sourceItems = []) {
    const items = Array.isArray(sourceItems) ? sourceItems : [];
    const fileIds = [];
    const seen = new Set();

    for (const item of items) {
      const fileId = normalizePrefix(item && item.fileId);

      if (!fileId || seen.has(fileId)) {
        continue;
      }

      seen.add(fileId);
      fileIds.push(fileId);
    }

    if (!fileIds.length) {
      return [];
    }

    const deleted = [];

    for (const itemGroup of chunk(fileIds, 50)) {
      const response = await cloud.deleteFile({
        fileList: itemGroup
      });
      const fileList = Array.isArray(response && response.fileList) ? response.fileList : [];

      for (const fileInfo of fileList) {
        const fileId = normalizePrefix(fileInfo && (fileInfo.fileID || fileInfo.fileId));
        const code = normalizePrefix(fileInfo && fileInfo.code).toUpperCase();

        if (fileId && code === 'SUCCESS') {
          deleted.push(fileId);
        }
      }
    }

    return deleted;
  }

  return {
    deleteStoredSources,
    resolveSourceUrls,
    saveInlineSources
  };
}

module.exports = {
  createAgentHomeworkSourceStore
};
