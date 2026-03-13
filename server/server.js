'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { URL } = require('url');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'server-data');
const CONFIG_PATH = path.join(DATA_DIR, 'server-config.json');
const SCHEDULE_PATH = path.join(DATA_DIR, 'schedule.json');
const ADMIN_PAGE_PATH = path.join(__dirname, 'admin.html');
const DEFAULT_PORT = 8787;
const WEEKDAY_ALIASES = new Map([
  ['1', 1],
  ['mon', 1],
  ['monday', 1],
  ['周一', 1],
  ['星期一', 1],
  ['2', 2],
  ['tue', 2],
  ['tues', 2],
  ['tuesday', 2],
  ['周二', 2],
  ['星期二', 2],
  ['3', 3],
  ['wed', 3],
  ['wednesday', 3],
  ['周三', 3],
  ['星期三', 3],
  ['4', 4],
  ['thu', 4],
  ['thur', 4],
  ['thurs', 4],
  ['thursday', 4],
  ['周四', 4],
  ['星期四', 4],
  ['5', 5],
  ['fri', 5],
  ['friday', 5],
  ['周五', 5],
  ['星期五', 5],
  ['6', 6],
  ['sat', 6],
  ['saturday', 6],
  ['周六', 6],
  ['星期六', 6],
  ['0', 7],
  ['7', 7],
  ['sun', 7],
  ['sunday', 7],
  ['周日', 7],
  ['周天', 7],
  ['星期日', 7],
  ['星期天', 7]
]);

function normalizePrefix(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeLibraryId(value, fallback) {
  const normalized = normalizePrefix(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || fallback;
}

function normalizeClockTime(value, fallback) {
  const normalized = normalizePrefix(value);
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(normalized) ? normalized : fallback;
}

function normalizeWeekdays(rawValue) {
  const source = Array.isArray(rawValue) ? rawValue : [rawValue];
  const days = new Set();

  for (const item of source) {
    const normalized = normalizePrefix(String(item || '')).toLowerCase();
    const weekday = WEEKDAY_ALIASES.get(normalized);

    if (weekday) {
      days.add(weekday);
    }
  }

  return [...days].sort((left, right) => left - right);
}

function normalizeTargetId(value) {
  const normalized = normalizeLibraryId(value, '');

  if (!normalized) {
    return '';
  }

  if (['course', 'english', 'english-course', 'start-url', 'starturl'].includes(normalized)) {
    return 'english-course';
  }

  return normalized;
}

function normalizeSchedule(rawItems) {
  if (!Array.isArray(rawItems)) {
    return [];
  }

  const items = [];
  const seenIds = new Set();

  for (let index = 0; index < rawItems.length; index += 1) {
    const item = rawItems[index] || {};
    const id = normalizeLibraryId(item.id, `schedule-${index + 1}`);

    if (seenIds.has(id)) {
      continue;
    }

    const title = normalizePrefix(item.title);
    const weekdays = normalizeWeekdays(item.weekdays || item.days);

    if (!title || !weekdays.length) {
      continue;
    }

    seenIds.add(id);
    items.push({
      id,
      enabled: item.enabled !== false,
      title,
      target: normalizeTargetId(item.target || item.targetId),
      time: normalizeClockTime(item.time, '19:00'),
      weekdays,
      message: normalizePrefix(item.message)
    });
  }

  return items;
}

function randomToken() {
  return crypto.randomBytes(18).toString('hex');
}

function defaultConfig() {
  return {
    host: '0.0.0.0',
    port: DEFAULT_PORT,
    publicBaseUrl: '',
    readToken: randomToken(),
    adminToken: randomToken()
  };
}

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}${os.EOL}`, 'utf8');
}

function ensureServerConfig() {
  ensureDataDir();
  const current = readJson(CONFIG_PATH, null);

  if (current && typeof current === 'object') {
    const nextConfig = {
      host: normalizePrefix(current.host) || '0.0.0.0',
      port: Number.isFinite(Number(current.port)) ? Number(current.port) : DEFAULT_PORT,
      publicBaseUrl: normalizePrefix(current.publicBaseUrl),
      readToken: normalizePrefix(current.readToken) || randomToken(),
      adminToken: normalizePrefix(current.adminToken) || randomToken()
    };

    writeJson(CONFIG_PATH, nextConfig);
    return nextConfig;
  }

  const created = defaultConfig();
  writeJson(CONFIG_PATH, created);
  return created;
}

function ensureScheduleFile() {
  ensureDataDir();
  const current = readJson(SCHEDULE_PATH, null);

  if (current && typeof current === 'object' && Array.isArray(current.items)) {
    const nextState = {
      updatedAt: normalizePrefix(current.updatedAt) || new Date().toISOString(),
      items: normalizeSchedule(current.items)
    };
    writeJson(SCHEDULE_PATH, nextState);
    return nextState;
  }

  const created = {
    updatedAt: new Date().toISOString(),
    items: []
  };
  writeJson(SCHEDULE_PATH, created);
  return created;
}

function loadState() {
  return readJson(SCHEDULE_PATH, {
    updatedAt: '',
    items: []
  });
}

function saveState(rawItems) {
  const nextState = {
    updatedAt: new Date().toISOString(),
    items: normalizeSchedule(rawItems)
  };
  writeJson(SCHEDULE_PATH, nextState);
  return nextState;
}

function send(response, statusCode, headers, body) {
  response.writeHead(statusCode, headers);
  response.end(body);
}

function sendJson(response, statusCode, payload) {
  send(
    response,
    statusCode,
    {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*'
    },
    JSON.stringify(payload)
  );
}

function sendHtml(response, statusCode, html) {
  send(
    response,
    statusCode,
    {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    },
    html
  );
}

function sendText(response, statusCode, text) {
  send(
    response,
    statusCode,
    {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store'
    },
    text
  );
}

function readRequestText(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    request.on('data', (chunk) => {
      chunks.push(Buffer.from(chunk));
    });
    request.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    request.on('error', reject);
  });
}

function bearerToken(request) {
  const rawHeader = normalizePrefix(request.headers.authorization);

  if (!rawHeader.toLowerCase().startsWith('bearer ')) {
    return '';
  }

  return normalizePrefix(rawHeader.slice(7));
}

function canRead(request, requestUrl, config) {
  const token = bearerToken(request) || normalizePrefix(requestUrl.searchParams.get('token'));
  return token === config.readToken || token === config.adminToken;
}

function canWrite(request, requestUrl, config) {
  const token = bearerToken(request) || normalizePrefix(requestUrl.searchParams.get('token'));
  return token === config.adminToken;
}

function localBaseUrls(config, addressInfo) {
  const urls = [];
  const hostPort = `http://127.0.0.1:${addressInfo.port}`;
  urls.push(hostPort);

  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (!entry || entry.internal || entry.family !== 'IPv4') {
        continue;
      }

      urls.push(`http://${entry.address}:${addressInfo.port}`);
    }
  }

  if (config.publicBaseUrl) {
    urls.unshift(config.publicBaseUrl.replace(/\/+$/, ''));
  }

  return [...new Set(urls)];
}

function adminPage(config, state) {
  const template = fs.readFileSync(ADMIN_PAGE_PATH, 'utf8');
  const bootstrap = {
    apiPath: '/api/schedule',
    adminToken: config.adminToken,
    readToken: config.readToken,
    items: state.items,
    updatedAt: state.updatedAt
  };

  return template.replace(
    '__STUDYGATE_SERVER_BOOTSTRAP__',
    JSON.stringify(bootstrap).replace(/</g, '\\u003c')
  );
}

async function handleRequest(request, response, config) {
  const requestUrl = new URL(request.url, `http://${request.headers.host || '127.0.0.1'}`);

  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Max-Age': '86400'
    });
    response.end();
    return;
  }

  if (requestUrl.pathname === '/healthz') {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (requestUrl.pathname === '/api/schedule') {
    if (request.method === 'GET') {
      if (!canRead(request, requestUrl, config)) {
        sendJson(response, 403, { error: 'forbidden' });
        return;
      }

      sendJson(response, 200, loadState());
      return;
    }

    if (request.method === 'POST') {
      if (!canWrite(request, requestUrl, config)) {
        sendJson(response, 403, { error: 'forbidden' });
        return;
      }

      const bodyText = await readRequestText(request);
      let payload;

      try {
        payload = bodyText ? JSON.parse(bodyText) : {};
      } catch {
        sendJson(response, 400, { error: 'bad_json' });
        return;
      }

      const rawItems = Array.isArray(payload) ? payload : payload && Array.isArray(payload.items) ? payload.items : [];
      const nextState = saveState(rawItems);
      sendJson(response, 200, nextState);
      return;
    }

    sendJson(response, 405, { error: 'method_not_allowed' });
    return;
  }

  if (requestUrl.pathname === '/admin') {
    if (!canWrite(request, requestUrl, config)) {
      sendHtml(response, 403, '<h1>禁止访问</h1><p>请用正确的管理 token 打开这个页面。</p>');
      return;
    }

    sendHtml(response, 200, adminPage(config, loadState()));
    return;
  }

  if (requestUrl.pathname === '/') {
    sendText(response, 200, 'StudyGate schedule server is running.');
    return;
  }

  sendText(response, 404, 'Not Found');
}

async function main() {
  const config = ensureServerConfig();
  ensureScheduleFile();

  const server = http.createServer((request, response) => {
    void handleRequest(request, response, config).catch((error) => {
      sendJson(response, 500, {
        error: 'internal_error',
        message: error.message || 'Internal error'
      });
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, resolve);
  });

  const addressInfo = server.address();
  const baseUrls = localBaseUrls(config, addressInfo);

  process.stdout.write(`课表服务器已启动${os.EOL}`);
  process.stdout.write(`配置文件: ${CONFIG_PATH}${os.EOL}`);
  process.stdout.write(`课表数据: ${SCHEDULE_PATH}${os.EOL}`);
  process.stdout.write(`读课表 token: ${config.readToken}${os.EOL}`);
  process.stdout.write(`管理 token: ${config.adminToken}${os.EOL}`);
  process.stdout.write(os.EOL);
  process.stdout.write(`桌面程序 remoteSchedule.url:${os.EOL}`);
  process.stdout.write(`${baseUrls[0]}/api/schedule${os.EOL}`);
  process.stdout.write(`桌面程序 remoteSchedule.authToken:${os.EOL}`);
  process.stdout.write(`${config.readToken}${os.EOL}`);
  process.stdout.write(os.EOL);
  process.stdout.write(`手机管理地址:${os.EOL}`);

  for (const baseUrl of baseUrls) {
    process.stdout.write(`${baseUrl}/admin?token=${config.adminToken}${os.EOL}`);
  }

  const shutdown = () => {
    server.close(() => {
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}${os.EOL}`);
  process.exitCode = 1;
});
