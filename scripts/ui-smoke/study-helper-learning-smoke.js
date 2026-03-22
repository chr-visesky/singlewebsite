'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFile } = require('node:child_process');

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

      resolve({ stdout, stderr });
    });
  });
}

function filterRequests(items, payload) {
  const targetDate = normalizeText(payload.targetDate);
  const subject = normalizeText(payload.subject);
  const bucket = normalizeText(payload.bucket);

  return items.filter((item) => {
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

async function invokeSkill(scriptPath, rootDir, env, command, payloadPath, requestId) {
  const args = [scriptPath, command];

  if (payloadPath) {
    args.push('--载荷文件', payloadPath);
  }

  if (requestId) {
    args.push('--请求编号', requestId);
  }

  const result = await execFileAsync('node', args, {
    cwd: rootDir,
    env
  });

  return parseJson(result.stdout);
}

function runStudyHelperLearningSmoke({ rootDir, outputDir }) {
  const report = {
    passed: false,
    failedChecks: [],
    dictation: {},
    recitation: {}
  };
  const scriptPath = path.join(rootDir, 'skills', 'study-helper', 'scripts', 'study-helper.js');
  const tempDir = path.join(outputDir, 'study-helper-learning');
  const dictationRecords = [];
  const recitationRecords = [];
  let server;

  fs.mkdirSync(tempDir, { recursive: true });

  const dictationCreatePath = path.join(tempDir, 'dictation-create.json');
  const dictationQueryPath = path.join(tempDir, 'dictation-query.json');
  const recitationCreatePath = path.join(tempDir, 'recitation-create.json');
  const recitationQueryPath = path.join(tempDir, 'recitation-query.json');

  fs.writeFileSync(dictationCreatePath, `${JSON.stringify({
    requests: [
      {
        requestId: 'smoke-dictation-1',
        subject: '英语',
        bucket: '课外',
        targetDate: '2026-03-22',
        language: '英语',
        items: ['apple', 'banana']
      },
      {
        requestId: 'smoke-dictation-2',
        subject: '语文',
        bucket: '课内',
        targetDate: '2026-03-22',
        items: ['春眠不觉晓']
      }
    ]
  }, null, 2)}\n`, 'utf8');
  fs.writeFileSync(dictationQueryPath, `${JSON.stringify({
    targetDate: '2026-03-22',
    subject: '英语',
    bucket: '课外'
  }, null, 2)}\n`, 'utf8');
  fs.writeFileSync(recitationCreatePath, `${JSON.stringify({
    requestId: 'smoke-recitation-1',
    title: '李白古诗',
    subject: '语文',
    bucket: '课内',
    targetDate: '2026-03-23',
    sourceText: '床前明月光，疑是地上霜。'
  }, null, 2)}\n`, 'utf8');
  fs.writeFileSync(recitationQueryPath, `${JSON.stringify({
    targetDate: '2026-03-23',
    subject: '语文',
    bucket: '课内'
  }, null, 2)}\n`, 'utf8');

  return new Promise((resolve) => {
    server = http.createServer((request, response) => {
      const chunks = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', () => {
        const authHeader = normalizeText(request.headers.authorization);
        const body = parseJson(Buffer.concat(chunks).toString('utf8'));
        response.setHeader('Content-Type', 'application/json; charset=utf-8');

        if (authHeader !== 'Bearer smoke-learning-token') {
          response.statusCode = 403;
          response.end(JSON.stringify({ error: 'forbidden' }));
          return;
        }

        if (request.url === '/api/dictation') {
          if (body.action === 'submitAgentDictationRequests') {
            report.dictation.createAction = body.action;
            report.dictation.batchCount = Array.isArray(body.requests) ? body.requests.length : 0;
            dictationRecords.push(...body.requests.map((item) => ({
              ...item,
              status: 'pending'
            })));
            response.end(JSON.stringify({
              ok: true,
              status: 'pending',
              requests: dictationRecords
            }));
            return;
          }

          if (body.action === 'queryAgentDictationRequests') {
            report.dictation.queryAction = body.action;
            const matches = filterRequests(dictationRecords, body);
            report.dictation.queryMatchCount = matches.length;
            response.end(JSON.stringify({
              ok: true,
              requests: matches
            }));
            return;
          }

          if (body.action === 'getAgentDictationRequestStatus') {
            report.dictation.statusAction = body.action;
            const match = dictationRecords.find((item) => item.requestId === body.requestId) || null;
            response.end(JSON.stringify({
              ok: true,
              request: match
            }));
            return;
          }
        }

        if (request.url === '/api/recitation') {
          if (body.action === 'submitAgentRecitationRequest') {
            report.recitation.createAction = body.action;
            report.recitation.sourceTextLength = normalizeText(body.sourceText).length;
            const record = {
              ...body,
              status: 'pending'
            };
            recitationRecords.push(record);
            response.end(JSON.stringify({
              ok: true,
              status: 'pending',
              request: record
            }));
            return;
          }

          if (body.action === 'queryAgentRecitationRequests') {
            report.recitation.queryAction = body.action;
            const matches = filterRequests(recitationRecords, body);
            report.recitation.queryMatchCount = matches.length;
            response.end(JSON.stringify({
              ok: true,
              requests: matches
            }));
            return;
          }

          if (body.action === 'getAgentRecitationRequestStatus') {
            report.recitation.statusAction = body.action;
            const match = recitationRecords.find((item) => item.requestId === body.requestId) || null;
            response.end(JSON.stringify({
              ok: true,
              request: match
            }));
            return;
          }
        }

        response.statusCode = 400;
        response.end(JSON.stringify({ error: 'unsupported_action' }));
      });
    });

    server.listen(0, '127.0.0.1', async () => {
      try {
        const address = server.address();
        const env = {
          ...process.env,
          STUDYGATE_SCHEDULE_PUBLIC_URL: `http://127.0.0.1:${address.port}/api/schedule`,
          STUDYGATE_AGENT_WRITE_TOKEN: 'smoke-learning-token'
        };

        await invokeSkill(scriptPath, rootDir, env, '创建听写', dictationCreatePath);
        await invokeSkill(scriptPath, rootDir, env, '查询听写', dictationQueryPath);
        await invokeSkill(scriptPath, rootDir, env, '听写状态', null, 'smoke-dictation-1');
        await invokeSkill(scriptPath, rootDir, env, '创建背诵', recitationCreatePath);
        await invokeSkill(scriptPath, rootDir, env, '查询背诵', recitationQueryPath);
        await invokeSkill(scriptPath, rootDir, env, '背诵状态', null, 'smoke-recitation-1');

        if (report.dictation.createAction !== 'submitAgentDictationRequests') {
          report.failedChecks.push(`学习助手没有走批量听写创建：${report.dictation.createAction || 'empty'}`);
        }

        if (report.dictation.batchCount !== 2) {
          report.failedChecks.push(`学习助手批量听写创建数量不对：${report.dictation.batchCount || 0}`);
        }

        if (report.dictation.queryAction !== 'queryAgentDictationRequests') {
          report.failedChecks.push(`学习助手没有走听写查询：${report.dictation.queryAction || 'empty'}`);
        }

        if (report.dictation.queryMatchCount !== 1) {
          report.failedChecks.push(`学习助手听写查询命中数量不对：${report.dictation.queryMatchCount || 0}`);
        }

        if (report.dictation.statusAction !== 'getAgentDictationRequestStatus') {
          report.failedChecks.push(`学习助手没有走听写状态查询：${report.dictation.statusAction || 'empty'}`);
        }

        if (report.recitation.createAction !== 'submitAgentRecitationRequest') {
          report.failedChecks.push(`学习助手没有走背诵创建：${report.recitation.createAction || 'empty'}`);
        }

        if ((report.recitation.sourceTextLength || 0) === 0) {
          report.failedChecks.push('学习助手背诵创建没有带上原文。');
        }

        if (report.recitation.queryAction !== 'queryAgentRecitationRequests') {
          report.failedChecks.push(`学习助手没有走背诵查询：${report.recitation.queryAction || 'empty'}`);
        }

        if (report.recitation.queryMatchCount !== 1) {
          report.failedChecks.push(`学习助手背诵查询命中数量不对：${report.recitation.queryMatchCount || 0}`);
        }

        if (report.recitation.statusAction !== 'getAgentRecitationRequestStatus') {
          report.failedChecks.push(`学习助手没有走背诵状态查询：${report.recitation.statusAction || 'empty'}`);
        }

        report.passed = report.failedChecks.length === 0;
      } catch (error) {
        report.failedChecks.push(error && error.message ? error.message : String(error));
        report.errorMessage = error && error.stack ? error.stack : String(error);
      } finally {
        fs.writeFileSync(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
        server.close(() => resolve(report));
      }
    });
  });
}

module.exports = {
  runStudyHelperLearningSmoke
};
