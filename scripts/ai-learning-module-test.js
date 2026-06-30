'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { createAiLearningJsonStoreRuntime } = require('../src/ai-learning-json-store-runtime');
const { createAiLearningPathsRuntime } = require('../src/ai-learning-paths-runtime');
const { createSkillGraphRuntime } = require('../src/skill-graph-runtime');
const { createContentBankRuntime } = require('../src/content-bank-runtime');
const { createEvaluationRuntime } = require('../src/evaluation-runtime');
const { createTrainingPolicyRuntime } = require('../src/training-policy-runtime');
const { createAssignmentRuntime } = require('../src/assignment-runtime');
const { createLearningEventRuntime } = require('../src/learning-event-runtime');
const { createStudentModelRuntime } = require('../src/student-model-runtime');
const { createReviewSchedulerRuntime } = require('../src/review-scheduler-runtime');
const { createGameRewardRuntime } = require('../src/game-reward-runtime');
const { createAiModelRoutingRuntime } = require('../src/ai-model-routing-runtime');
const { createAiProviderRuntime } = require('../src/ai-provider-runtime');
const { createAiTaskRuntime } = require('../src/ai-task-runtime');
const { createAttemptRuntime } = require('../src/attempt-runtime');
const { createAiLearningRuntime } = require('../src/ai-learning-runtime');

const moduleArg = (process.argv.find((arg) => arg.startsWith('--module=')) || '--module=all').split('=')[1];
const projectRootPath = path.resolve(__dirname, '..');

function readLocalSecrets() {
  const secretsPath = path.join(projectRootPath, 'config.secrets.json');

  if (!fs.existsSync(secretsPath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(secretsPath, 'utf8').replace(/^\uFEFF/, '')) || {};
  } catch {
    return {};
  }
}

function envWithLocalSecrets() {
  const secrets = readLocalSecrets();
  const aiLearning = secrets.aiLearning && typeof secrets.aiLearning === 'object'
    ? secrets.aiLearning
    : {};
  const deepSeek = aiLearning.deepSeek && typeof aiLearning.deepSeek === 'object'
    ? aiLearning.deepSeek
    : {};

  return {
    ...process.env,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || deepSeek.apiKey || '',
    DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL || deepSeek.baseUrl || '',
    AI_TEXT_FAST_MODEL: process.env.AI_TEXT_FAST_MODEL || deepSeek.fastModel || '',
    AI_TEXT_STRONG_MODEL: process.env.AI_TEXT_STRONG_MODEL || deepSeek.strongModel || ''
  };
}

function removeDirectory(directoryPath) {
  if (fs.existsSync(directoryPath)) {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function pass(name) {
  console.log(`PASS ${name}`);
}

function createHarness(options = {}) {
  const tempRoot = path.join(os.tmpdir(), `studygate-ai-learning-module-${process.pid}-${Date.now()}`);
  removeDirectory(tempRoot);

  const jsonStore = createAiLearningJsonStoreRuntime({ fs, pathModule: path });
  const paths = createAiLearningPathsRuntime({
    fs,
    pathModule: path,
    projectRootPath,
    userDataPath: tempRoot
  });
  const skillGraphRuntime = createSkillGraphRuntime({ jsonStore, paths });
  const contentBankRuntime = createContentBankRuntime({ jsonStore, paths, skillGraphRuntime });
  const evaluationRuntime = createEvaluationRuntime();
  const trainingPolicyRuntime = createTrainingPolicyRuntime({ contentBankRuntime });
  const assignmentRuntime = createAssignmentRuntime({ fs, jsonStore, paths, trainingPolicyRuntime });
  const learningEventRuntime = createLearningEventRuntime({ jsonStore, paths });
  const studentModelRuntime = createStudentModelRuntime({ jsonStore, paths });
  const reviewSchedulerRuntime = createReviewSchedulerRuntime({ jsonStore, paths });
  const gameRewardRuntime = createGameRewardRuntime({ jsonStore, paths });
  const aiModelRoutingRuntime = createAiModelRoutingRuntime({ env: options.env || { AI_PROVIDER: 'mock' } });
  const aiProviderRuntime = createAiProviderRuntime({ env: options.env || { AI_PROVIDER: 'mock' } });
  const aiTaskRuntime = createAiTaskRuntime({ aiModelRoutingRuntime, aiProviderRuntime, jsonStore, paths });
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

  return {
    aiModelRoutingRuntime,
    aiProviderRuntime,
    aiTaskRuntime,
    assignmentRuntime,
    attemptRuntime,
    contentBankRuntime,
    evaluationRuntime,
    gameRewardRuntime,
    jsonStore,
    learningEventRuntime,
    paths,
    reviewSchedulerRuntime,
    skillGraphRuntime,
    studentModelRuntime,
    tempRoot
  };
}

function answerForContentItem(item) {
  if (item.answerSchema && item.answerSchema.type === 'object') {
    return Object.entries(item.standardAnswer).map(([key, value]) => `${key}${value}`).join('，');
  }

  if (Array.isArray(item.standardAnswer)) {
    return item.standardAnswer.join('，');
  }

  return String(item.standardAnswer);
}

async function testPaths() {
  const h = createHarness();
  h.paths.ensureBaseDirectories();
  assert(fs.existsSync(h.paths.dataRoot()), 'data root missing');
  assert(fs.existsSync(h.paths.assetsDir()), 'assets dir missing');
  pass('module paths');
}

async function testStore() {
  const h = createHarness();
  const filePath = path.join(h.paths.dataRoot(), 'store-test.json');
  h.jsonStore.writeJsonFileAtomic(filePath, { ok: true });
  assert(h.jsonStore.readJsonFile(filePath, {}).ok === true, 'store read/write failed');
  h.jsonStore.appendJsonArrayItem(filePath, { item: 1 });
  assert(Array.isArray(h.jsonStore.readJsonFile(filePath, [])), 'store append fallback failed');
  pass('module store');
}

async function testSkill() {
  const h = createHarness();
  const nodes = h.skillGraphRuntime.initialize();
  assert(nodes.length >= 8, 'skill nodes missing');
  assert(h.skillGraphRuntime.getSkillNode('math.application.chicken_rabbit'), 'specific skill missing');
  pass('module skill');
}

async function testContent() {
  const h = createHarness();
  const items = h.contentBankRuntime.initialize();
  assert(items.length >= 24, 'content items missing');
  assert(h.contentBankRuntime.listContentItems({ skillNodeIds: ['math.application.chicken_rabbit'] }).length >= 3, 'content lookup failed');
  pass('module content');
}

async function testEvaluation() {
  const h = createHarness();
  const item = h.contentBankRuntime.getContentItem('q_math_chicken_rabbit_001');
  const evaluation = h.evaluationRuntime.evaluateAttempt({
    contentItem: item,
    attempt: { id: 'attempt_eval', contentItemId: item.id, response: { raw: '鸡23只，兔12只' } }
  });
  assert(evaluation.verdict.isCorrect, 'evaluation failed');
  pass('module evaluation');
}

async function testAssignment() {
  const h = createHarness();
  h.skillGraphRuntime.initialize();
  h.contentBankRuntime.initialize();
  const assignment = h.assignmentRuntime.getAssignment({
    studentId: 'default_child',
    dateKey: '2026-06-30',
    profileId: 'math_olympiad_daily_set_v1'
  });
  assert(assignment.contentItemIds.length === 10, 'assignment should contain 10 content items');
  pass('module assignment');
}

async function testAttempt() {
  const h = createHarness();
  h.skillGraphRuntime.initialize();
  h.contentBankRuntime.initialize();
  const assignment = h.assignmentRuntime.getAssignment({
    studentId: 'default_child',
    dateKey: '2026-06-30',
    profileId: 'math_olympiad_daily_set_v1'
  });
  const items = h.contentBankRuntime.getContentItemsByIds(assignment.contentItemIds);
  const result = await h.attemptRuntime.submitAttemptBatch({
    studentId: 'default_child',
    assignmentId: assignment.id,
    attempts: items.map((item) => ({
      contentItemId: item.id,
      response: { type: 'final_answer', raw: answerForContentItem(item) }
    }))
  });
  assert(result.evaluationBatch.summary.correct === 10, 'attempt batch evaluation failed');
  assert(result.learningEvents.length > 0, 'learning events missing');
  assert(result.gameState.xp > 0, 'reward missing');
  pass('module attempt');
}

async function testAiMock() {
  const h = createHarness();
  const result = await h.aiProviderRuntime.runTask({
    provider: 'mock',
    model: 'mock-ai',
    input: { evaluations: [] }
  });
  assert(result.status === 'completed', 'mock ai did not complete');
  pass('module ai-mock');
}

async function testDeepSeekLive() {
  const env = envWithLocalSecrets();

  if (!env.DEEPSEEK_API_KEY) {
    throw new Error('DEEPSEEK_API_KEY or config.secrets.json aiLearning.deepSeek.apiKey is required for --module=deepseek-live.');
  }

  const provider = createAiProviderRuntime({
    env: {
      ...env,
      AI_PROVIDER: 'deepseek',
      AI_TEXT_FAST_MODEL: env.AI_TEXT_FAST_MODEL || 'deepseek-v4-flash'
    }
  });
  const result = await provider.runTask({
    provider: 'deepseek',
    model: env.AI_TEXT_FAST_MODEL || 'deepseek-v4-flash',
    type: 'daily_summary',
    assignmentId: 'live_test_assignment',
    attemptBatchId: 'live_test_attempt_batch',
    thinking: 'disabled',
    input: {
      summary: { total: 1, correct: 1 },
      evaluations: [
        {
          contentItemId: 'live_test_item',
          verdict: { isCorrect: true, status: 'correct' }
        }
      ]
    }
  });
  assert(result.status === 'completed', 'DeepSeek live call did not complete');
  pass('module deepseek-live');
}

async function testAll() {
  await testPaths();
  await testStore();
  await testSkill();
  await testContent();
  await testEvaluation();
  await testAssignment();
  await testAttempt();
  await testAiMock();
}

const tests = {
  all: testAll,
  paths: testPaths,
  store: testStore,
  skill: testSkill,
  content: testContent,
  evaluation: testEvaluation,
  assignment: testAssignment,
  attempt: testAttempt,
  'ai-mock': testAiMock,
  'deepseek-live': testDeepSeekLive
};

const selected = tests[moduleArg];

if (!selected) {
  console.error(`FAIL Unknown module "${moduleArg}".`);
  process.exit(1);
}

selected().catch((error) => {
  console.error(`FAIL ${error && error.message ? error.message : String(error)}`);
  process.exit(1);
});
