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
const { createContentGenerationRuntime } = require('../src/content-generation-runtime');
const { createAttemptRuntime } = require('../src/attempt-runtime');
const { createAiLearningRuntime } = require('../src/ai-learning-runtime');
const { registerAiLearningIpc } = require('../src/ai-learning-ipc-runtime');

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
  const contentGenerationRuntime = createContentGenerationRuntime({ aiTaskRuntime, jsonStore, paths });
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
    contentGenerationRuntime,
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
  if (item.answerSchema && item.answerSchema.type === 'choice') {
    return String(item.standardAnswer);
  }

  if (item.answerSchema && item.answerSchema.type === 'object') {
    return Object.entries(item.standardAnswer).map(([key, value]) => `${key}${value}`).join('，');
  }

  if (Array.isArray(item.standardAnswer)) {
    return item.standardAnswer.join('，');
  }

  return String(item.standardAnswer);
}

function createFakeIpcMain() {
  const handlers = new Map();

  return {
    handlers,
    handle(channel, handler) {
      handlers.set(channel, handler);
    }
  };
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

async function testTrainingPolicy() {
  const h = createHarness();
  h.skillGraphRuntime.initialize();
  h.contentBankRuntime.initialize();
  const dueSkillNodeIds = ['math.number.remainder'];
  const weakSkillNodeIds = ['math.application.age'];
  const assignment = h.assignmentRuntime.getAssignment({
    studentId: 'policy_child',
    dateKey: '2026-07-01',
    profileId: 'math_olympiad_daily_set_v1',
    dueSkillNodeIds,
    weakSkillNodeIds,
    excludeContentItemIds: ['q_math_remainder_001']
  });
  const reviewSection = assignment.sections.find((section) => section.type === 'review');
  const weaknessSection = assignment.sections.find((section) => section.type === 'weakness');
  assert(reviewSection && reviewSection.contentItemIds.length > 0, 'review section missing');
  assert(weaknessSection && weaknessSection.contentItemIds.length > 0, 'weakness section missing');
  assert(!assignment.contentItemIds.includes('q_math_remainder_001'), 'excluded recent item was selected');
  assert(assignment.generationContext.dueSkillNodeIds.includes(dueSkillNodeIds[0]), 'generation context missing due skill');
  pass('module training-policy');
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

async function testContentGeneration() {
  const h = createHarness();
  const result = await h.contentGenerationRuntime.generateContentCandidates({
    subject: 'math',
    track: 'olympiad',
    skillNodeIds: ['math.number.remainder'],
    count: 2
  });
  assert(result.candidates.length === 2, 'content generation should return 2 candidates');
  assert(result.candidates.every((candidate) => candidate.enabled === false), 'generated candidates must not be enabled');
  assert(h.contentGenerationRuntime.listCandidates({ skillNodeId: 'math.number.remainder' }).length === 2, 'generated candidates not persisted');
  pass('module content-generation');
}

async function testLearningRuntimePolicy() {
  const tempRoot = path.join(os.tmpdir(), `studygate-ai-learning-runtime-policy-${process.pid}-${Date.now()}`);
  removeDirectory(tempRoot);
  const aiLearningRuntime = createAiLearningRuntime({
    env: { AI_PROVIDER: 'mock' },
    fs,
    pathModule: path,
    projectRootPath,
    userDataPath: tempRoot
  });
  const previousAssignment = aiLearningRuntime.getAssignment({
    studentId: 'policy_runtime_child',
    dateKey: '2026-06-30',
    profileId: 'math_olympiad_daily_set_v1'
  });
  const previousItems = aiLearningRuntime.contentBankRuntime.getContentItemsByIds(previousAssignment.contentItemIds);
  await aiLearningRuntime.submitAttemptBatch({
    studentId: 'policy_runtime_child',
    assignmentId: previousAssignment.id,
    attempts: previousItems.map((item) => ({
      contentItemId: item.id,
      response: { type: 'final_answer', raw: answerForContentItem(item) }
    }))
  });
  fs.writeFileSync(
    aiLearningRuntime.paths.reviewQueuePath(),
    JSON.stringify([
      {
        studentId: 'policy_runtime_child',
        skillNodeId: 'math.number.divisibility',
        reviewStage: 0,
        nextReviewAt: '2026-07-01T00:00:00.000Z',
        lastReviewResult: 'passed',
        stability: 0.1,
        status: 'active'
      }
    ], null, 2),
    'utf8'
  );
  const nextAssignment = aiLearningRuntime.getAssignment({
    studentId: 'policy_runtime_child',
    dateKey: '2026-07-01',
    profileId: 'math_olympiad_daily_set_v1'
  });
  const reviewSection = nextAssignment.sections.find((section) => section.type === 'review');
  assert(reviewSection && reviewSection.contentItemIds.length > 0, 'runtime did not auto-select due review section');
  assert(nextAssignment.generationContext.dueSkillNodeIds.includes('math.number.divisibility'), 'runtime generation context missing due review');
  assert(nextAssignment.generationContext.excludeContentItemIds.some((id) => previousAssignment.contentItemIds.includes(id)), 'runtime did not include recent exclusions');
  assert(!nextAssignment.contentItemIds.some((id) => previousAssignment.contentItemIds.includes(id)), 'runtime selected a recent content item');
  removeDirectory(tempRoot);
  pass('module learning-runtime-policy');
}

async function testIpc() {
  const tempRoot = path.join(os.tmpdir(), `studygate-ai-learning-ipc-${process.pid}-${Date.now()}`);
  removeDirectory(tempRoot);
  const aiLearningRuntime = createAiLearningRuntime({
    env: { AI_PROVIDER: 'mock' },
    fs,
    pathModule: path,
    projectRootPath,
    userDataPath: tempRoot
  });
  const ipcMain = createFakeIpcMain();

  registerAiLearningIpc({ ipcMain, aiLearningRuntime });

  assert(ipcMain.handlers.has('learning:get-assignment'), 'assignment ipc missing');
  assert(ipcMain.handlers.has('answer:submit-attempt-batch'), 'submit ipc missing');
  assert(ipcMain.handlers.has('ai:generate-content-candidates'), 'content generation ipc missing');

  const assignmentResponse = await ipcMain.handlers.get('learning:get-assignment')(null, {
    studentId: 'ipc_child',
    dateKey: '2026-06-30',
    profileId: 'math_olympiad_daily_set_v1'
  });
  assert(assignmentResponse.assignment.contentItemIds.length === 10, 'ipc assignment should contain 10 content items');
  assert(assignmentResponse.contentItems.length === 10, 'ipc assignment content items missing');
  assert(!Object.prototype.hasOwnProperty.call(assignmentResponse.contentItems[0], 'standardAnswer'), 'ipc leaked standard answer');

  const items = aiLearningRuntime.contentBankRuntime.getContentItemsByIds(assignmentResponse.assignment.contentItemIds);
  const submitResult = await ipcMain.handlers.get('answer:submit-attempt-batch')(null, {
    studentId: 'ipc_child',
    assignmentId: assignmentResponse.assignment.id,
    attempts: items.map((item) => ({
      contentItemId: item.id,
      response: { type: 'final_answer', raw: answerForContentItem(item) }
    }))
  });
  assert(submitResult.evaluationBatch.summary.correct === 10, 'ipc submit evaluation failed');
  assert(submitResult.aiResult.status === 'completed', 'ipc submit ai result missing');

  const aiResults = await ipcMain.handlers.get('ai:get-results')(null, {
    assignmentId: assignmentResponse.assignment.id
  });
  assert(aiResults.length >= 1, 'ipc ai results lookup failed');

  const gameState = await ipcMain.handlers.get('game:get-state')(null, { studentId: 'ipc_child' });
  assert(gameState.xp > 0, 'ipc game state missing');
  const evaluations = await ipcMain.handlers.get('answer:get-evaluation-batches')(null, {
    studentId: 'ipc_child',
    assignmentId: assignmentResponse.assignment.id
  });
  assert(evaluations.length === 1, 'ipc evaluation batches lookup failed');
  const generated = await ipcMain.handlers.get('ai:generate-content-candidates')(null, {
    skillNodeIds: ['math.number.remainder'],
    count: 1
  });
  assert(generated.candidates.length === 1, 'ipc content generation failed');
  removeDirectory(tempRoot);
  pass('module ipc');
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
  await testTrainingPolicy();
  await testAttempt();
  await testAiMock();
  await testContentGeneration();
  await testLearningRuntimePolicy();
  await testIpc();
}

const tests = {
  all: testAll,
  paths: testPaths,
  store: testStore,
  skill: testSkill,
  content: testContent,
  evaluation: testEvaluation,
  assignment: testAssignment,
  'training-policy': testTrainingPolicy,
  attempt: testAttempt,
  'ai-mock': testAiMock,
  'content-generation': testContentGeneration,
  'learning-runtime-policy': testLearningRuntimePolicy,
  ipc: testIpc,
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
