'use strict';

function createHomeworkAgentRuntime(dependencies = {}) {
  const {
    fetchJson,
    fs,
    normalizePrefix,
    getStudyToolsState,
    pathModule,
    resolveHomeworkExecutablePath,
    saveStudyToolsState,
    spawn
  } = dependencies;

  let syncPromise = Promise.resolve();
  const NATIVE_AGENT_TIMEOUT_MS = 2 * 60 * 1000;
  const SOURCE_DOWNLOAD_TIMEOUT_MS = 30 * 1000;

  function ensureMarksState() {
    const studyToolsState = typeof getStudyToolsState === 'function' ? getStudyToolsState() : {};

    if (!studyToolsState.agentHomeworkRequestMarks || typeof studyToolsState.agentHomeworkRequestMarks !== 'object') {
      studyToolsState.agentHomeworkRequestMarks = {};
    }

    return studyToolsState.agentHomeworkRequestMarks;
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
      jobId: normalizePrefix(mark && mark.jobId),
      totalPages: Math.max(0, Number(mark && mark.totalPages) || 0),
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

  function supportedExtensionFromUrl(url) {
    try {
      if (/^data:/i.test(String(url || ''))) {
        const matched = String(url).match(/^data:([^;,]+);base64,/i);
        return matched ? supportedExtensionFromContentType(matched[1]) : '';
      }

      const pathname = new URL(url).pathname.toLowerCase();
      const extension = pathModule.extname(pathname);
      return ['.pdf', '.jpg', '.jpeg', '.png', '.bmp', '.gif'].includes(extension) ? extension : '';
    } catch {
      return '';
    }
  }

  function supportedExtensionFromContentType(value) {
    const normalized = normalizePrefix(value).toLowerCase();

    if (normalized.includes('pdf')) {
      return '.pdf';
    }

    if (normalized.includes('jpeg') || normalized.includes('jpg')) {
      return '.jpg';
    }

    if (normalized.includes('png')) {
      return '.png';
    }

    if (normalized.includes('bmp')) {
      return '.bmp';
    }

    if (normalized.includes('gif')) {
      return '.gif';
    }

    return '';
  }

  function validateDownloadedFiles(filePaths = []) {
    const pdfCount = filePaths.filter((filePath) => pathModule.extname(filePath).toLowerCase() === '.pdf').length;
    const imageCount = filePaths.filter((filePath) =>
      ['.jpg', '.jpeg', '.png', '.bmp', '.gif'].includes(pathModule.extname(filePath).toLowerCase())
    ).length;

    if (pdfCount > 1) {
      throw new Error('智能体作业请求一次只能包含 1 个 PDF。');
    }

    if (pdfCount > 0 && imageCount > 0) {
      throw new Error('智能体作业请求里的 PDF 和图片不能混合。');
    }
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

  async function fetchSourceWithTimeout(sourceUrl) {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, SOURCE_DOWNLOAD_TIMEOUT_MS);

    try {
      return await fetch(sourceUrl, {
        signal: abortController.signal
      });
    } catch (error) {
      if (error && error.name === 'AbortError') {
        throw createTimeoutError('下载作业源文件超时。');
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function runHomeworkProcess(executablePath, payloadPath, resultPath) {
    await new Promise((resolve, reject) => {
      const child = spawn(
        executablePath,
        ['--agent-create-homework', '--payload-file', payloadPath, '--result-file', resultPath],
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

        finish(reject, createTimeoutError('HomeworkApp 处理作业超时。'));
      }, NATIVE_AGENT_TIMEOUT_MS);

      child.once('error', (error) => {
        finish(reject, error);
      });
      child.once('exit', (code) => {
        if (code === 0) {
          finish(resolve);
          return;
        }

        finish(reject, new Error(`HomeworkApp 创建作业失败，退出码 ${code}`));
      });
    });
  }

  async function downloadSourceFiles(request, workingDirectory) {
    const sourceUrls = Array.isArray(request && request.sourceUrls) ? request.sourceUrls : [];

    if (!sourceUrls.length) {
      return [];
    }

    const sourceDirectory = pathModule.join(workingDirectory, 'source');
    await fs.promises.mkdir(sourceDirectory, { recursive: true });
    const downloadedFiles = [];

    for (let index = 0; index < sourceUrls.length; index += 1) {
      const sourceUrl = sourceUrls[index];
      let extension = supportedExtensionFromUrl(sourceUrl);
      let buffer = null;

      if (/^data:/i.test(String(sourceUrl || ''))) {
        const matched = String(sourceUrl).match(/^data:([^;,]+);base64,(.*)$/is);

        if (!matched) {
          throw new Error('智能体作业源文件 data URL 不合法。');
        }

        extension = extension || supportedExtensionFromContentType(matched[1]);
        buffer = Buffer.from(matched[2].replace(/\s+/g, ''), 'base64');
      } else {
        const response = await fetchSourceWithTimeout(sourceUrl);

        if (!response.ok) {
          throw new Error(`下载作业源文件失败：${response.status}`);
        }

        extension = extension || supportedExtensionFromContentType(response.headers.get('content-type')) || '';
        buffer = Buffer.from(await response.arrayBuffer());
      }

      if (!extension || !buffer) {
        throw new Error('智能体作业源文件必须是 PDF 或图片。');
      }

      const filePath = pathModule.join(sourceDirectory, `source-${index + 1}${extension}`);
      await fs.promises.writeFile(filePath, buffer);
      downloadedFiles.push(filePath);
    }

    validateDownloadedFiles(downloadedFiles);
    return downloadedFiles;
  }

  async function invokeHomeworkAgentCreate(executablePath, payload, workingDirectory) {
    const payloadPath = pathModule.join(workingDirectory, 'payload.json');
    const resultPath = pathModule.join(workingDirectory, 'result.json');
    await writeTempJson(payloadPath, payload);

    await runHomeworkProcess(executablePath, payloadPath, resultPath);

    const resultText = await fs.promises.readFile(resultPath, 'utf8');
    const result = JSON.parse(resultText);

    if (!result || result.ok !== true) {
      throw new Error(normalizePrefix(result && result.error) || 'HomeworkApp 创建作业失败。');
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
        action: 'completeAgentHomeworkRequest',
        requestId: request.id,
        ...resultForMark(mark)
      })
    });

    if (!payload || payload.error) {
      throw new Error(payload && payload.error ? `作业完成状态回写失败：${payload.error}` : '作业完成状态回写失败。');
    }

    rememberMark(request.id, {
      ...mark,
      status: 'acknowledged'
    });
    return true;
  }

  async function createHomeworkFromRequest(request) {
    const executablePath = normalizePrefix(resolveHomeworkExecutablePath());

    if (!executablePath) {
      throw new Error('找不到 HomeworkApp.exe。');
    }

    const workingDirectory = pathModule.join(
      process.env.TEMP || process.env.TMP || pathModule.dirname(executablePath),
      'studygate-agent-homework',
      request.id
    );

    try {
      const sourceFiles = await downloadSourceFiles(request, workingDirectory);
      const result = await invokeHomeworkAgentCreate(
        executablePath,
        {
          subject: request.subject,
          bucket: request.bucket,
          targetDate: request.targetDate,
          sourceFiles
        },
        workingDirectory
      );

      return {
        status: 'created',
        jobId: normalizePrefix(result.jobId),
        totalPages: Math.max(0, Number(result.totalPages) || 0),
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

    const nextMark = await createHomeworkFromRequest(request);
    rememberMark(request.id, nextMark);
    await completeRemoteRequest(request, nextMark, context).catch(() => {});
  }

  function normalizeIncomingRequests(requests) {
    return (Array.isArray(requests) ? requests : [])
      .filter((item) => item && typeof item === 'object')
      .filter((item) => normalizePrefix(item.id) && normalizePrefix(item.status) !== 'completed')
      .filter((item) => normalizePrefix(item.operation || item.mode).toLowerCase() !== 'delete');
  }

  async function syncAgentHomeworkRequests(requests = [], context = {}) {
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
              errorMessage: normalizeMarkErrorMessage(error, '作业同步失败。')
            });
          }
        }
      });

    return syncPromise.catch(() => {});
  }

  return {
    syncAgentHomeworkRequests
  };
}

module.exports = {
  createHomeworkAgentRuntime
};
