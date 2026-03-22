'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFile } = require('node:child_process');

function createTestImageBuffer() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAxElEQVR4nO3YwQmAMBAAQVf673lXIAjBzDKMNiKz7YQZE12rL7M4n8M1w6PNrT0PgJ8EaANoA2gDaANoA2gDaANoA2j7P6s3kYxN0m5m3r1j8X+WJ2vLx3+Xw0Q1l1Qx5R2Q3iU7g4E3x2I9jG6+uKAgICAwP8Jv4Z0m3+fcl4dQBtAG0AbQBtAG0AbQBtAG0AbQBtAG0AbQBtAG0AbQBtAG0A7QBV/Qk0E12aT0AAAAASUVORK5CYII=',
    'base64'
  );
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseJson(text) {
  return text ? JSON.parse(text) : {};
}

function execFileAsync(command, args, options) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }

      resolve({
        stdout,
        stderr
      });
    });
  });
}

function filterRequests(requests, payload) {
  const targetDate = normalizeText(payload.targetDate);
  const subject = normalizeText(payload.subject);
  const bucket = normalizeText(payload.bucket);

  return requests.filter((item) => {
    if (targetDate && item.targetDate !== targetDate) {
      return false;
    }

    if (subject && item.subject !== subject) {
      return false;
    }

    if (bucket && item.bucket !== bucket) {
      return false;
    }

    return true;
  });
}

function runStudyHelperSmoke(options = {}) {
  const {
    rootDir,
    outputDir
  } = options;

  const report = {
    passed: false,
    failedChecks: [],
    errorMessage: null,
    receivedUploadAction: '',
    receivedCreateAction: '',
    receivedQueryAction: '',
    uploadedInlineSourceCount: 0,
    createdSourceItemCount: 0,
    sourceFilesLeakedToServer: false,
    queryMatchCount: 0
  };

  const scriptPath = path.join(rootDir, 'skills', 'study-helper', 'scripts', 'study-helper.js');
  const tempDir = path.join(outputDir, 'study-helper');
  const imagePath = path.join(tempDir, 'qq-homework-image.png');
  const createPayloadPath = path.join(tempDir, 'create.json');
  const queryPayloadPath = path.join(tempDir, 'query.json');
  const requestRecords = [];
  let server;

  fs.mkdirSync(tempDir, { recursive: true });
  fs.writeFileSync(imagePath, createTestImageBuffer());
  fs.writeFileSync(createPayloadPath, `${JSON.stringify({
    requestId: 'study-helper-image-create-1',
    subject: '数学',
    bucket: '课内',
    targetDate: '2026-03-21',
    sourceFiles: [imagePath]
  }, null, 2)}\n`, 'utf8');
  fs.writeFileSync(queryPayloadPath, `${JSON.stringify({
    targetDate: '2026-03-21',
    subject: '数学',
    bucket: '课内'
  }, null, 2)}\n`, 'utf8');

  return new Promise((resolve) => {
    server = http.createServer((request, response) => {
      const chunks = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', () => {
        const body = parseJson(Buffer.concat(chunks).toString('utf8'));
        const authHeader = normalizeText(request.headers.authorization);

        response.setHeader('Content-Type', 'application/json; charset=utf-8');

        if (authHeader !== 'Bearer smoke-homework-token') {
          response.statusCode = 403;
          response.end(JSON.stringify({ error: 'forbidden' }));
          return;
        }

        if (body.action === 'uploadAgentHomeworkSources') {
          report.receivedUploadAction = body.action;
          report.uploadedInlineSourceCount = Array.isArray(body.inlineSources) ? body.inlineSources.length : 0;
          report.sourceFilesLeakedToServer = Array.isArray(body.sourceFiles) && body.sourceFiles.length > 0;
          response.end(JSON.stringify({
            ok: true,
            sourceItems: [
              {
                sourceType: 'storage',
                fileId: 'cloud-source-1',
                cloudPath: 'studygate-agent-homework/test/cloud-source-1.png',
                fileName: 'qq-homework-image.png',
                contentType: 'image/png',
                fileKind: 'image',
                size: 1024
              }
            ]
          }));
          return;
        }

        if (body.action === 'submitAgentHomeworkRequest') {
          report.receivedCreateAction = body.action;
          report.createdSourceItemCount = Array.isArray(body.sourceItems) ? body.sourceItems.length : 0;

          const record = {
            id: body.requestId,
            status: 'pending',
            subject: body.subject,
            bucket: body.bucket,
            targetDate: body.targetDate,
            mode: report.uploadedInlineSourceCount ? 'files' : 'blank',
            requestedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          requestRecords.push(record);
          response.end(JSON.stringify({
            ok: true,
            status: 'pending',
            request: record
          }));
          return;
        }

        if (body.action === 'queryAgentHomeworkRequests') {
          report.receivedQueryAction = body.action;
          const matches = filterRequests(requestRecords, body);
          report.queryMatchCount = matches.length;
          response.end(JSON.stringify({
            ok: true,
            requests: matches
          }));
          return;
        }

        response.statusCode = 400;
        response.end(JSON.stringify({ error: 'unsupported_action' }));
      });
    });

    server.listen(0, '127.0.0.1', async () => {
      try {
        const address = server.address();
        const homeworkUrl = `http://127.0.0.1:${address.port}/api/homework`;
        const env = {
          ...process.env,
          STUDYGATE_HOMEWORK_PUBLIC_URL: homeworkUrl,
          STUDYGATE_HOMEWORK_AGENT_WRITE_TOKEN: 'smoke-homework-token'
        };

        await execFileAsync(
          'node',
          [scriptPath, '创建作业', '--载荷文件', createPayloadPath],
          {
            cwd: rootDir,
            env,
          }
        );

        await execFileAsync(
          'node',
          [scriptPath, '查询作业', '--载荷文件', queryPayloadPath],
          {
            cwd: rootDir,
            env,
          }
        );

        if (report.receivedUploadAction !== 'uploadAgentHomeworkSources') {
          report.failedChecks.push(`学习助手没有先走云存储上传动作：${report.receivedUploadAction || 'empty'}`);
        }

        if (report.receivedCreateAction !== 'submitAgentHomeworkRequest') {
          report.failedChecks.push(`学习助手没有走图片创建动作：${report.receivedCreateAction || 'empty'}`);
        }

        if (report.uploadedInlineSourceCount !== 1) {
          report.failedChecks.push(`学习助手没有把本地图片上传到云存储：${report.uploadedInlineSourceCount}`);
        }

        if (report.createdSourceItemCount !== 1) {
          report.failedChecks.push(`学习助手创建作业时没有带上云存储 sourceItems：${report.createdSourceItemCount}`);
        }

        if (report.sourceFilesLeakedToServer) {
          report.failedChecks.push('学习助手把 sourceFiles 原样发给了云端。');
        }

        if (report.receivedQueryAction !== 'queryAgentHomeworkRequests') {
          report.failedChecks.push(`学习助手没有走查询作业动作：${report.receivedQueryAction || 'empty'}`);
        }

        if (report.queryMatchCount !== 1) {
          report.failedChecks.push(`按日期/科目/校内校外查询作业数量不对：${report.queryMatchCount}`);
        }

        report.passed = report.failedChecks.length === 0;
      } catch (error) {
        report.errorMessage = error && error.stack ? error.stack : String(error);
        report.failedChecks.push(error && error.message ? error.message : String(error));
      } finally {
        fs.writeFileSync(
          path.join(outputDir, 'report.json'),
          `${JSON.stringify(report, null, 2)}\n`,
          'utf8'
        );
        server.close(() => resolve(report));
      }
    });
  });
}

module.exports = {
  runStudyHelperSmoke
};
