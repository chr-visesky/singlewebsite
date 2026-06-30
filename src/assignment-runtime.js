'use strict';

function createAssignmentRuntime(dependencies = {}) {
  const {
    fs,
    jsonStore,
    paths,
    trainingPolicyRuntime
  } = dependencies;

  if (!fs || !jsonStore || !paths || !trainingPolicyRuntime) {
    throw new Error('assignment runtime requires fs, jsonStore, paths, and trainingPolicyRuntime.');
  }

  function normalizePrefix(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function readAssignments() {
    return jsonStore.readJsonFile(paths.assignmentsPath(), []);
  }

  function writeAssignments(assignments) {
    jsonStore.writeJsonFileAtomic(paths.assignmentsPath(), assignments);
  }

  function readProfile(profileId) {
    const id = normalizePrefix(profileId) || 'math_olympiad_daily_set_v1';
    const fileName = id === 'math_olympiad_daily_set_v1'
      ? 'math-olympiad-daily-set.profile.json'
      : `${id}.profile.json`;
    const profilePath = paths.profileSeedPath(fileName);

    if (!fs.existsSync(profilePath)) {
      throw new Error(`Assignment profile not found: ${id}`);
    }

    return jsonStore.readJsonFile(profilePath, null);
  }

  function assignmentId(studentId, dateKey, profileId) {
    return `assignment_${normalizePrefix(studentId)}_${normalizePrefix(dateKey)}_${normalizePrefix(profileId)}`
      .replace(/[^a-zA-Z0-9_-]+/g, '_');
  }

  function flattenContentItemIds(sections = []) {
    const ids = [];
    const seen = new Set();

    for (const section of sections) {
      for (const contentItemId of Array.isArray(section.contentItemIds) ? section.contentItemIds : []) {
        const id = normalizePrefix(contentItemId);
        if (id && !seen.has(id)) {
          seen.add(id);
          ids.push(id);
        }
      }
    }

    return ids;
  }

  function getAssignment({ studentId, dateKey, profileId = 'math_olympiad_daily_set_v1', dueSkillNodeIds = [], weakSkillNodeIds = [] }) {
    const normalizedStudentId = normalizePrefix(studentId) || 'default_child';
    const normalizedDateKey = normalizePrefix(dateKey);
    const normalizedProfileId = normalizePrefix(profileId) || 'math_olympiad_daily_set_v1';

    if (!normalizedDateKey) {
      throw new Error('dateKey is required.');
    }

    const existing = readAssignments().find((assignment) =>
      assignment.studentId === normalizedStudentId &&
      assignment.dateKey === normalizedDateKey &&
      assignment.profileId === normalizedProfileId
    );

    if (existing) {
      return existing;
    }

    const profile = readProfile(normalizedProfileId);
    const sections = trainingPolicyRuntime.buildAssignmentSections({
      profile,
      dueSkillNodeIds,
      weakSkillNodeIds
    });
    const contentItemIds = flattenContentItemIds(sections);
    const now = new Date().toISOString();
    const assignment = {
      id: assignmentId(normalizedStudentId, normalizedDateKey, normalizedProfileId),
      studentId: normalizedStudentId,
      type: profile.assignmentType || 'daily_set',
      profileId: normalizedProfileId,
      dateKey: normalizedDateKey,
      createdAt: now,
      updatedAt: now,
      status: 'assigned',
      sections,
      contentItemIds,
      warnings: contentItemIds.length < (Number(profile.targetContentCount) || 0)
        ? [`Only ${contentItemIds.length} content items available.`]
        : []
    };
    const assignments = readAssignments();
    assignments.push(assignment);
    writeAssignments(assignments);
    return assignment;
  }

  function getAssignmentById(assignmentIdValue) {
    const id = normalizePrefix(assignmentIdValue);
    return readAssignments().find((assignment) => assignment.id === id) || null;
  }

  function markAssignmentSubmitted(assignmentIdValue, updates = {}) {
    const id = normalizePrefix(assignmentIdValue);
    const assignments = readAssignments();
    const index = assignments.findIndex((assignment) => assignment.id === id);

    if (index < 0) {
      throw new Error(`Assignment not found: ${id}`);
    }

    assignments[index] = {
      ...assignments[index],
      ...updates,
      status: 'submitted',
      updatedAt: new Date().toISOString()
    };
    writeAssignments(assignments);
    return assignments[index];
  }

  return {
    getAssignment,
    getAssignmentById,
    markAssignmentSubmitted,
    readProfile
  };
}

module.exports = {
  createAssignmentRuntime
};
