'use strict';

function createReviewSchedulerRuntime(dependencies = {}) {
  const {
    jsonStore,
    paths
  } = dependencies;

  if (!jsonStore || !paths) {
    throw new Error('review scheduler runtime requires jsonStore and paths.');
  }

  const REVIEW_INTERVAL_DAYS = [1, 3, 7, 14, 30];

  function stateKey(studentId, skillNodeId) {
    return `${studentId}::${skillNodeId}`;
  }

  function addDays(date, days) {
    const next = new Date(date.getTime());
    next.setDate(next.getDate() + days);
    return next;
  }

  function readQueue() {
    return jsonStore.readJsonFile(paths.reviewQueuePath(), []);
  }

  function writeQueue(queue) {
    jsonStore.writeJsonFileAtomic(paths.reviewQueuePath(), queue);
  }

  function dueSkillNodeIds({ studentId, date = new Date() }) {
    const cutoff = date.getTime();
    return readQueue()
      .filter((item) =>
        item.studentId === studentId &&
        item.status !== 'mastered' &&
        item.nextReviewAt &&
        new Date(item.nextReviewAt).getTime() <= cutoff
      )
      .map((item) => item.skillNodeId);
  }

  function applyLearningEvents({ studentId, events = [], createdAt = new Date().toISOString() }) {
    const now = new Date(createdAt);
    const queue = readQueue();
    const queueMap = new Map(queue.map((item) => [stateKey(item.studentId, item.skillNodeId), item]));

    for (const event of events) {
      for (const skillNodeId of Array.isArray(event.skillNodeIds) ? event.skillNodeIds : []) {
        const key = stateKey(event.studentId || studentId, skillNodeId);
        const existing = queueMap.get(key);

        if (event.type === 'final_answer_correct' && !existing) {
          queueMap.set(key, {
            studentId: event.studentId || studentId,
            skillNodeId,
            reviewStage: 0,
            nextReviewAt: addDays(now, REVIEW_INTERVAL_DAYS[0]).toISOString(),
            lastReviewResult: 'passed',
            stability: 0.1,
            status: 'active'
          });
          continue;
        }

        if (!existing) {
          continue;
        }

        if (event.type === 'spaced_review_passed') {
          const nextStage = existing.reviewStage + 1;
          existing.reviewStage = nextStage;
          existing.lastReviewResult = 'passed';
          existing.stability = Math.round(Math.min(1, (Number(existing.stability) || 0) + 0.12) * 100) / 100;

          if (nextStage >= REVIEW_INTERVAL_DAYS.length) {
            existing.status = 'mastered';
            existing.nextReviewAt = '';
          } else {
            existing.nextReviewAt = addDays(now, REVIEW_INTERVAL_DAYS[nextStage]).toISOString();
          }
        } else if (event.type === 'spaced_review_failed') {
          existing.lastReviewResult = 'failed';
          existing.stability = Math.round(Math.max(0, (Number(existing.stability) || 0) - 0.1) * 100) / 100;
          existing.nextReviewAt = addDays(now, 1).toISOString();
        }

        queueMap.set(key, existing);
      }
    }

    const next = [...queueMap.values()];
    writeQueue(next);
    return next.filter((item) => item.studentId === studentId);
  }

  function listQueue(studentId) {
    return readQueue().filter((item) => !studentId || item.studentId === studentId);
  }

  return {
    applyLearningEvents,
    dueSkillNodeIds,
    listQueue
  };
}

module.exports = {
  createReviewSchedulerRuntime
};
