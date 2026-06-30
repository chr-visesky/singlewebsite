'use strict';

function createTrainingPolicyRuntime(dependencies = {}) {
  const {
    contentBankRuntime
  } = dependencies;

  if (!contentBankRuntime) {
    throw new Error('training policy runtime requires contentBankRuntime.');
  }

  function normalizePrefix(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function pickUnique(items, limit, usedIds) {
    const selected = [];

    for (const item of items) {
      if (!item || usedIds.has(item.id)) {
        continue;
      }

      selected.push(item);
      usedIds.add(item.id);

      if (selected.length >= limit) {
        break;
      }
    }

    return selected;
  }

  function buildAssignmentSections({ profile, dueSkillNodeIds = [], weakSkillNodeIds = [] }) {
    const usedIds = new Set();
    const sections = [];
    const targetCount = Number(profile.targetContentCount) || 10;
    const contentTypes = Array.isArray(profile.contentTypes) ? profile.contentTypes : [];
    const baseFilters = {
      subject: normalizePrefix(profile.subject),
      track: normalizePrefix(profile.track)
    };

    function listBySkillNodeIds(skillNodeIds) {
      if (!skillNodeIds.length) {
        return [];
      }

      return contentBankRuntime.listContentItems({
        ...baseFilters,
        skillNodeIds,
        enabledOnly: true
      }).filter((item) => !contentTypes.length || contentTypes.includes(item.contentType));
    }

    function listAll() {
      return contentBankRuntime.listContentItems({
        ...baseFilters,
        enabledOnly: true
      }).filter((item) => !contentTypes.length || contentTypes.includes(item.contentType));
    }

    for (const sectionProfile of Array.isArray(profile.sections) ? profile.sections : []) {
      const type = normalizePrefix(sectionProfile.type);
      const maxCount = Math.max(0, Math.round(Number(sectionProfile.maxCount) || targetCount));
      let candidates = [];

      if (type === 'review') {
        candidates = listBySkillNodeIds(dueSkillNodeIds);
      } else if (type === 'weakness') {
        candidates = listBySkillNodeIds(weakSkillNodeIds);
      } else {
        candidates = listAll();
      }

      const remaining = Math.max(0, targetCount - usedIds.size);
      const selected = pickUnique(candidates, Math.min(maxCount, remaining), usedIds);

      if (selected.length) {
        sections.push({
          type,
          title: normalizePrefix(sectionProfile.title) || type,
          contentItemIds: selected.map((item) => item.id)
        });
      }

      if (usedIds.size >= targetCount) {
        break;
      }
    }

    if (usedIds.size < targetCount) {
      const filler = pickUnique(listAll(), targetCount - usedIds.size, usedIds);

      if (filler.length) {
        sections.push({
          type: 'new',
          title: '今日练习',
          contentItemIds: filler.map((item) => item.id)
        });
      }
    }

    return sections;
  }

  return {
    buildAssignmentSections
  };
}

module.exports = {
  createTrainingPolicyRuntime
};
