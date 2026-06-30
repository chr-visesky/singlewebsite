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
const { createAttemptRuntime } = require('./attempt-runtime');

function createAiLearningRuntime(dependencies = {}) {
  const {
    env = process.env,
    fs,
    pathModule,
    projectRootPath,
    userDataPath
  } = dependencies;

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
  const aiModelRoutingRuntime = createAiModelRoutingRuntime({ env });
  const aiProviderRuntime = createAiProviderRuntime({ env });
  const aiTaskRuntime = createAiTaskRuntime({
    aiModelRoutingRuntime,
    aiProviderRuntime,
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

  function getAssignment(options) {
    initialize();
    return assignmentRuntime.getAssignment(options);
  }

  async function submitAttemptBatch(options) {
    initialize();
    return attemptRuntime.submitAttemptBatch(options);
  }

  return {
    assignmentRuntime,
    contentBankRuntime,
    evaluationRuntime,
    gameRewardRuntime,
    initialize,
    paths,
    reviewSchedulerRuntime,
    skillGraphRuntime,
    studentModelRuntime,
    submitAttemptBatch,
    getAssignment
  };
}

module.exports = {
  createAiLearningRuntime
};
