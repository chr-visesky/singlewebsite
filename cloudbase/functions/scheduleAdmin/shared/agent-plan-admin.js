'use strict';

const { applyAgentPlanOperationRequest } = require('./agent-plan-operations');
const {
  normalizeAgentPlanRequests,
  sanitizeAgentPlanRequests,
  trimAgentPlanRequests
} = require('./agent-plan-requests');

function createMissingDocMatcher(normalizePrefix) {
  return (error) => {
    const message = normalizePrefix(error && (error.errMsg || error.message));
    return message.includes('document.get:fail') || message.includes('not exist');
  };
}

function createAgentPlanAdminRuntime(options = {}) {
  const {
    db,
    scheduleCollection,
    scheduleDocId,
    agentRequestCollection,
    agentRequestDocId,
    maxAgentPlanRequests = 40,
    defaultOnlineClassrooms = [],
    normalizePrefix,
    normalizeId,
    normalizeSchedule,
    normalizeOnlineClassrooms,
    fallbackOnlineClassrooms,
    normalizeContentLibraries,
    normalizeLearningTools,
    normalizeStudentDeviceAccess,
    normalizeControlSettings,
    createEmptyControlSettings,
    combineItems
  } = options;
  const isMissingDocError = createMissingDocMatcher(normalizePrefix);

  function normalizeScheduleState(data = {}) {
    const parentItems = normalizeSchedule(
      Array.isArray(data.parentItems) ? data.parentItems : Array.isArray(data.items) ? data.items : [],
      'parent'
    );
    const studentItems = normalizeSchedule(Array.isArray(data.studentItems) ? data.studentItems : [], 'student');

    return {
      updatedAt: normalizePrefix(data.updatedAt),
      parentItems,
      studentItems,
      onlineClassrooms: fallbackOnlineClassrooms(normalizeOnlineClassrooms(data.onlineClassrooms || data.classrooms)),
      contentLibraries: normalizeContentLibraries(data.contentLibraries || data.libraries),
      learningTools: normalizeLearningTools(data.learningTools || data.tools),
      studentDeviceAccess: normalizeStudentDeviceAccess(data.studentDeviceAccess),
      studentDeviceAccessUpdatedAt: normalizePrefix(data.studentDeviceAccessUpdatedAt),
      controlSettings: normalizeControlSettings(data.controlSettings),
      items: combineItems(parentItems, studentItems)
    };
  }

  function emptyScheduleState() {
    return {
      updatedAt: '',
      parentItems: [],
      studentItems: [],
      onlineClassrooms: normalizeOnlineClassrooms(defaultOnlineClassrooms),
      contentLibraries: [],
      learningTools: [],
      studentDeviceAccess: [],
      studentDeviceAccessUpdatedAt: '',
      controlSettings: createEmptyControlSettings(),
      items: []
    };
  }

  function sanitizeRequests(items) {
    return sanitizeAgentPlanRequests(items, {
      normalizeSchedule,
      normalizeId
    });
  }

  function trimRequests(items) {
    return trimAgentPlanRequests(items, {
      normalizeSchedule,
      normalizeId,
      limit: maxAgentPlanRequests
    });
  }

  async function readAgentRequestsFromReader(reader) {
    try {
      const result = await reader.collection(agentRequestCollection).doc(agentRequestDocId).get();
      const data = result && result.data ? result.data : {};

      return {
        updatedAt: normalizePrefix(data.updatedAt),
        items: normalizeAgentPlanRequests(data.items, {
          normalizeSchedule,
          normalizeId
        })
      };
    } catch (error) {
      if (isMissingDocError(error)) {
        return {
          updatedAt: '',
          items: []
        };
      }

      throw error;
    }
  }

  async function readScheduleStateFromReader(reader) {
    try {
      const result = await reader.collection(scheduleCollection).doc(scheduleDocId).get();
      return normalizeScheduleState(result && result.data ? result.data : {});
    } catch (error) {
      if (isMissingDocError(error)) {
        return emptyScheduleState();
      }

      throw error;
    }
  }

  async function persistAgentRequests(transaction, items, updatedAt) {
    await transaction.collection(agentRequestCollection).doc(agentRequestDocId).set({
      data: {
        updatedAt,
        items
      }
    });
  }

  async function writeScheduleState(transaction, state, updatedAt) {
    await transaction.collection(scheduleCollection).doc(scheduleDocId).set({
      data: {
        updatedAt,
        parentItems: state.parentItems,
        studentItems: state.studentItems,
        onlineClassrooms: state.onlineClassrooms,
        contentLibraries: state.contentLibraries,
        learningTools: state.learningTools,
        studentDeviceAccess: state.studentDeviceAccess,
        studentDeviceAccessUpdatedAt: state.studentDeviceAccessUpdatedAt,
        controlSettings: state.controlSettings,
        items: combineItems(state.parentItems, state.studentItems)
      }
    });
  }

  async function listRequests() {
    const state = await readAgentRequestsFromReader(db);
    return {
      updatedAt: state.updatedAt,
      items: sanitizeRequests(state.items)
    };
  }

  async function approveRequest(requestId) {
    const normalizedRequestId = normalizeId(requestId, '');

    if (!normalizedRequestId) {
      throw new Error('要批准的智能体申请不能为空。');
    }

    return db.runTransaction(async (transaction) => {
      const currentRequests = (await readAgentRequestsFromReader(transaction)).items;
      const currentState = await readScheduleStateFromReader(transaction);
      const targetRequest = currentRequests.find((item) => item.id === normalizedRequestId);

      if (!targetRequest) {
        throw new Error('找不到这个智能体申请。');
      }

      if (targetRequest.status !== 'pending') {
        throw new Error('这个智能体申请已经处理过了。');
      }

      const now = new Date().toISOString();
      const nextState = applyAgentPlanOperationRequest(targetRequest, currentState, {
        combineItems
      });
      const nextRequests = trimRequests(
        currentRequests.map((item) =>
          item.id === normalizedRequestId
            ? {
                ...item,
                status: 'approved',
                reviewedAt: now,
                updatedAt: now
              }
            : item
        )
      );

      await writeScheduleState(transaction, nextState, now);
      await persistAgentRequests(transaction, nextRequests, now);

      return {
        updatedAt: now,
        items: sanitizeRequests(nextRequests)
      };
    });
  }

  async function rejectRequest(requestId) {
    const normalizedRequestId = normalizeId(requestId, '');

    if (!normalizedRequestId) {
      throw new Error('要驳回的智能体申请不能为空。');
    }

    return db.runTransaction(async (transaction) => {
      const currentRequests = (await readAgentRequestsFromReader(transaction)).items;
      const now = new Date().toISOString();
      let found = false;
      const nextRequests = trimRequests(
        currentRequests.map((item) => {
          if (item.id !== normalizedRequestId) {
            return item;
          }

          found = true;

          if (item.status !== 'pending') {
            throw new Error('这个智能体申请已经处理过了。');
          }

          return {
            ...item,
            status: 'rejected',
            reviewedAt: now,
            updatedAt: now
          };
        })
      );

      if (!found) {
        throw new Error('找不到这个智能体申请。');
      }

      await persistAgentRequests(transaction, nextRequests, now);
      return {
        updatedAt: now,
        items: sanitizeRequests(nextRequests)
      };
    });
  }

  return {
    approveRequest,
    listRequests,
    rejectRequest
  };
}

module.exports = {
  createAgentPlanAdminRuntime
};
