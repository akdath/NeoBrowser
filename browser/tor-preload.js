'use strict';
// This script is injected into every page in a Tor session BEFORE any page
// scripts run. It masks the signals sites use to detect bots / Tor users.

(function () {
  // 1. Hide automation flag — the #1 CAPTCHA trigger
  try {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
      configurable: true,
    });
  } catch (_) {}

  // 2. Spoof plugins array (empty plugins = headless browser)
  try {
    Object.defineProperty(navigator, 'plugins', {
      get: () => {
        const arr = [
          { name: 'PDF Viewer',               filename: 'internal-pdf-viewer',    description: 'Portable Document Format' },
          { name: 'Chrome PDF Viewer',         filename: 'internal-pdf-viewer',    description: 'Portable Document Format' },
          { name: 'Chromium PDF Viewer',       filename: 'internal-pdf-viewer',    description: 'Portable Document Format' },
          { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer',    description: 'Portable Document Format' },
          { name: 'WebKit built-in PDF',       filename: 'internal-pdf-viewer',    description: 'Portable Document Format' },
        ];
        arr.item   = i => arr[i];
        arr.namedItem = n => arr.find(p => p.name === n) || null;
        arr.refresh   = () => {};
        Object.setPrototypeOf(arr, PluginArray.prototype);
        return arr;
      },
      configurable: true,
    });
  } catch (_) {}

  // 3. Spoof mimeTypes
  try {
    Object.defineProperty(navigator, 'mimeTypes', {
      get: () => {
        const arr = [
          { type: 'application/pdf',       suffixes: 'pdf',  description: '', enabledPlugin: {} },
          { type: 'text/pdf',              suffixes: 'pdf',  description: '', enabledPlugin: {} },
        ];
        arr.item      = i => arr[i];
        arr.namedItem = n => arr.find(m => m.type === n) || null;
        Object.setPrototypeOf(arr, MimeTypeArray.prototype);
        return arr;
      },
      configurable: true,
    });
  } catch (_) {}

  // 4. Languages — empty or mismatched languages flag headless
  try {
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
      configurable: true,
    });
  } catch (_) {}

  // 5. Platform — must match the UA (we send Windows UA)
  try {
    Object.defineProperty(navigator, 'platform', {
      get: () => 'Win32',
      configurable: true,
    });
  } catch (_) {}

  // 6. Hardware concurrency — 0 or 1 is suspicious
  try {
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      get: () => 4,
      configurable: true,
    });
  } catch (_) {}

  // 7. DeviceMemory — undefined is a bot signal
  try {
    Object.defineProperty(navigator, 'deviceMemory', {
      get: () => 8,
      configurable: true,
    });
  } catch (_) {}

  // 8. Permissions API — headless browsers return 'denied' for notifications
  //    which Cloudflare checks. Make it return 'default' like a real browser.
  try {
    const origQuery = window.Permissions?.prototype?.query;
    if (origQuery) {
      window.Permissions.prototype.query = function (params) {
        if (params?.name === 'notifications') {
          return Promise.resolve({ state: 'default', onchange: null });
        }
        return origQuery.call(this, params);
      };
    }
  } catch (_) {}

  // 9. Chrome runtime object — its absence signals a non-Chrome headless env
  try {
    if (!window.chrome) {
      Object.defineProperty(window, 'chrome', {
        value: {
          runtime: {
            connect:          () => {},
            sendMessage:      () => {},
            onMessage:        { addListener: () => {}, removeListener: () => {} },
          },
        },
        configurable: true,
        writable: true,
      });
    }
  } catch (_) {}

  // 10. WebGL renderer — some bots expose 'SwiftShader' (software renderer)
  try {
    const getParam = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (param) {
      if (param === 37445) return 'Intel Inc.';           // UNMASKED_VENDOR_WEBGL
      if (param === 37446) return 'Intel Iris OpenGL Engine'; // UNMASKED_RENDERER_WEBGL
      return getParam.call(this, param);
    };
  } catch (_) {}
})();