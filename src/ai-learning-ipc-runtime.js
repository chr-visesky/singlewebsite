'use strict';

function createIpcError(message, code = 'AI_LEARNING_ERROR') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function sanitizeContentItemForRenderer(contentItem) {
  if (!contentItem || typeof contentItem !== 'object') {
    return null;
  }

  const {
    standardAnswer,
    evaluationPolicy,
    ...safeContentItem
  } = contentItem;

  return safeContentItem;
}

function normalizeAttempts(rawAttempts) {
  if (!Array.isArray(rawAttempts)) {
    return [];
  }

  return rawAttempts.map((attempt) => {
    const response = attempt && attempt.response && typeof attempt.response === 'object'
      ? attempt.response
      : { type: 'final_answer', raw: attempt && attempt.raw !== undefined ? attempt.raw : '' };

    return {
      id: attempt && typeof attempt.id === 'string' ? attempt.id.trim() : undefined,
      contentItemId: attempt && typeof attempt.contentItemId === 'string' ? attempt.contentItemId.trim() : '',
      response
    };
  });
}

function registerAiLearningIpc(dependencies = {}) {
  const {
    ipcMain,
    aiLearningRuntime,
    normalizePrefix = (value) => (typeof value === 'string' ? value.trim() : '')
  } = dependencies;

  if (!ipcMain || typeof ipcMain.handle !== 'function') {
    throw new Error('ai-learning ipc requires ipcMain.');
  }

  if (!aiLearningRuntime) {
    throw new Error('ai-learning ipc requires aiLearningRuntime.');
  }

  ipcMain.handle('learning:get-assignment', async (_event, payload = {}) => {
    const studentId = normalizePrefix(payload.studentId) || 'default_child';
    const dateKey = normalizePrefix(payload.dateKey) || localDateKey();
    const profileId = normalizePrefix(payload.profileId) || 'math_olympiad_daily_set_v1';
    const assignment = aiLearningRuntime.getAssignment({
      studentId,
      dateKey,
      profileId,
      dueSkillNodeIds: Array.isArray(payload.dueSkillNodeIds) ? payload.dueSkillNodeIds : [],
      weakSkillNodeIds: Array.isArray(payload.weakSkillNodeIds) ? payload.weakSkillNodeIds : []
    });
    const contentItems = aiLearningRuntime.contentBankRuntime
      .getContentItemsByIds(assignment.contentItemIds)
      .map(sanitizeContentItemForRenderer);

    return {
      assignment,
      contentItems
    };
  });

  ipcMain.handle('learning:get-content-item', async (_event, payload = {}) => {
    const contentItemId = normalizePrefix(payload.contentItemId || payload.id);
    const contentItem = aiLearningRuntime.getContentItem(contentItemId);

    if (!contentItem) {
      throw createIpcError(`Content item not found: ${contentItemId}`, 'CONTENT_ITEM_NOT_FOUND');
    }

    return sanitizeContentItemForRenderer(contentItem);
  });

  ipcMain.handle('answer:submit-attempt-batch', async (_event, payload = {}) => {
    const studentId = normalizePrefix(payload.studentId) || 'default_child';
    const assignmentId = normalizePrefix(payload.assignmentId);

    if (!assignmentId) {
      throw createIpcError('assignmentId is required.', 'ASSIGNMENT_ID_REQUIRED');
    }

    return aiLearningRuntime.submitAttemptBatch({
      studentId,
      assignmentId,
      attempts: normalizeAttempts(payload.attempts),
      behavior: payload.behavior && typeof payload.behavior === 'object' ? payload.behavior : {}
    });
  });

  ipcMain.handle('learning:get-mastery', async (_event, payload = {}) => {
    const studentId = normalizePrefix(payload.studentId) || 'default_child';
    aiLearningRuntime.initialize();
    return aiLearningRuntime.studentModelRuntime.getMastery(studentId);
  });

  ipcMain.handle('learning:get-review-queue', async (_event, payload = {}) => {
    const studentId = normalizePrefix(payload.studentId) || 'default_child';
    return aiLearningRuntime.getReviewQueue(studentId);
  });

  ipcMain.handle('answer:get-attempt-batches', async (_event, payload = {}) => {
    return aiLearningRuntime.getAttemptBatches({
      studentId: normalizePrefix(payload.studentId),
      assignmentId: normalizePrefix(payload.assignmentId)
    });
  });

  ipcMain.handle('answer:get-evaluation-batches', async (_event, payload = {}) => {
    return aiLearningRuntime.getEvaluationBatches({
      studentId: normalizePrefix(payload.studentId),
      assignmentId: normalizePrefix(payload.assignmentId),
      attemptBatchId: normalizePrefix(payload.attemptBatchId)
    });
  });

  ipcMain.handle('game:get-state', async (_event, payload = {}) => {
    const studentId = normalizePrefix(payload.studentId) || 'default_child';
    aiLearningRuntime.initialize();
    return aiLearningRuntime.gameRewardRuntime.getGameState(studentId);
  });

  ipcMain.handle('ai:get-results', async (_event, payload = {}) => {
    return aiLearningRuntime.getAiResults({
      assignmentId: normalizePrefix(payload.assignmentId),
      attemptBatchId: normalizePrefix(payload.attemptBatchId)
    });
  });

  ipcMain.handle('ai:generate-content-candidates', async (_event, payload = {}) => {
    return aiLearningRuntime.generateContentCandidates({
      subject: normalizePrefix(payload.subject) || 'math',
      track: normalizePrefix(payload.track) || 'olympiad',
      skillNodeIds: Array.isArray(payload.skillNodeIds) ? payload.skillNodeIds : [],
      difficulty: Number(payload.difficulty) || 2,
      count: Number(payload.count) || 3,
      constraints: payload.constraints && typeof payload.constraints === 'object' ? payload.constraints : {}
    });
  });
}

module.exports = {
  localDateKey,
  registerAiLearningIpc,
  sanitizeContentItemForRenderer
};
