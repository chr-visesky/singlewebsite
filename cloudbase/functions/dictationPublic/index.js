'use strict';

const cloud = require('wx-server-sdk');
const { createAgentDictationPublicRuntime } = require('./shared/agent-dictation-public');
const { createAgentDictationRuntime } = require('./shared/agent-dictation-runtime');
const { createDictationSpeechRuntime } = require('./shared/dictation-speech-runtime');
const { createCollectionEnsurer } = require('./shared/ensure-collection');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const READ_TOKEN = (process.env.READ_TOKEN || '').trim();
const AGENT_WRITE_TOKEN = (process.env.AGENT_WRITE_TOKEN || '').trim();
const AGENT_DICTATION_COLLECTION = process.env.AGENT_DICTATION_COLLECTION || 'study_agent_dictation_requests';
const AGENT_DICTATION_DOC_ID = process.env.AGENT_DICTATION_DOC_ID || 'main';
const MAX_AGENT_DICTATION_REQUESTS = 60;

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

const dictationRuntime = createAgentDictationRuntime({
  db,
  collectionName: AGENT_DICTATION_COLLECTION,
  docId: AGENT_DICTATION_DOC_ID,
  ensureCollectionExists: createCollectionEnsurer(AGENT_DICTATION_COLLECTION),
  maxRequests: MAX_AGENT_DICTATION_REQUESTS,
  normalizePrefix,
  normalizeId
});
const publicRuntime = createAgentDictationPublicRuntime({
  agentDictationRuntime: dictationRuntime,
  dictationSpeechRuntime: createDictationSpeechRuntime({
    normalizePrefix
  }),
  readToken: READ_TOKEN,
  agentWriteToken: AGENT_WRITE_TOKEN,
  normalizePrefix
});

exports.main = async (event = {}) => publicRuntime.handleHttpEvent(event);
