'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createAgentHomeworkPublicRuntime } = require('../../cloudbase/functions/shared/agent-homework-public');
const { createAgentHomeworkRuntime: createCloudHomeworkRuntime } = require('../../cloudbase/functions/shared/agent-homework-runtime');
const { createHomeworkAgentRuntime } = require('../../src/homework-agent-runtime');
const { createHomeworkRemoteRuntime } = require('../../src/homework-remote-runtime');

function normalizePrefix(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function createInMemoryDb() {
  const documents = new Map();

  function keyFor(collectionName, docId) {
    return `${collectionName}::${docId}`;
  }

  function readDocument(collectionName, docId) {
    const key = keyFor(collectionName, docId);

    if (!documents.has(key)) {
      const error = new Error('document.get:fail not exist');
      error.errMsg = 'document.get:fail not exist';
      throw error;
    }

    return {
      data: cloneJson(documents.get(key))
    };
  }

  function writeDocument(collectionName, docId, data) {
    documents.set(keyFor(collectionName, docId), cloneJson(data));
    return {
      stats: {
        updated: 1
      }
    };
  }

  function collection(collectionName) {
    return {
      doc(docId) {
        return {
          async get() {
            return readDocument(collectionName, docId);
          },
          async set({ data }) {
            return writeDocument(collectionName, docId, data);
          }
        };
      }
    };
  }

  return {
    collection,
    async runTransaction(handler) {
      return handler({
        collection
      });
    }
  };
}

function readOptionalFile(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
}

function restoreOptionalFile(filePath, buffer) {
  if (buffer === null) {
    fs.rmSync(filePath, {
      force: true
    });
    return;
  }

  fs.mkdirSync(path.dirname(filePath), {
    recursive: true
  });
  fs.writeFileSync(filePath, buffer);
}

function createFetchAdapter(publicRuntime) {
  return async (url, options = {}) => {
    const response = await publicRuntime.handleHttpEvent({
      httpMethod: normalizePrefix(options.method) || 'GET',
      headers: options.headers || {},
      body: options.body || ''
    });

    if (!response || typeof response.body !== 'string' || !response.body) {
      return {};
    }

    return JSON.parse(response.body);
  };
}

async function callHomeworkInterface(publicRuntime, method, token, payload) {
  const response = await publicRuntime.handleHttpEvent({
    httpMethod: method,
    headers: token
      ? {
          Authorization: `Bearer ${token}`
        }
      : {},
    body: payload ? JSON.stringify(payload) : ''
  });

  return {
    statusCode: response.statusCode,
    body: response.body ? JSON.parse(response.body) : {}
  };
}

function createTestImageBuffer() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAxElEQVR4nO3YwQmAMBAAQVf673lXIAjBzDKMNiKz7YQZE12rL7M4n8M1w6PNrT0PgJ8EaANoA2gDaANoA2gDaANoA2j7P6s3kYxN0m5m3r1j8X+WJ2vLx3+Xw0Q1l1Qx5R2Q3iU7g4E3x2I9jG6+uKAgICAwP8Jv4Z0m3+fcl4dQBtAG0AbQBtAG0AbQBtAG0AbQBtAG0AbQBtAG0AbQBtAG0A7QBV/Qk0E12aT0AAAAASUVORK5CYII=',
    'base64'
  );
}

function createInlineImageSource(fileName) {
  return {
    fileName,
    contentType: 'image/png',
    base64: createTestImageBuffer().toString('base64')
  };
}

function createMemorySourceStore() {
  const sourceMap = new Map();

  return {
    async saveInlineSources(requestId, inlineSources = []) {
      return inlineSources.map((item, index) => {
        const fileId = `${requestId}-source-${index + 1}`;
        sourceMap.set(fileId, `data:${item.contentType};base64,${item.buffer.toString('base64')}`);

        return {
          sourceType: 'storage',
          fileId,
          cloudPath: fileId,
          fileName: item.fileName,
          contentType: item.contentType,
          fileKind: item.fileKind,
          size: item.buffer.length
        };
      });
    },
    async resolveSourceUrls(sourceItems = []) {
      return sourceItems
        .map((item) => sourceMap.get(item.fileId) || '')
        .filter(Boolean);
    },
    async deleteStoredSources(sourceItems = []) {
      const deleted = [];

      for (const item of sourceItems) {
        const fileId = normalizePrefix(item && item.fileId);

        if (!fileId || !sourceMap.has(fileId)) {
          continue;
        }

        sourceMap.delete(fileId);
        deleted.push(fileId);
      }

      return deleted;
    },
    getStoredSourceCount() {
      return sourceMap.size;
    }
  };
}

function collectStatuses(items = []) {
  return items.map((item) => normalizePrefix(item && item.status));
}

function ensureStatuses(report, statuses, expectedStatus, label) {
  if (!statuses.length || statuses.some((status) => status !== expectedStatus)) {
    report.failedChecks.push(`${label} 的状态不对：${JSON.stringify(statuses)}`);
    return false;
  }

  return true;
}

async function runHomeworkInterfaceSmoke(options = {}) {
  const {
    rootDir,
    outputDir
  } = options;

  const report = {
    passed: false,
    appPath: '',
    outputDirectory: outputDir,
    failedChecks: [],
    errorMessage: null,
    singleCreateRequestId: '',
    batchCreateRequestIds: [],
    createdJobIds: [],
    pendingCreateCountBeforeSync: 0,
    singleCreateStatusBeforeSync: '',
    batchCreateStatusesBeforeSync: [],
    createStatusesAfterSync: [],
    queryByDateCount: 0,
    queryByBucketCount: 0,
    queryBySubjectCount: 0,
    queryByCombinedCount: 0,
    deleteSingleBlocked: false,
    deleteBatchBlocked: false,
    createdSourceFileCounts: [],
    remainingStoredSourceCountAfterSync: -1
  };

  const studyToolsStatePath = path.join(process.env.APPDATA || '', 'StudyGate', 'study-tools-state.json');
  const homeworkAppDataPath = path.join(process.env.LOCALAPPDATA || '', 'HomeworkApp');
  const jobsPath = path.join(homeworkAppDataPath, 'Jobs');
  const recentJobsPath = path.join(homeworkAppDataPath, 'recentJobs.json');
  const lastJobPath = path.join(homeworkAppDataPath, 'lastJob.txt');
  const readToken = 'homework-read-token';
  const agentWriteToken = 'homework-agent-token';
  const db = createInMemoryDb();
  const sourceStore = createMemorySourceStore();
  const stateBackup = readOptionalFile(studyToolsStatePath);
  const recentBackup = readOptionalFile(recentJobsPath);
  const lastBackup = readOptionalFile(lastJobPath);
  let studyToolsState = stateBackup
    ? JSON.parse(stateBackup.toString('utf8'))
    : {
        classMarks: {},
        agentHomeworkRequestMarks: {}
      };

  const appPath = path.join(rootDir, 'dist', 'StudyGate-win32-x64', 'modules', 'homework', 'HomeworkApp.exe');
  report.appPath = appPath;

  const cloudHomeworkRuntime = createCloudHomeworkRuntime({
    db,
    collectionName: 'study_agent_homework_requests',
    docId: 'main',
    ensureCollectionExists: async () => {},
    maxRequests: 60,
    normalizePrefix,
    normalizeId: (value, fallback) => {
      const normalized = normalizePrefix(value)
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '');

      return normalized || fallback;
    },
    sourceStore
  });
  const publicRuntime = createAgentHomeworkPublicRuntime({
    agentHomeworkRuntime: cloudHomeworkRuntime,
    readToken,
    agentWriteToken,
    normalizePrefix
  });
  const fetchJson = createFetchAdapter(publicRuntime);
  const localHomeworkRuntime = createHomeworkAgentRuntime({
    fetchJson,
    fs,
    normalizePrefix,
    getStudyToolsState: () => studyToolsState,
    pathModule: path,
    resolveHomeworkExecutablePath: () => appPath,
    saveStudyToolsState: () => {
      fs.mkdirSync(path.dirname(studyToolsStatePath), {
        recursive: true
      });
      fs.writeFileSync(studyToolsStatePath, `${JSON.stringify(studyToolsState, null, 2)}\n`, 'utf8');
    },
    spawn
  });
  const remoteHomeworkRuntime = createHomeworkRemoteRuntime({
    fetchJson,
    getAppConfig: () => ({
      remoteHomework: {
        enabled: true,
        url: 'https://example.invalid/homework',
        authToken: readToken,
        refreshMinutes: 3
      }
    }),
    homeworkAgentRuntime: localHomeworkRuntime,
    normalizePrefix
  });

  fs.mkdirSync(outputDir, {
    recursive: true
  });
  fs.mkdirSync(jobsPath, {
    recursive: true
  });

  const singleCreateRequestId = `api-create-single-${Date.now()}`;
  const batchCreateRequestIds = [
    `api-create-batch-${Date.now()}-1`,
    `api-create-batch-${Date.now()}-2`
  ];
  report.singleCreateRequestId = singleCreateRequestId;
  report.batchCreateRequestIds = batchCreateRequestIds;

  try {
    if (!fs.existsSync(appPath)) {
      report.failedChecks.push(`HomeworkApp executable was not found: ${appPath}`);
      return report;
    }

    const singleCreateResponse = await callHomeworkInterface(publicRuntime, 'POST', agentWriteToken, {
      action: 'submitAgentHomeworkRequest',
      requestId: singleCreateRequestId,
      agentId: 'openclaw',
      label: 'OpenClaw',
      subject: '接口作业测试-单条',
      bucket: '课外',
      targetDate: '2026-03-21',
      inlineSources: [createInlineImageSource('single-source.png')]
    });

    if (singleCreateResponse.statusCode !== 200 || !singleCreateResponse.body.ok) {
      report.failedChecks.push(`单条作业创建接口返回异常：${JSON.stringify(singleCreateResponse.body)}`);
      return report;
    }

    const batchCreateResponse = await callHomeworkInterface(publicRuntime, 'POST', agentWriteToken, {
      action: 'submitAgentHomeworkRequests',
      requests: batchCreateRequestIds.map((requestId, index) => ({
        requestId,
        agentId: 'openclaw',
        label: 'OpenClaw',
        subject: `接口作业测试-批量${index + 1}`,
        bucket: index === 0 ? '课内' : '课外',
        targetDate: '2026-03-21',
        inlineSources: [createInlineImageSource(`batch-source-${index + 1}.png`)]
      }))
    });

    if (batchCreateResponse.statusCode !== 200 || !batchCreateResponse.body.ok) {
      report.failedChecks.push(`批量作业创建接口返回异常：${JSON.stringify(batchCreateResponse.body)}`);
      return report;
    }

    const pendingBeforeSyncResponse = await callHomeworkInterface(publicRuntime, 'GET', readToken);
    report.pendingCreateCountBeforeSync = Array.isArray(pendingBeforeSyncResponse.body.items)
      ? pendingBeforeSyncResponse.body.items.length
      : 0;

    if (report.pendingCreateCountBeforeSync !== 3) {
      report.failedChecks.push(`创建同步前的待处理作业数量不对：${report.pendingCreateCountBeforeSync}`);
      return report;
    }

    const singleCreateStatusBefore = await callHomeworkInterface(publicRuntime, 'POST', agentWriteToken, {
      action: 'getAgentHomeworkRequestStatus',
      requestId: singleCreateRequestId
    });
    report.singleCreateStatusBeforeSync = normalizePrefix(
      singleCreateStatusBefore.body && singleCreateStatusBefore.body.request && singleCreateStatusBefore.body.request.status
    );

    const batchCreateStatusBefore = await callHomeworkInterface(publicRuntime, 'POST', agentWriteToken, {
      action: 'getAgentHomeworkRequestStatuses',
      requestIds: batchCreateRequestIds
    });
    report.batchCreateStatusesBeforeSync = collectStatuses(batchCreateStatusBefore.body.requests);

    if (report.singleCreateStatusBeforeSync !== 'pending') {
      report.failedChecks.push(`单条作业创建在同步前状态不对：${report.singleCreateStatusBeforeSync || 'empty'}`);
      return report;
    }

    if (!ensureStatuses(report, report.batchCreateStatusesBeforeSync, 'pending', '批量作业创建')) {
      return report;
    }

    if (!(await remoteHomeworkRuntime.syncRemoteHomeworkRequests())) {
      report.failedChecks.push('创建作业同步返回 false。');
      return report;
    }

    const createStatusesAfter = await callHomeworkInterface(publicRuntime, 'POST', agentWriteToken, {
      action: 'getAgentHomeworkRequestStatuses',
      requestIds: [singleCreateRequestId, ...batchCreateRequestIds]
    });
    report.createStatusesAfterSync = collectStatuses(createStatusesAfter.body.requests);

    if (!ensureStatuses(report, report.createStatusesAfterSync, 'completed', '创建作业同步后')) {
      return report;
    }

    const queryByDateResponse = await callHomeworkInterface(publicRuntime, 'POST', agentWriteToken, {
      action: 'queryAgentHomeworkRequests',
      targetDate: '2026-03-21'
    });
    report.queryByDateCount = Array.isArray(queryByDateResponse.body.requests)
      ? queryByDateResponse.body.requests.length
      : 0;

    if (report.queryByDateCount !== 3) {
      report.failedChecks.push(`按日期查询作业数量不对：${report.queryByDateCount}`);
      return report;
    }

    const queryByBucketResponse = await callHomeworkInterface(publicRuntime, 'POST', agentWriteToken, {
      action: 'queryAgentHomeworkRequests',
      bucket: '课内'
    });
    report.queryByBucketCount = Array.isArray(queryByBucketResponse.body.requests)
      ? queryByBucketResponse.body.requests.length
      : 0;

    if (report.queryByBucketCount !== 1) {
      report.failedChecks.push(`按校内校外查询作业数量不对：${report.queryByBucketCount}`);
      return report;
    }

    const queryBySubjectResponse = await callHomeworkInterface(publicRuntime, 'POST', agentWriteToken, {
      action: 'queryAgentHomeworkRequests',
      subject: '接口作业测试-单条'
    });
    report.queryBySubjectCount = Array.isArray(queryBySubjectResponse.body.requests)
      ? queryBySubjectResponse.body.requests.length
      : 0;

    if (report.queryBySubjectCount !== 1) {
      report.failedChecks.push(`按科目查询作业数量不对：${report.queryBySubjectCount}`);
      return report;
    }

    const queryByCombinedResponse = await callHomeworkInterface(publicRuntime, 'POST', agentWriteToken, {
      action: 'queryAgentHomeworkRequests',
      targetDate: '2026-03-21',
      subject: '接口作业测试-单条',
      bucket: '课外'
    });
    report.queryByCombinedCount = Array.isArray(queryByCombinedResponse.body.requests)
      ? queryByCombinedResponse.body.requests.length
      : 0;

    if (report.queryByCombinedCount !== 1) {
      report.failedChecks.push(`按日期+科目+校内校外组合查询数量不对：${report.queryByCombinedCount}`);
      return report;
    }

    report.remainingStoredSourceCountAfterSync = sourceStore.getStoredSourceCount();

    if (report.remainingStoredSourceCountAfterSync !== 0) {
      report.failedChecks.push(
        `创建作业同步完成后，云端暂存源文件没有被清空：${report.remainingStoredSourceCountAfterSync}`
      );
      return report;
    }

    const createdRequests = Array.isArray(createStatusesAfter.body.requests) ? createStatusesAfter.body.requests : [];
    report.createdJobIds = createdRequests.map((item) =>
      normalizePrefix(item && item.result && item.result.jobId)
    );

    for (const request of createdRequests) {
      const jobId = normalizePrefix(request && request.result && request.result.jobId);
      const jobDirectory = path.join(jobsPath, jobId);

      if (!jobId || !fs.existsSync(jobDirectory)) {
        report.failedChecks.push(`作业创建完成后目录不存在：${jobId || 'empty'}`);
        return report;
      }

      const jobJsonPath = path.join(jobDirectory, 'job.json');
      const jobJson = fs.existsSync(jobJsonPath)
        ? JSON.parse(fs.readFileSync(jobJsonPath, 'utf8'))
        : null;
      const sourceFileCount = jobJson && Array.isArray(jobJson.sourceFiles) ? jobJson.sourceFiles.length : 0;
      report.createdSourceFileCounts.push(sourceFileCount);

      if (sourceFileCount < 1) {
        report.failedChecks.push(`作业 ${jobId} 没有把 inline 图片导入进去。`);
        return report;
      }
    }

    const singleDeleteResponse = await callHomeworkInterface(publicRuntime, 'POST', agentWriteToken, {
      action: 'submitAgentHomeworkDeleteRequest',
      requestId: `api-delete-single-${Date.now()}`,
      agentId: 'openclaw',
      label: 'OpenClaw',
      jobId: report.createdJobIds[0],
      subject: '接口作业测试-单条',
      bucket: '课外',
      targetDate: '2026-03-21'
    });

    report.deleteSingleBlocked =
      singleDeleteResponse.statusCode === 400
      && normalizePrefix(singleDeleteResponse.body && singleDeleteResponse.body.error) === 'unsupported_action';

    if (!report.deleteSingleBlocked) {
      report.failedChecks.push(`单条作业删除接口应该被禁用：${JSON.stringify(singleDeleteResponse.body)}`);
      return report;
    }

    const batchDeleteResponse = await callHomeworkInterface(publicRuntime, 'POST', agentWriteToken, {
      action: 'submitAgentHomeworkDeleteRequests',
      requests: report.createdJobIds.slice(1).map((jobId, index) => ({
        requestId: `api-delete-batch-${Date.now()}-${index + 1}`,
        agentId: 'openclaw',
        label: 'OpenClaw',
        jobId,
        subject: `接口作业测试-批量${index + 1}`,
        bucket: index === 0 ? '课内' : '课外',
        targetDate: '2026-03-21'
      }))
    });

    report.deleteBatchBlocked =
      batchDeleteResponse.statusCode === 400
      && normalizePrefix(batchDeleteResponse.body && batchDeleteResponse.body.error) === 'unsupported_action';

    if (!report.deleteBatchBlocked) {
      report.failedChecks.push(`批量作业删除接口应该被禁用：${JSON.stringify(batchDeleteResponse.body)}`);
      return report;
    }

    report.passed = true;
    fs.writeFileSync(
      path.join(outputDir, 'report.json'),
      `${JSON.stringify(report, null, 2)}\n`,
      'utf8'
    );
    return report;
  } catch (error) {
    report.errorMessage = error && error.stack ? error.stack : String(error);
    report.failedChecks.push(error && error.message ? error.message : String(error));
    return report;
  } finally {
    for (const jobId of report.createdJobIds) {
      fs.rmSync(path.join(jobsPath, jobId), {
        recursive: true,
        force: true
      });
    }

    restoreOptionalFile(recentJobsPath, recentBackup);
    restoreOptionalFile(lastJobPath, lastBackup);
    restoreOptionalFile(studyToolsStatePath, stateBackup);

    if (!fs.existsSync(path.join(outputDir, 'report.json'))) {
      fs.writeFileSync(
        path.join(outputDir, 'report.json'),
        `${JSON.stringify(report, null, 2)}\n`,
        'utf8'
      );
    }
  }
}

module.exports = {
  runHomeworkInterfaceSmoke
};
