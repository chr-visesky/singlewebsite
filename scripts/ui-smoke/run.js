'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { runHomeworkInterfaceSmoke } = require('./homework-interface-smoke');
const { runStudyGateSmoke } = require('./studygate-smoke');

function resolveDotnetPath() {
  const candidates = [
    process.env.DOTNET_ROOT ? path.join(process.env.DOTNET_ROOT, 'dotnet.exe') : '',
    process.env.DOTNET_ROOT_X64 ? path.join(process.env.DOTNET_ROOT_X64, 'dotnet.exe') : '',
    'C:\\dotnet\\dotnet.exe',
    'C:\\Program Files\\dotnet\\dotnet.exe'
  ].filter(Boolean);

  return candidates.find((candidate) => {
    try {
      return require('node:fs').existsSync(candidate);
    } catch {
      return false;
    }
  }) || 'dotnet';
}

function createDotnetEnvironment(dotnetPath) {
  if (!path.isAbsolute(dotnetPath)) {
    return { ...process.env };
  }

  const dotnetRoot = path.dirname(dotnetPath);

  return {
    ...process.env,
    DOTNET_ROOT: process.env.DOTNET_ROOT || dotnetRoot,
    DOTNET_ROOT_X64: process.env.DOTNET_ROOT_X64 || dotnetRoot
  };
}

function escapePowerShellSingleQuoted(value) {
  return String(value || '').replace(/'/g, "''");
}

function stopProcessesByPath(exePath) {
  const command = `
$target = '${escapePowerShellSingleQuoted(String(exePath || '').replace(/\//g, '\\'))}'
Get-CimInstance Win32_Process |
  Where-Object { $_.ExecutablePath -and $_.ExecutablePath -ieq $target } |
  ForEach-Object {
    try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {}
  }
`;

  execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
    {
      stdio: 'ignore'
    }
  );
}

function runHomeworkSmoke(rootDir, outputDir, options = {}) {
  const dotnetPath = resolveDotnetPath();
  const dotnetEnv = createDotnetEnvironment(dotnetPath);
  const projectPath = path.join(rootDir, 'tools', 'HomeworkApp.UiSmoke', 'HomeworkApp.UiSmoke.csproj');
  const homeworkAppPath = path.join(rootDir, 'dist', 'StudyGate-win32-x64', 'modules', 'homework', 'HomeworkApp.exe');
  const existingProcessId = Number.isFinite(Number(options.processId)) ? Number(options.processId) : 0;

  execFileSync(dotnetPath, ['build', projectPath, '-nologo', '-v:q'], {
    cwd: rootDir,
    stdio: 'inherit',
    env: dotnetEnv
  });

  const assemblyPath = path.join(
    rootDir,
    'tools',
    'HomeworkApp.UiSmoke',
    'bin',
    'Debug',
    'net10.0-windows',
    'HomeworkApp.UiSmoke.dll'
  );

  try {
    const stdout = execFileSync(
      dotnetPath,
      [
        assemblyPath,
        'run-print-smoke',
        '--app',
        homeworkAppPath,
        '--output-dir',
        outputDir,
        ...(existingProcessId > 0 ? ['--process-id', String(existingProcessId)] : [])
      ],
      {
        cwd: rootDir,
        encoding: 'utf8',
        env: dotnetEnv
      }
    );
    return JSON.parse(stdout);
  } catch (error) {
    const stdout = error && typeof error.stdout === 'string' ? error.stdout : '';

    if (stdout) {
      return JSON.parse(stdout);
    }

    throw error;
  }
}

function normalizeHomeworkReport(report) {
  if (!report || typeof report !== 'object') {
    return {
      passed: false,
      failedChecks: ['HomeworkApp smoke report is missing.']
    };
  }

  if (Array.isArray(report.failedChecks)) {
    return report;
  }

  return {
    ...report,
    passed: typeof report.passed === 'boolean' ? report.passed : Boolean(report.Passed),
    failedChecks: Array.isArray(report.FailedChecks) ? report.FailedChecks : []
  };
}

async function main() {
  const rootDir = path.resolve(__dirname, '..', '..');
  const outputDir = path.join(rootDir, 'temp', 'ui-smoke');
  const studyGatePath = path.join(rootDir, 'dist', 'StudyGate-win32-x64', 'StudyGate.exe');
  const homeworkAppPath = path.join(rootDir, 'dist', 'StudyGate-win32-x64', 'modules', 'homework', 'HomeworkApp.exe');

  try {
    await fs.rm(outputDir, {
      recursive: true,
      force: true
    });
    await fs.mkdir(outputDir, { recursive: true });

    const studyGate = await runStudyGateSmoke({
      rootDir,
      outputDir: path.join(outputDir, 'studygate')
    });
    const homework = normalizeHomeworkReport(runHomeworkSmoke(rootDir, path.join(outputDir, 'homework')));
    const homeworkInterface = await runHomeworkInterfaceSmoke({
      rootDir,
      outputDir: path.join(outputDir, 'homework-interface')
    });
    const report = {
      generatedAt: new Date().toISOString(),
      studyGate,
      homework,
      homeworkInterface
    };

    report.failedChecks = [
      ...studyGate.failedChecks,
      ...homework.failedChecks,
      ...(Array.isArray(homeworkInterface.failedChecks) ? homeworkInterface.failedChecks : [])
    ];
    report.passed = report.failedChecks.length === 0;

    const reportPath = path.join(outputDir, 'report.json');
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.passed ? 0 : 1;
  } finally {
    stopProcessesByPath(homeworkAppPath);
    stopProcessesByPath(studyGatePath);
  }
}

main().catch((error) => {
  process.stderr.write(`${(error && error.stack) || String(error)}\n`);
  process.exitCode = 1;
});
