'use strict';

const cloud = require('wx-server-sdk');
const { createAgentHomeworkPublicRuntime } = require('./shared/agent-homework-public');
const { createAgentHomeworkRuntime } = require('./shared/agent-homework-runtime');
const { createAgentHomeworkSourceStore } = require('./shared/agent-homework-source-store');
const { createCollectionEnsurer } = require('./shared/ensure-collection');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const READ_TOKEN = (process.env.READ_TOKEN || '').trim();
const AGENT_WRITE_TOKEN = (process.env.AGENT_WRITE_TOKEN || '').trim();
const AGENT_HOMEWORK_COLLECTION = process.env.AGENT_HOMEWORK_COLLECTION || 'study_agent_homework_requests';
const AGENT_HOMEWORK_DOC_ID = process.env.AGENT_HOMEWORK_DOC_ID || 'main';
const AGENT_HOMEWORK_STORAGE_PREFIX = process.env.AGENT_HOMEWORK_STORAGE_PREFIX || 'studygate-agent-homework';
const MAX_AGENT_HOMEWORK_REQUESTS = 60;

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
const homeworkRuntime = createAgentHomeworkRuntime({
  db,
  collectionName: AGENT_HOMEWORK_COLLECTION,
  docId: AGENT_HOMEWORK_DOC_ID,
  ensureCollectionExists: createCollectionEnsurer(AGENT_HOMEWORK_COLLECTION),
  maxRequests: MAX_AGENT_HOMEWORK_REQUESTS,
  normalizePrefix,
  normalizeId,
  sourceStore: createAgentHomeworkSourceStore({
    cloud,
    storagePrefix: AGENT_HOMEWORK_STORAGE_PREFIX
  })
});
const publicRuntime = createAgentHomeworkPublicRuntime({
  agentHomeworkRuntime: homeworkRuntime,
  readToken: READ_TOKEN,
  agentWriteToken: AGENT_WRITE_TOKEN,
  normalizePrefix
});

exports.main = async (event = {}) => publicRuntime.handleHttpEvent(event);
