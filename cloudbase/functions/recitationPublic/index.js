'use strict';

const cloud = require('wx-server-sdk');
const { createAgentRecitationPublicRuntime } = require('./shared/agent-recitation-public');
const { createAgentRecitationRuntime } = require('./shared/agent-recitation-runtime');
const { createCollectionEnsurer } = require('./shared/ensure-collection');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const READ_TOKEN = (process.env.READ_TOKEN || '').trim();
const AGENT_WRITE_TOKEN = (process.env.AGENT_WRITE_TOKEN || '').trim();
const AGENT_RECITATION_COLLECTION = process.env.AGENT_RECITATION_COLLECTION || 'study_agent_recitation_requests';
const AGENT_RECITATION_DOC_ID = process.env.AGENT_RECITATION_DOC_ID || 'main';
const MAX_AGENT_RECITATION_REQUESTS = 60;

function normalizePrefix(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeId(value, fallback) {
  const normalized = normalizePrefix(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || fallback;
}

const recitationRuntime = createAgentRecitationRuntime({
  db,
  collectionName: AGENT_RECITATION_COLLECTION,
  docId: AGENT_RECITATION_DOC_ID,
  ensureCollectionExists: createCollectionEnsurer(AGENT_RECITATION_COLLECTION),
  maxRequests: MAX_AGENT_RECITATION_REQUESTS,
  normalizePrefix,
  normalizeId
});
const publicRuntime = createAgentRecitationPublicRuntime({
  agentRecitationRuntime: recitationRuntime,
  readToken: READ_TOKEN,
  agentWriteToken: AGENT_WRITE_TOKEN,
  normalizePrefix
});

exports.main = async (event = {}) => publicRuntime.handleHttpEvent(event);
