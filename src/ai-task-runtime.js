'use strict';

function createAiTaskRuntime(dependencies = {}) {
  const {
    aiModelRoutingRuntime,
    aiProviderRuntime,
    jsonStore,
    paths
  } = dependencies;

  if (!aiModelRoutingRuntime || !aiProviderRuntime || !jsonStore || !paths) {
    throw new Error('ai task runtime requires routing, provider, jsonStore, and paths.');
  }

  function readTasks() {
    return jsonStore.readJsonFile(paths.aiTasksPath(), []);
  }

  function writeTasks(tasks) {
    jsonStore.writeJsonFileAtomic(paths.aiTasksPath(), tasks);
  }

  function readResults() {
    return jsonStore.readJsonFile(paths.aiResultsPath(), []);
  }

  function writeResults(results) {
    jsonStore.writeJsonFileAtomic(paths.aiResultsPath(), results);
  }

  function taskId() {
    return `ai_task_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  }

  function resultId() {
    return `ai_result_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  }

  async function createAndRunGenericTask({
    type = 'daily_summary',
    assignmentId = '',
    attemptBatchId = '',
    input = {},
    metadata = {}
  }) {
    const route = aiModelRoutingRuntime.routeTask(type);
    const now = new Date().toISOString();
    const task = {
      id: taskId(),
      type,
      assignmentId,
      attemptBatchId,
      provider: route.provider,
      model: route.model,
      thinking: route.thinking,
      status: 'running',
      input,
      metadata,
      createdAt: now,
      updatedAt: now
    };

    const tasks = readTasks();
    tasks.push(task);
    writeTasks(tasks);

    try {
      const providerResult = await aiProviderRuntime.runTask(task);
      const result = {
        id: resultId(),
        taskId: task.id,
        assignmentId,
        attemptBatchId,
        type,
        provider: providerResult.provider,
        model: providerResult.model,
        status: providerResult.status || 'completed',
        output: providerResult.output || {},
        usage: providerResult.usage || {},
        createdAt: new Date().toISOString()
      };
      const nextTasks = readTasks().map((item) =>
        item.id === task.id
          ? { ...item, status: result.status, updatedAt: result.createdAt }
          : item
      );
      writeTasks(nextTasks);
      const results = readResults();
      results.push(result);
      writeResults(results);
      return result;
    } catch (error) {
      const failedAt = new Date().toISOString();
      const nextTasks = readTasks().map((item) =>
        item.id === task.id
          ? { ...item, status: 'failed', error: error.message || String(error), updatedAt: failedAt }
          : item
      );
      writeTasks(nextTasks);
      return {
        taskId: task.id,
        type,
        assignmentId,
        attemptBatchId,
        status: 'failed',
        error: error.message || String(error)
      };
    }
  }

  async function createAndRunTask({ type = 'daily_summary', assignment, attemptBatch, evaluationBatch }) {
    return createAndRunGenericTask({
      type,
      assignmentId: assignment.id,
      attemptBatchId: attemptBatch.id,
      input: {
        assignmentId: assignment.id,
        summary: evaluationBatch.summary,
        evaluations: evaluationBatch.evaluations
      }
    });
  }

  function listResults() {
    return readResults();
  }

  return {
    createAndRunTask,
    createAndRunGenericTask,
    listResults
  };
}

module.exports = {
  createAiTaskRuntime
};
