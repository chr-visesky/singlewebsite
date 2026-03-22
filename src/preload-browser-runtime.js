'use strict';

function createBrowserPreloadRuntime(dependencies = {}) {
  const { ipcRenderer } = dependencies;
  let zoomShortcutBound = false;

  function isTopFrame() {
    try {
      return window.top === window;
    } catch {
      return false;
    }
  }

  function readStorageArea(storageArea) {
    const snapshot = {};

    try {
      for (let index = 0; index < storageArea.length; index += 1) {
        const key = storageArea.key(index);

        if (typeof key === 'string') {
          snapshot[key] = storageArea.getItem(key);
        }
      }
    } catch {
      return {};
    }

    return snapshot;
  }

  function writeStorageArea(storageArea, snapshot) {
    try {
      storageArea.clear();

      for (const [key, value] of Object.entries(snapshot || {})) {
        storageArea.setItem(key, typeof value === 'string' ? value : '');
      }
    } catch {
      // Ignore storage restoration failures.
    }
  }

  function setInputValue(input, value) {
    if (!input || typeof value !== 'string') {
      return;
    }

    const prototype = Object.getPrototypeOf(input);
    const descriptor = prototype ? Object.getOwnPropertyDescriptor(prototype, 'value') : null;
    const fallbackDescriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    const setter = (descriptor && descriptor.set) || (fallbackDescriptor && fallbackDescriptor.set);

    if (typeof setter === 'function') {
      setter.call(input, value);
    } else {
      input.value = value;
    }

    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function isEditableTextInput(input) {
    if (!input || input.disabled || input.readOnly) {
      return false;
    }

    const type = String(input.getAttribute('type') || 'text').toLowerCase();
    return ['text', 'email', 'tel', 'search', 'number', ''].includes(type);
  }

  function isEditablePasswordInput(input) {
    return Boolean(input && !input.disabled && !input.readOnly && String(input.type).toLowerCase() === 'password');
  }

  function findCredentialFields(root = document) {
    const passwordInput = Array.from(root.querySelectorAll('input[type="password"]')).find(isEditablePasswordInput);

    if (!passwordInput) {
      return null;
    }

    const scope = passwordInput.form || passwordInput.closest('form') || root;
    const usernameInput = Array.from(scope.querySelectorAll('input')).find(
      (input) => input !== passwordInput && isEditableTextInput(input)
    );

    if (!usernameInput) {
      return null;
    }

    return {
      usernameInput,
      passwordInput
    };
  }

  function bootstrapCredentialAutofill() {
    if (!isTopFrame() || !/^https?:$/.test(window.location.protocol)) {
      return;
    }

    const credentialPromise = ipcRenderer.invoke('shell:get-site-credentials', {
      url: window.location.href
    }).catch(() => null);

    const fillCredentials = async () => {
      const saved = await credentialPromise;

      if (!saved || !saved.available) {
        return false;
      }

      const fields = findCredentialFields(document);

      if (!fields) {
        return false;
      }

      if (!fields.usernameInput.value) {
        setInputValue(fields.usernameInput, saved.username);
      }

      if (!fields.passwordInput.value) {
        setInputValue(fields.passwordInput, saved.password);
      }

      return true;
    };

    const persistCredentials = () => {
      const fields = findCredentialFields(document);

      if (!fields) {
        return;
      }

      const username = String(fields.usernameInput.value || '').trim();
      const password = String(fields.passwordInput.value || '');

      if (!username || !password) {
        return;
      }

      ipcRenderer.send('shell:save-site-credentials', {
        url: window.location.href,
        username,
        password
      });
    };

    const startFill = () => {
      void fillCredentials();

      const observer = new MutationObserver(() => {
        void fillCredentials();
      });

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true
      });

      window.setTimeout(() => {
        observer.disconnect();
      }, 20000);
    };

    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', startFill, { once: true });
    } else {
      startFill();
    }

    document.addEventListener(
      'submit',
      () => {
        window.setTimeout(persistCredentials, 0);
      },
      true
    );

    document.addEventListener(
      'click',
      (event) => {
        const target = event.target && event.target.closest
          ? event.target.closest('button,input[type="submit"],.el-button')
          : null;

        if (target) {
          window.setTimeout(persistCredentials, 0);
        }
      },
      true
    );
  }

  function bootstrapPersistentPageStorage() {
    if (!isTopFrame() || !/^https?:$/.test(window.location.protocol)) {
      return;
    }

    let snapshot;

    try {
      snapshot = ipcRenderer.sendSync('shell:get-origin-storage-sync', {
        url: window.location.href
      });
    } catch {
      return;
    }

    if (!snapshot || !snapshot.origin) {
      return;
    }

    writeStorageArea(window.localStorage, snapshot.localStorage);

    const savePageStorage = () => {
      ipcRenderer.send('shell:save-origin-storage', {
        url: window.location.href,
        localStorage: readStorageArea(window.localStorage)
      });
    };

    window.addEventListener('beforeunload', savePageStorage);
    window.addEventListener('pagehide', savePageStorage);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        savePageStorage();
      }
    });
    window.setInterval(savePageStorage, 5000);
  }

  function bootstrapZoomShortcuts() {
    if (!isTopFrame() || zoomShortcutBound) {
      return;
    }

    zoomShortcutBound = true;

    window.addEventListener(
      'wheel',
      (event) => {
        if (!event.ctrlKey) {
          return;
        }

        event.preventDefault();

        const delta = event.deltaY < 0 ? 0.1 : -0.1;
        void ipcRenderer.invoke('shell:adjust-window-zoom', {
          delta
        });
      },
      { passive: false }
    );

    window.addEventListener(
      'keydown',
      (event) => {
        if (!event.ctrlKey) {
          return;
        }

        if (event.key === '0') {
          event.preventDefault();
          void ipcRenderer.invoke('shell:reset-window-zoom');
        }
      },
      true
    );
  }

  function bootstrapBrowserPreloadRuntime() {
    bootstrapPersistentPageStorage();
    bootstrapCredentialAutofill();
    bootstrapZoomShortcuts();
  }

  return {
    bootstrapBrowserPreloadRuntime
  };
}

module.exports = {
  createBrowserPreloadRuntime
};
