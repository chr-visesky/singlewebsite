'use strict';

const { createAiLearningJsonStoreRuntime } = require('./ai-learning-json-store-runtime');
const { createAiLearningPathsRuntime } = require('./ai-learning-paths-runtime');
const { createSkillGraphRuntime } = require('./skill-graph-runtime');
const { createContentBankRuntime } = require('./content-bank-runtime');
const { createTrainingPolicyRuntime } = require('./training-policy-runtime');
const { createAssignmentRuntime } = require('./assignment-runtime');
const { createEvaluationRuntime } = require('./evaluation-runtime');
const { createLearningEventRuntime } = require('./learning-event-runtime');
const { createStudentModelRuntime } = require('./student-model-runtime');
const { createReviewSchedulerRuntime } = require('./review-scheduler-runtime');
const { createGameRewardRuntime } = require('./game-reward-runtime');
const { createAiModelRoutingRuntime } = require('./ai-model-routing-runtime');
const { createAiProviderRuntime } = require('./ai-provider-runtime');
const { createAiTaskRuntime } = require('./ai-task-runtime');
const { createContentGenerationRuntime } = require('./content-generation-runtime');
const { createAttemptRuntime } = require('./attempt-runtime');

function readLocalAiLearningEnv({ env, fs, pathModule, projectRootPath }) {
  const path = pathModule || require('path');
  const resolvedEnv = { ...(env || {}) };

  if (!fs || !projectRootPath) {
    return resolvedEnv;
  }

  const secretsPath = path.join(projectRootPath, 'config.secrets.json');

  if (!fs.existsSync(secretsPath)) {
    return resolvedEnv;
  }

  try {
    const secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf8').replace(/^\uFEFF/, '')) || {};
    const aiLearning = secrets.aiLearning && typeof secrets.aiLearning === 'object'
      ? secrets.aiLearning
      : {};
    const deepSeek = aiLearning.deepSeek && typeof aiLearning.deepSeek === 'object'
      ? aiLearning.deepSeek
      : {};

    return {
      ...resolvedEnv,
      DEEPSEEK_API_KEY: resolvedEnv.DEEPSEEK_API_KEY || deepSeek.apiKey || '',
      DEEPSEEK_BASE_URL: resolvedEnv.DEEPSEEK_BASE_URL || deepSeek.baseUrl || '',
      AI_PROVIDER: resolvedEnv.AI_PROVIDER || deepSeek.provider || '',
      AI_TEXT_FAST_MODEL: resolvedEnv.AI_TEXT_FAST_MODEL || deepSeek.fastModel || '',
      AI_TEXT_STRONG_MODEL: resolvedEnv.AI_TEXT_STRONG_MODEL || deepSeek.strongModel || ''
    };
  } catch {
    return resolvedEnv;
  }
}

function createAiLearningRuntime(dependencies = {}) {
  const {
    env = process.env,
    fs,
    pathModule,
    projectRootPath,
    userDataPath
  } = dependencies;

  const resolvedEnv = readLocalAiLearningEnv({
    env,
    fs,
    pathModule,
    projectRootPath
  });
  const jsonStore = createAiLearningJsonStoreRuntime({ fs, pathModule });
  const paths = createAiLearningPathsRuntime({
    fs,
    pathModule,
    projectRootPath,
    userDataPath
  });
  const skillGraphRuntime = createSkillGraphRuntime({ jsonStore, paths });
  const contentBankRuntime = createContentBankRuntime({ jsonStore, paths, skillGraphRuntime });
  const trainingPolicyRuntime = createTrainingPolicyRuntime({ contentBankRuntime });
  const assignmentRuntime = createAssignmentRuntime({ fs, jsonStore, paths, trainingPolicyRuntime });
  const evaluationRuntime = createEvaluationRuntime();
  const learningEventRuntime = createLearningEventRuntime({ jsonStore, paths });
  const studentModelRuntime = createStudentModelRuntime({ jsonStore, paths });
  const reviewSchedulerRuntime = createReviewSchedulerRuntime({ jsonStore, paths });
  const gameRewardRuntime = createGameRewardRuntime({ jsonStore, paths });
  const aiModelRoutingRuntime = createAiModelRoutingRuntime({ env: resolvedEnv });
  const aiProviderRuntime = createAiProviderRuntime({ env: resolvedEnv });
  const aiTaskRuntime = createAiTaskRuntime({
    aiModelRoutingRuntime,
    aiProviderRuntime,
    jsonStore,
    paths
  });
  const contentGenerationRuntime = createContentGenerationRuntime({
    aiTaskRuntime,
    jsonStore,
    paths
  });
  const attemptRuntime = createAttemptRuntime({
    aiTaskRuntime,
    assignmentRuntime,
    contentBankRuntime,
    evaluationRuntime,
    gameRewardRuntime,
    jsonStore,
    learningEventRuntime,
    paths,
    reviewSchedulerRuntime,
    studentModelRuntime
  });

  function initialize() {
    paths.ensureBaseDirectories();
    const skillNodes = skillGraphRuntime.initialize();
    const contentItems = contentBankRuntime.initialize();
    return {
      skillNodes,
      contentItems
    };
  }

  function getAssignment(options = {}) {
    initialize();
    const studentId = typeof options.studentId === 'string' && options.studentId.trim()
      ? options.studentId.trim()
      : 'default_child';
    const dateKey = typeof options.dateKey === 'string' ? options.dateKey.trim() : '';
    const dueSkillNodeIds = Array.isArray(options.dueSkillNodeIds) && options.dueSkillNodeIds.length
      ? options.dueSkillNodeIds
      : reviewSchedulerRuntime.dueSkillNodeIds({
          studentId,
          date: dateKey ? new Date(`${dateKey}T23:59:59`) : new Date()
        });
    const weakSkillNodeIds = Array.isArray(options.weakSkillNodeIds) && options.weakSkillNodeIds.length
      ? options.weakSkillNodeIds
      : studentModelRuntime.getWeakSkillNodeIds(studentId);
    const excludeContentItemIds = Array.isArray(options.excludeContentItemIds) && options.excludeContentItemIds.length
      ? options.excludeContentItemIds
      : attemptRuntime.recentContentItemIds({
          studentId,
          limit: Number(options.excludeRecentLimit) || 20
        });

    return assignmentRuntime.getAssignment({
      ...options,
      studentId,
      dueSkillNodeIds,
      weakSkillNodeIds,
      excludeContentItemIds
    });
  }

  function getContentItem(contentItemId) {
    initialize();
    return contentBankRuntime.getContentItem(contentItemId);
  }

  function getAiResults(filters = {}) {
    initialize();
    const assignmentId = typeof filters.assignmentId === 'string' ? filters.assignmentId.trim() : '';
    const attemptBatchId = typeof filters.attemptBatchId === 'string' ? filters.attemptBatchId.trim() : '';

    return aiTaskRuntime.listResults().filter((result) => {
      if (assignmentId && result.assignmentId !== assignmentId) {
        return false;
      }

      if (attemptBatchId && result.attemptBatchId !== attemptBatchId) {
        return false;
      }

      return true;
    });
  }

  function getAttemptBatches(filters = {}) {
    initialize();
    return attemptRuntime.listAttemptBatches(filters);
  }

  function getEvaluationBatches(filters = {}) {
    initialize();
    return attemptRuntime.listEvaluationBatches(filters);
  }

  function getReviewQueue(studentId) {
    initialize();
    return reviewSchedulerRuntime.listQueue(studentId);
  }

  async function submitAttemptBatch(options) {
    initialize();
    return attemptRuntime.submitAttemptBatch(options);
  }

  async function generateContentCandidates(options) {
    initialize();
    return contentGenerationRuntime.generateContentCandidates(options);
  }

  return {
    assignmentRuntime,
    aiTaskRuntime,
    contentBankRuntime,
    contentGenerationRuntime,
    evaluationRuntime,
    gameRewardRuntime,
    getAiResults,
    getAttemptBatches,
    getContentItem,
    getEvaluationBatches,
    getAssignment,
    getReviewQueue,
    generateContentCandidates,
    initialize,
    paths,
    reviewSchedulerRuntime,
    skillGraphRuntime,
    studentModelRuntime,
    submitAttemptBatch
  };
}

module.exports = {
  readLocalAiLearningEnv,
  createAiLearningRuntime
};
