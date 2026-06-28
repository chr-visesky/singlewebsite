'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { runHomeworkInterfaceSmoke } = require('./homework-interface-smoke');
const { runReminderSmoke } = require('./reminder-smoke');
const { runSkillZipSmoke } = require('./skill-zip-smoke');
const { runStudyHelperSmoke } = require('./study-helper-smoke');
const { runStudyHelperLearningSmoke } = require('./study-helper-learning-smoke');
const { runStudyGateSmoke } = require('./studygate-smoke');
const { runStudyModulesSmoke } = require('./study-modules-smoke');
const { runUpdateArtifactSmoke } = require('./update-artifact-smoke');
const { runUpdateRuntimeSmoke } = require('./update-runtime-smoke');

let homeworkSmokeBuilt = false;

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
  const rootDir = path.resolve(__dirname, '..', '..');
  const userProfile = path.join(rootDir, '.dotnet-profile', 'User');
  const appData = path.join(rootDir, '.dotnet-profile', 'AppData', 'Roaming');
  const environment = {
    ...process.env,
    APPDATA: appData,
    USERPROFILE: userProfile,
    HOME: userProfile,
    DOTNET_CLI_HOME: path.join(rootDir, '.dotnet-cli'),
    NUGET_PACKAGES: path.join(rootDir, '.nuget', 'packages')
  };

  if (!path.isAbsolute(dotnetPath)) {
    return environment;
  }

  const dotnetRoot = path.dirname(dotnetPath);

  environment.DOTNET_ROOT = process.env.DOTNET_ROOT || dotnetRoot;
  environment.DOTNET_ROOT_X64 = process.env.DOTNET_ROOT_X64 || dotnetRoot;
  return environment;
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

  try {
    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
      {
        stdio: 'ignore'
      }
    );
  } catch {
    // Ignore cleanup failures so smoke results are not masked by CIM issues.
  }
}

function runHomeworkSmoke(rootDir, outputDir, command, options = {}) {
  const dotnetPath = resolveDotnetPath();
  const dotnetEnv = createDotnetEnvironment(dotnetPath);
  const projectPath = path.join(rootDir, 'tools', 'HomeworkApp.UiSmoke', 'HomeworkApp.UiSmoke.csproj');
  const homeworkAppPath = path.join(rootDir, 'dist', 'StudyGate-win32-x64', 'modules', 'homework', 'HomeworkApp.exe');
  const existingProcessId = Number.isFinite(Number(options.processId)) ? Number(options.processId) : 0;

  if (!homeworkSmokeBuilt) {
    execFileSync(dotnetPath, ['build', projectPath, '-nologo', '-v:q'], {
      cwd: rootDir,
      stdio: 'inherit',
      env: dotnetEnv
    });
    homeworkSmokeBuilt = true;
  }

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
        command,
        '--app',
        homeworkAppPath,
        '--output-dir',
        outputDir,
        ...(existingProcessId > 0 ? ['--process-id', String(existingProcessId)] : []),
        ...(options.leaveProcessRunning ? ['--leave-process-running'] : []),
        ...(options.forceSmokeJob ? ['--force-smoke-job'] : []),
        ...(options.cleanupJobDir ? ['--cleanup-job-dir', options.cleanupJobDir] : [])
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
    const studyGateAdvanced = {
      passed: Array.isArray(studyGate.failedChecks) ? studyGate.failedChecks.length === 0 : Boolean(studyGate.passed),
      failedChecks: [],
      classroomNavigationResult: studyGate.classroomNavigationResult,
      learningToolLaunchResult: studyGate.learningToolLaunchResult,
      learningToolLaunched: studyGate.learningToolLaunched,
      zoomAfterCtrlWheel: studyGate.zoomAfterCtrlWheel,
      zoomAfterSubframeCtrlWheel: studyGate.zoomAfterSubframeCtrlWheel,
      zoomAfterReset: studyGate.zoomAfterReset
    };
    const homework = normalizeHomeworkReport(
      runHomeworkSmoke(rootDir, path.join(outputDir, 'homework'), 'run-print-smoke', {
        forceSmokeJob: true
      })
    );
    const homeworkEditor = normalizeHomeworkReport(
      runHomeworkSmoke(rootDir, path.join(outputDir, 'homework-editor'), 'run-editor-controls-smoke')
    );
    const homeworkInterface = await runHomeworkInterfaceSmoke({
      rootDir,
      outputDir: path.join(outputDir, 'homework-interface')
    });
    const reminder = await runReminderSmoke({
      rootDir,
      outputDir: path.join(outputDir, 'reminder')
    });
    const studyHelper = await runStudyHelperSmoke({
      rootDir,
      outputDir: path.join(outputDir, 'study-helper')
    });
    const studyHelperLearning = await runStudyHelperLearningSmoke({
      rootDir,
      outputDir: path.join(outputDir, 'study-helper-learning')
    });
    const studyModules = await runStudyModulesSmoke({
      rootDir,
      outputDir: path.join(outputDir, 'study-modules')
    });
    const skillZip = await runSkillZipSmoke({
      rootDir,
      outputDir: path.join(outputDir, 'skill-zip')
    });
    const updateArtifacts = await runUpdateArtifactSmoke({
      rootDir
    });
    const updateRuntime = await runUpdateRuntimeSmoke({
      rootDir,
      outputDir: path.join(outputDir, 'update-runtime')
    });
    const report = {
      generatedAt: new Date().toISOString(),
      studyGate,
      studyGateAdvanced,
      homework,
      homeworkEditor,
      homeworkInterface,
      reminder,
      studyHelper,
      studyHelperLearning,
      studyModules,
      skillZip,
      updateArtifacts,
      updateRuntime
    };

    report.failedChecks = [
      ...studyGate.failedChecks,
      ...(Array.isArray(studyGateAdvanced.failedChecks) ? studyGateAdvanced.failedChecks : []),
      ...homework.failedChecks,
      ...homeworkEditor.failedChecks,
      ...(Array.isArray(homeworkInterface.failedChecks) ? homeworkInterface.failedChecks : []),
      ...(Array.isArray(reminder.failedChecks) ? reminder.failedChecks : []),
      ...(Array.isArray(studyHelper.failedChecks) ? studyHelper.failedChecks : []),
      ...(Array.isArray(studyHelperLearning.failedChecks) ? studyHelperLearning.failedChecks : []),
      ...(Array.isArray(studyModules.failedChecks) ? studyModules.failedChecks : []),
      ...(Array.isArray(skillZip.failedChecks) ? skillZip.failedChecks : []),
      ...(Array.isArray(updateArtifacts.failedChecks) ? updateArtifacts.failedChecks : []),
      ...(Array.isArray(updateRuntime.failedChecks) ? updateRuntime.failedChecks : [])
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
