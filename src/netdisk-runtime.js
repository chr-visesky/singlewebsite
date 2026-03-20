'use strict';

function createNetdiskRuntime(dependencies = {}) {
  const {
    BrowserWindow,
    Readable,
    createConfigError,
    createEmptyNetdiskState,
    createNetdiskApiError,
    createNetdiskAuthError,
    getAppConfig,
    getInternalMediaRoute,
    getInternalServerOrigin,
    normalizeNetdiskFolderPath,
    normalizePrefix,
    normalizeTitle,
    pathModule,
    readStateFile,
    resolveLibrary,
    runtimePaths,
    videoExtensions,
    writeStateFile
  } = dependencies;

  let authWindow = null;
  let pendingNetdiskAuth = null;
  let netdiskState = createEmptyNetdiskState();
  let netdiskDlinkCache = new Map();

  function currentConfig() {
    return getAppConfig();
  }

  function currentAuthorizeLabel() {
    return netdiskState.refreshToken ? '重新连接百度网盘' : '连接百度网盘';
  }

  function ensureNetdiskConfigured() {
    const config = currentConfig();

    if (!config.baiduNetdisk.clientId || !config.baiduNetdisk.clientSecret) {
      throw createConfigError('请先在 config.json 的 baiduNetdisk 中填写 clientId 和 clientSecret。');
    }
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

  function loadNetdiskState() {
    const filePath = runtimePaths.netdiskStatePath();

    if (!filePath || !readStateFile(filePath)) {
      netdiskState = createEmptyNetdiskState();
      return;
    }

    try {
      const raw = JSON.parse(readStateFile(filePath));
      netdiskState = {
        ...createEmptyNetdiskState(),
        ...raw
      };
    } catch {
      netdiskState = createEmptyNetdiskState();
    }
  }

  function saveNetdiskState() {
    writeStateFile(runtimePaths.netdiskStatePath(), JSON.stringify(netdiskState, null, 2));
  }

  function updateNetdiskState(tokenPayload) {
    netdiskState = {
      accessToken: normalizePrefix(tokenPayload.access_token || tokenPayload.accessToken),
      refreshToken: normalizePrefix(tokenPayload.refresh_token || tokenPayload.refreshToken || netdiskState.refreshToken),
      expiresAt: Date.now() + Math.max(60, Number(tokenPayload.expires_in || tokenPayload.expiresIn || 0) || 0) * 1000,
      scope: normalizePrefix(tokenPayload.scope) || netdiskState.scope || 'netdisk',
      tokenType: normalizePrefix(tokenPayload.token_type || tokenPayload.tokenType) || 'bearer'
    };

    saveNetdiskState();
  }

  function clearNetdiskState() {
    netdiskState = createEmptyNetdiskState();
    netdiskDlinkCache = new Map();

    try {
      const filePath = runtimePaths.netdiskStatePath();
      if (filePath) {
        require('fs').unlinkSync(filePath);
      }
    } catch {
      // Ignore missing file.
    }
  }

  async function refreshNetdiskToken() {
    const config = currentConfig();
    ensureNetdiskConfigured();

    if (!netdiskState.refreshToken) {
      throw createNetdiskAuthError('请先连接百度网盘。');
    }

    const tokenUrl = new URL('https://openapi.baidu.com/oauth/2.0/token');
    tokenUrl.searchParams.set('grant_type', 'refresh_token');
    tokenUrl.searchParams.set('refresh_token', netdiskState.refreshToken);
    tokenUrl.searchParams.set('client_id', config.baiduNetdisk.clientId);
    tokenUrl.searchParams.set('client_secret', config.baiduNetdisk.clientSecret);

    const payload = await fetchJson(tokenUrl);

    if (!payload || payload.error) {
      clearNetdiskState();
      throw createNetdiskAuthError(
        `百度网盘授权已失效：${payload && payload.error_description ? payload.error_description : '刷新 token 失败。'}`
      );
    }

    updateNetdiskState(payload);
  }

  async function ensureNetdiskAccessToken(options = {}) {
    ensureNetdiskConfigured();
    const forceRefresh = Boolean(options.forceRefresh);

    if (!forceRefresh && netdiskState.accessToken && netdiskState.expiresAt > Date.now()) {
      return netdiskState.accessToken;
    }

    if (netdiskState.refreshToken) {
      await refreshNetdiskToken();
      return netdiskState.accessToken;
    }

    throw createNetdiskAuthError('请先连接百度网盘。');
  }

  async function invokeNetdiskApi(buildUrl) {
    const authErrnos = new Set([111]);
    let accessToken = await ensureNetdiskAccessToken();

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const payload = await fetchJson(buildUrl(accessToken));

      if (payload && (typeof payload.errno !== 'number' || payload.errno === 0)) {
        return payload;
      }

      if (payload && authErrnos.has(payload.errno) && attempt === 0) {
        accessToken = await ensureNetdiskAccessToken({ forceRefresh: true });
        continue;
      }

      if (payload && authErrnos.has(payload.errno)) {
        clearNetdiskState();
        throw createNetdiskAuthError('百度网盘授权已失效，请重新连接。');
      }

      throw createNetdiskApiError(
        payload && payload.errmsg ? `百度网盘接口失败：${payload.errmsg}` : `百度网盘接口失败：errno=${payload ? payload.errno : 'unknown'}`,
        payload && payload.errno
      );
    }

    throw createNetdiskApiError('百度网盘接口调用失败。');
  }

  async function listNetdiskFolderEntries(folderPath) {
    const items = [];
    let start = 0;

    while (true) {
      const payload = await invokeNetdiskApi((accessToken) => {
        const url = new URL('https://pan.baidu.com/rest/2.0/xpan/file');
        url.searchParams.set('method', 'list');
        url.searchParams.set('access_token', accessToken);
        url.searchParams.set('dir', folderPath);
        url.searchParams.set('web', '1');
        url.searchParams.set('order', 'name');
        url.searchParams.set('desc', '0');
        url.searchParams.set('limit', '1000');
        url.searchParams.set('start', String(start));
        return url;
      });

      const page = Array.isArray(payload.list) ? payload.list : [];
      items.push(...page);

      if (!page.length || page.length < 1000 || payload.has_more !== 1) {
        break;
      }

      start += page.length;
    }

    return items;
  }

  function netdiskPathName(fullPath, fallback = '') {
    const normalized = normalizePrefix(fullPath);

    if (!normalized || normalized === '/') {
      return fallback || '/';
    }

    const parts = normalized.split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : fallback || normalized;
  }

  function isSupportedVideoFileName(fileName) {
    return videoExtensions.has(pathModule.extname(normalizePrefix(fileName)).toLowerCase());
  }

  function buildNetdiskVideoItems(library, rawItems) {
    return rawItems
      .filter((item) => Number(item.isdir) !== 1 && isSupportedVideoFileName(item.server_filename || item.path))
      .map((item) => ({
        id: `${library.id}-${item.fs_id}`,
        fsId: String(item.fs_id),
        title: normalizeTitle(item.server_filename || item.path || String(item.fs_id)),
        description: normalizePrefix(item.path) || normalizePrefix(item.server_filename),
        sourceUrl: `${getInternalServerOrigin()}${getInternalMediaRoute()}?libraryId=${encodeURIComponent(library.id)}&fsId=${encodeURIComponent(String(item.fs_id))}`
      }))
      .sort((left, right) => left.title.localeCompare(right.title, 'zh-CN', { numeric: true }));
  }

  async function buildNetdiskTreeNode(library, folderPath, options = {}) {
    const rawItems = await listNetdiskFolderEntries(folderPath);
    const folderItems = rawItems
      .filter((item) => Number(item.isdir) === 1)
      .sort((left, right) =>
        normalizeTitle(left.server_filename || left.path).localeCompare(
          normalizeTitle(right.server_filename || right.path),
          'zh-CN',
          { numeric: true }
        )
      );
    const files = buildNetdiskVideoItems(library, rawItems);
    const folders = folderItems.map((item) => {
      const childPath = normalizeNetdiskFolderPath(item.path || item.server_filename, folderPath);

      return {
        id: `folder:${childPath}`,
        name: netdiskPathName(childPath, library.title),
        path: childPath,
        folders: [],
        files: [],
        isLoaded: false
      };
    });

    return {
      id: `folder:${folderPath}`,
      name: options.isRoot ? library.title : netdiskPathName(folderPath, library.title),
      path: folderPath,
      folders,
      files,
      isLoaded: true
    };
  }

  function flattenTreeFiles(node, result = []) {
    if (!node || typeof node !== 'object') {
      return result;
    }

    if (Array.isArray(node.files)) {
      result.push(...node.files);
    }

    for (const child of Array.isArray(node.folders) ? node.folders : []) {
      flattenTreeFiles(child, result);
    }

    return result;
  }

  async function getNetdiskFileDlink(fsId) {
    const cached = netdiskDlinkCache.get(fsId);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.dlink;
    }

    const payload = await invokeNetdiskApi((accessToken) => {
      const url = new URL('https://pan.baidu.com/rest/2.0/xpan/multimedia');
      url.searchParams.set('method', 'filemetas');
      url.searchParams.set('access_token', accessToken);
      url.searchParams.set('dlink', '1');
      url.searchParams.set('fsids', JSON.stringify([Number(fsId)]));
      return url;
    });

    const dlink = payload && Array.isArray(payload.list) && payload.list[0] ? normalizePrefix(payload.list[0].dlink) : '';

    if (!dlink) {
      throw createNetdiskApiError('没有拿到百度网盘视频地址。');
    }

    netdiskDlinkCache.set(fsId, {
      dlink,
      expiresAt: Date.now() + 5 * 60 * 1000
    });

    return dlink;
  }

  function libraryStatus(kind, message) {
    return { kind, message };
  }

  async function buildLibraryModel(libraryId) {
    const library = resolveLibrary(libraryId);

    if (!library) {
      return {
        id: '',
        title: '媒体库',
        description: '没有找到这个媒体库。',
        sourceType: 'baiduNetdisk',
        providerLabel: '百度网盘',
        folderPath: '',
        authorizeLabel: '连接百度网盘',
        canAuthorize: true,
        status: libraryStatus('load_error', '没有找到这个媒体库。'),
        items: []
      };
    }

    try {
      ensureNetdiskConfigured();
      const tree = await buildNetdiskTreeNode(library, library.folderPath, { isRoot: true });
      const items = flattenTreeFiles(tree);

      return {
        id: library.id,
        title: library.title,
        description: library.description,
        sourceType: library.sourceType,
        providerLabel: '百度网盘',
        folderPath: library.folderPath,
        authorizeLabel: currentAuthorizeLabel(),
        canAuthorize: true,
        tree,
        status: libraryStatus('ready', items.length ? '' : '这个目录里还没有可播放的视频。'),
        items
      };
    } catch (error) {
      const kind =
        error.name === 'NetdiskAuthError'
          ? 'needs_auth'
          : error.name === 'ConfigError'
            ? 'config_error'
            : 'load_error';

      return {
        id: library.id,
        title: library.title,
        description: library.description,
        sourceType: library.sourceType,
        providerLabel: '百度网盘',
        folderPath: library.folderPath,
        authorizeLabel: currentAuthorizeLabel(),
        canAuthorize: true,
        tree: null,
        status: libraryStatus(kind, error.message || '媒体库加载失败。'),
        items: []
      };
    }
  }

  async function buildLibraryFolderModel(libraryId, folderPath) {
    const library = resolveLibrary(libraryId);

    if (!library) {
      throw createNetdiskApiError('没有找到这个媒体库。');
    }

    ensureNetdiskConfigured();
    return buildNetdiskTreeNode(library, normalizeNetdiskFolderPath(folderPath, library.folderPath));
  }

  function closeAuthWindow() {
    if (authWindow && !authWindow.isDestroyed()) {
      authWindow.close();
    }

    authWindow = null;
  }

  function clearPendingNetdiskAuth() {
    if (pendingNetdiskAuth && pendingNetdiskAuth.timer) {
      clearTimeout(pendingNetdiskAuth.timer);
    }

    pendingNetdiskAuth = null;
  }

  async function requestNetdiskDeviceCode() {
    const config = currentConfig();
    ensureNetdiskConfigured();
    const url = new URL('https://openapi.baidu.com/oauth/2.0/device/code');
    url.searchParams.set('response_type', 'device_code');
    url.searchParams.set('client_id', config.baiduNetdisk.clientId);
    url.searchParams.set('scope', 'basic,netdisk');

    const payload = await fetchJson(url, {
      headers: {
        'User-Agent': 'pan.baidu.com'
      }
    });

    if (!payload || payload.error || !payload.device_code || !payload.user_code || !payload.qrcode_url) {
      throw createNetdiskAuthError(
        `百度网盘设备授权初始化失败：${payload && payload.error_description ? payload.error_description : '没有拿到设备码。'}`
      );
    }

    return {
      deviceCode: normalizePrefix(payload.device_code),
      userCode: normalizePrefix(payload.user_code),
      verificationUrl: normalizePrefix(payload.verification_url) || 'https://openapi.baidu.com/device',
      qrCodeUrl: normalizePrefix(payload.qrcode_url),
      expiresIn: Math.max(60, Number(payload.expires_in) || 300),
      intervalMs: Math.max(5000, (Number(payload.interval) || 5) * 1000)
    };
  }

  function renderNetdiskDeviceAuthHtml(deviceAuth) {
    const qrCodeUrl = deviceAuth.qrCodeUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const verificationUrl = deviceAuth.verificationUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const userCode = deviceAuth.userCode.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    return `<!doctype html>
  <html lang="zh-CN">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>连接百度网盘</title>
      <style>
        :root { color-scheme: dark; }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          min-height: 100vh;
          font-family: "Microsoft YaHei UI", "Segoe UI", sans-serif;
          background:
            radial-gradient(circle at top left, rgba(105, 216, 194, 0.18), transparent 24%),
            linear-gradient(145deg, #071019, #10131c 58%, #15111a);
          color: #eef7fb;
          display: grid;
          place-items: center;
          padding: 24px;
        }
        .shell {
          width: min(860px, 100%);
          display: grid;
          grid-template-columns: 320px minmax(0, 1fr);
          gap: 24px;
          padding: 24px;
          border-radius: 28px;
          background: rgba(10, 21, 30, 0.88);
          border: 1px solid rgba(255,255,255,0.08);
          box-shadow: 0 24px 80px rgba(0,0,0,0.28);
        }
        .qr-panel {
          display: grid;
          gap: 14px;
          justify-items: center;
        }
        .qr-box {
          width: 280px;
          height: 280px;
          border-radius: 22px;
          background: rgba(255,255,255,0.96);
          display: grid;
          place-items: center;
          padding: 14px;
        }
        .qr-box img {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }
        .content {
          display: grid;
          align-content: center;
          gap: 14px;
        }
        .eyebrow {
          margin: 0;
          color: #69d8c2;
          letter-spacing: 0.16em;
          font-size: 12px;
          text-transform: uppercase;
        }
        h1 {
          margin: 0;
          font-size: 34px;
        }
        p {
          margin: 0;
          color: #a6c0cf;
          line-height: 1.7;
        }
        .code {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 54px;
          padding: 0 18px;
          border-radius: 16px;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.08);
          font-size: 28px;
          font-weight: 700;
          letter-spacing: 0.12em;
        }
        .link {
          color: #f4bb64;
          word-break: break-all;
        }
        .hint {
          font-size: 13px;
        }
        @media (max-width: 760px) {
          .shell { grid-template-columns: 1fr; }
          .qr-box { width: min(72vw, 280px); height: min(72vw, 280px); }
        }
      </style>
    </head>
    <body>
      <main class="shell">
        <section class="qr-panel">
          <div class="qr-box">
            <img src="${qrCodeUrl}" alt="百度网盘授权二维码" />
          </div>
          <p class="hint">用手机百度 App、百度网盘 App 或微信扫码</p>
        </section>
        <section class="content">
          <p class="eyebrow">Baidu Netdisk</p>
          <h1>连接百度网盘</h1>
          <p>不跳系统浏览器。请直接用手机扫码授权，程序会自动完成连接。</p>
          <div class="code">${userCode}</div>
          <p>如果扫码不方便，也可以在手机浏览器打开：</p>
          <p class="link">${verificationUrl}</p>
          <p>然后输入上面的授权码。</p>
          <p class="hint">授权完成后，这个窗口会自动关闭。</p>
        </section>
      </main>
    </body>
  </html>`;
  }

  async function pollNetdiskDeviceAuthorization(deviceAuth, authToken) {
    const config = currentConfig();
    const deadline = Date.now() + deviceAuth.expiresIn * 1000;
    let intervalMs = deviceAuth.intervalMs;

    while (Date.now() < deadline) {
      if (!pendingNetdiskAuth || pendingNetdiskAuth.token !== authToken) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));

      if (!pendingNetdiskAuth || pendingNetdiskAuth.token !== authToken) {
        return;
      }

      const url = new URL('https://openapi.baidu.com/oauth/2.0/token');
      url.searchParams.set('grant_type', 'device_token');
      url.searchParams.set('code', deviceAuth.deviceCode);
      url.searchParams.set('client_id', config.baiduNetdisk.clientId);
      url.searchParams.set('client_secret', config.baiduNetdisk.clientSecret);

      const payload = await fetchJson(url, {
        headers: {
          'User-Agent': 'pan.baidu.com'
        }
      });

      if (payload && !payload.error && payload.access_token) {
        updateNetdiskState(payload);
        if (pendingNetdiskAuth && pendingNetdiskAuth.token === authToken) {
          const resolve = pendingNetdiskAuth.resolve;
          clearPendingNetdiskAuth();
          closeAuthWindow();
          resolve({ success: true });
        }
        return;
      }

      const errorCode = normalizePrefix(payload && payload.error);

      if (!errorCode || errorCode === 'authorization_pending') {
        continue;
      }

      if (errorCode === 'slow_down') {
        intervalMs += 5000;
        continue;
      }

      if (pendingNetdiskAuth && pendingNetdiskAuth.token === authToken) {
        const reject = pendingNetdiskAuth.reject;
        clearPendingNetdiskAuth();
        closeAuthWindow();
        reject(
          createNetdiskAuthError(
            `百度网盘授权失败：${normalizePrefix(payload && payload.error_description) || errorCode}`
          )
        );
      }
      return;
    }

    if (pendingNetdiskAuth && pendingNetdiskAuth.token === authToken) {
      const reject = pendingNetdiskAuth.reject;
      clearPendingNetdiskAuth();
      closeAuthWindow();
      reject(createNetdiskAuthError('百度网盘授权超时，请重新扫码。'));
    }
  }

  async function authorizeNetdisk() {
    ensureNetdiskConfigured();

    if (pendingNetdiskAuth && pendingNetdiskAuth.promise) {
      return pendingNetdiskAuth.promise;
    }

    const deviceAuth = await requestNetdiskDeviceCode();
    const authToken = require('crypto').randomBytes(12).toString('hex');

    const authPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!pendingNetdiskAuth || pendingNetdiskAuth.token !== authToken) {
          return;
        }

        clearPendingNetdiskAuth();
        closeAuthWindow();
        reject(createNetdiskAuthError('百度网盘授权超时，请重试。'));
      }, 5 * 60 * 1000);

      pendingNetdiskAuth = {
        token: authToken,
        resolve,
        reject,
        timer
      };
    });

    pendingNetdiskAuth.promise = authPromise;
    authWindow = new BrowserWindow({
      title: '连接百度网盘',
      width: 920,
      height: 640,
      show: true,
      frame: true,
      autoHideMenuBar: true,
      backgroundColor: '#0f172a',
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        devTools: false,
        spellcheck: false
      }
    });

    authWindow.removeMenu();
    authWindow.once('ready-to-show', () => {
      if (authWindow && !authWindow.isDestroyed()) {
        authWindow.focus();
      }
    });

    authWindow.on('closed', () => {
      authWindow = null;

      if (pendingNetdiskAuth && pendingNetdiskAuth.token === authToken) {
        const reject = pendingNetdiskAuth.reject;
        clearPendingNetdiskAuth();
        reject(createNetdiskAuthError('已取消百度网盘授权。'));
      }
    });

    try {
      await authWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderNetdiskDeviceAuthHtml(deviceAuth))}`);
    } catch (error) {
      if (pendingNetdiskAuth && pendingNetdiskAuth.token === authToken) {
        const reject = pendingNetdiskAuth.reject;
        clearPendingNetdiskAuth();
        closeAuthWindow();
        reject(createNetdiskAuthError(error && error.message ? error.message : '百度网盘授权窗口打开失败。'));
      }

      return authPromise;
    }

    void pollNetdiskDeviceAuthorization(deviceAuth, authToken);
    return authPromise;
  }

  async function proxyNetdiskMedia(request, response, requestUrl) {
    const library = resolveLibrary(requestUrl.searchParams.get('libraryId'));
    const fsId = normalizePrefix(requestUrl.searchParams.get('fsId'));

    if (!library || !fsId) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not Found');
      return;
    }

    const accessToken = await ensureNetdiskAccessToken();
    const dlink = await getNetdiskFileDlink(fsId);
    const upstreamUrl = new URL(dlink);
    upstreamUrl.searchParams.set('access_token', accessToken);

    const headers = {};
    if (request.headers.range) {
      headers.Range = request.headers.range;
    }

    let upstreamResponse = null;
    let currentUpstreamUrl = upstreamUrl;

    for (let redirectCount = 0; redirectCount < 4; redirectCount += 1) {
      upstreamResponse = await fetch(currentUpstreamUrl, {
        method: request.method,
        headers,
        redirect: 'manual'
      });

      if (![301, 302, 303, 307, 308].includes(upstreamResponse.status)) {
        break;
      }

      const location = upstreamResponse.headers.get('location');

      if (!location) {
        break;
      }

      currentUpstreamUrl = new URL(location, currentUpstreamUrl);
    }

    response.statusCode = upstreamResponse.status;
    response.setHeader('Access-Control-Allow-Origin', '*');

    for (const headerName of [
      'accept-ranges',
      'cache-control',
      'content-length',
      'content-range',
      'content-type',
      'etag',
      'last-modified'
    ]) {
      const headerValue = upstreamResponse.headers.get(headerName);

      if (headerValue) {
        response.setHeader(headerName, headerValue);
      }
    }

    if (request.method === 'HEAD' || !upstreamResponse.body) {
      response.end();
      return;
    }

    Readable.fromWeb(upstreamResponse.body).pipe(response);
  }

  return {
    authorizeNetdisk,
    buildLibraryFolderModel,
    buildLibraryModel,
    ensureNetdiskAccessToken,
    getNetdiskFileDlink,
    loadNetdiskState,
    proxyNetdiskMedia
  };
}

module.exports = {
  createNetdiskRuntime
};
