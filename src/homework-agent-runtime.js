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

  function normalizeRequestOperation(request) {
    return normalizePrefix(request && (request.operation || request.mode)).toLowerCase() === 'delete'
      ? 'delete'
      : 'create';
  }

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

  function supportedExtensionFromUrl(url) {
    try {
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
      const response = await fetch(sourceUrl);

      if (!response.ok) {
        throw new Error(`下载作业源文件失败：${response.status}`);
      }

      const extension =
        supportedExtensionFromUrl(sourceUrl) ||
        supportedExtensionFromContentType(response.headers.get('content-type')) ||
        '';

      if (!extension) {
        throw new Error('智能体作业源文件必须是 PDF 或图片。');
      }

      const filePath = pathModule.join(sourceDirectory, `source-${index + 1}${extension}`);
      const buffer = Buffer.from(await response.arrayBuffer());
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

      child.once('error', reject);
      child.once('exit', (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        reject(new Error(`HomeworkApp 创建作业失败，退出码 ${code}`));
      });
    });

    const resultText = await fs.promises.readFile(resultPath, 'utf8');
    const result = JSON.parse(resultText);

    if (!result || result.ok !== true) {
      throw new Error(normalizePrefix(result && result.error) || 'HomeworkApp 创建作业失败。');
    }

    return result;
  }

  async function invokeHomeworkAgentDelete(executablePath, payload, workingDirectory) {
    const payloadPath = pathModule.join(workingDirectory, 'payload.json');
    const resultPath = pathModule.join(workingDirectory, 'result.json');
    await writeTempJson(payloadPath, payload);

    await new Promise((resolve, reject) => {
      const child = spawn(
        executablePath,
        ['--agent-delete-homework', '--payload-file', payloadPath, '--result-file', resultPath],
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

        reject(new Error(`HomeworkApp 删除作业失败，退出码 ${code}`));
      });
    });

    const resultText = await fs.promises.readFile(resultPath, 'utf8');
    const result = JSON.parse(resultText);

    if (!result || result.ok !== true) {
      throw new Error(normalizePrefix(result && result.error) || 'HomeworkApp 删除作业失败。');
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

  async function deleteHomeworkFromRequest(request) {
    const executablePath = normalizePrefix(resolveHomeworkExecutablePath());

    if (!executablePath) {
      throw new Error('找不到 HomeworkApp.exe。');
    }

    const jobId = normalizePrefix(request && (request.targetJobId || request.jobId));

    if (!jobId) {
      throw new Error('智能体删除作业请求缺少 jobId。');
    }

    const workingDirectory = pathModule.join(
      process.env.TEMP || process.env.TMP || pathModule.dirname(executablePath),
      'studygate-agent-homework',
      request.id
    );

    try {
      const result = await invokeHomeworkAgentDelete(
        executablePath,
        {
          jobId
        },
        workingDirectory
      );

      return {
        status: 'deleted',
        jobId: normalizePrefix(result.jobId || jobId),
        totalPages: 0,
        subject: normalizePrefix(result.subject) || request.subject,
        bucket: normalizePrefix(result.bucket) || request.bucket,
        targetDate: normalizePrefix(result.targetDate) || request.targetDate
      };
    } finally {
      await removeTempDirectory(workingDirectory);
    }
  }

  async function processRequest(request, context) {
    const marks = ensureMarksState();
    const currentMark = marks[request.id];
    const operation = normalizeRequestOperation(request);

    if (currentMark && currentMark.status === 'acknowledged') {
      return;
    }

    if (
      currentMark &&
      ((operation === 'delete' && currentMark.status === 'deleted') ||
        (operation !== 'delete' && currentMark.status === 'created'))
    ) {
      await completeRemoteRequest(request, currentMark, context).catch(() => {});
      return;
    }

    const nextMark = operation === 'delete'
      ? await deleteHomeworkFromRequest(request)
      : await createHomeworkFromRequest(request);
    rememberMark(request.id, nextMark);
    await completeRemoteRequest(request, nextMark, context).catch(() => {});
  }

  function normalizeIncomingRequests(requests) {
    return (Array.isArray(requests) ? requests : [])
      .filter((item) => item && typeof item === 'object')
      .filter((item) => normalizePrefix(item.id) && normalizePrefix(item.status) !== 'completed');
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
          await processRequest(request, context);
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
