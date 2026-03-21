'use strict';

const crypto = require('crypto');
const tcb = require('@cloudbase/node-sdk');

function normalizePrefix(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeId(value, fallback = '') {
  const normalized = normalizePrefix(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || fallback;
}

function normalizeLabel(value) {
  return normalizePrefix(value).slice(0, 80) || '学习助手';
}

function normalizeSummary(value, fallback) {
  return normalizePrefix(value).slice(0, 240) || fallback;
}

function normalizeStatus(value) {
  const normalized = normalizePrefix(value).toLowerCase();

  if (normalized === 'approved' || normalized === 'rejected') {
    return normalized;
  }

  return 'pending';
}

function hashClaimSecret(requestId, claimSecret) {
  return crypto
    .createHash('sha256')
    .update(`${normalizeId(requestId, '')}:${normalizePrefix(claimSecret)}`)
    .digest('hex');
}

function createMissingDocMatcher() {
  return (error) => {
    const message = normalizePrefix(error && (error.errMsg || error.message));
    return message.includes('document.get:fail')
      || message.includes('not exist')
      || message.includes('collection not exists')
      || message.includes('db or table not exist');
  };
}

function createAgentAccessStore(options = {}) {
  const {
    db,
    collectionName = 'study_agent_access_requests',
    docId = 'main',
    maxRequests = 80
  } = options;
  const isMissingDocError = createMissingDocMatcher();
  const adminDb = tcb.init({
    env: tcb.SYMBOL_CURRENT_ENV
  }).database();

  function createRequestId() {
    return `agent-access-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
  }

  function normalizeRequest(rawItem) {
    const item = rawItem && typeof rawItem === 'object' ? rawItem : {};
    const id = normalizeId(item.id || item.requestId, '');

    if (!id) {
      return null;
    }

    return {
      id,
      clientId: normalizeId(item.clientId || item.agentId || item.requesterId || item.label, ''),
      label: normalizeLabel(item.label || item.agentLabel),
      summary: normalizeSummary(item.summary, '学习助手请求接入'),
      status: normalizeStatus(item.status),
      claimHash: normalizePrefix(item.claimHash),
      requestedAt: normalizePrefix(item.requestedAt),
      reviewedAt: normalizePrefix(item.reviewedAt),
      updatedAt: normalizePrefix(item.updatedAt),
      issuedAt: normalizePrefix(item.issuedAt)
    };
  }

  function normalizeRequests(rawItems) {
    const source = Array.isArray(rawItems) ? rawItems : [];
    const items = [];
    const seen = new Set();

    for (const rawItem of source) {
      const normalized = normalizeRequest(rawItem);

      if (!normalized || seen.has(normalized.id)) {
        continue;
      }

      seen.add(normalized.id);
      items.push(normalized);
    }

    return items;
  }

  function trimRequests(items) {
    return normalizeRequests(items)
      .sort((left, right) =>
        Number(left.status !== 'pending') - Number(right.status !== 'pending') ||
        (right.updatedAt || right.requestedAt || '').localeCompare(left.updatedAt || left.requestedAt || '') ||
        left.id.localeCompare(right.id)
      )
      .slice(0, maxRequests);
  }

  async function ensureCollectionExists() {
    if (!adminDb || typeof adminDb.createCollection !== 'function') {
      return;
    }

    try {
      await adminDb.createCollection(collectionName);
    } catch (error) {
      const message = normalizePrefix(error && (error.errMsg || error.message)).toLowerCase();

      if (
        message.includes('database_collection_already_exist')
        || message.includes('database collection already exist')
        || message.includes('already exists')
        || message.includes('collection exists')
        || message.includes('duplicated')
      ) {
        return;
      }

      throw error;
    }
  }

  async function readState(reader) {
    try {
      const result = await reader.collection(collectionName).doc(docId).get();
      const data = result && result.data ? result.data : {};
      return {
        updatedAt: normalizePrefix(data.updatedAt),
        items: normalizeRequests(data.items)
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

  async function persistState(transaction, items, updatedAt) {
    await transaction.collection(collectionName).doc(docId).set({
      data: {
        updatedAt,
        items
      }
    });
  }

  function sanitizePublicRequest(item) {
    return {
      id: item.id,
      clientId: item.clientId,
      label: item.label,
      summary: item.summary,
      status: item.status,
      requestedAt: item.requestedAt,
      reviewedAt: item.reviewedAt,
      updatedAt: item.updatedAt,
      issuedAt: item.issuedAt
    };
  }

  function sanitizeAdminRequest(item) {
    return sanitizePublicRequest(item);
  }

  function validateClaimSecret(requestId, claimSecret) {
    const normalizedClaim = normalizePrefix(claimSecret);

    if (!normalizedClaim) {
      const error = new Error('missing_agent_claim_secret');
      error.code = 'missing_agent_claim_secret';
      throw error;
    }

    return hashClaimSecret(requestId, normalizedClaim);
  }

  async function submitRequest(payload = {}) {
    const clientId = normalizeId(payload.clientId || payload.agentId || payload.requesterId || payload.label, '');

    if (!clientId) {
      const error = new Error('missing_agent_client_id');
      error.code = 'missing_agent_client_id';
      throw error;
    }

    const requestId = normalizeId(payload.requestId || payload.id, '') || createRequestId();
    const claimHash = validateClaimSecret(requestId, payload.claimSecret || payload.secret);
    const now = new Date().toISOString();
    const nextRequest = {
      id: requestId,
      clientId,
      label: normalizeLabel(payload.label || payload.agentLabel),
      summary: normalizeSummary(payload.summary, `${normalizeLabel(payload.label || payload.agentLabel)} 请求接入`),
      status: 'pending',
      claimHash,
      requestedAt: now,
      reviewedAt: '',
      updatedAt: now,
      issuedAt: ''
    };

    await ensureCollectionExists();

    return db.runTransaction(async (transaction) => {
      const currentState = await readState(transaction);
      const existingIndex = currentState.items.findIndex((item) => item.id === requestId);
      let storedRequest = nextRequest;
      let nextItems = currentState.items;

      if (existingIndex >= 0) {
        const existing = currentState.items[existingIndex];

        if (existing.claimHash !== claimHash) {
          const error = new Error('agent_access_claim_mismatch');
          error.code = 'agent_access_claim_mismatch';
          throw error;
        }

        storedRequest = {
          ...existing,
          clientId,
          label: nextRequest.label,
          summary: nextRequest.summary,
          updatedAt: now
        };

        if (existing.status === 'pending') {
          storedRequest = {
            ...storedRequest,
            requestedAt: existing.requestedAt || now
          };
        }

        nextItems = currentState.items.map((item, index) => (index === existingIndex ? storedRequest : item));
      } else {
        nextItems = [...currentState.items, storedRequest];
      }

      await persistState(transaction, trimRequests(nextItems), now);
      return sanitizePublicRequest(storedRequest);
    });
  }

  async function getRequestByClaim(requestId, claimSecret, options = {}) {
    const normalizedRequestId = normalizeId(requestId, '');

    if (!normalizedRequestId) {
      const error = new Error('missing_agent_access_request_id');
      error.code = 'missing_agent_access_request_id';
      throw error;
    }

    const expectedClaimHash = validateClaimSecret(normalizedRequestId, claimSecret);

    if (options.markIssued) {
      return db.runTransaction(async (transaction) => {
        const currentState = await readState(transaction);
        const target = currentState.items.find((item) => item.id === normalizedRequestId);

        if (!target) {
          const error = new Error('agent_access_request_not_found');
          error.code = 'agent_access_request_not_found';
          throw error;
        }

        if (target.claimHash !== expectedClaimHash) {
          const error = new Error('agent_access_claim_mismatch');
          error.code = 'agent_access_claim_mismatch';
          throw error;
        }

        if (target.status === 'approved' && !target.issuedAt) {
          const now = new Date().toISOString();
          const nextItems = currentState.items.map((item) =>
            item.id === normalizedRequestId
              ? {
                  ...item,
                  issuedAt: now,
                  updatedAt: now
                }
              : item
          );
          await persistState(transaction, trimRequests(nextItems), now);
          return sanitizePublicRequest({
            ...target,
            issuedAt: now,
            updatedAt: now
          });
        }

        return sanitizePublicRequest(target);
      });
    }

    const state = await readState(db);
    const target = state.items.find((item) => item.id === normalizedRequestId);

    if (!target) {
      const error = new Error('agent_access_request_not_found');
      error.code = 'agent_access_request_not_found';
      throw error;
    }

    if (target.claimHash !== expectedClaimHash) {
      const error = new Error('agent_access_claim_mismatch');
      error.code = 'agent_access_claim_mismatch';
      throw error;
    }

    return sanitizePublicRequest(target);
  }

  async function listRequests() {
    const state = await readState(db);
    return {
      updatedAt: state.updatedAt,
      items: state.items.map(sanitizeAdminRequest)
    };
  }

  async function updateRequestStatus(requestId, status) {
    const normalizedRequestId = normalizeId(requestId, '');
    const nextStatus = normalizeStatus(status);

    if (!normalizedRequestId || nextStatus === 'pending') {
      const error = new Error('missing_agent_access_request_id');
      error.code = 'missing_agent_access_request_id';
      throw error;
    }

    return db.runTransaction(async (transaction) => {
      const currentState = await readState(transaction);
      const now = new Date().toISOString();
      let found = false;

      const nextItems = currentState.items.map((item) => {
        if (item.id !== normalizedRequestId) {
          return item;
        }

        found = true;

        if (item.status !== 'pending') {
          return item;
        }

        return {
          ...item,
          status: nextStatus,
          reviewedAt: now,
          updatedAt: now
        };
      });

      if (!found) {
        const error = new Error('agent_access_request_not_found');
        error.code = 'agent_access_request_not_found';
        throw error;
      }

      await persistState(transaction, trimRequests(nextItems), now);
      return {
        updatedAt: now,
        items: trimRequests(nextItems).map(sanitizeAdminRequest)
      };
    });
  }

  async function approveRequest(requestId) {
    return updateRequestStatus(requestId, 'approved');
  }

  async function rejectRequest(requestId) {
    return updateRequestStatus(requestId, 'rejected');
  }

  return {
    approveRequest,
    getRequestByClaim,
    listRequests,
    rejectRequest,
    submitRequest
  };
}

module.exports = {
  createAgentAccessStore,
  normalizeId,
  normalizeLabel,
  normalizePrefix
};
