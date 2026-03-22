'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function execFileAsync(command, args, options = {}) {
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

async function invokeSkill(rootDir, env, command, payload) {
  const scriptPath = path.join(rootDir, 'skills', 'study-helper', 'scripts', 'study-helper.js');
  const args = [scriptPath, command, '--标准输入'];
  const child = spawn('node', args, {
    cwd: rootDir,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  });

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  child.stdin.write(`${JSON.stringify(payload, null, 2)}\n`);
  child.stdin.end();

  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });

  if (exitCode !== 0) {
    throw new Error(normalizeText(stderr) || `学习助手命令 ${command} 失败，退出码 ${exitCode}`);
  }

  return stdout ? JSON.parse(stdout) : {};
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function stopProcessByPath(executablePath) {
  const normalizedPath = String(executablePath || '').replace(/\//g, '\\');
  const command = `$target='${normalizedPath.replace(/'/g, "''")}'; Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath -ieq $target } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }`;
  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    windowsHide: true
  }).catch(() => {});
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function runStudyHelperLearningLiveCheck({ rootDir, outputDir }) {
  const report = {
    passed: false,
    failedChecks: [],
    outputDir
  };
  const appPath = path.join(rootDir, 'dist', 'StudyGate-win32-x64', 'StudyGate.exe');
  const tempRoot = path.join(outputDir, 'runtime');
  const appData = path.join(tempRoot, 'AppData', 'Roaming');
  const userProfile = path.join(tempRoot, 'User');
  const moduleDataRoot = path.join(tempRoot, 'module-data-root');
  const env = {
    ...process.env,
    STUDYGATE_SCHEDULE_PUBLIC_URL: 'https://selfuse-5g3tkjfq0ede092b-1324687027.ap-shanghai.app.tcloudbase.com/api/schedule',
    STUDYGATE_AGENT_WRITE_TOKEN: 'c74714689ce94dd78ab921d99fa1ddc1a06c3ac9ff3e40bdacc6e0e6f8bc8763'
  };

  await fs.rm(outputDir, {
    recursive: true,
    force: true
  });
  await fs.mkdir(moduleDataRoot, {
    recursive: true
  });

  const dictationPayload = {
    requestId: `live-dictation-${Date.now()}`,
    title: '英语听写 smoke',
    subject: '英语',
    bucket: '课外',
    targetDate: '2026-03-22',
    language: '英语',
    items: ['apple', 'banana', 'orange']
  };
  const recitationPayload = {
    requestId: `live-recitation-${Date.now()}`,
    title: '静夜思 smoke',
    subject: '语文',
    bucket: '课内',
    targetDate: '2026-03-22',
    sourceText: '床前明月光，疑是地上霜。举头望明月，低头思故乡。'
  };

  report.dictationCreate = await invokeSkill(rootDir, env, '创建听写', dictationPayload);
  report.recitationCreate = await invokeSkill(rootDir, env, '创建背诵', recitationPayload);

  const child = spawn(appPath, [], {
    cwd: path.dirname(appPath),
    env: {
      ...process.env,
      APPDATA: appData,
      USERPROFILE: userProfile,
      HOME: userProfile,
      STUDYGATE_MODULES_DATA_ROOT: moduleDataRoot
    },
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  });
  child.unref();

  try {
    await sleep(18000);
  } finally {
    await stopProcessByPath(appPath);
  }

  const dictationTasksPath = path.join(moduleDataRoot, 'DictationApp', 'tasks.json');
  const recitationTasksPath = path.join(moduleDataRoot, 'RecitationApp', 'tasks.json');
  const dictationTasks = await readJsonIfExists(dictationTasksPath);
  const recitationTasks = await readJsonIfExists(recitationTasksPath);
  const dictationStatus = await execFileAsync(
    'node',
    [
      path.join(rootDir, 'skills', 'study-helper', 'scripts', 'study-helper.js'),
      '听写状态',
      '--请求编号',
      report.dictationCreate.request.id
    ],
    {
      cwd: rootDir,
      env
    }
  );
  const recitationStatus = await execFileAsync(
    'node',
    [
      path.join(rootDir, 'skills', 'study-helper', 'scripts', 'study-helper.js'),
      '背诵状态',
      '--请求编号',
      report.recitationCreate.request.id
    ],
    {
      cwd: rootDir,
      env
    }
  );

  report.dictationStatus = JSON.parse(dictationStatus.stdout || '{}');
  report.recitationStatus = JSON.parse(recitationStatus.stdout || '{}');
  report.dictationTasksPath = dictationTasksPath;
  report.recitationTasksPath = recitationTasksPath;
  report.dictationTaskCount = Array.isArray(dictationTasks && dictationTasks.tasks) ? dictationTasks.tasks.length : 0;
  report.recitationTaskCount = Array.isArray(recitationTasks && recitationTasks.tasks) ? recitationTasks.tasks.length : 0;
  report.dictationTaskTitles = Array.isArray(dictationTasks && dictationTasks.tasks)
    ? dictationTasks.tasks.map((item) => item.title)
    : [];
  report.recitationTaskTitles = Array.isArray(recitationTasks && recitationTasks.tasks)
    ? recitationTasks.tasks.map((item) => item.title)
    : [];

  if (normalizeText(report.dictationStatus.request && report.dictationStatus.request.status) !== 'completed') {
    report.failedChecks.push(`线上听写状态不是 completed：${normalizeText(report.dictationStatus.request && report.dictationStatus.request.status) || 'empty'}`);
  }

  if (normalizeText(report.recitationStatus.request && report.recitationStatus.request.status) !== 'completed') {
    report.failedChecks.push(`线上背诵状态不是 completed：${normalizeText(report.recitationStatus.request && report.recitationStatus.request.status) || 'empty'}`);
  }

  if (report.dictationTaskCount < 1) {
    report.failedChecks.push('本地没有生成听写任务文件。');
  }

  if (report.recitationTaskCount < 1) {
    report.failedChecks.push('本地没有生成背诵任务文件。');
  }

  report.passed = report.failedChecks.length === 0;
  await fs.writeFile(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

module.exports = {
  runStudyHelperLearningLiveCheck
};
