'use strict';

function createLearningEventRuntime(dependencies = {}) {
  const {
    jsonStore,
    paths
  } = dependencies;

  if (!jsonStore || !paths) {
    throw new Error('learning event runtime requires jsonStore and paths.');
  }

  function normalizePrefix(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function sectionTypeByContentItemId(assignment = {}) {
    const map = new Map();

    for (const section of Array.isArray(assignment.sections) ? assignment.sections : []) {
      for (const contentItemId of Array.isArray(section.contentItemIds) ? section.contentItemIds : []) {
        map.set(contentItemId, normalizePrefix(section.type));
      }
    }

    return map;
  }

  function eventId(prefix, parts) {
    return `${prefix}_${parts.filter(Boolean).join('_')}`.replace(/[^a-zA-Z0-9_-]+/g, '_');
  }

  function createEventsFromEvaluationBatch({ assignment, attemptBatch, evaluationBatch, createdAt = new Date().toISOString() }) {
    const events = [];
    const sectionMap = sectionTypeByContentItemId(assignment);
    const studentId = normalizePrefix(assignment && assignment.studentId);
    const assignmentId = normalizePrefix(assignment && assignment.id);
    const attemptBatchId = normalizePrefix(attemptBatch && attemptBatch.id);

    for (const evaluation of Array.isArray(evaluationBatch.evaluations) ? evaluationBatch.evaluations : []) {
      const contentItemId = normalizePrefix(evaluation.contentItemId);
      const isCorrect = Boolean(evaluation.verdict && evaluation.verdict.isCorrect);
      const type = isCorrect ? 'final_answer_correct' : 'final_answer_wrong';
      const baseEvent = {
        id: eventId('evt', [attemptBatchId, evaluation.attemptId, type]),
        studentId,
        type,
        assignmentId,
        attemptBatchId,
        attemptId: normalizePrefix(evaluation.attemptId),
        evaluationId: normalizePrefix(evaluation.id),
        contentItemId,
        skillNodeIds: Array.isArray(evaluation.skillNodeIds) ? evaluation.skillNodeIds : [],
        confidence: Number(evaluation.verdict && evaluation.verdict.confidence) || 1,
        createdAt
      };

      events.push(baseEvent);

      if (sectionMap.get(contentItemId) === 'review') {
        events.push({
          ...baseEvent,
          id: eventId('evt', [attemptBatchId, evaluation.attemptId, isCorrect ? 'spaced_review_passed' : 'spaced_review_failed']),
          type: isCorrect ? 'spaced_review_passed' : 'spaced_review_failed'
        });
      }
    }

    events.push({
      id: eventId('evt', [attemptBatchId, 'assignment_completed']),
      studentId,
      type: 'assignment_completed',
      assignmentId,
      attemptBatchId,
      skillNodeIds: [],
      confidence: 1,
      createdAt
    });

    return events;
  }

  function appendEvents(events = []) {
    const current = jsonStore.readJsonFile(paths.learningEventsPath(), []);
    const next = [...(Array.isArray(current) ? current : []), ...events];
    jsonStore.writeJsonFileAtomic(paths.learningEventsPath(), next);
    return next;
  }

  function listEvents() {
    return jsonStore.readJsonFile(paths.learningEventsPath(), []);
  }

  return {
    appendEvents,
    createEventsFromEvaluationBatch,
    listEvents
  };
}

module.exports = {
  createLearningEventRuntime
};
