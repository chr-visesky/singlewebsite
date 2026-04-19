'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function resolveDotnetPath() {
  const candidates = [
    process.env.DOTNET_ROOT ? path.join(process.env.DOTNET_ROOT, 'dotnet.exe') : '',
    process.env.DOTNET_ROOT_X64 ? path.join(process.env.DOTNET_ROOT_X64, 'dotnet.exe') : '',
    'C:\\dotnet\\dotnet.exe',
    'C:\\Program Files\\dotnet\\dotnet.exe'
  ].filter(Boolean);

  return candidates.find((candidate) => {
    try {
      return fs.existsSync(candidate);
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
  const rootDir = path.resolve(__dirname, '..', '..');
  const userProfile = path.join(rootDir, '.dotnet-profile', 'User');
  const appData = path.join(rootDir, '.dotnet-profile', 'AppData', 'Roaming');

  return {
    ...process.env,
    APPDATA: process.env.APPDATA || appData,
    USERPROFILE: process.env.USERPROFILE || userProfile,
    HOME: process.env.HOME || userProfile,
    DOTNET_CLI_HOME: process.env.DOTNET_CLI_HOME || path.join(rootDir, '.dotnet-cli'),
    NUGET_PACKAGES: process.env.NUGET_PACKAGES || path.join(rootDir, '.nuget', 'packages'),
    DOTNET_ROOT: process.env.DOTNET_ROOT || dotnetRoot,
    DOTNET_ROOT_X64: process.env.DOTNET_ROOT_X64 || dotnetRoot
  };
}

function runStudyModulesSmoke({ rootDir, outputDir }) {
  const dotnetPath = resolveDotnetPath();
  const dotnetEnv = createDotnetEnvironment(dotnetPath);
  const projectPath = path.join(rootDir, 'tools', 'StudyModules.UiSmoke', 'StudyModules.UiSmoke.csproj');
  const assemblyPath = path.join(rootDir, 'tools', 'StudyModules.UiSmoke', 'bin', 'Debug', 'net10.0-windows', 'StudyModules.UiSmoke.dll');
  const dictationAppPath = path.join(rootDir, 'dist', 'StudyGate-win32-x64', 'modules', 'dictation', 'DictationApp.exe');
  const recitationAppPath = path.join(rootDir, 'dist', 'StudyGate-win32-x64', 'modules', 'recitation', 'RecitationApp.exe');

  execFileSync(dotnetPath, ['build', projectPath, '-nologo', '-v:q'], {
    cwd: rootDir,
    stdio: 'inherit',
    env: dotnetEnv
  });

  const stdout = execFileSync(
    dotnetPath,
    [
      assemblyPath,
      'run-agent-create-smoke',
      '--dictation-app',
      dictationAppPath,
      '--recitation-app',
      recitationAppPath,
      '--output-dir',
      outputDir
    ],
    {
      cwd: rootDir,
      encoding: 'utf8',
      env: dotnetEnv
    }
  );

  return JSON.parse(stdout);
}

module.exports = {
  runStudyModulesSmoke
};
