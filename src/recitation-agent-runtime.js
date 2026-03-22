'use strict';

function createRecitationAgentRuntime(dependencies = {}) {
  const {
    fetchJson,
    fs,
    getStudyToolsState,
    normalizePrefix,
    pathModule,
    resolveRecitationExecutablePath,
    saveStudyToolsState,
    spawn
  } = dependencies;

  let syncPromise = Promise.resolve();

  function ensureMarksState() {
    const studyToolsState = typeof getStudyToolsState === 'function' ? getStudyToolsState() : {};

    if (!studyToolsState.agentRecitationRequestMarks || typeof studyToolsState.agentRecitationRequestMarks !== 'object') {
      studyToolsState.agentRecitationRequestMarks = {};
    }

    return studyToolsState.agentRecitationRequestMarks;
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
      subject: normalizePrefix(mark && mark.subject),
      bucket: normalizePrefix(mark && mark.bucket),
      targetDate: normalizePrefix(mark && mark.targetDate)
    };
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

  async function invokeRecitationAgentCreate(executablePath, payload, workingDirectory) {
    const payloadPath = pathModule.join(workingDirectory, 'payload.json');
    const resultPath = pathModule.join(workingDirectory, 'result.json');
    await writeTempJson(payloadPath, payload);

    await new Promise((resolve, reject) => {
      const child = spawn(
        executablePath,
        ['--agent-create-recitation', '--payload-file', payloadPath, '--result-file', resultPath],
        {
          cwd: pathModule.dirname(executablePath),
          windowsHide: true,
          stdio: 'ignore'
        }
      );

      child.once('error', reject);
      child.once('exit', (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        reject(new Error(`RecitationApp 创建背诵失败，退出码 ${code}`));
      });
    });

    const resultText = await fs.promises.readFile(resultPath, 'utf8');
    const result = JSON.parse(resultText);

    if (!result || result.ok !== true) {
      throw new Error(normalizePrefix(result && result.error) || 'RecitationApp 创建背诵失败。');
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
        action: 'completeAgentRecitationRequest',
        requestId: request.id,
        ...resultForMark(mark)
      })
    });

    if (!payload || payload.error) {
      throw new Error(payload && payload.error ? `背诵完成状态回写失败：${payload.error}` : '背诵完成状态回写失败。');
    }

    rememberMark(request.id, {
      ...mark,
      status: 'acknowledged'
    });
    return true;
  }

  async function createRecitationFromRequest(request) {
    const executablePath = normalizePrefix(resolveRecitationExecutablePath());

    if (!executablePath) {
      throw new Error('找不到 RecitationApp.exe。');
    }

    const workingDirectory = pathModule.join(
      process.env.TEMP || process.env.TMP || pathModule.dirname(executablePath),
      'studygate-agent-recitation',
      request.id
    );

    try {
      const result = await invokeRecitationAgentCreate(
        executablePath,
        {
          title: request.title,
          bucket: request.bucket,
          targetDate: request.targetDate,
          sourceText: request.sourceText
        },
        workingDirectory
      );

      return {
        status: 'created',
        taskId: normalizePrefix(result.taskId),
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

    const nextMark = await createRecitationFromRequest(request);
    rememberMark(request.id, nextMark);
    await completeRemoteRequest(request, nextMark, context).catch(() => {});
  }

  function normalizeIncomingRequests(requests) {
    return (Array.isArray(requests) ? requests : [])
      .filter((item) => item && typeof item === 'object')
      .filter((item) => normalizePrefix(item.id) && normalizePrefix(item.status) !== 'completed');
  }

  async function syncAgentRecitationRequests(requests = [], context = {}) {
    const pendingRequests = normalizeIncomingRequests(requests);

    if (!pendingRequests.length) {
      return;
    }

    syncPromise = syncPromise
      .catch(() => {})
      .then(async () => {
        for (const request of pendingRequests) {
          await processRequest(request, context);
        }
      });

    return syncPromise.catch(() => {});
  }

  return {
    syncAgentRecitationRequests
  };
}

module.exports = {
  createRecitationAgentRuntime
};
