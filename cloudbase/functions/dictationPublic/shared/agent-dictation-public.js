'use strict';

function createAgentDictationPublicRuntime(options = {}) {
  const {
    agentDictationRuntime,
    readToken,
    agentWriteToken,
    normalizePrefix
  } = options;

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

  function bearerToken(headers = {}) {
    const rawHeader = normalizePrefix(headers.authorization || headers.Authorization);

    if (!rawHeader.toLowerCase().startsWith('bearer ')) {
      return '';
    }

    return normalizePrefix(rawHeader.slice(7));
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

  function requestIdList(payload = {}) {
    if (Array.isArray(payload.requestIds)) {
      return payload.requestIds;
    }

    if (Array.isArray(payload.ids)) {
      return payload.ids;
    }

    return [];
  }

  function requestPayloadList(payload = {}) {
    if (Array.isArray(payload.requests)) {
      return payload.requests;
    }

    if (Array.isArray(payload.items)) {
      return payload.items;
    }

    return [];
  }

  async function handleAgentAction(action, payload) {
    if (action === 'submitAgentDictationRequest') {
      return {
        ok: true,
        status: 'pending',
        message: '听写创建请求已提交，等待桌面端同步创建。',
        request: await agentDictationRuntime.submitRequest(payload)
      };
    }

    if (action === 'submitAgentDictationRequests') {
      const requests = await agentDictationRuntime.submitRequests(requestPayloadList(payload));
      return {
        ok: true,
        status: 'pending',
        message: `已提交 ${requests.length} 条听写创建请求，等待桌面端同步创建。`,
        requests
      };
    }

    if (action === 'getAgentDictationRequestStatus') {
      return {
        ok: true,
        request: await agentDictationRuntime.getRequestStatus(payload.requestId || payload.id)
      };
    }

    if (action === 'getAgentDictationRequestStatuses') {
      return {
        ok: true,
        requests: await agentDictationRuntime.getRequestStatuses(requestIdList(payload))
      };
    }

    if (action === 'queryAgentDictationRequests') {
      return {
        ok: true,
        requests: await agentDictationRuntime.queryRequests(payload)
      };
    }

    throw new Error('unsupported_action');
  }

  async function handleHttpEvent(event = {}) {
    const method = (event.httpMethod || 'GET').toUpperCase();

    if (method === 'OPTIONS') {
      return {
        statusCode: 204,
        headers: responseHeaders(),
        body: ''
      };
    }

    if (method === 'GET') {
      if (!readToken) {
        return jsonResponse(500, {
          error: 'missing_read_token'
        });
      }

      if (bearerToken(event.headers) !== readToken) {
        return jsonResponse(403, {
          error: 'forbidden'
        });
      }

      return jsonResponse(200, {
        ok: true,
        items: await agentDictationRuntime.listPendingRequests()
      });
    }

    if (method === 'POST') {
      const payload = parseBody(event.body);

      if (!payload || typeof payload !== 'object') {
        return jsonResponse(400, {
          error: 'bad_json'
        });
      }

      const action = normalizePrefix(payload.action);
      const requestToken = bearerToken(event.headers);
      const agentActions = new Set([
        'submitAgentDictationRequest',
        'submitAgentDictationRequests',
        'getAgentDictationRequestStatus',
        'getAgentDictationRequestStatuses',
        'queryAgentDictationRequests'
      ]);

      if (agentActions.has(action)) {
        if (!agentWriteToken) {
          return jsonResponse(500, {
            error: 'missing_agent_write_token'
          });
        }

        if (requestToken !== agentWriteToken) {
          return jsonResponse(403, {
            error: 'forbidden'
          });
        }

        try {
          return jsonResponse(200, await handleAgentAction(action, payload));
        } catch (error) {
          if (error && error.code) {
            return jsonResponse(400, {
              error: error.code
            });
          }

          if (error && error.message === 'unsupported_action') {
            return jsonResponse(400, {
              error: 'unsupported_action'
            });
          }

          throw error;
        }
      }

      if (action === 'completeAgentDictationRequest') {
        if (!readToken) {
          return jsonResponse(500, {
            error: 'missing_read_token'
          });
        }

        if (requestToken !== readToken) {
          return jsonResponse(403, {
            error: 'forbidden'
          });
        }

        try {
          return jsonResponse(200, {
            ok: true,
            request: await agentDictationRuntime.completeRequest(payload.requestId || payload.id, payload)
          });
        } catch (error) {
          if (error && error.code) {
            return jsonResponse(400, {
              error: error.code
            });
          }

          throw error;
        }
      }

      return jsonResponse(400, {
        error: 'unsupported_action'
      });
    }

    return jsonResponse(405, {
      error: 'method_not_allowed'
    });
  }

  return {
    handleHttpEvent
  };
}

module.exports = {
  createAgentDictationPublicRuntime
};
