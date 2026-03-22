'use strict';

function createInternalServiceRuntime(dependencies = {}) {
  const {
    createConfigError,
    fs,
    getAppConfig,
    getClassroomDefinitions,
    getLearningToolDefinitions,
    getLibraryDefinitions,
    getProxyNetdiskMedia,
    getSaveStudySchedule,
    getSerializeStudySchedule,
    http,
    internalHomeworkSyncApiRoute,
    internalMediaRoute,
    internalMobileConfigRoute,
    internalMobileScheduleApiRoute,
    internalOAuthCallbackRoute,
    internalServerPort,
    nativeModuleTargetOptions,
    normalizeDateList,
    normalizePrefix,
    os,
    pathModule,
    ensureMobileToken,
    syncRemoteHomeworkRequests
  } = dependencies;

  let internalServer = null;
  let internalServerOrigin = '';

  function dedupe(items) {
    return Array.from(new Set(items));
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    const text = await response.text();
    let payload = null;

    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = null;
    }

    if (!response.ok && !payload) {
      throw new Error(`请求失败：${response.status}`);
    }

    if (!response.ok && payload && typeof payload === 'object') {
      return payload;
    }

    return payload;
  }

  function currentInternalServerPort() {
    const address = internalServer && typeof internalServer.address === 'function' ? internalServer.address() : null;
    return address && typeof address.port === 'number' ? address.port : 0;
  }

  function localNetworkAddresses() {
    const interfaces = os.networkInterfaces();
    const addresses = [];

    for (const entries of Object.values(interfaces)) {
      for (const entry of entries || []) {
        if (!entry || entry.internal || entry.family !== 'IPv4') {
          continue;
        }

        addresses.push(entry.address);
      }
    }

    return dedupe(addresses).sort();
  }

  function sendHtml(response, statusCode, html) {
    response.writeHead(statusCode, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    response.end(html);
  }

  function sendText(response, statusCode, text) {
    response.writeHead(statusCode, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    response.end(text);
  }

  function sendJson(response, statusCode, payload) {
    response.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    response.end(JSON.stringify(payload));
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

  function isAuthorizedMobileRequest(requestUrl) {
    return normalizePrefix(requestUrl.searchParams.get('token')) === ensureMobileToken();
  }

  function mobileTargetOptions() {
    return [
      { id: '', label: '只提醒，不跳转' },
      ...getClassroomDefinitions().map((classroom) => ({
        id: classroom.id,
        label: classroom.title
      })),
      ...getLearningToolDefinitions().map((learningTool) => ({
        id: learningTool.id,
        label: learningTool.title
      })),
      ...nativeModuleTargetOptions(),
      ...getLibraryDefinitions().map((library) => ({
        id: library.id,
        label: library.title
      }))
    ];
  }

  function mobileConfigPagePath() {
    return pathModule.join(__dirname, 'mobile-config.html');
  }

  function renderMobileConfigPage() {
    const template = fs.readFileSync(mobileConfigPagePath(), 'utf8');
    const appConfig = getAppConfig();
    const bootstrap = {
      token: ensureMobileToken(),
      apiPath: internalMobileScheduleApiRoute,
      items: getSerializeStudySchedule()(),
      targetOptions: mobileTargetOptions(),
      readOnly: Boolean(appConfig.remoteSchedule.enabled),
      readOnlyMessage: appConfig.remoteSchedule.enabled ? '当前已启用云端课表，这个本地页面只能看，不能改。' : ''
    };

    return template.replace(
      '__STUDYGATE_MOBILE_BOOTSTRAP__',
      JSON.stringify(bootstrap).replace(/</g, '\\u003c')
    );
  }

  async function handleMobileScheduleApi(request, response, requestUrl) {
    if (!isAuthorizedMobileRequest(requestUrl)) {
      sendJson(response, 403, {
        error: 'forbidden'
      });
      return;
    }

    if (request.method === 'GET') {
      const appConfig = getAppConfig();
      sendJson(response, 200, {
        items: getSerializeStudySchedule()(),
        targetOptions: mobileTargetOptions(),
        readOnly: Boolean(appConfig.remoteSchedule.enabled),
        readOnlyMessage: appConfig.remoteSchedule.enabled ? '当前已启用云端课表，这个本地页面只能看，不能改。' : ''
      });
      return;
    }

    if (request.method !== 'POST') {
      sendJson(response, 405, {
        error: 'method_not_allowed'
      });
      return;
    }

    const appConfig = getAppConfig();
    if (appConfig.remoteSchedule.enabled) {
      sendJson(response, 409, {
        error: 'remote_enabled',
        message: '当前已启用云端课表，请在家长管理端修改。'
      });
      return;
    }

    const bodyText = await readRequestText(request);
    let payload;

    try {
      payload = bodyText ? JSON.parse(bodyText) : {};
    } catch {
      sendJson(response, 400, {
        error: 'bad_json'
      });
      return;
    }

    const items = payload && Array.isArray(payload.items) ? payload.items : [];
    const savedItems = getSaveStudySchedule()(items);

    sendJson(response, 200, {
      success: true,
      items: savedItems.map((item) => ({
        id: item.id,
        enabled: item.enabled,
        mode: item.mode,
        title: item.title,
        target: item.targetId,
        time: item.time,
        weekdays: item.weekdays,
        specificDate: item.specificDate || '',
        exceptionDates: normalizeDateList(item.exceptionDates || []),
        message: item.message
      })),
      targetOptions: mobileTargetOptions()
    });
  }

  async function handleHomeworkSyncApi(response, requestUrl) {
    if (!isAuthorizedMobileRequest(requestUrl)) {
      sendJson(response, 403, {
        error: 'forbidden'
      });
      return;
    }

    const result = await syncRemoteHomeworkRequests();
    sendJson(response, result && result.success ? 200 : 500, result || {
      success: false,
      message: '云端作业同步失败。'
    });
  }

  async function handleOAuthCallback(response) {
    sendHtml(
      response,
      410,
      '<h1>这个地址已停用</h1><p>当前版本改成了百度设备码授权，不再使用浏览器 OAuth 回调地址。请回到程序里重新点“连接百度网盘”。</p>'
    );
  }

  async function handleInternalServerRequest(request, response) {
    const requestUrl = new URL(request.url, internalServerOrigin);

    try {
      if (requestUrl.pathname === internalOAuthCallbackRoute) {
        await handleOAuthCallback(response);
        return;
      }

      if (requestUrl.pathname === internalMediaRoute) {
        await getProxyNetdiskMedia()(request, response, requestUrl);
        return;
      }

      if (requestUrl.pathname === internalMobileConfigRoute) {
        if (!isAuthorizedMobileRequest(requestUrl)) {
          sendHtml(response, 403, '<h1>禁止访问</h1><p>请从程序首页复制手机配置链接。</p>');
          return;
        }

        sendHtml(response, 200, renderMobileConfigPage());
        return;
      }

      if (requestUrl.pathname === internalMobileScheduleApiRoute) {
        await handleMobileScheduleApi(request, response, requestUrl);
        return;
      }

      if (requestUrl.pathname === internalHomeworkSyncApiRoute) {
        if (request.method !== 'POST') {
          sendJson(response, 405, {
            error: 'method_not_allowed'
          });
          return;
        }

        await handleHomeworkSyncApi(response, requestUrl);
        return;
      }

      sendText(response, 404, 'Not Found');
    } catch (error) {
      sendText(response, 500, error.message || 'Internal Error');
    }
  }

  async function startInternalServer() {
    if (internalServer) {
      return;
    }

    internalServer = http.createServer((request, response) => {
      void handleInternalServerRequest(request, response);
    });

    await new Promise((resolve, reject) => {
      const onError = (error) => {
        if (error && error.code === 'EADDRINUSE') {
          reject(createConfigError(`内部服务端口 ${internalServerPort} 已被占用。请关闭占用该端口的程序后重试。`));
          return;
        }

        reject(error);
      };

      internalServer.once('error', onError);
      internalServer.listen(internalServerPort, '0.0.0.0', () => {
        internalServer.off('error', onError);
        resolve();
      });
    });

    const address = internalServer.address();
    internalServerOrigin = `http://127.0.0.1:${address.port}`;
  }

  function stopInternalServer() {
    if (internalServer) {
      internalServer.close();
      internalServer = null;
      internalServerOrigin = '';
    }
  }

  return {
    currentInternalServerPort,
    fetchJson,
    getInternalServerOrigin: () => internalServerOrigin,
    localNetworkAddresses,
    startInternalServer,
    stopInternalServer
  };
}

module.exports = {
  createInternalServiceRuntime
};
