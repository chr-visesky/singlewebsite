'use strict';

function createAgentHomeworkPublicRuntime(options = {}) {
  const {
    agentHomeworkRuntime,
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
        items: await agentHomeworkRuntime.listPendingRequests()
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

      if (
        action === 'submitAgentHomeworkRequest' ||
        action === 'submitAgentHomeworkDeleteRequest' ||
        action === 'getAgentHomeworkRequestStatus'
      ) {
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
          if (action === 'submitAgentHomeworkRequest') {
            return jsonResponse(200, {
              ok: true,
              status: 'pending',
              message: '作业创建请求已提交，等待桌面端同步创建。',
              request: await agentHomeworkRuntime.submitRequest(payload)
            });
          }

          if (action === 'submitAgentHomeworkDeleteRequest') {
            return jsonResponse(200, {
              ok: true,
              status: 'pending',
              message: '作业删除请求已提交，等待桌面端同步处理。',
              request: await agentHomeworkRuntime.submitDeleteRequest(payload)
            });
          }

          return jsonResponse(200, {
            ok: true,
            request: await agentHomeworkRuntime.getRequestStatus(payload.requestId || payload.id)
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

      if (action === 'completeAgentHomeworkRequest') {
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
            request: await agentHomeworkRuntime.completeRequest(payload.requestId || payload.id, payload)
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
  createAgentHomeworkPublicRuntime
};
