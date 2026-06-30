'use strict';

function createAttemptRuntime(dependencies = {}) {
  const {
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
  } = dependencies;

  if (
    !aiTaskRuntime ||
    !assignmentRuntime ||
    !contentBankRuntime ||
    !evaluationRuntime ||
    !gameRewardRuntime ||
    !jsonStore ||
    !learningEventRuntime ||
    !paths ||
    !reviewSchedulerRuntime ||
    !studentModelRuntime
  ) {
    throw new Error('attempt runtime missing dependencies.');
  }

  function normalizePrefix(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function readAttempts() {
    return jsonStore.readJsonFile(paths.attemptsPath ? paths.attemptsPath() : paths.evaluationsPath().replace('evaluations.json', 'attempts.json'), []);
  }

  function writeAttempts(attempts) {
    const attemptsPath = paths.attemptsPath ? paths.attemptsPath() : paths.evaluationsPath().replace('evaluations.json', 'attempts.json');
    jsonStore.writeJsonFileAtomic(attemptsPath, attempts);
  }

  function readEvaluations() {
    return jsonStore.readJsonFile(paths.evaluationsPath(), []);
  }

  function writeEvaluations(evaluations) {
    jsonStore.writeJsonFileAtomic(paths.evaluationsPath(), evaluations);
  }

  function listAttemptBatches(filters = {}) {
    const studentId = normalizePrefix(filters.studentId);
    const assignmentId = normalizePrefix(filters.assignmentId);

    return readAttempts().filter((attemptBatch) => {
      if (studentId && attemptBatch.studentId !== studentId) {
        return false;
      }

      if (assignmentId && attemptBatch.assignmentId !== assignmentId) {
        return false;
      }

      return true;
    });
  }

  function listEvaluationBatches(filters = {}) {
    const studentId = normalizePrefix(filters.studentId);
    const assignmentId = normalizePrefix(filters.assignmentId);
    const attemptBatchId = normalizePrefix(filters.attemptBatchId);

    return readEvaluations().filter((evaluationBatch) => {
      if (studentId && evaluationBatch.studentId !== studentId) {
        return false;
      }

      if (assignmentId && evaluationBatch.assignmentId !== assignmentId) {
        return false;
      }

      if (attemptBatchId && evaluationBatch.attemptBatchId !== attemptBatchId) {
        return false;
      }

      return true;
    });
  }

  function recentContentItemIds({ studentId, limit = 30 } = {}) {
    const normalizedStudentId = normalizePrefix(studentId);
    const maxCount = Math.max(0, Math.round(Number(limit) || 0));
    const ids = [];
    const seen = new Set();

    const batches = listAttemptBatches({ studentId: normalizedStudentId })
      .slice()
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());

    for (const batch of batches) {
      for (const attempt of Array.isArray(batch.attempts) ? batch.attempts : []) {
        const contentItemId = normalizePrefix(attempt && attempt.contentItemId);

        if (!contentItemId || seen.has(contentItemId)) {
          continue;
        }

        seen.add(contentItemId);
        ids.push(contentItemId);

        if (ids.length >= maxCount) {
          return ids;
        }
      }
    }

    return ids;
  }

  function normalizeAttempts(rawAttempts = [], assignment) {
    const assignmentContentIds = new Set(assignment.contentItemIds || []);
    const byContentItemId = new Map();

    for (const rawAttempt of Array.isArray(rawAttempts) ? rawAttempts : []) {
      const contentItemId = normalizePrefix(rawAttempt && rawAttempt.contentItemId);

      if (!contentItemId || !assignmentContentIds.has(contentItemId)) {
        throw new Error(`Attempt contentItemId is not in assignment: ${contentItemId}`);
      }

      byContentItemId.set(contentItemId, {
        id: normalizePrefix(rawAttempt.id) || `attempt_${assignment.id}_${contentItemId}`.replace(/[^a-zA-Z0-9_-]+/g, '_'),
        assignmentId: assignment.id,
        studentId: assignment.studentId,
        contentItemId,
        response: rawAttempt.response && typeof rawAttempt.response === 'object'
          ? rawAttempt.response
          : { type: 'final_answer', raw: rawAttempt.raw || '' }
      });
    }

    return (assignment.contentItemIds || []).map((contentItemId) =>
      byContentItemId.get(contentItemId) || {
        id: `attempt_${assignment.id}_${contentItemId}`.replace(/[^a-zA-Z0-9_-]+/g, '_'),
        assignmentId: assignment.id,
        studentId: assignment.studentId,
        contentItemId,
        response: {
          type: 'final_answer',
          raw: ''
        }
      }
    );
  }

  async function submitAttemptBatch({ studentId, assignmentId, attempts = [], behavior = {} }) {
    const assignment = assignmentRuntime.getAssignmentById(assignmentId);

    if (!assignment) {
      throw new Error(`Assignment not found: ${assignmentId}`);
    }

    if (assignment.studentId !== studentId) {
      throw new Error('Assignment does not belong to student.');
    }

    if (assignment.status === 'submitted') {
      throw new Error('Assignment already submitted.');
    }

    const normalizedAttempts = normalizeAttempts(attempts, assignment);
    const contentItems = contentBankRuntime.getContentItemsByIds(assignment.contentItemIds);
    const evaluationBatch = evaluationRuntime.evaluateAttemptBatch({
      contentItems,
      attempts: normalizedAttempts
    });
    const now = new Date().toISOString();
    const attemptBatch = {
      id: `attempt_batch_${Date.now()}`,
      studentId,
      assignmentId: assignment.id,
      createdAt: now,
      behavior,
      attempts: normalizedAttempts
    };
    const evaluationsRecord = {
      id: `evaluation_batch_${Date.now()}`,
      studentId,
      assignmentId: assignment.id,
      attemptBatchId: attemptBatch.id,
      createdAt: now,
      ...evaluationBatch
    };

    const storedAttempts = readAttempts();
    storedAttempts.push(attemptBatch);
    writeAttempts(storedAttempts);

    const storedEvaluations = readEvaluations();
    storedEvaluations.push(evaluationsRecord);
    writeEvaluations(storedEvaluations);

    const aiResult = await aiTaskRuntime.createAndRunTask({
      type: 'daily_summary',
      assignment,
      attemptBatch,
      evaluationBatch: evaluationsRecord
    });
    const learningEvents = learningEventRuntime.createEventsFromEvaluationBatch({
      assignment,
      attemptBatch,
      evaluationBatch: evaluationsRecord,
      createdAt: now
    });
    learningEventRuntime.appendEvents(learningEvents);
    const masterySnapshot = studentModelRuntime.applyLearningEvents({
      studentId,
      events: learningEvents,
      createdAt: now
    });
    const reviewQueue = reviewSchedulerRuntime.applyLearningEvents({
      studentId,
      events: learningEvents,
      createdAt: now
    });
    const settlement = gameRewardRuntime.applyLearningEvents({
      studentId,
      events: learningEvents,
      gradingSummary: evaluationsRecord.summary,
      createdAt: now
    });
    const submittedAssignment = assignmentRuntime.markAssignmentSubmitted(assignment.id, {
      attemptBatchId: attemptBatch.id,
      evaluationBatchId: evaluationsRecord.id,
      submittedAt: now
    });

    return {
      assignment: submittedAssignment,
      attemptBatch,
      evaluationBatch: evaluationsRecord,
      aiResult,
      learningEvents,
      masterySnapshot,
      reviewQueue,
      settlement,
      gameState: gameRewardRuntime.getGameState(studentId)
    };
  }

  return {
    listAttemptBatches,
    listEvaluationBatches,
    recentContentItemIds,
    submitAttemptBatch
  };
}

module.exports = {
  createAttemptRuntime
};
