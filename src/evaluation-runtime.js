'use strict';

const { createFinalAnswerGrader } = require('./graders/final-answer-grader');

function createEvaluationRuntime(dependencies = {}) {
  const {
    graders = {}
  } = dependencies;

  const graderRegistry = new Map();
  const finalAnswerGrader = graders.finalAnswerGrader || createFinalAnswerGrader();

  graderRegistry.set('final-answer-grader', finalAnswerGrader);
  graderRegistry.set('programmatic_final_answer', finalAnswerGrader);

  function normalizePrefix(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function resolveGraderName(contentItem = {}) {
    const policy = contentItem.evaluationPolicy && typeof contentItem.evaluationPolicy === 'object'
      ? contentItem.evaluationPolicy
      : {};
    const explicitGrader = normalizePrefix(policy.grader);

    if (explicitGrader) {
      return explicitGrader;
    }

    const contentType = normalizePrefix(contentItem.contentType);

    if (contentType.startsWith('math_')) {
      return 'final-answer-grader';
    }

    return 'final-answer-grader';
  }

  function getGrader(graderName) {
    const normalized = normalizePrefix(graderName);
    const grader = graderRegistry.get(normalized);

    if (!grader || typeof grader.evaluate !== 'function') {
      throw new Error(`Unknown evaluation grader: ${normalized}`);
    }

    return grader;
  }

  function registerGrader(name, grader) {
    const normalized = normalizePrefix(name);

    if (!normalized) {
      throw new Error('Grader name is required.');
    }

    if (!grader || typeof grader.evaluate !== 'function') {
      throw new Error(`Grader ${normalized} must expose evaluate().`);
    }

    graderRegistry.set(normalized, grader);
  }

  function evaluateAttempt({ contentItem, attempt }) {
    if (!contentItem) {
      throw new Error('evaluateAttempt requires contentItem.');
    }

    const graderName = resolveGraderName(contentItem);
    return getGrader(graderName).evaluate({ contentItem, attempt });
  }

  function evaluateAttemptBatch({ contentItems = [], attempts = [] }) {
    const contentItemById = new Map(contentItems.map((item) => [item.id, item]));
    const attemptByContentItemId = new Map();

    for (const attempt of attempts) {
      const contentItemId = normalizePrefix(attempt && attempt.contentItemId);
      if (contentItemId) {
        attemptByContentItemId.set(contentItemId, attempt);
      }
    }

    const evaluations = contentItems.map((contentItem) => {
      const attempt = attemptByContentItemId.get(contentItem.id) || {
        id: `attempt_${contentItem.id}`,
        contentItemId: contentItem.id,
        response: {
          type: 'final_answer',
          raw: ''
        }
      };

      return evaluateAttempt({
        contentItem,
        attempt
      });
    });

    const total = evaluations.length;
    const correct = evaluations.filter((evaluation) => evaluation.verdict && evaluation.verdict.isCorrect).length;
    const answered = evaluations.filter((evaluation) => evaluation.verdict && evaluation.verdict.status !== 'unanswered').length;
    const score = evaluations.reduce((sum, evaluation) => sum + (Number(evaluation.verdict && evaluation.verdict.score) || 0), 0);
    const maxScore = evaluations.reduce((sum, evaluation) => sum + (Number(evaluation.verdict && evaluation.verdict.maxScore) || 0), 0);

    return {
      summary: {
        total,
        answered,
        correct,
        wrong: total - correct,
        score,
        maxScore
      },
      evaluations,
      missingContentItemIds: attempts
        .map((attempt) => normalizePrefix(attempt && attempt.contentItemId))
        .filter((contentItemId) => contentItemId && !contentItemById.has(contentItemId))
    };
  }

  return {
    evaluateAttempt,
    evaluateAttemptBatch,
    registerGrader,
    resolveGraderName
  };
}

module.exports = {
  createEvaluationRuntime
};
