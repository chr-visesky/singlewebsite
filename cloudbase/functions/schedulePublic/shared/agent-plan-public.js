'use strict';

const crypto = require('crypto');
const {
  createAgentPlanOperationRequest,
  applyAgentPlanOperationRequest,
  requestNeedsApproval
} = require('./agent-plan-operations');
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

function createAgentPlanPublicRuntime(options = {}) {
  const {
    db,
    scheduleCollection,
    scheduleDocId,
    agentRequestCollection,
    agentRequestDocId,
    ensureAgentRequestCollection,
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

  function createAgentRequestId() {
    return `agent-request-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
  }

  function createScheduleItemId(planScope) {
    const scope = planScope === 'parent' ? 'parent' : 'student';
    return `${scope}-schedule-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
  }

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

  function buildStoredRequest(request, status, now, requestedAt) {
    return {
      ...request,
      status,
      requestedAt: requestedAt || request.requestedAt,
      reviewedAt: status === 'pending' ? '' : now,
      updatedAt: now
    };
  }

  function upsertRequestList(currentItems, request, now, status) {
    const existingIndex = currentItems.findIndex((item) => item.id === request.id);
    let nextItems = currentItems;
    let storedRequest = buildStoredRequest(request, status, now);

    if (existingIndex >= 0) {
      const existing = currentItems[existingIndex];

      if (existing.status !== 'pending') {
        const closedError = new Error('agent_request_closed');
        closedError.code = 'agent_request_closed';
        throw closedError;
      }

      storedRequest = buildStoredRequest(request, status, now, existing.requestedAt || request.requestedAt);
      nextItems = currentItems.map((item, index) => (index === existingIndex ? storedRequest : item));
    } else {
      nextItems = [...currentItems, storedRequest];
    }

    return {
      storedRequest,
      items: trimAgentPlanRequests(nextItems, {
        normalizeSchedule,
        normalizeId,
        limit: maxAgentPlanRequests
      })
    };
  }

  function createRequest(payload, currentState, now) {
    return createAgentPlanOperationRequest(payload, currentState, {
      normalizeSchedule,
      normalizeId,
      createRequestId: createAgentRequestId,
      createScheduleItemId,
      now
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

  async function submitRequest(payload = {}) {
    const now = new Date().toISOString();

    if (typeof ensureAgentRequestCollection === 'function') {
      await ensureAgentRequestCollection();
    }

    return db.runTransaction(async (transaction) => {
      const currentRequests = (await readAgentRequestsFromReader(transaction)).items;
      const currentState = await readScheduleStateFromReader(transaction);
      const request = createRequest(payload, currentState, now);

      if (requestNeedsApproval(request)) {
        const queued = upsertRequestList(currentRequests, request, now, 'pending');
        await persistAgentRequests(transaction, queued.items, now);

        return {
          ok: true,
          status: 'pending',
          message: request.operation === 'delete'
            ? '删除计划已提交到管理端等待确认。'
            : '修改计划已提交到管理端等待确认。',
          request: sanitizeRequests([queued.storedRequest])[0]
        };
      }

      const approved = upsertRequestList(currentRequests, request, now, 'approved');
      const nextState = applyAgentPlanOperationRequest(request, currentState, {
        combineItems
      });

      await writeScheduleState(transaction, nextState, now);
      await persistAgentRequests(transaction, approved.items, now);

      return {
        ok: true,
        status: 'applied',
        message: '新增计划已直接生效。',
        request: sanitizeRequests([approved.storedRequest])[0]
      };
    });
  }

  async function getRequestStatus(requestId) {
    const normalizedRequestId = normalizeId(requestId, '');

    if (!normalizedRequestId) {
      const error = new Error('missing_agent_request_id');
      error.code = 'missing_agent_request_id';
      throw error;
    }

    const state = await readAgentRequestsFromReader(db);
    const matched = state.items.find((item) => item.id === normalizedRequestId);

    if (!matched) {
      const error = new Error('agent_request_not_found');
      error.code = 'agent_request_not_found';
      throw error;
    }

    return sanitizeRequests([matched])[0];
  }

  return {
    getRequestStatus,
    submitRequest
  };
}

module.exports = {
  createAgentPlanPublicRuntime
};
