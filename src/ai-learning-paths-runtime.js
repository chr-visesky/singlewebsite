'use strict';

function createAiLearningPathsRuntime(dependencies = {}) {
  const {
    fs,
    pathModule,
    projectRootPath,
    userDataPath
  } = dependencies;

  if (!fs) {
    throw new Error('ai-learning paths requires fs.');
  }

  const path = pathModule || require('path');
  const dataRoot = path.join(userDataPath, 'ai-learning');
  const seedRoot = path.join(projectRootPath, 'data', 'ai-learning');

  function ensureDirectory(directoryPath) {
    if (!fs.existsSync(directoryPath)) {
      fs.mkdirSync(directoryPath, { recursive: true });
    }
  }

  function ensureBaseDirectories() {
    ensureDirectory(dataRoot);
    ensureDirectory(assetsDir());
  }

  function runtimeFile(fileName) {
    return path.join(dataRoot, fileName);
  }

  function seedFile(fileName) {
    return path.join(seedRoot, fileName);
  }

  function profileSeedFile(profileFileName) {
    return path.join(seedRoot, 'profiles', profileFileName);
  }

  function assetsDir() {
    return path.join(dataRoot, 'assets');
  }

  return {
    aiTasksPath: () => runtimeFile('ai-tasks.json'),
    aiResultsPath: () => runtimeFile('ai-results.json'),
    assignmentsPath: () => runtimeFile('assignments.json'),
    assetsDir,
    attemptsPath: () => runtimeFile('attempts.json'),
    contentItemsPath: () => runtimeFile('content-items.json'),
    contentItemsSeedPath: () => seedFile('content-items.seed.json'),
    dataRoot: () => dataRoot,
    ensureBaseDirectories,
    evaluationsPath: () => runtimeFile('evaluations.json'),
    gameStatePath: () => runtimeFile('game-state.json'),
    generatedContentCandidatesPath: () => runtimeFile('generated-content-candidates.json'),
    learningEventsPath: () => runtimeFile('learning-events.json'),
    masteryPath: () => runtimeFile('mastery.json'),
    profileSeedPath: profileSeedFile,
    reviewQueuePath: () => runtimeFile('review-queue.json'),
    skillNodesPath: () => runtimeFile('skill-nodes.json'),
    skillNodesSeedPath: () => seedFile('skill-nodes.seed.json')
  };
}

module.exports = {
  createAiLearningPathsRuntime
};
