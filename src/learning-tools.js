'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const VALID_CARD_TONES = new Set(['amber', 'teal', 'coral']);
const EXECUTABLE_EXTENSIONS = new Set(['.exe', '.com', '.bat', '.cmd']);

function normalizePrefix(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeCardTone(value, fallback = 'teal') {
  const normalized = normalizePrefix(value).toLowerCase();
  return VALID_CARD_TONES.has(normalized) ? normalized : fallback;
}

function normalizeLearningToolId(value, fallback) {
  const normalized = normalizePrefix(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || fallback;
}

function normalizeLearningToolPath(value) {
  return normalizePrefix(value);
}

function expandEnvironmentVariables(value) {
  return normalizePrefix(value).replace(/%([^%]+)%/g, (_match, variableName) => {
    const envValue = process.env[variableName];
    return typeof envValue === 'string' && envValue ? envValue : `%${variableName}%`;
  });
}

function defaultLearningTools() {
  return [];
}

function normalizeLearningTools(rawTools, options = {}) {
  const source =
    Array.isArray(rawTools)
      ? rawTools
      : options.fallbackToDefault === false
        ? []
        : defaultLearningTools();
  const reservedIds = options.reservedIds instanceof Set ? options.reservedIds : new Set();
  const seenIds = new Set();
  const tools = [];

  for (let index = 0; index < source.length; index += 1) {
    const item = source[index] || {};
    const appPath = normalizeLearningToolPath(item.appPath || item.path || item.executablePath);

    if (!appPath) {
      continue;
    }

    let id = normalizeLearningToolId(item.id, `tool-${index + 1}`);

    while (seenIds.has(id) || reservedIds.has(id)) {
      id = normalizeLearningToolId(`${id}-tool`, `tool-${index + 1}`);
    }

    seenIds.add(id);
    tools.push({
      id,
      title: normalizePrefix(item.title) || `学习工具 ${index + 1}`,
      description: normalizePrefix(item.description) || '打开指定的本机学习工具。',
      tone: normalizeCardTone(item.tone, index % 2 === 0 ? 'teal' : 'coral'),
      appPath
    });
  }

  return tools;
}

function serializeLearningTools(tools = []) {
  return (Array.isArray(tools) ? tools : []).map((tool) => ({
    id: tool.id,
    title: tool.title,
    description: tool.description,
    tone: tool.tone,
    appPath: tool.appPath
  }));
}

function resolveLearningTool(tools, toolId) {
  return (Array.isArray(tools) ? tools : []).find((item) => item.id === normalizePrefix(toolId)) || null;
}

function resolveLearningToolTitle(tools, toolId) {
  const tool = resolveLearningTool(tools, toolId);
  return tool ? tool.title : '';
}

function learningToolTarget(toolId) {
  return `internal:learning-tool:${toolId}`;
}

function resolveLaunchPlan(appPath, options = {}) {
  const normalized = expandEnvironmentVariables(normalizeLearningToolPath(appPath).replace(/^"(.*)"$/, '$1'));

  if (!normalized) {
    return null;
  }

  const looksLikeSimpleCommand = !path.isAbsolute(normalized) && !/[\\/]/.test(normalized);

  if (looksLikeSimpleCommand) {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', normalized],
      cwd: options.executableDir || process.cwd()
    };
  }

  const candidateBases = [options.executableDir, options.projectRoot].filter(Boolean);
  let resolvedPath = '';

  if (path.isAbsolute(normalized)) {
    resolvedPath = path.normalize(normalized);
  } else if (candidateBases.length) {
    const matchedCandidate = candidateBases
      .map((basePath) => path.resolve(basePath, normalized))
      .find((candidatePath) => fs.existsSync(candidatePath));
    resolvedPath = matchedCandidate || path.resolve(candidateBases[0], normalized);
  } else {
    resolvedPath = path.resolve(normalized);
  }

  if (!fs.existsSync(resolvedPath)) {
    return {
      error: '程序文件不存在。'
    };
  }

  const extension = path.extname(resolvedPath).toLowerCase();

  if (extension === '.lnk') {
    return {
      command: 'explorer.exe',
      args: [resolvedPath],
      cwd: path.dirname(resolvedPath)
    };
  }

  if (extension === '.bat' || extension === '.cmd') {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', resolvedPath],
      cwd: path.dirname(resolvedPath)
    };
  }

  if (!EXECUTABLE_EXTENSIONS.has(extension)) {
    return {
      error: '请配置 .exe、.cmd、.bat 或 .lnk 程序路径。'
    };
  }

  return {
    command: resolvedPath,
    args: [],
    cwd: path.dirname(resolvedPath)
  };
}

function launchLearningTool(toolDefinition, options = {}) {
  if (!toolDefinition) {
    return {
      ok: false,
      error: '找不到指定的学习工具。'
    };
  }

  const launchPlan = resolveLaunchPlan(toolDefinition.appPath, options);

  if (!launchPlan) {
    return {
      ok: false,
      error: '没有配置可用的程序路径。'
    };
  }

  if (launchPlan.error) {
    return {
      ok: false,
      error: launchPlan.error
    };
  }

  try {
    const child = spawn(launchPlan.command, launchPlan.args, {
      cwd: launchPlan.cwd,
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    });
    child.unref();
    return {
      ok: true,
      launchPlan
    };
  } catch (error) {
    return {
      ok: false,
      error: error && error.message ? error.message : `${toolDefinition.title} 启动失败。`
    };
  }
}

module.exports = {
  defaultLearningTools,
  learningToolTarget,
  launchLearningTool,
  normalizeLearningToolId,
  normalizeLearningToolPath,
  normalizeLearningTools,
  resolveLearningTool,
  resolveLearningToolTitle,
  serializeLearningTools
};
