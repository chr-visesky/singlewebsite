'use strict';

function createDictationAgentRuntime(dependencies = {}) {
  const {
    fetchJson,
    fs,
    getStudyToolsState,
    normalizePrefix,
    pathModule,
    resolveDictationExecutablePath,
    saveStudyToolsState,
    spawn
  } = dependencies;

  let syncPromise = Promise.resolve();
  const NATIVE_AGENT_TIMEOUT_MS = 2 * 60 * 1000;

  function ensureMarksState() {
    const studyToolsState = typeof getStudyToolsState === 'function' ? getStudyToolsState() : {};

    if (!studyToolsState.agentDictationRequestMarks || typeof studyToolsState.agentDictationRequestMarks !== 'object') {
      studyToolsState.agentDictationRequestMarks = {};
    }

    return studyToolsState.agentDictationRequestMarks;
  }

  function rememberMark(requestId, mark) {
    ensureMarksState()[requestId] = {
      ...(ensureMarksState()[requestId] || {}),
      ...mark,
      updatedAt: new Date().toISOString()
    };
    saveStudyToolsState();
  }

  function resultForMark(mark) {
    return {
      taskId: normalizePrefix(mark && mark.taskId),
      itemCount: Math.max(0, Number(mark && mark.itemCount) || 0),
      subject: normalizePrefix(mark && mark.subject),
      bucket: normalizePrefix(mark && mark.bucket),
      targetDate: normalizePrefix(mark && mark.targetDate)
    };
  }

  function normalizeMarkErrorMessage(error, fallback) {
    return normalizePrefix(error && error.message).slice(0, 240) || fallback;
  }

  function createTimeoutError(message) {
    const error = new Error(message);
    error.code = 'timeout';
    return error;
  }

  async function writeTempJson(filePath, payload) {
    await fs.promises.mkdir(pathModule.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }

  async function removeTempDirectory(directoryPath) {
    await fs.promises.rm(directoryPath, {
      recursive: true,
      force: true
    }).catch(() => {});
  }

  async function runDictationProcess(executablePath, payloadPath, resultPath) {
    await new Promise((resolve, reject) => {
      const child = spawn(
        executablePath,
        ['--agent-create-dictation', '--payload-file', payloadPath, '--result-file', resultPath],
        {
          cwd: pathModule.dirname(executablePath),
          windowsHide: true,
          stdio: 'ignore'
        }
      );
      let settled = false;

      const finish = (callback, value) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeoutId);
        callback(value);
      };

      const timeoutId = setTimeout(() => {
        try {
          child.kill();
        } catch {
          // Ignore kill failures when the child is already exiting.
        }

        finish(reject, createTimeoutError('DictationApp 处理听写超时。'));
      }, NATIVE_AGENT_TIMEOUT_MS);

      child.once('error', (error) => {
        finish(reject, error);
      });
      child.once('exit', (code) => {
        if (code === 0) {
          finish(resolve);
          return;
        }

        finish(reject, new Error(`DictationApp 创建听写失败，退出码 ${code}`));
      });
    });
  }

  async function invokeDictationAgentCreate(executablePath, payload, workingDirectory) {
    const payloadPath = pathModule.join(workingDirectory, 'payload.json');
    const resultPath = pathModule.join(workingDirectory, 'result.json');
    await writeTempJson(payloadPath, payload);

    await runDictationProcess(executablePath, payloadPath, resultPath);

    const resultText = await fs.promises.readFile(resultPath, 'utf8');
    const result = JSON.parse(resultText);

    if (!result || result.ok !== true) {
      throw new Error(normalizePrefix(result && result.error) || 'DictationApp 创建听写失败。');
    }

    return result;
  }

  async function completeRemoteRequest(request, mark, context) {
    const remoteUrl = normalizePrefix(context && context.remoteUrl);
    const authToken = normalizePrefix(context && context.authToken);

    if (!remoteUrl || !authToken) {
      return false;
    }

    const payload = await fetchJson(remoteUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`
      },
      body: JSON.stringify({
        action: 'completeAgentDictationRequest',
        requestId: request.id,
        ...resultForMark(mark)
      })
    });

    if (!payload || payload.error) {
      throw new Error(payload && payload.error ? `听写完成状态回写失败：${payload.error}` : '听写完成状态回写失败。');
    }

    rememberMark(request.id, {
      ...mark,
      status: 'acknowledged'
    });
    return true;
  }

  async function createDictationFromRequest(request) {
    const executablePath = normalizePrefix(resolveDictationExecutablePath());

    if (!executablePath) {
      throw new Error('找不到 DictationApp.exe。');
    }

    const workingDirectory = pathModule.join(
      process.env.TEMP || process.env.TMP || pathModule.dirname(executablePath),
      'studygate-agent-dictation',
      request.id
    );

    try {
      const result = await invokeDictationAgentCreate(
        executablePath,
        {
          title: request.title,
          subject: request.subject,
          bucket: request.bucket,
          targetDate: request.targetDate,
          language: request.language,
          items: Array.isArray(request.items) ? request.items : []
        },
        workingDirectory
      );

      return {
        status: 'created',
        taskId: normalizePrefix(result.taskId),
        itemCount: Math.max(0, Number(result.itemCount) || 0),
        subject: request.subject,
        bucket: request.bucket,
        targetDate: request.targetDate
      };
    } finally {
      await removeTempDirectory(workingDirectory);
    }
  }

  async function processRequest(request, context) {
    const marks = ensureMarksState();
    const currentMark = marks[request.id];

    if (currentMark && currentMark.status === 'acknowledged') {
      return;
    }

    if (currentMark && currentMark.status === 'created') {
      await completeRemoteRequest(request, currentMark, context).catch(() => {});
      return;
    }

    const nextMark = await createDictationFromRequest(request);
    rememberMark(request.id, nextMark);
    await completeRemoteRequest(request, nextMark, context).catch(() => {});
  }

  function normalizeIncomingRequests(requests) {
    return (Array.isArray(requests) ? requests : [])
      .filter((item) => item && typeof item === 'object')
      .filter((item) => normalizePrefix(item.id) && normalizePrefix(item.status) !== 'completed');
  }

  async function syncAgentDictationRequests(requests = [], context = {}) {
    const pendingRequests = normalizeIncomingRequests(requests);

    if (!pendingRequests.length) {
      return;
    }

    syncPromise = syncPromise
      .catch(() => {})
      .then(async () => {
        for (const request of pendingRequests) {
          try {
            await processRequest(request, context);
          } catch (error) {
            rememberMark(request.id, {
              status: 'failed',
              errorMessage: normalizeMarkErrorMessage(error, '听写同步失败。')
            });
          }
        }
      });

    return syncPromise.catch(() => {});
  }

  return {
    syncAgentDictationRequests
  };
}

module.exports = {
  createDictationAgentRuntime
};
