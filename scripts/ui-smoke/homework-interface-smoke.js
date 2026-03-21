'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
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
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yF9kAAAAASUVORK5CYII=',
    'base64'
  );
}

async function startStaticImageServer(filePath) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      if (!request || request.url !== '/test-source.png') {
        response.writeHead(404);
        response.end();
        return;
      }

      response.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store'
      });
      response.end(fs.readFileSync(filePath));
    });

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();

      if (!address || typeof address === 'string') {
        reject(new Error('测试图片服务启动失败。'));
        return;
      }

      resolve({
        close: () =>
          new Promise((closeResolve) => {
            server.close(() => closeResolve());
          }),
        url: `http://127.0.0.1:${address.port}/test-source.png`
      });
    });
  });
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
    createRequestId: '',
    deleteRequestId: '',
    createdJobId: '',
    createdJobDirectory: '',
    createStatusBeforeSync: '',
    createStatusAfterSync: '',
    deleteStatusBeforeSync: '',
    deleteStatusAfterSync: '',
    sourceImagePath: '',
    sourceImageUrl: '',
    createdSourceFileCount: 0
  };

  const studyToolsStatePath = path.join(process.env.APPDATA || '', 'StudyGate', 'study-tools-state.json');
  const homeworkAppDataPath = path.join(process.env.LOCALAPPDATA || '', 'HomeworkApp');
  const jobsPath = path.join(homeworkAppDataPath, 'Jobs');
  const recentJobsPath = path.join(homeworkAppDataPath, 'recentJobs.json');
  const lastJobPath = path.join(homeworkAppDataPath, 'lastJob.txt');
  const readToken = 'homework-read-token';
  const agentWriteToken = 'homework-agent-token';
  const db = createInMemoryDb();
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
    maxRequests: 60,
    normalizePrefix,
    normalizeId: (value, fallback) => {
      const normalized = normalizePrefix(value)
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '');

      return normalized || fallback;
    }
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
    spawn: require('node:child_process').spawn
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

  const subject = `接口作业测试-${Date.now()}`;
  const createRequestId = `api-create-${Date.now()}`;
  const deleteRequestId = `api-delete-${Date.now()}`;
  const sourceImagePath = path.join(outputDir, 'test-source.png');
  report.createRequestId = createRequestId;
  report.deleteRequestId = deleteRequestId;
  report.sourceImagePath = sourceImagePath;

  fs.writeFileSync(sourceImagePath, createTestImageBuffer());

  let sourceImageServer = null;

  try {
    if (!fs.existsSync(appPath)) {
      report.failedChecks.push(`HomeworkApp executable was not found: ${appPath}`);
      return report;
    }

    sourceImageServer = await startStaticImageServer(sourceImagePath);
    report.sourceImageUrl = sourceImageServer.url;

    const createResponse = await callHomeworkInterface(publicRuntime, 'POST', agentWriteToken, {
      action: 'submitAgentHomeworkRequest',
      requestId: createRequestId,
      agentId: 'openclaw',
      label: 'OpenClaw',
      subject,
      bucket: '课外',
      targetDate: '2026-03-20',
      sourceUrls: [sourceImageServer.url]
    });

    if (createResponse.statusCode !== 200 || !createResponse.body.ok) {
      report.failedChecks.push(`作业创建接口返回异常：${JSON.stringify(createResponse.body)}`);
      return report;
    }

    const createStatusBefore = await callHomeworkInterface(publicRuntime, 'POST', agentWriteToken, {
      action: 'getAgentHomeworkRequestStatus',
      requestId: createRequestId
    });
    report.createStatusBeforeSync = normalizePrefix(
      createStatusBefore.body && createStatusBefore.body.request && createStatusBefore.body.request.status
    );

    if (report.createStatusBeforeSync !== 'pending') {
      report.failedChecks.push(`作业创建接口在同步前状态不对：${report.createStatusBeforeSync || 'empty'}`);
      return report;
    }

    if (!(await remoteHomeworkRuntime.syncRemoteHomeworkRequests())) {
      report.failedChecks.push('远程作业创建同步返回 false。');
      return report;
    }

    const createStatusAfter = await callHomeworkInterface(publicRuntime, 'POST', agentWriteToken, {
      action: 'getAgentHomeworkRequestStatus',
      requestId: createRequestId
    });
    report.createStatusAfterSync = normalizePrefix(
      createStatusAfter.body && createStatusAfter.body.request && createStatusAfter.body.request.status
    );

    if (report.createStatusAfterSync !== 'completed') {
      report.failedChecks.push(`作业创建接口在同步后没有完成：${report.createStatusAfterSync || 'empty'}`);
      return report;
    }

    report.createdJobId = normalizePrefix(
      createStatusAfter.body &&
        createStatusAfter.body.request &&
        createStatusAfter.body.request.result &&
        createStatusAfter.body.request.result.jobId
    );
    report.createdJobDirectory = path.join(jobsPath, report.createdJobId);

    if (!report.createdJobId || !fs.existsSync(report.createdJobDirectory)) {
      report.failedChecks.push('作业创建完成后，本地作业目录不存在。');
      return report;
    }

    const createdJobJsonPath = path.join(report.createdJobDirectory, 'job.json');
    const createdJobJson = fs.existsSync(createdJobJsonPath)
      ? JSON.parse(fs.readFileSync(createdJobJsonPath, 'utf8'))
      : null;
    report.createdSourceFileCount =
      createdJobJson && Array.isArray(createdJobJson.sourceFiles) ? createdJobJson.sourceFiles.length : 0;

    if (report.createdSourceFileCount < 1) {
      report.failedChecks.push('接口创建作业后，没有把测试图片导入到作业里。');
      return report;
    }

    const deleteResponse = await callHomeworkInterface(publicRuntime, 'POST', agentWriteToken, {
      action: 'submitAgentHomeworkDeleteRequest',
      requestId: deleteRequestId,
      agentId: 'openclaw',
      label: 'OpenClaw',
      jobId: report.createdJobId,
      subject,
      bucket: '课外',
      targetDate: '2026-03-20'
    });

    if (deleteResponse.statusCode !== 200 || !deleteResponse.body.ok) {
      report.failedChecks.push(`作业删除接口返回异常：${JSON.stringify(deleteResponse.body)}`);
      return report;
    }

    const deleteStatusBefore = await callHomeworkInterface(publicRuntime, 'POST', agentWriteToken, {
      action: 'getAgentHomeworkRequestStatus',
      requestId: deleteRequestId
    });
    report.deleteStatusBeforeSync = normalizePrefix(
      deleteStatusBefore.body && deleteStatusBefore.body.request && deleteStatusBefore.body.request.status
    );

    if (report.deleteStatusBeforeSync !== 'pending') {
      report.failedChecks.push(`作业删除接口在同步前状态不对：${report.deleteStatusBeforeSync || 'empty'}`);
      return report;
    }

    if (!(await remoteHomeworkRuntime.syncRemoteHomeworkRequests())) {
      report.failedChecks.push('远程作业删除同步返回 false。');
      return report;
    }

    const deleteStatusAfter = await callHomeworkInterface(publicRuntime, 'POST', agentWriteToken, {
      action: 'getAgentHomeworkRequestStatus',
      requestId: deleteRequestId
    });
    report.deleteStatusAfterSync = normalizePrefix(
      deleteStatusAfter.body && deleteStatusAfter.body.request && deleteStatusAfter.body.request.status
    );

    if (report.deleteStatusAfterSync !== 'completed') {
      report.failedChecks.push(`作业删除接口在同步后没有完成：${report.deleteStatusAfterSync || 'empty'}`);
      return report;
    }

    if (fs.existsSync(report.createdJobDirectory)) {
      report.failedChecks.push('作业删除接口完成后，本地作业目录还存在。');
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
    if (sourceImageServer) {
      await sourceImageServer.close().catch(() => {});
    }

    if (report.createdJobId) {
      fs.rmSync(path.join(jobsPath, report.createdJobId), {
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
