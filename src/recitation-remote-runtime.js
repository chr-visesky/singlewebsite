'use strict';

function createRecitationRemoteRuntime(dependencies = {}) {
  const {
    fetchJson,
    getAppConfig,
    recitationAgentRuntime,
    normalizePrefix
  } = dependencies;

  let remoteRecitationPollTimer = null;
  let remoteRecitationSyncPromise = Promise.resolve();

  function currentConfig() {
    return getAppConfig();
  }

  function currentRemoteRecitationConfig() {
    const appConfig = currentConfig();
    return appConfig && appConfig.remoteRecitation ? appConfig.remoteRecitation : { enabled: false };
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
      throw new Error('服务器返回的背诵请求格式不对。');
    }

    if (payload.error) {
      throw new Error(`服务器背诵同步失败：${payload.error}`);
    }

    if (Array.isArray(payload.items)) {
      return payload.items;
    }

    if (Array.isArray(payload.requests)) {
      return payload.requests;
    }

    throw new Error('服务器返回的背诵请求格式不对。');
  }

  async function fetchRemoteRequests(remoteRecitation) {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, 8000);

    try {
      const payload = await fetchJson(remoteRecitation.url, {
        headers: requestHeaders(normalizePrefix(remoteRecitation.authToken)),
        signal: abortController.signal
      });
      return normalizeRequestList(payload);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function syncRemoteRecitationRequests() {
    const remoteRecitation = currentRemoteRecitationConfig();

    if (!remoteRecitation.enabled || typeof recitationAgentRuntime.syncAgentRecitationRequests !== 'function') {
      return false;
    }

    remoteRecitationSyncPromise = remoteRecitationSyncPromise
      .catch(() => {})
      .then(async () => {
        const requests = await fetchRemoteRequests(remoteRecitation);
        await recitationAgentRuntime.syncAgentRecitationRequests(requests, {
          remoteUrl: normalizePrefix(remoteRecitation.url),
          authToken: normalizePrefix(remoteRecitation.authToken)
        });
        return true;
      });

    return remoteRecitationSyncPromise.catch(() => false);
  }

  function startRemoteRecitationPolling() {
    const remoteRecitation = currentRemoteRecitationConfig();

    if (!remoteRecitation.enabled || remoteRecitationPollTimer) {
      return;
    }

    const intervalMs = remoteRecitation.refreshMinutes * 60 * 1000;
    remoteRecitationPollTimer = setInterval(() => {
      void syncRemoteRecitationRequests();
    }, intervalMs);
  }

  function stopRemoteRecitationPolling() {
    if (remoteRecitationPollTimer) {
      clearInterval(remoteRecitationPollTimer);
      remoteRecitationPollTimer = null;
    }
  }

  return {
    startRemoteRecitationPolling,
    stopRemoteRecitationPolling,
    syncRemoteRecitationRequests
  };
}

module.exports = {
  createRecitationRemoteRuntime
};
