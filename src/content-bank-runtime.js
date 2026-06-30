'use strict';

function createContentBankRuntime(dependencies = {}) {
  const {
    jsonStore,
    paths,
    skillGraphRuntime
  } = dependencies;

  if (!jsonStore || !paths || !skillGraphRuntime) {
    throw new Error('content bank runtime requires jsonStore, paths, and skillGraphRuntime.');
  }

  function normalizePrefix(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function normalizeNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  function normalizeStringArray(value) {
    return (Array.isArray(value) ? value : [value])
      .map((item) => normalizePrefix(item))
      .filter(Boolean);
  }

  function normalizeChoices(value) {
    return (Array.isArray(value) ? value : [])
      .map((choice, index) => {
        const label = normalizePrefix(choice && choice.label) || String.fromCharCode(65 + index);
        const choiceValue = normalizePrefix(choice && choice.value) || label;
        const text = normalizePrefix(choice && choice.text);

        return text
          ? {
              label,
              value: choiceValue,
              text
            }
          : null;
      })
      .filter(Boolean);
  }

  function shouldUseChoiceFallback(item) {
    const schemaType = normalizePrefix(item && item.answerSchema && item.answerSchema.type);
    const skillNodeIds = normalizeStringArray(item && item.skillNodeIds);

    return schemaType === 'number' &&
      Math.max(1, Math.min(5, Math.round(normalizeNumber(item && item.difficulty, 2)))) === 1 &&
      skillNodeIds.includes('math.number.remainder');
  }

  function inferQuestionType(item, choices) {
    const explicit = normalizePrefix(item && item.questionType);

    if (explicit) {
      return explicit;
    }

    const schemaType = normalizePrefix(item && item.answerSchema && item.answerSchema.type);
    const contentType = normalizePrefix(item && item.contentType);

    if (choices.length || schemaType === 'choice' || contentType.includes('choice') || shouldUseChoiceFallback(item)) {
      return 'choice';
    }

    if (schemaType === 'object' || contentType.includes('object')) {
      return 'application';
    }

    return 'fill_blank';
  }

  function generatedNumberChoices(item, questionType, choices) {
    if (choices.length || questionType !== 'choice') {
      return choices;
    }

    const standardAnswer = Number(item && item.standardAnswer);

    if (!Number.isFinite(standardAnswer)) {
      return choices;
    }

    const values = [standardAnswer - 2, standardAnswer - 1, standardAnswer, standardAnswer + 1]
      .filter((value, index, source) => value >= 0 && source.indexOf(value) === index);

    while (values.length < 4) {
      const nextValue = values[values.length - 1] + 1;
      if (!values.includes(nextValue)) {
        values.push(nextValue);
      }
    }

    return values.slice(0, 4).map((value, index) => ({
      label: String.fromCharCode(65 + index),
      value: String(value),
      text: String(value)
    }));
  }

  function validateContentItem(item, index, skillNodeIds) {
    const id = normalizePrefix(item && item.id);
    const type = normalizePrefix(item && item.type) || 'question';
    const subject = normalizePrefix(item && item.subject);
    const contentType = normalizePrefix(item && item.contentType);
    const prompt = normalizePrefix(item && item.prompt);
    const itemSkillNodeIds = normalizeStringArray(item && item.skillNodeIds);
    const seedChoices = normalizeChoices(item && item.choices);
    const questionType = inferQuestionType(item, seedChoices);
    const choices = generatedNumberChoices(item, questionType, seedChoices);

    if (!id) {
      throw new Error(`ContentItem at index ${index} is missing id.`);
    }

    if (!subject) {
      throw new Error(`ContentItem ${id} is missing subject.`);
    }

    if (!contentType) {
      throw new Error(`ContentItem ${id} is missing contentType.`);
    }

    if (!prompt) {
      throw new Error(`ContentItem ${id} is missing prompt.`);
    }

    if (!itemSkillNodeIds.length) {
      throw new Error(`ContentItem ${id} is missing skillNodeIds.`);
    }

    for (const skillNodeId of itemSkillNodeIds) {
      if (!skillNodeIds.has(skillNodeId)) {
        throw new Error(`ContentItem ${id} references unknown SkillNode ${skillNodeId}.`);
      }
    }

    if (contentType.startsWith('math_') && item.standardAnswer === undefined) {
      throw new Error(`ContentItem ${id} is missing standardAnswer.`);
    }

    if (contentType.startsWith('math_') && (!item.answerSchema || typeof item.answerSchema !== 'object')) {
      throw new Error(`ContentItem ${id} is missing answerSchema.`);
    }

    return {
      id,
      type,
      subject,
      track: normalizePrefix(item.track),
      skillNodeIds: itemSkillNodeIds,
      difficulty: Math.max(1, Math.min(5, Math.round(normalizeNumber(item.difficulty, 2)))),
      contentType,
      questionType,
      prompt,
      choices,
      answerSchema: item.answerSchema || null,
      standardAnswer: item.standardAnswer,
      evaluationPolicy: item.evaluationPolicy && typeof item.evaluationPolicy === 'object'
        ? item.evaluationPolicy
        : {},
      enabled: item.enabled !== false
    };
  }

  function validateContentItems(items) {
    if (!Array.isArray(items)) {
      throw new Error('content-items seed must be an array.');
    }

    const skillNodeIds = new Set(skillGraphRuntime.initialize().map((node) => node.id));
    const seen = new Set();

    return items.map((item, index) => {
      const normalized = validateContentItem(item, index, skillNodeIds);

      if (seen.has(normalized.id)) {
        throw new Error(`Duplicate ContentItem id: ${normalized.id}`);
      }

      seen.add(normalized.id);
      return normalized;
    });
  }

  function initialize() {
    paths.ensureBaseDirectories();

    const targetPath = paths.contentItemsPath();
    const existing = jsonStore.readJsonFile(targetPath, null);

    if (Array.isArray(existing) && existing.length) {
      return validateContentItems(existing);
    }

    const seedItems = validateContentItems(jsonStore.readJsonFile(paths.contentItemsSeedPath(), []));
    jsonStore.writeJsonFileAtomic(targetPath, seedItems);
    return seedItems;
  }

  function listContentItems(filters = {}) {
    const items = initialize();
    const contentType = normalizePrefix(filters.contentType);
    const subject = normalizePrefix(filters.subject);
    const track = normalizePrefix(filters.track);
    const skillNodeIds = new Set(normalizeStringArray(filters.skillNodeIds));
    const excludeIds = new Set(normalizeStringArray(filters.excludeContentItemIds));
    const enabledOnly = filters.enabledOnly !== false;

    return items.filter((item) => {
      if (enabledOnly && item.enabled === false) {
        return false;
      }

      if (excludeIds.has(item.id)) {
        return false;
      }

      if (subject && item.subject !== subject) {
        return false;
      }

      if (track && item.track !== track) {
        return false;
      }

      if (contentType && item.contentType !== contentType) {
        return false;
      }

      if (skillNodeIds.size && !item.skillNodeIds.some((skillNodeId) => skillNodeIds.has(skillNodeId))) {
        return false;
      }

      return true;
    });
  }

  function getContentItem(contentItemId) {
    const id = normalizePrefix(contentItemId);
    return initialize().find((item) => item.id === id) || null;
  }

  function getContentItemsByIds(contentItemIds = []) {
    const idSet = new Set(normalizeStringArray(contentItemIds));
    return initialize().filter((item) => idSet.has(item.id));
  }

  return {
    getContentItem,
    getContentItemsByIds,
    initialize,
    listContentItems,
    validateContentItems
  };
}

module.exports = {
  createContentBankRuntime
};
