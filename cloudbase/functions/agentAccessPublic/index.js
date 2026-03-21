'use strict';

const cloud = require('wx-server-sdk');
const { createAgentAccessStore, normalizePrefix } = require('./shared/agent-access-store');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const ACCESS_REQUEST_COLLECTION = process.env.AGENT_ACCESS_REQUEST_COLLECTION || 'study_agent_access_requests';
const ACCESS_REQUEST_DOC_ID = process.env.AGENT_ACCESS_REQUEST_DOC_ID || 'main';
const MAX_AGENT_ACCESS_REQUESTS = 80;
const AGENT_WRITE_TOKEN = normalizePrefix(process.env.AGENT_WRITE_TOKEN);

const accessStore = createAgentAccessStore({
  db,
  collectionName: ACCESS_REQUEST_COLLECTION,
  docId: ACCESS_REQUEST_DOC_ID,
  maxRequests: MAX_AGENT_ACCESS_REQUESTS
});

function responseHeaders() {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400'
  };
}

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: responseHeaders(),
    body: JSON.stringify(payload)
  };
}

function parseBody(body) {
  if (!body) {
    return {};
  }

  if (typeof body === 'object') {
    return body;
  }

  try {
    return JSON.parse(String(body));
  } catch {
    return null;
  }
}

exports.main = async (event = {}) => {
  const method = normalizePrefix(event.httpMethod || 'GET').toUpperCase();

  if (method === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: responseHeaders(),
      body: ''
    };
  }

  if (method === 'GET') {
    return jsonResponse(200, {
      ok: true,
      title: 'StudyGate 智能体授权',
      actions: ['requestAgentAccess', 'getAgentAccessRequestStatus']
    });
  }

  if (method !== 'POST') {
    return jsonResponse(405, {
      error: 'method_not_allowed'
    });
  }

  const payload = parseBody(event.body);

  if (!payload || typeof payload !== 'object') {
    return jsonResponse(400, {
      error: 'bad_json'
    });
  }

  const action = normalizePrefix(payload.action);

  try {
    if (action === 'requestAgentAccess') {
      const request = await accessStore.submitRequest(payload);

      return jsonResponse(200, {
        ok: true,
        status: request.status,
        message: request.status === 'approved'
          ? '智能体接入已获批准。'
          : '已提交智能体接入申请，等待家长在管理端批准。',
        request,
        grantedToken: request.status === 'approved' && AGENT_WRITE_TOKEN ? AGENT_WRITE_TOKEN : ''
      });
    }

    if (action === 'getAgentAccessRequestStatus') {
      const request = await accessStore.getRequestByClaim(
        payload.requestId || payload.id,
        payload.claimSecret || payload.secret,
        {
          markIssued: true
        }
      );

      if (request.status === 'approved' && !AGENT_WRITE_TOKEN) {
        return jsonResponse(500, {
          error: 'missing_agent_write_token'
        });
      }

      return jsonResponse(200, {
        ok: true,
        status: request.status,
        request,
        grantedToken: request.status === 'approved' ? AGENT_WRITE_TOKEN : ''
      });
    }

    return jsonResponse(400, {
      error: 'unsupported_action'
    });
  } catch (error) {
    if (error && error.code) {
      return jsonResponse(400, {
        error: error.code
      });
    }

    throw error;
  }
};
