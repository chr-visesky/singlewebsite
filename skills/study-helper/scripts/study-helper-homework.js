'use strict';

const fs = require('node:fs');
const path = require('node:path');

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeUrl(value) {
  const raw = normalizeText(value);

  if (!raw) {
    return '';
  }

  try {
    return new URL(raw).href;
  } catch {
    return '';
  }
}

function extensionFromPathLike(value) {
  const matched = String(value || '').trim().toLowerCase().match(/\.([a-z0-9]{2,5})$/i);
  return matched ? `.${matched[1]}` : '';
}

function fileKindFromExtension(extension) {
  const normalized = String(extension || '').trim().toLowerCase();

  if (normalized === '.pdf') {
    return 'pdf';
  }

  if (['.jpg', '.jpeg', '.png', '.bmp', '.gif', '.webp'].includes(normalized)) {
    return 'image';
  }

  return '';
}

function contentTypeFromExtension(extension) {
  const normalized = String(extension || '').trim().toLowerCase();

  if (normalized === '.pdf') {
    return 'application/pdf';
  }

  if (normalized === '.jpg' || normalized === '.jpeg') {
    return 'image/jpeg';
  }

  if (normalized === '.png') {
    return 'image/png';
  }

  if (normalized === '.bmp') {
    return 'image/bmp';
  }

  if (normalized === '.gif') {
    return 'image/gif';
  }

  if (normalized === '.webp') {
    return 'image/webp';
  }

  return '';
}

function fileKindFromUrl(url) {
  try {
    const pathname = new URL(url).pathname.toLowerCase();

    if (pathname.endsWith('.pdf')) {
      return 'pdf';
    }

    if (/\.(jpg|jpeg|png|bmp|gif)$/i.test(pathname)) {
      return 'image';
    }
  } catch {
    return '';
  }

  return '';
}

function fileKindFromInlineSource(source) {
  const item = source && typeof source === 'object' ? source : {};
  const contentType = normalizeText(item.contentType || item.mimeType).toLowerCase();

  if (contentType.includes('pdf')) {
    return 'pdf';
  }

  if (contentType.startsWith('image/')) {
    return 'image';
  }

  const base64Text = normalizeText(item.base64 || item.data || item.content);
  const dataUrlMatch = base64Text.match(/^data:([^;,]+);base64,/i);

  if (dataUrlMatch) {
    const dataUrlContentType = normalizeText(dataUrlMatch[1]).toLowerCase();

    if (dataUrlContentType.includes('pdf')) {
      return 'pdf';
    }

    if (dataUrlContentType.startsWith('image/')) {
      return 'image';
    }
  }

  return fileKindFromExtension(extensionFromPathLike(item.fileName || item.name));
}

function normalizeHomeworkSourceUrls(sourceUrls) {
  const items = Array.isArray(sourceUrls) ? sourceUrls : [];
  const seen = new Set();
  const normalized = [];

  for (const item of items) {
    const url = normalizeUrl(item);

    if (!url || seen.has(url)) {
      continue;
    }

    seen.add(url);
    normalized.push(url);
  }

  return normalized;
}

function validateHomeworkSources(sourceUrls, inlineSources) {
  const kinds = [
    ...sourceUrls.map(fileKindFromUrl).filter(Boolean),
    ...inlineSources.map(fileKindFromInlineSource).filter(Boolean)
  ];
  const pdfCount = kinds.filter((kind) => kind === 'pdf').length;
  const imageCount = kinds.filter((kind) => kind === 'image').length;

  if (pdfCount > 1) {
    throw new Error('一次作业请求只允许 1 个 PDF。');
  }

  if (pdfCount > 0 && imageCount > 0) {
    throw new Error('一次作业请求里不能混用 PDF 和图片。');
  }
}

async function inlineSourcesFromLocalFiles(sourceFiles) {
  const items = Array.isArray(sourceFiles) ? sourceFiles : [];
  const normalized = [];

  for (const rawItem of items) {
    const item = rawItem && typeof rawItem === 'object' ? rawItem : {
      path: rawItem
    };
    const filePath = normalizeText(item.path || item.filePath);

    if (!filePath) {
      continue;
    }

    const absolutePath = path.resolve(filePath);
    const stat = await fs.promises.stat(absolutePath);

    if (!stat.isFile()) {
      throw new Error(`作业源文件不是普通文件：${absolutePath}`);
    }

    const extension = extensionFromPathLike(item.fileName || absolutePath);
    const fileKind = fileKindFromExtension(extension);

    if (!fileKind) {
      throw new Error(`作业源文件只支持 PDF 或图片：${absolutePath}`);
    }

    const buffer = await fs.promises.readFile(absolutePath);

    normalized.push({
      fileName: normalizeText(item.fileName || item.name) || path.basename(absolutePath),
      contentType: normalizeText(item.contentType || item.mimeType) || contentTypeFromExtension(extension),
      base64: buffer.toString('base64')
    });
  }

  return normalized;
}

function normalizeInlineSourcesPayload(inlineSources) {
  const source = Array.isArray(inlineSources) ? inlineSources : [];
  const normalized = [];

  for (const rawItem of source) {
    const item = rawItem && typeof rawItem === 'object' ? rawItem : {};
    const base64 = normalizeText(item.base64 || item.data || item.content);

    if (!base64) {
      continue;
    }

    normalized.push({
      fileName: normalizeText(item.fileName || item.name) || 'source',
      contentType: normalizeText(item.contentType || item.mimeType),
      base64
    });
  }

  return normalized;
}

function normalizeSourceItemsPayload(sourceItems) {
  const items = Array.isArray(sourceItems) ? sourceItems : [];
  const normalized = [];

  for (const rawItem of items) {
    const item = rawItem && typeof rawItem === 'object' ? rawItem : {};
    const sourceType = normalizeText(item.sourceType || item.kind || item.type).toLowerCase() === 'storage'
      ? 'storage'
      : 'url';
    const normalizedItem = {
      sourceType,
      fileId: normalizeText(item.fileId || item.fileID),
      cloudPath: normalizeText(item.cloudPath),
      url: normalizeUrl(item.url || item.sourceUrl || item.href),
      fileName: normalizeText(item.fileName || item.name) || 'source',
      contentType: normalizeText(item.contentType || item.mimeType),
      fileKind: normalizeText(item.fileKind),
      size: Math.max(0, Number(item.size) || 0)
    };

    if (normalizedItem.sourceType === 'storage') {
      if (!normalizedItem.fileId && !normalizedItem.cloudPath) {
        continue;
      }
    } else if (!normalizedItem.url) {
      continue;
    }

    normalized.push(normalizedItem);
  }

  return normalized;
}

function buildStatusPayload(requestIdOption, payload) {
  const nextPayload = payload && typeof payload === 'object' ? payload : {};
  const requestIds = Array.isArray(nextPayload.requestIds)
    ? nextPayload.requestIds.filter((item) => normalizeText(item))
    : Array.isArray(nextPayload.ids)
      ? nextPayload.ids.filter((item) => normalizeText(item))
      : [];

  if (requestIds.length) {
    return {
      action: 'getAgentHomeworkRequestStatuses',
      requestIds
    };
  }

  const normalizedId = normalizeText(requestIdOption || nextPayload.requestId || nextPayload.id);

  if (!normalizedId) {
    throw new Error('状态查询必须提供 requestId。');
  }

  return {
    action: 'getAgentHomeworkRequestStatus',
    requestId: normalizedId
  };
}

async function uploadHomeworkSources(invokeJsonRequest, endpoint, token, timeoutMs, payload) {
  const response = await invokeJsonRequest(
    endpoint,
    token,
    'POST',
    {
      action: 'uploadAgentHomeworkSources',
      requestId: payload.requestId,
      sourceUrls: payload.sourceUrls,
      inlineSources: payload.inlineSources
    },
    timeoutMs
  );

  return normalizeSourceItemsPayload(response && response.sourceItems);
}

async function buildHomeworkCreateRequest(invokeJsonRequest, endpoint, token, timeoutMs, payload, makeRequestId, index = 0) {
  const nextPayload = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const {
    sourceFiles: _sourceFiles,
    inlineSources: _rawInlineSources,
    sourceUrls: _rawSourceUrls,
    sourceItems: _rawSourceItems,
    requests: _rawRequests,
    items: _rawItems,
    ...requestBody
  } = nextPayload;
  const sourceUrls = normalizeHomeworkSourceUrls(nextPayload.sourceUrls);
  const inlineSources = [
    ...normalizeInlineSourcesPayload(nextPayload.inlineSources),
    ...await inlineSourcesFromLocalFiles(nextPayload.sourceFiles)
  ];
  validateHomeworkSources(sourceUrls, inlineSources);
  const requestId = normalizeText(nextPayload.requestId) || makeRequestId(`openclaw-homework-${index + 1}`);
  let sourceItems = normalizeSourceItemsPayload(nextPayload.sourceItems);

  if (!sourceItems.length && inlineSources.length) {
    sourceItems = await uploadHomeworkSources(
      invokeJsonRequest,
      endpoint,
      token,
      timeoutMs,
      {
        requestId,
        sourceUrls,
        inlineSources
      }
    );
  }

  return {
    ...requestBody,
    requestId,
    agentId: normalizeText(nextPayload.agentId) || 'openclaw',
    label: normalizeText(nextPayload.label) || 'OpenClaw',
    sourceUrls,
    sourceItems
  };
}

async function buildHomeworkCreatePayload(invokeJsonRequest, endpoint, token, timeoutMs, payload, makeRequestId) {
  const nextPayload = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const requests = Array.isArray(nextPayload.requests)
    ? nextPayload.requests
    : Array.isArray(nextPayload.items)
      ? nextPayload.items
      : null;

  if (requests) {
    return {
      action: 'submitAgentHomeworkRequests',
      requests: await Promise.all(
        requests.map((item, index) =>
          buildHomeworkCreateRequest(invokeJsonRequest, endpoint, token, timeoutMs, item, makeRequestId, index)
        )
      )
    };
  }

  return {
    action: 'submitAgentHomeworkRequest',
    ...(await buildHomeworkCreateRequest(invokeJsonRequest, endpoint, token, timeoutMs, nextPayload, makeRequestId))
  };
}

function buildHomeworkQueryPayload(payload) {
  const nextPayload = payload && typeof payload === 'object' ? payload : {};
  const query = {
    action: 'queryAgentHomeworkRequests'
  };

  if (normalizeText(nextPayload.targetDate)) {
    query.targetDate = normalizeText(nextPayload.targetDate);
  }

  if (Array.isArray(nextPayload.targetDates)) {
    query.targetDates = nextPayload.targetDates.filter((item) => normalizeText(item));
  } else if (Array.isArray(nextPayload.dates)) {
    query.targetDates = nextPayload.dates.filter((item) => normalizeText(item));
  }

  if (normalizeText(nextPayload.subject)) {
    query.subject = normalizeText(nextPayload.subject);
  }

  if (Array.isArray(nextPayload.subjects)) {
    query.subjects = nextPayload.subjects.filter((item) => normalizeText(item));
  }

  if (normalizeText(nextPayload.bucket)) {
    query.bucket = normalizeText(nextPayload.bucket);
  }

  if (normalizeText(nextPayload.status)) {
    query.status = normalizeText(nextPayload.status);
  }

  if (Array.isArray(nextPayload.statuses)) {
    query.statuses = nextPayload.statuses.filter((item) => normalizeText(item));
  }

  if (Number.isFinite(Number(nextPayload.limit))) {
    query.limit = Number(nextPayload.limit);
  }

  return query;
}

function buildHomeworkStatusPayload(payload, requestIdOption) {
  return buildStatusPayload(requestIdOption, payload);
}

module.exports = {
  buildHomeworkCreatePayload,
  buildHomeworkQueryPayload,
  buildHomeworkStatusPayload
};
