'use strict';

function createContentGenerationRuntime(dependencies = {}) {
  const {
    aiTaskRuntime,
    jsonStore,
    paths
  } = dependencies;

  if (!aiTaskRuntime || !jsonStore || !paths) {
    throw new Error('content generation runtime requires aiTaskRuntime, jsonStore, and paths.');
  }

  function normalizePrefix(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function readCandidates() {
    return jsonStore.readJsonFile(paths.generatedContentCandidatesPath(), []);
  }

  function writeCandidates(candidates) {
    jsonStore.writeJsonFileAtomic(paths.generatedContentCandidatesPath(), candidates);
  }

  function normalizeCandidate(candidate = {}, context = {}) {
    const now = new Date().toISOString();
    const id = normalizePrefix(candidate.id) || `candidate_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    const skillNodeIds = Array.isArray(candidate.skillNodeIds) && candidate.skillNodeIds.length
      ? candidate.skillNodeIds.map(normalizePrefix).filter(Boolean)
      : context.skillNodeIds;

    return {
      id,
      type: normalizePrefix(candidate.type) || 'question',
      subject: normalizePrefix(candidate.subject) || context.subject || 'math',
      track: normalizePrefix(candidate.track) || context.track || 'olympiad',
      skillNodeIds,
      difficulty: Math.max(1, Math.min(5, Math.round(Number(candidate.difficulty) || Number(context.difficulty) || 2))),
      contentType: normalizePrefix(candidate.contentType) || 'math_short_answer',
      questionType: normalizePrefix(candidate.questionType) || 'fill_blank',
      prompt: normalizePrefix(candidate.prompt),
      choices: Array.isArray(candidate.choices) ? candidate.choices : [],
      answerSchema: candidate.answerSchema && typeof candidate.answerSchema === 'object'
        ? candidate.answerSchema
        : { type: 'number' },
      standardAnswer: candidate.standardAnswer,
      evaluationPolicy: candidate.evaluationPolicy && typeof candidate.evaluationPolicy === 'object'
        ? candidate.evaluationPolicy
        : { finalAnswerRequired: true, processOptional: true },
      quality: {
        status: 'candidate',
        riskFlags: [],
        confidence: 0,
        ...(candidate.quality && typeof candidate.quality === 'object' ? candidate.quality : {})
      },
      source: {
        type: 'ai_generated',
        aiTaskId: context.aiTaskId,
        aiResultId: context.aiResultId,
        generatedAt: now
      },
      enabled: false
    };
  }

  function validateCandidate(candidate) {
    const issues = [];

    if (!candidate.prompt) {
      issues.push('prompt_missing');
    }

    if (!Array.isArray(candidate.skillNodeIds) || !candidate.skillNodeIds.length) {
      issues.push('skill_node_missing');
    }

    if (candidate.standardAnswer === undefined || candidate.standardAnswer === null || candidate.standardAnswer === '') {
      issues.push('standard_answer_missing');
    }

    if (candidate.questionType === 'choice' && (!Array.isArray(candidate.choices) || candidate.choices.length < 2)) {
      issues.push('choices_missing');
    }

    return {
      ...candidate,
      quality: {
        ...candidate.quality,
        status: issues.length ? 'needs_review' : 'candidate',
        riskFlags: [...new Set([...(candidate.quality.riskFlags || []), ...issues])],
        confidence: issues.length ? Math.min(Number(candidate.quality.confidence) || 0.5, 0.5) : Number(candidate.quality.confidence) || 0.8
      }
    };
  }

  async function generateContentCandidates(options = {}) {
    if (typeof paths.ensureBaseDirectories === 'function') {
      paths.ensureBaseDirectories();
    }

    const skillNodeIds = (Array.isArray(options.skillNodeIds) ? options.skillNodeIds : [options.skillNodeId])
      .map(normalizePrefix)
      .filter(Boolean);
    const count = Math.max(1, Math.min(10, Math.round(Number(options.count) || 3)));
    const input = {
      subject: normalizePrefix(options.subject) || 'math',
      track: normalizePrefix(options.track) || 'olympiad',
      skillNodeIds,
      difficulty: Math.max(1, Math.min(5, Math.round(Number(options.difficulty) || 2))),
      contentTypes: Array.isArray(options.contentTypes) ? options.contentTypes : ['math_short_answer'],
      count,
      constraints: options.constraints && typeof options.constraints === 'object' ? options.constraints : {}
    };
    const aiResult = await aiTaskRuntime.createAndRunGenericTask({
      type: 'content_generation',
      input,
      metadata: {
        source: 'content-generation-runtime'
      }
    });
    const rawCandidates = aiResult &&
      aiResult.output &&
      Array.isArray(aiResult.output.candidates)
      ? aiResult.output.candidates
      : [];
    const context = {
      ...input,
      aiTaskId: aiResult.taskId,
      aiResultId: aiResult.id
    };
    const candidates = rawCandidates
      .map((candidate) => normalizeCandidate(candidate, context))
      .map(validateCandidate);
    const stored = readCandidates();
    const next = [...stored, ...candidates];
    writeCandidates(next);

    return {
      aiResult,
      candidates
    };
  }

  function listCandidates(filters = {}) {
    const skillNodeId = normalizePrefix(filters.skillNodeId);
    const status = normalizePrefix(filters.status);

    return readCandidates().filter((candidate) => {
      if (skillNodeId && !(candidate.skillNodeIds || []).includes(skillNodeId)) {
        return false;
      }

      if (status && candidate.quality && candidate.quality.status !== status) {
        return false;
      }

      return true;
    });
  }

  return {
    generateContentCandidates,
    listCandidates,
    validateCandidate
  };
}

module.exports = {
  createContentGenerationRuntime
};
