'use strict';

function createStudentModelRuntime(dependencies = {}) {
  const {
    jsonStore,
    paths
  } = dependencies;

  if (!jsonStore || !paths) {
    throw new Error('student model runtime requires jsonStore and paths.');
  }

  function roundMetric(value) {
    return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
  }

  function stateKey(studentId, skillNodeId) {
    return `${studentId}::${skillNodeId}`;
  }

  function defaultState(studentId, skillNodeId) {
    return {
      studentId,
      skillNodeId,
      mastery: 0,
      stability: 0,
      transfer: 0,
      wrongCount: 0,
      correctCount: 0,
      lastPracticedAt: '',
      nextReviewAt: '',
      weakReason: ''
    };
  }

  function readMastery() {
    return jsonStore.readJsonFile(paths.masteryPath(), []);
  }

  function writeMastery(states) {
    jsonStore.writeJsonFileAtomic(paths.masteryPath(), states);
  }

  function applyLearningEvents({ studentId, events = [], createdAt = new Date().toISOString() }) {
    const states = readMastery();
    const stateMap = new Map(states.map((state) => [stateKey(state.studentId, state.skillNodeId), state]));

    for (const event of events) {
      for (const skillNodeId of Array.isArray(event.skillNodeIds) ? event.skillNodeIds : []) {
        const key = stateKey(event.studentId || studentId, skillNodeId);
        const state = stateMap.get(key) || defaultState(event.studentId || studentId, skillNodeId);

        if (event.type === 'final_answer_correct') {
          state.mastery = roundMetric(state.mastery + 0.1);
          state.correctCount += 1;
          state.weakReason = '';
        } else if (event.type === 'final_answer_wrong') {
          state.mastery = roundMetric(state.mastery - 0.06);
          state.wrongCount += 1;
          state.weakReason = '最终答案错误';
        } else if (event.type === 'spaced_review_passed') {
          state.stability = roundMetric(state.stability + 0.12);
        } else if (event.type === 'spaced_review_failed') {
          state.stability = roundMetric(state.stability - 0.1);
          state.weakReason = '到期复习未通过';
        }

        state.lastPracticedAt = createdAt;
        stateMap.set(key, state);
      }
    }

    const next = [...stateMap.values()];
    writeMastery(next);
    return next.filter((state) => state.studentId === studentId);
  }

  function getMastery(studentId) {
    return readMastery().filter((state) => state.studentId === studentId);
  }

  function getWeakSkillNodeIds(studentId, limit = 8) {
    return getMastery(studentId)
      .filter((state) => state.mastery < 0.6 || state.wrongCount > 0)
      .sort((left, right) => left.mastery - right.mastery || right.wrongCount - left.wrongCount)
      .slice(0, limit)
      .map((state) => state.skillNodeId);
  }

  return {
    applyLearningEvents,
    getMastery,
    getWeakSkillNodeIds
  };
}

module.exports = {
  createStudentModelRuntime
};
