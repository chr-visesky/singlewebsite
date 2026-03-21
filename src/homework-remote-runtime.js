'use strict';

function createHomeworkRemoteRuntime(dependencies = {}) {
  const {
    fetchJson,
    getAppConfig,
    homeworkAgentRuntime,
    normalizePrefix
  } = dependencies;

  let remoteHomeworkPollTimer = null;
  let remoteHomeworkSyncPromise = Promise.resolve();

  function currentConfig() {
    return getAppConfig();
  }

  function currentRemoteHomeworkConfig() {
    const appConfig = currentConfig();
    return appConfig && appConfig.remoteHomework ? appConfig.remoteHomework : { enabled: false };
  }

  function requestHeaders(authToken) {
    const headers = {
      Accept: 'application/json'
    };

    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }

    return headers;
  }

  function normalizeRequestList(payload) {
    if (Array.isArray(payload)) {
      return payload;
    }

    if (!payload || typeof payload !== 'object') {
      throw new Error('服务器返回的作业请求格式不对。');
    }

    if (payload.error) {
      throw new Error(`服务器作业同步失败：${payload.error}`);
    }

    if (Array.isArray(payload.items)) {
      return payload.items;
    }

    if (Array.isArray(payload.requests)) {
      return payload.requests;
    }

    throw new Error('服务器返回的作业请求格式不对。');
  }

  async function fetchRemoteRequests(remoteHomework) {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, 8000);

    try {
      const payload = await fetchJson(remoteHomework.url, {
        headers: requestHeaders(normalizePrefix(remoteHomework.authToken)),
        signal: abortController.signal
      });
      return normalizeRequestList(payload);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function syncRemoteHomeworkRequests() {
    const remoteHomework = currentRemoteHomeworkConfig();

    if (!remoteHomework.enabled || typeof homeworkAgentRuntime.syncAgentHomeworkRequests !== 'function') {
      return false;
    }

    remoteHomeworkSyncPromise = remoteHomeworkSyncPromise
      .catch(() => {})
      .then(async () => {
        const requests = await fetchRemoteRequests(remoteHomework);
        await homeworkAgentRuntime.syncAgentHomeworkRequests(requests, {
          remoteUrl: normalizePrefix(remoteHomework.url),
          authToken: normalizePrefix(remoteHomework.authToken)
        });
        return true;
      });

    return remoteHomeworkSyncPromise.catch(() => false);
  }

  function startRemoteHomeworkPolling() {
    const remoteHomework = currentRemoteHomeworkConfig();

    if (!remoteHomework.enabled || remoteHomeworkPollTimer) {
      return;
    }

    const intervalMs = remoteHomework.refreshMinutes * 60 * 1000;
    remoteHomeworkPollTimer = setInterval(() => {
      void syncRemoteHomeworkRequests();
    }, intervalMs);
  }

  function stopRemoteHomeworkPolling() {
    if (remoteHomeworkPollTimer) {
      clearInterval(remoteHomeworkPollTimer);
      remoteHomeworkPollTimer = null;
    }
  }

  return {
    startRemoteHomeworkPolling,
    stopRemoteHomeworkPolling,
    syncRemoteHomeworkRequests
  };
}

module.exports = {
  createHomeworkRemoteRuntime
};
