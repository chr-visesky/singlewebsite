'use strict';

function createSkillGraphRuntime(dependencies = {}) {
  const {
    jsonStore,
    paths
  } = dependencies;

  if (!jsonStore || !paths) {
    throw new Error('skill graph runtime requires jsonStore and paths.');
  }

  function normalizePrefix(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function normalizeNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  function validateSkillNode(node, index) {
    const id = normalizePrefix(node && node.id);
    const title = normalizePrefix(node && node.title);
    const subject = normalizePrefix(node && node.subject);

    if (!id) {
      throw new Error(`SkillNode at index ${index} is missing id.`);
    }

    if (!title) {
      throw new Error(`SkillNode ${id} is missing title.`);
    }

    if (!subject) {
      throw new Error(`SkillNode ${id} is missing subject.`);
    }

    return {
      id,
      subject,
      track: normalizePrefix(node.track),
      title,
      parentId: normalizePrefix(node.parentId),
      examImportance: Math.max(0, Math.min(1, normalizeNumber(node.examImportance, 0.5))),
      defaultDifficulty: Math.max(1, Math.min(5, Math.round(normalizeNumber(node.defaultDifficulty, 2)))),
      enabled: node.enabled !== false
    };
  }

  function validateSkillNodes(nodes) {
    if (!Array.isArray(nodes)) {
      throw new Error('skill-nodes seed must be an array.');
    }

    const seen = new Set();
    return nodes.map((node, index) => {
      const normalized = validateSkillNode(node, index);

      if (seen.has(normalized.id)) {
        throw new Error(`Duplicate SkillNode id: ${normalized.id}`);
      }

      seen.add(normalized.id);
      return normalized;
    });
  }

  function initialize() {
    paths.ensureBaseDirectories();

    const targetPath = paths.skillNodesPath();
    const existing = jsonStore.readJsonFile(targetPath, null);

    if (Array.isArray(existing) && existing.length) {
      return validateSkillNodes(existing);
    }

    const seedNodes = validateSkillNodes(jsonStore.readJsonFile(paths.skillNodesSeedPath(), []));
    jsonStore.writeJsonFileAtomic(targetPath, seedNodes);
    return seedNodes;
  }

  function listSkillNodes(filters = {}) {
    const nodes = initialize();
    const subject = normalizePrefix(filters.subject);
    const track = normalizePrefix(filters.track);
    const enabledOnly = filters.enabledOnly !== false;

    return nodes.filter((node) => {
      if (enabledOnly && node.enabled === false) {
        return false;
      }

      if (subject && node.subject !== subject) {
        return false;
      }

      if (track && node.track !== track) {
        return false;
      }

      return true;
    });
  }

  function getSkillNode(skillNodeId) {
    const id = normalizePrefix(skillNodeId);
    return initialize().find((node) => node.id === id) || null;
  }

  return {
    getSkillNode,
    initialize,
    listSkillNodes,
    validateSkillNodes
  };
}

module.exports = {
  createSkillGraphRuntime
};
