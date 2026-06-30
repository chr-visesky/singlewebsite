'use strict';

function createGameRewardRuntime(dependencies = {}) {
  const {
    jsonStore,
    paths
  } = dependencies;

  if (!jsonStore || !paths) {
    throw new Error('game reward runtime requires jsonStore and paths.');
  }

  function readStates() {
    return jsonStore.readJsonFile(paths.gameStatePath(), {});
  }

  function writeStates(states) {
    jsonStore.writeJsonFileAtomic(paths.gameStatePath(), states);
  }

  function defaultState(studentId) {
    return {
      studentId,
      xp: 0,
      cards: {},
      rewardLog: []
    };
  }

  function ensureCard(state, skillNodeId) {
    if (!state.cards[skillNodeId]) {
      state.cards[skillNodeId] = {
        cardId: skillNodeId,
        name: skillNodeId,
        proficiency: 0,
        stability: 0,
        transfer: 0,
        reviewStage: 0
      };
    }

    return state.cards[skillNodeId];
  }

  function clampProgress(value) {
    return Math.max(0, Math.min(100, Math.round(value)));
  }

  function applyLearningEvents({ studentId, events = [], gradingSummary = {}, createdAt = new Date().toISOString() }) {
    const states = readStates();
    const state = states[studentId] || defaultState(studentId);
    let xpGained = 0;
    const reasons = [];
    const cardUpdates = [];

    for (const event of events) {
      if (event.type === 'final_answer_correct') {
        xpGained += 10;
        reasons.push('答对题目 +10 XP');

        for (const skillNodeId of Array.isArray(event.skillNodeIds) ? event.skillNodeIds : []) {
          const card = ensureCard(state, skillNodeId);
          card.proficiency = clampProgress(card.proficiency + 5);
          cardUpdates.push({ cardId: skillNodeId, proficiency: card.proficiency });
        }
      } else if (event.type === 'spaced_review_passed') {
        xpGained += 5;
        reasons.push('到期复习通过 +5 XP');

        for (const skillNodeId of Array.isArray(event.skillNodeIds) ? event.skillNodeIds : []) {
          const card = ensureCard(state, skillNodeId);
          card.stability = clampProgress(card.stability + 5);
          cardUpdates.push({ cardId: skillNodeId, stability: card.stability });
        }
      } else if (event.type === 'assignment_completed') {
        xpGained += 20;
        reasons.push('完成今日任务 +20 XP');
      }
    }

    const total = Number(gradingSummary.total) || 0;
    const correct = Number(gradingSummary.correct) || 0;
    const accuracy = total ? correct / total : 0;

    if (total && accuracy >= 0.8) {
      xpGained += 20;
      reasons.push('正确率达到 80% +20 XP');
    }

    if (total && accuracy >= 1) {
      xpGained += 20;
      reasons.push('全部正确 +20 XP');
    }

    state.xp += xpGained;
    const reward = {
      id: `reward_${Date.now()}`,
      source: 'assignment',
      xpGained,
      reasons,
      cardUpdates,
      createdAt
    };
    state.rewardLog.push(reward);
    states[studentId] = state;
    writeStates(states);

    return reward;
  }

  function getGameState(studentId) {
    const states = readStates();
    return states[studentId] || defaultState(studentId);
  }

  return {
    applyLearningEvents,
    getGameState
  };
}

module.exports = {
  createGameRewardRuntime
};
