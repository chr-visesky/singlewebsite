'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { createAiLearningJsonStoreRuntime } = require('../src/ai-learning-json-store-runtime');
const { createAiLearningPathsRuntime } = require('../src/ai-learning-paths-runtime');
const { createSkillGraphRuntime } = require('../src/skill-graph-runtime');
const { createContentBankRuntime } = require('../src/content-bank-runtime');
const { createEvaluationRuntime } = require('../src/evaluation-runtime');
const { createAiLearningRuntime } = require('../src/ai-learning-runtime');

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

function pass(message) {
  console.log(`PASS ${message}`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function answerForContentItem(contentItem) {
  if (contentItem.id === 'q_math_chicken_rabbit_001') {
    return '鸡23只，兔12只';
  }

  if (contentItem.answerSchema && contentItem.answerSchema.type === 'object') {
    return Object.entries(contentItem.standardAnswer)
      .map(([key, value]) => `${key}${value}`)
      .join('，');
  }

  if (Array.isArray(contentItem.standardAnswer)) {
    return contentItem.standardAnswer.join('，');
  }

  if (contentItem.standardAnswer && typeof contentItem.standardAnswer === 'object') {
    if (
      Object.prototype.hasOwnProperty.call(contentItem.standardAnswer, 'numerator') &&
      Object.prototype.hasOwnProperty.call(contentItem.standardAnswer, 'denominator')
    ) {
      return `${contentItem.standardAnswer.numerator}/${contentItem.standardAnswer.denominator}`;
    }
  }

  return String(contentItem.standardAnswer);
}

async function run() {
  const tempRoot = path.join(os.tmpdir(), `studygate-ai-learning-smoke-${process.pid}`);
  removeDirectory(tempRoot);

  const projectRootPath = path.resolve(__dirname, '..');
  const jsonStore = createAiLearningJsonStoreRuntime({
    fs,
    pathModule: path
  });
  const paths = createAiLearningPathsRuntime({
    fs,
    pathModule: path,
    projectRootPath,
    userDataPath: tempRoot
  });
  const skillGraphRuntime = createSkillGraphRuntime({
    jsonStore,
    paths
  });
  const contentBankRuntime = createContentBankRuntime({
    jsonStore,
    paths,
    skillGraphRuntime
  });
  const evaluationRuntime = createEvaluationRuntime();

  paths.ensureBaseDirectories();
  assert(fs.existsSync(paths.dataRoot()), 'ai-learning data root was not created.');
  assert(fs.existsSync(paths.assetsDir()), 'assets directory was not created.');
  pass('paths');

  const skillNodes = skillGraphRuntime.initialize();
  assert(fs.existsSync(paths.skillNodesPath()), 'skill-nodes.json was not created.');
  assert(skillNodes.length >= 8, `expected at least 8 skill nodes, got ${skillNodes.length}.`);
  pass('skill nodes');

  const contentItems = contentBankRuntime.initialize();
  assert(fs.existsSync(paths.contentItemsPath()), 'content-items.json was not created.');
  assert(contentItems.length >= 24, `expected at least 24 content items, got ${contentItems.length}.`);
  pass('content items');

  const chickenRabbit = skillGraphRuntime.getSkillNode('math.application.chicken_rabbit');
  assert(chickenRabbit && chickenRabbit.title === '鸡兔同笼', 'chicken-rabbit skill node was not found.');
  const chickenRabbitItems = contentBankRuntime.listContentItems({
    skillNodeIds: ['math.application.chicken_rabbit']
  });
  assert(chickenRabbitItems.length >= 3, 'expected at least 3 chicken-rabbit content items.');
  pass('content lookup');

  const profilePath = paths.profileSeedPath('math-olympiad-daily-set.profile.json');
  assert(fs.existsSync(profilePath), 'math daily-set profile seed was not found.');
  const profile = readJson(profilePath);
  assert(profile.id === 'math_olympiad_daily_set_v1', 'unexpected math profile id.');
  assert(profile.assignmentType === 'daily_set', 'unexpected math profile assignment type.');
  assert(profile.targetContentCount === 10, 'unexpected math profile target content count.');
  pass('math profile');

  const chickenRabbitItem = contentBankRuntime.getContentItem('q_math_chicken_rabbit_001');
  const objectEvaluation = evaluationRuntime.evaluateAttempt({
    contentItem: chickenRabbitItem,
    attempt: {
      id: 'attempt_object',
      contentItemId: chickenRabbitItem.id,
      response: {
        type: 'final_answer',
        raw: '鸡23只，兔12只'
      }
    }
  });
  assert(objectEvaluation.verdict.isCorrect, 'object answer should be correct.');
  pass('object evaluation');

  const numberItem = contentBankRuntime.getContentItem('q_math_remainder_001');
  const numberEvaluation = evaluationRuntime.evaluateAttempt({
    contentItem: numberItem,
    attempt: {
      id: 'attempt_number',
      contentItemId: numberItem.id,
      response: {
        type: 'final_answer',
        raw: '2'
      }
    }
  });
  assert(numberEvaluation.verdict.isCorrect, 'number answer should be correct.');
  pass('number evaluation');

  const fractionEvaluation = evaluationRuntime.evaluateAttempt({
    contentItem: {
      id: 'q_fraction_smoke',
      contentType: 'math_fraction_answer',
      skillNodeIds: ['math.number.remainder'],
      answerSchema: {
        type: 'fraction'
      },
      standardAnswer: '2/4',
      evaluationPolicy: {
        grader: 'final-answer-grader'
      }
    },
    attempt: {
      id: 'attempt_fraction',
      contentItemId: 'q_fraction_smoke',
      response: {
        type: 'final_answer',
        raw: '1/2'
      }
    }
  });
  assert(fractionEvaluation.verdict.isCorrect, 'fraction answer should be equivalent.');
  pass('fraction evaluation');

  const listEvaluation = evaluationRuntime.evaluateAttempt({
    contentItem: {
      id: 'q_list_smoke',
      contentType: 'math_list_answer',
      skillNodeIds: ['math.combinatorics.enumeration'],
      answerSchema: {
        type: 'list'
      },
      standardAnswer: [3, 5, 7],
      evaluationPolicy: {
        grader: 'final-answer-grader'
      }
    },
    attempt: {
      id: 'attempt_list',
      contentItemId: 'q_list_smoke',
      response: {
        type: 'final_answer',
        raw: '7，5，3'
      }
    }
  });
  assert(listEvaluation.verdict.isCorrect, 'list answer should be order-insensitive.');
  pass('list evaluation');

  const batch = evaluationRuntime.evaluateAttemptBatch({
    contentItems: [chickenRabbitItem, numberItem],
    attempts: [
      {
        id: 'attempt_batch_object',
        contentItemId: chickenRabbitItem.id,
        response: {
          type: 'final_answer',
          raw: '鸡23只，兔12只'
        }
      },
      {
        id: 'attempt_batch_number',
        contentItemId: numberItem.id,
        response: {
          type: 'final_answer',
          raw: '2'
        }
      }
    ]
  });
  assert(batch.summary.total === 2, 'batch should include 2 evaluations.');
  assert(batch.summary.correct === 2, 'batch should grade both answers as correct.');
  pass('evaluation batch');

  const aiLearningRuntime = createAiLearningRuntime({
    env: { AI_PROVIDER: 'mock' },
    fs,
    pathModule: path,
    projectRootPath,
    userDataPath: tempRoot
  });
  const assignment = aiLearningRuntime.getAssignment({
    studentId: 'default_child',
    dateKey: '2026-06-30',
    profileId: 'math_olympiad_daily_set_v1'
  });
  assert(assignment.contentItemIds.length === 10, `expected 10 assignment content items, got ${assignment.contentItemIds.length}.`);
  pass('assignment generated');

  const assignmentContentItems = contentBankRuntime.getContentItemsByIds(assignment.contentItemIds);
  const attempts = assignmentContentItems.map((item) => ({
    contentItemId: item.id,
    response: {
      type: 'final_answer',
      raw: answerForContentItem(item)
    }
  }));
  const result = await aiLearningRuntime.submitAttemptBatch({
    studentId: 'default_child',
    assignmentId: assignment.id,
    attempts,
    behavior: {
      durationSeconds: 900
    }
  });

  assert(result.evaluationBatch.summary.total === 10, 'expected 10 evaluations.');
  assert(result.evaluationBatch.summary.correct === 10, 'expected all evaluations to be correct.');
  pass('attempt batch submitted');

  assert(result.aiResult && result.aiResult.status === 'completed', 'expected mock AI result to complete.');
  pass('mock ai result');

  assert(result.learningEvents.some((event) => event.type === 'assignment_completed'), 'assignment_completed event missing.');
  assert(result.learningEvents.some((event) => event.type === 'final_answer_correct'), 'final_answer_correct event missing.');
  pass('learning events');

  assert(result.masterySnapshot.some((state) => state.mastery > 0), 'mastery was not updated.');
  pass('mastery updated');

  assert(result.reviewQueue.length > 0, 'review queue was not created.');
  pass('review queued');

  assert(result.gameState.xp > 0, 'game XP was not awarded.');
  assert(Object.keys(result.gameState.cards).length > 0, 'game cards were not updated.');
  pass('game reward');

  console.log('PASS ai-learning step1 MVP smoke');
}

run().catch((error) => {
  console.error(`FAIL ${error && error.message ? error.message : String(error)}`);
  process.exit(1);
});
