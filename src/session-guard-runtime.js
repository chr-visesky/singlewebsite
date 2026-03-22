'use strict';

function createSessionGuardRuntime(options = {}) {
  const {
    allowedMediaPermissions,
    logBlockedRequest,
    logClassroomMediaDebug,
    normalizePrefix,
    scheduleSessionPersist,
    session,
    sessionPartition,
    shouldAllowRequest,
    shouldGrantPermission
  } = options;

  function summarizePermissionDetails(details = {}) {
    return {
      detailsKeys: details && typeof details === 'object' ? Object.keys(details).sort() : [],
      mediaTypes: Array.isArray(details.mediaTypes) ? details.mediaTypes : [],
      requestingUrl: normalizePrefix(details.requestingUrl),
      securityOrigin: normalizePrefix(details.securityOrigin),
      externalURL: normalizePrefix(details.externalURL),
      isMainFrame: details.isMainFrame === true
    };
  }

  function shouldLogMediaPermission(permission) {
    return allowedMediaPermissions.has(permission);
  }

  function configure() {
    const ses = session.fromPartition(sessionPartition);

    ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
      const allowed = shouldGrantPermission(webContents, permission, null, details);

      if (shouldLogMediaPermission(permission)) {
        logClassroomMediaDebug('session-permission-request', {
          permission,
          allowed,
          currentUrl: webContents && !webContents.isDestroyed() ? webContents.getURL() : '',
          ...summarizePermissionDetails(details)
        });
      }

      callback(allowed);
    });

    ses.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
      const allowed = shouldGrantPermission(webContents, permission, requestingOrigin, details);

      if (shouldLogMediaPermission(permission)) {
        logClassroomMediaDebug('session-permission-check', {
          permission,
          allowed,
          requestingOrigin: normalizePrefix(requestingOrigin),
          currentUrl: webContents && !webContents.isDestroyed() ? webContents.getURL() : '',
          ...summarizePermissionDetails(details)
        });
      }

      return allowed;
    });

    ses.on('will-download', (event) => {
      event.preventDefault();
    });

    ses.cookies.on('changed', () => {
      scheduleSessionPersist();
    });

    ses.webRequest.onBeforeRequest((details, callback) => {
      const allowed = shouldAllowRequest(details);

      if (!allowed) {
        logBlockedRequest(details, 'BLOCK_REQ');
      }

      callback({ cancel: !allowed });
    });
  }

  return {
    configure
  };
}

module.exports = {
  createSessionGuardRuntime
};
