'use strict';

function createDictationRemoteRuntime(dependencies = {}) {
  const {
    fetchJson,
    getAppConfig,
    dictationAgentRuntime,
    normalizePrefix
  } = dependencies;

  let remoteDictationPollTimer = null;
  let remoteDictationSyncPromise = Promise.resolve();

  function currentConfig() {
    return getAppConfig();
  }

  function currentRemoteDictationConfig() {
    const appConfig = currentConfig();
    return appConfig && appConfig.remoteDictation ? appConfig.remoteDictation : { enabled: false };
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
      throw new Error('服务器返回的听写请求格式不对。');
    }

    if (payload.error) {
      throw new Error(`服务器听写同步失败：${payload.error}`);
    }

    if (Array.isArray(payload.items)) {
      return payload.items;
    }

    if (Array.isArray(payload.requests)) {
      return payload.requests;
    }

    throw new Error('服务器返回的听写请求格式不对。');
  }

  async function fetchRemoteRequests(remoteDictation) {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, 8000);

    try {
      const payload = await fetchJson(remoteDictation.url, {
        headers: requestHeaders(normalizePrefix(remoteDictation.authToken)),
        signal: abortController.signal
      });
      return normalizeRequestList(payload);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function syncRemoteDictationRequests() {
    const remoteDictation = currentRemoteDictationConfig();

    if (!remoteDictation.enabled || typeof dictationAgentRuntime.syncAgentDictationRequests !== 'function') {
      return false;
    }

    remoteDictationSyncPromise = remoteDictationSyncPromise
      .catch(() => {})
      .then(async () => {
        const requests = await fetchRemoteRequests(remoteDictation);
        await dictationAgentRuntime.syncAgentDictationRequests(requests, {
          remoteUrl: normalizePrefix(remoteDictation.url),
          authToken: normalizePrefix(remoteDictation.authToken)
        });
        return true;
      });

    return remoteDictationSyncPromise.catch(() => false);
  }

  function startRemoteDictationPolling() {
    const remoteDictation = currentRemoteDictationConfig();

    if (!remoteDictation.enabled || remoteDictationPollTimer) {
      return;
    }

    const intervalMs = remoteDictation.refreshMinutes * 60 * 1000;
    remoteDictationPollTimer = setInterval(() => {
      void syncRemoteDictationRequests();
    }, intervalMs);
  }

  function stopRemoteDictationPolling() {
    if (remoteDictationPollTimer) {
      clearInterval(remoteDictationPollTimer);
      remoteDictationPollTimer = null;
    }
  }

  return {
    startRemoteDictationPolling,
    stopRemoteDictationPolling,
    syncRemoteDictationRequests
  };
}

module.exports = {
  createDictationRemoteRuntime
};
