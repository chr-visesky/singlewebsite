'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const BUILTIN_NATIVE_MODULES = Object.freeze([
  Object.freeze({
    id: 'homework-module',
    title: '作业',
    description: '打开独立作业模块。',
    tone: 'coral',
    badge: '作业模块',
    entryLabel: '打开作业',
    packagedExecutableRelativePath: path.join('modules', 'homework', 'HomeworkApp.exe'),
    developmentExecutableRelativePaths: Object.freeze([
      path.join('modules', 'HomeworkApp', 'bin', 'Release', 'studygate-publish', 'HomeworkApp.exe'),
      path.join('modules', 'HomeworkApp', 'bin', 'Debug', 'net10.0-windows', 'HomeworkApp.exe'),
      path.join('modules', 'HomeworkApp', 'bin', 'Debug', 'net8.0-windows', 'HomeworkApp.exe')
    ])
  })
]);

function normalizePrefix(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function nativeModuleTarget(moduleId) {
  return `internal:native-module:${moduleId}`;
}

function listNativeModules() {
  return BUILTIN_NATIVE_MODULES.map((item) => ({ ...item }));
}

function resolveNativeModule(moduleId) {
  const normalizedId = normalizePrefix(moduleId);
  return BUILTIN_NATIVE_MODULES.find((item) => item.id === normalizedId) || null;
}

function resolveNativeModuleTitle(moduleId) {
  const moduleDefinition = resolveNativeModule(moduleId);
  return moduleDefinition ? moduleDefinition.title : '';
}

function nativeModuleTargetOptions() {
  return BUILTIN_NATIVE_MODULES.map((item) => ({
    id: item.id,
    label: item.title
  }));
}

function packagedExecutablePath(executableDir, moduleDefinition) {
  if (!executableDir) {
    return '';
  }

  return path.join(executableDir, moduleDefinition.packagedExecutableRelativePath);
}

function developmentExecutablePaths(projectRoot, moduleDefinition) {
  if (!projectRoot) {
    return [];
  }

  return moduleDefinition.developmentExecutableRelativePaths.map((relativePath) =>
    path.resolve(projectRoot, relativePath)
  );
}

function resolveNativeModuleExecutablePath(moduleId, options = {}) {
  const moduleDefinition = resolveNativeModule(moduleId);

  if (!moduleDefinition) {
    return '';
  }

  const packagedPath = packagedExecutablePath(options.executableDir, moduleDefinition);
  const candidates = [
    packagedPath,
    ...developmentExecutablePaths(options.projectRoot, moduleDefinition)
  ].filter(Boolean);

  return candidates.find((candidatePath) => fs.existsSync(candidatePath)) || '';
}

function launchNativeModule(moduleId, options = {}) {
  const moduleDefinition = resolveNativeModule(moduleId);

  if (!moduleDefinition) {
    return {
      ok: false,
      error: '找不到指定的原生模块。'
    };
  }

  const executablePath = resolveNativeModuleExecutablePath(moduleId, options);

  if (!executablePath) {
    return {
      ok: false,
      error: `${moduleDefinition.title} 程序文件不存在。`
    };
  }

  try {
    const child = spawn(executablePath, [], {
      cwd: path.dirname(executablePath),
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    });
    child.unref();
    return {
      ok: true,
      executablePath
    };
  } catch (error) {
    return {
      ok: false,
      error: error && error.message ? error.message : `${moduleDefinition.title} 启动失败。`
    };
  }
}

module.exports = {
  listNativeModules,
  resolveNativeModule,
  resolveNativeModuleExecutablePath,
  resolveNativeModuleTitle,
  nativeModuleTarget,
  nativeModuleTargetOptions,
  launchNativeModule
};
