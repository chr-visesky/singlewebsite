'use strict';

function createAiModelRoutingRuntime(dependencies = {}) {
  const {
    env = process.env
  } = dependencies;

  function routeTask(taskType) {
    if (taskType === 'content_generation' || taskType === 'quality_review' || taskType === 'complex_explanation') {
      return {
        provider: env.AI_PROVIDER || (env.DEEPSEEK_API_KEY ? 'deepseek' : 'mock'),
        model: env.AI_TEXT_STRONG_MODEL || 'deepseek-v4-pro',
        thinking: 'high'
      };
    }

    if (taskType === 'vision_analysis') {
      return {
        provider: env.AI_VISION_PROVIDER || env.AI_PROVIDER || 'mock',
        model: env.AI_VISION_MODEL || 'qwen-vl-plus',
        thinking: 'low'
      };
    }

    return {
      provider: env.AI_PROVIDER || (env.DEEPSEEK_API_KEY ? 'deepseek' : 'mock'),
      model: env.AI_TEXT_FAST_MODEL || 'deepseek-v4-flash',
      thinking: 'disabled'
    };
  }

  return {
    routeTask
  };
}

module.exports = {
  createAiModelRoutingRuntime
};
