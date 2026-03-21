'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  buildScheduleCreatePayload,
  buildScheduleDeletePayload,
  buildScheduleUpdatePayload
} = require('./study-helper-schedule');

function canonicalizeCommand(command) {
  const normalized = String(command || '').trim();
  const commandMap = {
    '申请授权': 'agent-access-request',
    '授权状态': 'agent-access-status',
    '查询授权状态': 'agent-access-status',
    '清除授权': 'agent-access-clear',
    '读取计划': 'schedule-read',
    '创建计划': 'schedule-create',
    '新增计划': 'schedule-create',
    '添加计划': 'schedule-create',
    '修改计划': 'schedule-update',
    '更新计划': 'schedule-update',
    '删除计划': 'schedule-delete',
    '提交计划': 'schedule-submit-disabled',
    '计划状态': 'schedule-status',
    '查询计划状态': 'schedule-status',
    '创建作业': 'homework-create',
    '作业状态': 'homework-status',
    '查询作业状态': 'homework-status'
  };

  return commandMap[normalized] || normalized;
}

function canonicalizeOptionKey(key) {
  const optionMap = {
    '载荷文件': 'payload-file',
    '请求编号': 'request-id',
    '地址': 'url',
    '令牌': 'token',
    '标准输入': 'stdin',
    '超时毫秒': 'timeout-ms',
    '帮助': 'help'
  };

  return optionMap[key] || key;
}

function printHelp() {
  process.stdout.write(`学习助手命令行

Usage:
  node ./scripts/study-helper.js 申请授权
  node ./scripts/study-helper.js 授权状态
  node ./scripts/study-helper.js 清除授权
  node ./scripts/study-helper.js 读取计划
  node ./scripts/study-helper.js 创建计划 --载荷文件 <文件>
  node ./scripts/study-helper.js 修改计划 --载荷文件 <文件>
  node ./scripts/study-helper.js 删除计划 --载荷文件 <文件>
  node ./scripts/study-helper.js 计划状态 --请求编号 <编号>
  node ./scripts/study-helper.js 创建作业 --载荷文件 <文件>
  node ./scripts/study-helper.js 作业状态 --请求编号 <编号>

参数:
  --载荷文件 <文件>  从文件读取 JSON 请求体
  --请求编号 <编号>  状态查询使用的 requestId
  --地址 <地址>      覆盖默认接口地址
  --令牌 <令牌>      覆盖默认 Bearer 令牌
  --标准输入         从标准输入读取 JSON 请求体
  --超时毫秒 <毫秒>  请求超时时间，默认 30000
  --帮助             显示帮助

作业创建载荷除了 sourceUrls，还支持：
  sourceFiles      本地 PDF 或图片文件路径数组
  inlineSources    直接内嵌 base64 的文件数组
`);
}

function parseArgs(argv) {
  const positional = [];
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (!value.startsWith('--')) {
      positional.push(canonicalizeCommand(value));
      continue;
    }

    const key = canonicalizeOptionKey(value.slice(2));

    if (key === 'stdin' || key === 'help') {
      options[key] = true;
      continue;
    }

    const nextValue = argv[index + 1];

    if (typeof nextValue !== 'string' || nextValue.startsWith('--')) {
      throw new Error(`缺少参数 --${key} 的值。`);
    }

    options[key] = nextValue;
    index += 1;
  }

  return {
    command: positional[0] || '',
    options
  };
}

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

function deriveApiUrl(rawUrl, pathname) {
  const normalized = normalizeUrl(rawUrl);

  if (!normalized) {
    return '';
  }

  try {
    const url = new URL(normalized);
    url.pathname = pathname;
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return '';
  }
}

function authStateFilePath() {
  return path.join(os.homedir(), '.openclaw', 'study-helper-auth.json');
}

function randomId(prefix) {
  return `${prefix}-${crypto.randomBytes(8).toString('hex')}`;
}

function defaultClientId() {
  const hostName = normalizeText(os.hostname()).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${hostName || 'openclaw'}-${crypto.randomBytes(4).toString('hex')}`;
}

function defaultAgentLabel() {
  const hostName = normalizeText(os.hostname());
  return hostName ? `学习助手 · ${hostName}` : '学习助手';
}

function normalizeAuthState(rawState) {
  const source = rawState && typeof rawState === 'object' ? rawState : {};
  return {
    clientId: normalizeText(source.clientId),
    label: normalizeText(source.label),
    requestId: normalizeText(source.requestId),
    claimSecret: normalizeText(source.claimSecret),
    token: normalizeText(source.token),
    status: normalizeText(source.status),
    accessUrl: normalizeUrl(source.accessUrl),
    updatedAt: normalizeText(source.updatedAt)
  };
}

async function readAuthState() {
  try {
    const text = await fs.promises.readFile(authStateFilePath(), 'utf8');
    return normalizeAuthState(parseJsonText(text, authStateFilePath()));
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return normalizeAuthState({});
    }

    throw error;
  }
}

async function writeAuthState(nextState) {
  const filePath = authStateFilePath();
  await fs.promises.mkdir(path.dirname(filePath), {
    recursive: true
  });
  await fs.promises.writeFile(
    filePath,
    `${JSON.stringify(normalizeAuthState(nextState), null, 2)}\n`,
    'utf8'
  );
}

async function clearAuthState() {
  try {
    await fs.promises.unlink(authStateFilePath());
  } catch (error) {
    if (!error || error.code !== 'ENOENT') {
      throw error;
    }
  }
}

function readStdinText() {
  return new Promise((resolve, reject) => {
    let chunks = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      chunks += chunk;
    });
    process.stdin.on('end', () => resolve(chunks));
    process.stdin.on('error', reject);
  });
}

async function readJsonPayload(options) {
  if (options.stdin) {
    const text = await readStdinText();
    return parseJsonText(text, 'stdin');
  }

  if (options['payload-file']) {
    const filePath = path.resolve(options['payload-file']);
    const text = await fs.promises.readFile(filePath, 'utf8');
    return parseJsonText(text, filePath);
  }

  return {};
}

function parseJsonText(text, sourceLabel) {
  try {
    return JSON.parse(String(text || ''));
  } catch (error) {
    throw new Error(`解析 ${sourceLabel} 的 JSON 失败：${error.message}`);
  }
}

function makeRequestId(prefix) {
  return `${prefix}-${Date.now()}`;
}

function resolveScheduleEndpoint(options = {}) {
  if (normalizeText(options.url)) {
    return normalizeUrl(options.url);
  }

  return normalizeUrl(process.env.STUDYGATE_SCHEDULE_PUBLIC_URL);
}

function resolveHomeworkEndpoint(options = {}) {
  if (normalizeText(options.url)) {
    return normalizeUrl(options.url);
  }

  return normalizeUrl(process.env.STUDYGATE_HOMEWORK_PUBLIC_URL) || deriveApiUrl(resolveScheduleEndpoint(options), '/api/homework');
}

function resolveAgentAccessEndpoint(options = {}) {
  if (normalizeText(options.url)) {
    return normalizeUrl(options.url);
  }

  return normalizeUrl(process.env.STUDYGATE_AGENT_ACCESS_URL)
    || deriveApiUrl(resolveScheduleEndpoint(options), '/api/agent-access')
    || deriveApiUrl(resolveHomeworkEndpoint(options), '/api/agent-access');
}

function resolveEndpoint(command, options) {
  if (command.startsWith('schedule-')) {
    return resolveScheduleEndpoint(options);
  }

  if (command.startsWith('homework-')) {
    return resolveHomeworkEndpoint(options);
  }

  if (command.startsWith('agent-access-')) {
    return resolveAgentAccessEndpoint(options);
  }

  return normalizeUrl(options.url);
}

function resolveConfiguredToken(command, options) {
  if (normalizeText(options.token)) {
    return normalizeText(options.token);
  }

  if (command.startsWith('schedule-')) {
    return normalizeText(
      process.env.STUDYGATE_SCHEDULE_AGENT_WRITE_TOKEN || process.env.STUDYGATE_AGENT_WRITE_TOKEN
    );
  }

  if (command.startsWith('homework-')) {
    return normalizeText(
      process.env.STUDYGATE_HOMEWORK_AGENT_WRITE_TOKEN || process.env.STUDYGATE_AGENT_WRITE_TOKEN
    );
  }

  return '';
}

function requestTimeoutMs(options) {
  const numeric = Number(options['timeout-ms']);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 30000;
}

function ensureObjectPayload(payload, command) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`${command} 需要一个 JSON 对象作为请求体。`);
  }

  return payload;
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

async function buildHomeworkCreateRequest(payload, index = 0) {
  const nextPayload = ensureObjectPayload(payload, 'homework-create');
  const sourceUrls = normalizeHomeworkSourceUrls(nextPayload.sourceUrls);
  const inlineSources = [
    ...normalizeInlineSourcesPayload(nextPayload.inlineSources),
    ...await inlineSourcesFromLocalFiles(nextPayload.sourceFiles)
  ];
  validateHomeworkSources(sourceUrls, inlineSources);

  return {
    ...nextPayload,
    requestId: normalizeText(nextPayload.requestId) || makeRequestId(`openclaw-homework-${index + 1}`),
    agentId: normalizeText(nextPayload.agentId) || 'openclaw',
    label: normalizeText(nextPayload.label) || 'OpenClaw',
    sourceUrls,
    inlineSources
  };
}

async function buildHomeworkCreatePayload(payload) {
  const nextPayload = ensureObjectPayload(payload, 'homework-create');
  const requests = Array.isArray(nextPayload.requests)
    ? nextPayload.requests
    : Array.isArray(nextPayload.items)
      ? nextPayload.items
      : null;

  if (requests) {
    return {
      action: 'submitAgentHomeworkRequests',
      requests: await Promise.all(requests.map((item, index) => buildHomeworkCreateRequest(item, index)))
    };
  }

  return {
    action: 'submitAgentHomeworkRequest',
    ...(await buildHomeworkCreateRequest(nextPayload))
  };
}

function buildStatusPayload(action, requestId) {
  const normalizedId = normalizeText(requestId);

  if (!normalizedId) {
    throw new Error('状态查询必须提供 requestId。');
  }

  return {
    action,
    requestId: normalizedId
  };
}

function buildHomeworkStatusPayload(payload, requestIdOption) {
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

  return buildStatusPayload(
    'getAgentHomeworkRequestStatus',
    requestIdOption || nextPayload.requestId || nextPayload.id
  );
}

async function invokeJsonRequest(url, token, method, payload, timeoutMs, options = {}) {
  if (!url) {
    throw new Error('缺少接口地址。请配置技能环境变量或传入 --地址。');
  }

  if (options.requireToken !== false && !token) {
    throw new Error('缺少 Bearer 令牌。请配置技能环境变量或传入 --令牌。');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {})
      },
      body: method === 'POST' ? JSON.stringify(payload) : undefined,
      signal: controller.signal
    });
    const text = await response.text();
    const data = text ? parseJsonText(text, `${method} ${url}`) : {};

    if (!response.ok) {
      const reason = normalizeText(data && data.error) || `HTTP ${response.status}`;
      throw new Error(reason);
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function requestAgentAccess(options, timeoutMs) {
  const currentState = await readAuthState();
  const requestId = currentState.requestId || randomId('openclaw-access');
  const claimSecret = currentState.claimSecret || crypto.randomBytes(24).toString('hex');
  const clientId = currentState.clientId || defaultClientId();
  const label = currentState.label || defaultAgentLabel();
  const accessUrl = resolveAgentAccessEndpoint(options);

  if (!accessUrl) {
    throw new Error('缺少智能体授权地址。请先配置 STUDYGATE_SCHEDULE_PUBLIC_URL 或 STUDYGATE_AGENT_ACCESS_URL。');
  }

  const result = await invokeJsonRequest(
    accessUrl,
    '',
    'POST',
    {
      action: 'requestAgentAccess',
      requestId,
      clientId,
      label,
      summary: `${label} 请求接入计划与作业接口`,
      claimSecret
    },
    timeoutMs,
    {
      requireToken: false
    }
  );

  await writeAuthState({
    ...currentState,
    clientId,
    label,
    requestId,
    claimSecret,
    status: normalizeText(result.status || result.request && result.request.status),
    accessUrl,
    token: normalizeText(result.grantedToken) || currentState.token,
    updatedAt: new Date().toISOString()
  });

  return result;
}

async function readAgentAccessStatus(options, timeoutMs) {
  const currentState = await readAuthState();

  if (!currentState.requestId || !currentState.claimSecret) {
    throw new Error('当前还没有智能体接入申请。先执行“申请授权”，或直接用任意学习助手命令让它自动申请。');
  }

  const accessUrl = currentState.accessUrl || resolveAgentAccessEndpoint(options);

  if (!accessUrl) {
    throw new Error('缺少智能体授权地址。请先配置 STUDYGATE_SCHEDULE_PUBLIC_URL 或 STUDYGATE_AGENT_ACCESS_URL。');
  }

  const result = await invokeJsonRequest(
    accessUrl,
    '',
    'POST',
    {
      action: 'getAgentAccessRequestStatus',
      requestId: currentState.requestId,
      claimSecret: currentState.claimSecret
    },
    timeoutMs,
    {
      requireToken: false
    }
  );

  await writeAuthState({
    ...currentState,
    status: normalizeText(result.status || result.request && result.request.status),
    accessUrl,
    token: normalizeText(result.grantedToken) || currentState.token,
    updatedAt: new Date().toISOString()
  });

  return result;
}

async function ensureAgentToken(command, options, timeoutMs) {
  const configuredToken = resolveConfiguredToken(command, options);

  if (configuredToken) {
    return configuredToken;
  }

  const currentState = await readAuthState();

  if (currentState.token) {
    return currentState.token;
  }

  if (currentState.requestId && currentState.claimSecret) {
    const statusResult = await readAgentAccessStatus(options, timeoutMs);
    const status = normalizeText(statusResult.status || statusResult.request && statusResult.request.status);

    if (normalizeText(statusResult.grantedToken)) {
      return normalizeText(statusResult.grantedToken);
    }

    if (status === 'pending') {
      throw new Error(`已自动提交学习助手接入申请，等待你在小程序系统管理里批准。申请编号：${currentState.requestId}`);
    }

    if (status === 'rejected') {
      await clearAuthState();
    }
  }

  const requestResult = await requestAgentAccess(options, timeoutMs);
  const nextStatus = normalizeText(requestResult.status || requestResult.request && requestResult.request.status);

  if (normalizeText(requestResult.grantedToken)) {
    return normalizeText(requestResult.grantedToken);
  }

  if (nextStatus === 'pending') {
    const nextState = await readAuthState();
    throw new Error(`已自动提交学习助手接入申请，等待你在小程序系统管理里批准。申请编号：${nextState.requestId}`);
  }

  throw new Error('学习助手授权尚未就绪。');
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));

  if (!command || options.help) {
    printHelp();
    return;
  }

  const endpoint = resolveEndpoint(command, options);
  const timeoutMs = requestTimeoutMs(options);
  const payload = await readJsonPayload(options);
  const token = command.startsWith('schedule-') || command.startsWith('homework-')
    ? await ensureAgentToken(command, options, timeoutMs)
    : '';
  let result;

  switch (command) {
    case 'agent-access-request':
      result = await requestAgentAccess(options, timeoutMs);
      break;
    case 'agent-access-status':
      result = await readAgentAccessStatus(options, timeoutMs);
      break;
    case 'agent-access-clear':
      await clearAuthState();
      result = {
        ok: true,
        cleared: true
      };
      break;
    case 'schedule-read':
      result = await invokeJsonRequest(endpoint, token, 'GET', null, timeoutMs);
      break;
    case 'schedule-create':
      result = await invokeJsonRequest(
        endpoint,
        token,
        'POST',
        buildScheduleCreatePayload(payload),
        timeoutMs
      );
      break;
    case 'schedule-update':
      result = await invokeJsonRequest(
        endpoint,
        token,
        'POST',
        buildScheduleUpdatePayload(payload),
        timeoutMs
      );
      break;
    case 'schedule-delete':
      result = await invokeJsonRequest(
        endpoint,
        token,
        'POST',
        buildScheduleDeletePayload(payload),
        timeoutMs
      );
      break;
    case 'schedule-submit-disabled':
      throw new Error('整组替换计划已禁用，请改用“创建计划”“修改计划”或“删除计划”。');
    case 'schedule-status':
      result = await invokeJsonRequest(
        endpoint,
        token,
        'POST',
        buildStatusPayload('getAgentPlanRequestStatus', options['request-id'] || payload.requestId || payload.id),
        timeoutMs
      );
      break;
    case 'homework-create':
      result = await invokeJsonRequest(
        endpoint,
        token,
        'POST',
        await buildHomeworkCreatePayload(payload),
        timeoutMs
      );
      break;
    case 'homework-status':
      result = await invokeJsonRequest(
        endpoint,
        token,
        'POST',
        buildHomeworkStatusPayload(payload, options['request-id']),
        timeoutMs
      );
      break;
    default:
      throw new Error(`不支持的命令：${command}`);
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error && error.message ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
