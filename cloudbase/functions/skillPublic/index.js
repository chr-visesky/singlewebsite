'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SKILL_SLUG = 'study-helper';
const SKILL_DISPLAY_NAME = '学习助手';
const SKILL_VERSION = '1.2.6';
const SKILL_FILE_NAME = 'study-helper.zip';
const SKILL_DOWNLOAD_TOKEN = (process.env.SKILL_DOWNLOAD_TOKEN || '').trim();
const SKILL_PUBLIC_PATH = (process.env.SKILL_PUBLIC_PATH || '/api/skill').trim() || '/api/skill';
const SKILL_RELATIVE_PATH = path.join('assets', SKILL_FILE_NAME);
const SKILL_FULL_PATH = path.join(__dirname, SKILL_RELATIVE_PATH);
const SKILL_HOMEPAGE = 'https://github.com/chr-visesky/singlewebsite/tree/main/skills/study-helper';
const SKILL_SOURCE = 'https://github.com/chr-visesky/singlewebsite';

function normalizePrefix(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function responseHeaders(extraHeaders = {}) {
  return {
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
    ...extraHeaders
  };
}

function jsonResponse(statusCode, payload, extraHeaders = {}) {
  return {
    statusCode,
    headers: responseHeaders({
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders
    }),
    body: JSON.stringify(payload)
  };
}

function emptyResponse(statusCode, extraHeaders = {}) {
  return {
    statusCode,
    headers: responseHeaders(extraHeaders),
    body: ''
  };
}

function bearerToken(headers = {}) {
  const raw = normalizePrefix(headers.authorization || headers.Authorization);

  if (!raw.toLowerCase().startsWith('bearer ')) {
    return '';
  }

  return normalizePrefix(raw.slice(7));
}

function parseQueryString(rawQueryString) {
  const result = {};
  const query = normalizePrefix(rawQueryString);

  if (!query) {
    return result;
  }

  for (const segment of query.split('&')) {
    if (!segment) {
      continue;
    }

    const [rawKey, rawValue = ''] = segment.split('=');
    const key = normalizePrefix(decodeURIComponent(rawKey || ''));

    if (!key) {
      continue;
    }

    result[key] = normalizePrefix(decodeURIComponent(rawValue || ''));
  }

  return result;
}

function queryValue(event = {}, key) {
  const direct = event.queryStringParameters && event.queryStringParameters[key];

  if (direct !== undefined && direct !== null) {
    return normalizePrefix(String(direct));
  }

  return normalizePrefix(parseQueryString(event.queryString)[key]);
}

function requestPath(event = {}) {
  return normalizePrefix(event.path || event.requestContext && event.requestContext.path || '/');
}

function normalizeHttpPath(value) {
  const normalized = normalizePrefix(value);

  if (!normalized) {
    return '/';
  }

  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function requestProto(headers = {}) {
  const forwardedProto = normalizePrefix(headers['x-forwarded-proto'] || headers['X-Forwarded-Proto']);
  return forwardedProto || 'https';
}

function requestHost(headers = {}) {
  return normalizePrefix(headers.host || headers.Host);
}

function buildDownloadUrl(event = {}) {
  const host = requestHost(event.headers || {});
  const incomingPath = normalizeHttpPath(requestPath(event));
  const pathName = incomingPath === '/' ? normalizeHttpPath(SKILL_PUBLIC_PATH) : incomingPath;

  if (!host || !pathName) {
    return '';
  }

  return `${requestProto(event.headers || {})}://${host}${pathName}?action=download`;
}

let cachedAsset = null;

function readSkillAsset() {
  if (cachedAsset) {
    return cachedAsset;
  }

  const buffer = fs.readFileSync(SKILL_FULL_PATH);
  cachedAsset = {
    buffer,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    sizeBytes: buffer.length
  };
  return cachedAsset;
}

function requireDownloadAuth(headers = {}) {
  if (!SKILL_DOWNLOAD_TOKEN) {
    return true;
  }

  return bearerToken(headers) === SKILL_DOWNLOAD_TOKEN;
}

function metadataPayload(event = {}) {
  const asset = readSkillAsset();
  const downloadUrl = buildDownloadUrl(event);

  return {
    ok: true,
    skill: {
      slug: SKILL_SLUG,
      displayName: SKILL_DISPLAY_NAME,
      version: SKILL_VERSION,
      fileName: SKILL_FILE_NAME,
      sizeBytes: asset.sizeBytes,
      sha256: asset.sha256,
      homepage: SKILL_HOMEPAGE,
      source: SKILL_SOURCE,
      downloadUrl,
      downloadQuery: '?action=download',
      requiresToken: Boolean(SKILL_DOWNLOAD_TOKEN),
      commands: [
        '申请授权',
        '授权状态',
        '读取计划',
        '创建计划',
        '修改计划',
        '删除计划',
        '计划状态',
        '创建作业',
        '批量创建作业',
        '查询作业',
        '作业状态'
      ]
    }
  };
}

exports.main = async (event = {}) => {
  const method = normalizePrefix(event.httpMethod || 'GET').toUpperCase();

  if (method === 'OPTIONS') {
    return emptyResponse(204);
  }

  if (method !== 'GET') {
    return jsonResponse(405, {
      error: 'method_not_allowed'
    });
  }

  if (!requireDownloadAuth(event.headers || {})) {
    return jsonResponse(403, {
      error: 'forbidden'
    });
  }

  const action = normalizePrefix(queryValue(event, 'action')).toLowerCase();

  if (action === 'download') {
    const asset = readSkillAsset();

    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: responseHeaders({
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${SKILL_FILE_NAME}"`,
        'Content-Length': String(asset.sizeBytes),
        ETag: asset.sha256
      }),
      body: asset.buffer.toString('base64')
    };
  }

  return jsonResponse(200, metadataPayload(event));
};
