'use strict';

function createAiProviderRuntime(dependencies = {}) {
  const {
    env = process.env,
    fetchImpl = globalThis.fetch
  } = dependencies;

  function normalizePrefix(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  async function runMockTask(task) {
    const itemCount = Array.isArray(task.input && task.input.evaluations)
      ? task.input.evaluations.length
      : 0;

    return {
      provider: 'mock',
      model: task.model || 'mock-ai',
      status: 'completed',
      output: {
        itemFeedback: (task.input.evaluations || []).map((evaluation) => ({
          contentItemId: evaluation.contentItemId,
          errorReasons: evaluation.verdict && evaluation.verdict.isCorrect ? [] : ['最终答案错误'],
          explanation: evaluation.verdict && evaluation.verdict.isCorrect
            ? '答案正确，继续保持。'
            : '先检查最终答案，再回看对应知识点的方法。',
          nextPracticeHint: '下一次优先做同一能力点的变式练习。'
        })),
        dailySummary: {
          strengths: itemCount ? ['已完成本次任务'] : [],
          weaknesses: [],
          nextPlanSuggestion: ['按复习队列继续安排下一次任务']
        }
      },
      usage: {
        inputTokens: 0,
        outputTokens: 0
      }
    };
  }

  function parseJsonOutput(content) {
    const raw = normalizePrefix(content);

    if (!raw) {
      return {};
    }

    try {
      return JSON.parse(raw);
    } catch {
      return {
        rawText: raw
      };
    }
  }

  function deepSeekBaseUrl() {
    return normalizePrefix(env.DEEPSEEK_BASE_URL) || 'https://api.deepseek.com';
  }

  function deepSeekThinkingPayload(task) {
    if (task.thinking === 'high' || task.thinking === 'max') {
      return {
        type: 'enabled'
      };
    }

    return {
      type: 'disabled'
    };
  }

  function deepSeekMessages(task) {
    return [
      {
        role: 'system',
        content: [
          '你是嘉好学 AI 学习系统的分析模块。',
          '必须输出 JSON，不要输出 Markdown。',
          '不要改变程序判分结果。',
          '不要直接发奖励。',
          '只基于输入中的 assignment、evaluations 和 content 信息生成学习反馈。'
        ].join('\n')
      },
      {
        role: 'user',
        content: JSON.stringify({
          taskType: task.type,
          assignmentId: task.assignmentId,
          attemptBatchId: task.attemptBatchId,
          input: task.input
        })
      }
    ];
  }

  async function runDeepSeekTask(task) {
    if (!env.DEEPSEEK_API_KEY) {
      throw new Error('DEEPSEEK_API_KEY is not configured.');
    }

    if (typeof fetchImpl !== 'function') {
      throw new Error('fetch is not available for DeepSeek provider.');
    }

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), Number(env.AI_PROVIDER_TIMEOUT_MS) || 30000);
    const model = normalizePrefix(task.model) || normalizePrefix(env.AI_TEXT_FAST_MODEL) || 'deepseek-v4-flash';

    try {
      const response = await fetchImpl(`${deepSeekBaseUrl().replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          messages: deepSeekMessages(task),
          response_format: {
            type: 'json_object'
          },
          max_tokens: Number(env.AI_MAX_TOKENS) || 2048,
          temperature: Number.isFinite(Number(env.AI_TEMPERATURE)) ? Number(env.AI_TEMPERATURE) : 0.2,
          thinking: deepSeekThinkingPayload(task),
          reasoning_effort: task.thinking === 'max' ? 'high' : task.thinking === 'high' ? 'medium' : undefined,
          stream: false
        }),
        signal: abortController.signal
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        const message =
          payload && payload.error && payload.error.message
            ? payload.error.message
            : `DeepSeek request failed with HTTP ${response.status}`;
        throw new Error(message);
      }

      const choice = payload && Array.isArray(payload.choices) ? payload.choices[0] : null;
      const content = choice && choice.message ? choice.message.content : '';

      return {
        provider: 'deepseek',
        model,
        status: 'completed',
        output: parseJsonOutput(content),
        usage: payload.usage || {}
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function runTask(task) {
    const provider = task.provider || 'mock';

    if (provider === 'mock') {
      return runMockTask(task);
    }

    if (provider === 'deepseek') {
      return runDeepSeekTask(task);
    }

    return runMockTask({
      ...task,
      provider: 'mock'
    });
  }

  return {
    runTask
  };
}

module.exports = {
  createAiProviderRuntime
};
