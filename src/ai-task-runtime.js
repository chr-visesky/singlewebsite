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

  async function createAndRunTask({ type = 'daily_summary', assignment, attemptBatch, evaluationBatch }) {
    const route = aiModelRoutingRuntime.routeTask(type);
    const now = new Date().toISOString();
    const task = {
      id: `ai_task_${Date.now()}`,
      type,
      assignmentId: assignment.id,
      attemptBatchId: attemptBatch.id,
      provider: route.provider,
      model: route.model,
      thinking: route.thinking,
      status: 'running',
      input: {
        assignmentId: assignment.id,
        summary: evaluationBatch.summary,
        evaluations: evaluationBatch.evaluations
      },
      createdAt: now,
      updatedAt: now
    };

    const tasks = readTasks();
    tasks.push(task);
    writeTasks(tasks);

    try {
      const providerResult = await aiProviderRuntime.runTask(task);
      const result = {
        id: `ai_result_${Date.now()}`,
        taskId: task.id,
        assignmentId: assignment.id,
        attemptBatchId: attemptBatch.id,
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
        status: 'failed',
        error: error.message || String(error)
      };
    }
  }

  function listResults() {
    return readResults();
  }

  return {
    createAndRunTask,
    listResults
  };
}

module.exports = {
  createAiTaskRuntime
};
