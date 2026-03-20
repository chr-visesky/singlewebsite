'use strict';

function createStudyTargetRuntime(dependencies = {}) {
  const {
    dialog,
    launchLearningTool,
    launchNativeModule,
    learningToolEntryTarget,
    libraryTarget,
    logNavigationDebug,
    nativeModuleTarget,
    normalizePrefix,
    pathModule,
    processExecPath,
    projectRootPath,
    resolveLearningTool,
    resolveLibrary,
    resolveNativeModule,
    resolveNativeModuleDefinitionFromIndex,
    resolveClassroom
  } = dependencies;

  function resolveNativeModuleDefinition(moduleId) {
    return resolveNativeModuleDefinitionFromIndex(moduleId) || resolveNativeModule(moduleId);
  }

  function launchNativeModuleEntry(moduleId) {
    const moduleDefinition = resolveNativeModuleDefinition(moduleId);

    if (!moduleDefinition) {
      return false;
    }

    const result = launchNativeModule(moduleId, {
      executableDir: pathModule.dirname(processExecPath()),
      projectRoot: projectRootPath
    });

    if (!result.ok) {
      dialog.showErrorBox(moduleDefinition.title, result.error || `${moduleDefinition.title} 启动失败。`);
      return false;
    }

    const payload = {
      moduleId,
      executablePath: result.executablePath
    };

    if (typeof logNavigationDebug === 'function') {
      logNavigationDebug('launch-native-module', payload);
    }

    return payload;
  }

  function launchLearningToolEntry(toolId) {
    const learningTool = resolveLearningTool(toolId);

    if (!learningTool) {
      return false;
    }

    const result = launchLearningTool(learningTool, {
      executableDir: pathModule.dirname(processExecPath()),
      projectRoot: projectRootPath
    });

    if (!result.ok) {
      dialog.showErrorBox(learningTool.title, result.error || `${learningTool.title} 启动失败。`);
      return false;
    }

    const payload = {
      toolId,
      appPath: learningTool.appPath,
      command: result.launchPlan && result.launchPlan.command
    };

    if (typeof logNavigationDebug === 'function') {
      logNavigationDebug('launch-learning-tool', payload);
    }

    return payload;
  }

  function resolveStudyTargetById(targetId) {
    const classroom = targetId === 'english-course' ? resolveClassroom(null) : resolveClassroom(targetId);

    if (classroom && (targetId === 'english-course' || targetId === classroom.id)) {
      return {
        target: classroom.entryUrl,
        classroomId: classroom.id,
        classroomTitle: classroom.title,
        libraryId: '',
        libraryTitle: '',
        entryLabel: '进入课堂'
      };
    }

    const learningTool = resolveLearningTool(targetId);

    if (learningTool) {
      return {
        target: learningToolEntryTarget(learningTool.id),
        classroomId: '',
        classroomTitle: '',
        libraryId: '',
        libraryTitle: '',
        entryLabel: '打开工具'
      };
    }

    const nativeModule = resolveNativeModuleDefinition(targetId);

    if (nativeModule) {
      return {
        target: nativeModuleTarget(nativeModule.id),
        classroomId: '',
        classroomTitle: '',
        libraryId: '',
        libraryTitle: '',
        entryLabel: nativeModule.entryLabel || '打开模块'
      };
    }

    const library = resolveLibrary(targetId);

    if (!library) {
      return null;
    }

    return {
      target: libraryTarget(library.id),
      libraryId: library.id,
      libraryTitle: library.title,
      entryLabel: '打开内容'
    };
  }

  return {
    launchLearningToolEntry,
    launchNativeModuleEntry,
    resolveStudyTargetById
  };
}

module.exports = {
  createStudyTargetRuntime
};
