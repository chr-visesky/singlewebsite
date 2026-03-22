'use strict';

function createConfigRuntime(dependencies = {}) {
  const {
    app,
    bannerAssets,
    createConfigError,
    defaultNavigationBannerText,
    defaultReminderLeadMinutes,
    embeddedConfigFile,
    fs,
    mergeStudySchedules,
    nativeModuleDefinitions,
    normalizeHomeNotice,
    normalizeHostname,
    normalizeHostnameSuffix,
    normalizeLibraries,
    normalizeLearningTools,
    normalizeOnlineClassrooms,
    normalizeAutoUpdateConfig,
    normalizePrefix,
    normalizeReminderLeadMinutes,
    normalizeRemoteSchedule,
    normalizeResourceAccessMode,
    normalizeStudySchedule,
    normalizeControlSettings,
    parseUrl,
    path,
    serializeLearningTools,
    serializeLibraries,
    serializeOnlineClassrooms,
    stableUserDataDir
  } = dependencies;

  const STATE_ENTRY_NAMES = Object.freeze([
    'baidu-netdisk-state.json',
    'navigation-debug.log',
    'origin-storage-state.json',
    'reminder-audio-cache',
    'reminder-debug.log',
    'session-state.json',
    'site-credentials.bin',
    'study-schedule-cache.json',
    'study-schedule.json',
    'study-tools-state.json'
  ]);

  function dedupe(items) {
    return [...new Set(items)];
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function deepMerge(target, source) {
    if (!isPlainObject(source)) {
      return source === undefined ? target : source;
    }

    const base = isPlainObject(target) ? { ...target } : {};

    for (const [key, value] of Object.entries(source)) {
      if (isPlainObject(value)) {
        base[key] = deepMerge(base[key], value);
        continue;
      }

      base[key] = value;
    }

    return base;
  }

  function candidateFiles(fileName) {
    return dedupe([
      path.join(process.cwd(), fileName),
      path.join(path.dirname(process.execPath), fileName),
      path.join(app.getAppPath(), fileName)
    ]);
  }

  function firstExistingFile(paths) {
    return paths.find((filePath) => fs.existsSync(filePath));
  }

  function readJsonFile(filePath) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
      throw createConfigError(`无法解析 ${filePath}: ${error.message}`);
    }
  }

  function secretConfigCandidates(configPath) {
    const parsed = path.parse(configPath);
    const sidecarName = `${parsed.name}.secrets${parsed.ext}`;
    const fileNames = dedupe([sidecarName, 'config.secrets.json']);
    const candidates = [];

    for (const fileName of fileNames) {
      candidates.push(path.join(path.dirname(configPath), fileName));

      for (const fallbackPath of candidateFiles(fileName)) {
        candidates.push(fallbackPath);
      }
    }

    return dedupe(candidates);
  }

  function mergeOptionalSecretConfig(configPath, rawConfig) {
    const secretPath = firstExistingFile(secretConfigCandidates(configPath));

    if (!secretPath) {
      return rawConfig;
    }

    const secretConfig = readJsonFile(secretPath);
    return deepMerge(rawConfig, secretConfig);
  }

  function resolveConfiguredStateDir(rawConfig, configPath) {
    const configuredStateDir = normalizePrefix(rawConfig && rawConfig.stateDir);

    if (!configuredStateDir) {
      return stableUserDataDir;
    }

    return path.isAbsolute(configuredStateDir)
      ? configuredStateDir
      : path.resolve(path.dirname(configPath), configuredStateDir);
  }

  function copyStateEntry(sourcePath, targetPath) {
    if (!fs.existsSync(sourcePath) || fs.existsSync(targetPath)) {
      return;
    }

    const stats = fs.statSync(sourcePath);

    if (stats.isDirectory()) {
      fs.cpSync(sourcePath, targetPath, {
        recursive: true,
        force: false,
        errorOnExist: false
      });
      return;
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
  }

  function migrateLegacyState(configPath, stateDir) {
    const legacyDir = path.dirname(configPath);
    const normalizedLegacyDir = path.resolve(legacyDir);
    const normalizedStateDir = path.resolve(stateDir);

    if (normalizedLegacyDir === normalizedStateDir || !fs.existsSync(legacyDir)) {
      return;
    }

    fs.mkdirSync(stateDir, { recursive: true });

    for (const entryName of STATE_ENTRY_NAMES) {
      copyStateEntry(path.join(legacyDir, entryName), path.join(stateDir, entryName));
    }
  }

  function loadConfig(configFileName) {
    const embeddedConfigPath = path.join(app.getAppPath(), embeddedConfigFile);
    const configPath = fs.existsSync(embeddedConfigPath)
      ? embeddedConfigPath
      : firstExistingFile(candidateFiles(configFileName));

    if (!configPath) {
      throw createConfigError(`找不到 ${configFileName}。`);
    }

    let rawConfig = readJsonFile(configPath);
    rawConfig = mergeOptionalSecretConfig(configPath, rawConfig);

    const configuredStartUrl = normalizePrefix(rawConfig.startUrl);
    const configuredStartUrlObject = configuredStartUrl ? parseUrl(configuredStartUrl) : null;

    if (configuredStartUrl && (!configuredStartUrlObject || !['http:', 'https:'].includes(configuredStartUrlObject.protocol))) {
      throw createConfigError('config.json 中的 startUrl 必须是有效的 http/https 地址。');
    }

    const nativeModuleIds = new Set(nativeModuleDefinitions.map((moduleDefinition) => moduleDefinition.id));
    const classrooms = normalizeOnlineClassrooms(rawConfig.onlineClassrooms || rawConfig.classrooms, {
      defaultStartUrl: configuredStartUrl,
      reservedIds: nativeModuleIds
    });
    const libraries = normalizeLibraries(rawConfig.contentLibraries, {
      reservedIds: new Set([
        ...nativeModuleIds,
        ...classrooms.map((classroom) => classroom.id)
      ])
    });
    const learningTools = normalizeLearningTools(rawConfig.learningTools || rawConfig.tools, {
      reservedIds: new Set([
        ...nativeModuleIds,
        ...classrooms.map((classroom) => classroom.id),
        ...libraries.map((library) => library.id)
      ])
    });

    if (!classrooms.length) {
      throw createConfigError('至少需要一个在线课堂入口。可以配置 onlineClassrooms，或者保留有效的 startUrl。');
    }

    const startUrl = classrooms[0].entryUrl;
    const classroomEntryUrls = classrooms.map((classroom) => classroom.entryUrl);
    const topLevelPrefixes = dedupe(
      [...(Array.isArray(rawConfig.allowedTopLevelUrlPrefixes) ? rawConfig.allowedTopLevelUrlPrefixes : classroomEntryUrls), ...classroomEntryUrls]
        .map(normalizePrefix)
        .filter(Boolean)
    );

    if (!topLevelPrefixes.length) {
      throw createConfigError('至少需要一个 allowedTopLevelUrlPrefixes 项。');
    }

    const allowedHostnames = dedupe(
      [...(Array.isArray(rawConfig.allowedResourceHostnames) ? rawConfig.allowedResourceHostnames : []), ...classroomEntryUrls.map((entryUrl) => {
        const parsed = parseUrl(entryUrl);
        return parsed ? parsed.hostname : '';
      })]
        .map(normalizeHostname)
        .filter(Boolean)
    );

    const allowedHostnameSuffixes = dedupe(
      (Array.isArray(rawConfig.allowedResourceHostnameSuffixes)
        ? rawConfig.allowedResourceHostnameSuffixes
        : [])
        .map(normalizeHostnameSuffix)
        .filter(Boolean)
    );

    const allowedResourceUrlPrefixes = dedupe(
      (Array.isArray(rawConfig.allowedResourceUrlPrefixes) ? rawConfig.allowedResourceUrlPrefixes : [])
        .map(normalizePrefix)
        .filter(Boolean)
    );

    const blockedShortcuts = dedupe(
      (Array.isArray(rawConfig.blockedShortcuts) ? rawConfig.blockedShortcuts : [])
        .map(normalizePrefix)
        .filter(Boolean)
    );
    const parentStudySchedule = normalizeStudySchedule(rawConfig.studySchedule, classrooms, libraries, {
      planScope: 'parent',
      learningTools
    });
    const stateDir = resolveConfiguredStateDir(rawConfig, configPath);
    const reminderLeadMinutes = normalizeReminderLeadMinutes(
      (rawConfig.reminders && rawConfig.reminders.leadMinutes) || rawConfig.reminderLeadMinutes || defaultReminderLeadMinutes
    );

    fs.mkdirSync(stateDir, { recursive: true });
    migrateLegacyState(configPath, stateDir);

    return {
      configPath,
      configDir: path.dirname(configPath),
      stateDir,
      appTitle: normalizePrefix(rawConfig.appTitle) || '学习入口',
      homeNotice: normalizeHomeNotice(rawConfig.homeNotice, bannerAssets.homeNoticeImageDataUrl()),
      navigationBannerText: normalizePrefix(rawConfig.navigationBannerText) || defaultNavigationBannerText,
      startUrl,
      baseClassrooms: serializeOnlineClassrooms(classrooms),
      classrooms,
      baseLearningTools: serializeLearningTools(learningTools),
      learningTools,
      topLevelPrefixes,
      allowedHostnames: new Set(allowedHostnames),
      allowedHostnameSuffixes,
      allowedResourceUrlPrefixes,
      resourceAccessMode: normalizeResourceAccessMode(rawConfig.resourceAccessMode),
      kiosk: rawConfig.kiosk !== false,
      alwaysOnTop: rawConfig.alwaysOnTop !== false,
      exitShortcut: normalizePrefix(rawConfig.exitShortcut) || 'Ctrl+Alt+Shift+Q',
      blockedShortcuts,
      logBlockedRequests: rawConfig.logBlockedRequests !== false,
      baiduNetdisk: {
        clientId: normalizePrefix(rawConfig.baiduNetdisk && (rawConfig.baiduNetdisk.clientId || rawConfig.baiduNetdisk.appKey)),
        clientSecret: normalizePrefix(
          rawConfig.baiduNetdisk && (rawConfig.baiduNetdisk.clientSecret || rawConfig.baiduNetdisk.secretKey)
        ),
        scope: normalizePrefix(rawConfig.baiduNetdisk && rawConfig.baiduNetdisk.scope) || 'netdisk'
      },
      remoteSchedule: normalizeRemoteSchedule(rawConfig.remoteSchedule),
      remoteDictation: normalizeRemoteSchedule(rawConfig.remoteDictation),
      remoteHomework: normalizeRemoteSchedule(rawConfig.remoteHomework),
      remoteRecitation: normalizeRemoteSchedule(rawConfig.remoteRecitation),
      autoUpdate: normalizeAutoUpdateConfig(rawConfig.autoUpdate),
      reminders: {
        leadMinutes: reminderLeadMinutes.length ? reminderLeadMinutes : [...defaultReminderLeadMinutes]
      },
      baseLibraries: serializeLibraries(libraries),
      libraries,
      controlSettings: normalizeControlSettings(rawConfig.controlSettings),
      parentStudySchedule,
      studentStudySchedule: [],
      studySchedule: mergeStudySchedules(parentStudySchedule, [])
    };
  }

  return {
    loadConfig
  };
}

module.exports = {
  createConfigRuntime
};
