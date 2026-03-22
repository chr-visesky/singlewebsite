'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { chromium } = require('playwright-core');

const DEFAULT_DEBUG_PORT = 9341;

function normalizeWindowsPath(value) {
  return String(value || '').replace(/\//g, '\\');
}

function escapePowerShellSingleQuoted(value) {
  return String(value || '').replace(/'/g, "''");
}

function runPowerShell(command, options = {}) {
  return execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
    {
      encoding: 'utf8',
      ...options
    }
  );
}

function stopProcessesByPath(exePath) {
  const normalizedPath = normalizeWindowsPath(exePath);
  const command = `
$target = '${escapePowerShellSingleQuoted(normalizedPath)}'
Get-CimInstance Win32_Process |
  Where-Object { $_.ExecutablePath -and $_.ExecutablePath -ieq $target } |
  ForEach-Object {
    try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {}
  }
`;

  try {
    runPowerShell(command, { stdio: 'ignore' });
  } catch {
    // Ignore cleanup failures.
  }
}

function processIdsByName(processName) {
  const command = `
$target = '${escapePowerShellSingleQuoted(processName)}'
$rows = Get-Process -Name $target -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id
($rows | ForEach-Object { $_.ToString() }) -join ','
`;

  try {
    const output = runPowerShell(command).trim();
    return output
      ? output
          .split(',')
          .map((value) => Number.parseInt(value, 10))
          .filter((value) => Number.isFinite(value))
      : [];
  } catch {
    return [];
  }
}

function stopProcessesByIds(processIds) {
  const normalizedIds = Array.from(new Set((Array.isArray(processIds) ? processIds : []).filter((value) => Number.isFinite(value))));

  if (!normalizedIds.length) {
    return;
  }

  const command = `
$ids = @(${normalizedIds.join(',')})
foreach ($id in $ids) {
  try { Stop-Process -Id $id -Force -ErrorAction Stop } catch {}
}
`;

  try {
    runPowerShell(command, { stdio: 'ignore' });
  } catch {
    // Ignore cleanup failures.
  }
}

async function delay(ms) {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function connectToStudyGate(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    } catch (error) {
      lastError = error;
      await delay(500);
    }
  }

  throw lastError || new Error('Unable to connect to the StudyGate CDP endpoint.');
}

async function findPage(browser, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        if (predicate(page.url())) {
          return page;
        }
      }
    }

    await delay(300);
  }

  throw new Error('The expected page did not appear in time.');
}

async function waitForHomeReady(page) {
  await page.waitForFunction(() => {
    const cardGrid = document.getElementById('card-grid');
    const host = document.getElementById('studygate-nav-host');
    const shadowRoot = host && host.shadowRoot;
    const actionCount = shadowRoot ? shadowRoot.querySelectorAll('.toolbar-actions button').length : 0;
    return Boolean(window.studyGate && cardGrid && cardGrid.children.length > 0 && actionCount > 0);
  }, null, { timeout: 10000 });
}

async function takeScreenshot(page, targetPath) {
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  await page.screenshot({
    path: targetPath,
    fullPage: true
  });
}

function createServerHtml() {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>Classroom Zoom Smoke</title>
    <style>
      body {
        margin: 0;
        font-family: "Microsoft YaHei UI", sans-serif;
        background: linear-gradient(135deg, #0f1724, #1d3a5b);
        color: #f7fbff;
      }
      .hero {
        padding: 24px;
        font-size: 22px;
        font-weight: 700;
      }
      .content {
        display: grid;
        gap: 12px;
        padding: 0 24px 24px;
      }
      iframe {
        width: 100%;
        height: 240px;
        border: none;
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.04);
      }
      .row {
        padding: 16px 18px;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.08);
      }
    </style>
  </head>
  <body>
    <div class="hero">在线课堂缩放冒烟页</div>
    <div class="content">
      <div class="row">Ctrl + 鼠标滚轮应该改变窗口缩放。</div>
      <div class="row">如果这一页看起来过大或过小，说明缩放正在生效。</div>
      <div class="row">这页只用于本地 BrowserView 缩放测试。</div>
      <iframe src="/frame.html" title="Classroom Inner Frame"></iframe>
    </div>
  </body>
</html>`;
}

function createServerFrameHtml() {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>Classroom Zoom Inner Frame</title>
    <style>
      body {
        margin: 0;
        padding: 20px;
        background: linear-gradient(135deg, rgba(255, 255, 255, 0.12), rgba(90, 168, 255, 0.12));
        color: #ffffff;
        font-family: "Microsoft YaHei UI", sans-serif;
      }
      .panel {
        padding: 18px;
        border-radius: 18px;
        background: rgba(8, 18, 30, 0.72);
      }
    </style>
  </head>
  <body>
    <div class="panel">这个 iframe 会转发 Ctrl + 滚轮 缩放意图。</div>
  </body>
</html>`;
}

async function startLocalClassroomServer() {
  const html = createServerHtml();
  const frameHtml = createServerFrameHtml();
  const server = http.createServer((request, response) => {
    if (!request.url || request.url === '/' || request.url.startsWith('/classroom.html')) {
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8'
      });
      response.end(html);
      return;
    }

    if (request.url.startsWith('/frame.html')) {
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8'
      });
      response.end(frameHtml);
      return;
    }

    response.writeHead(404, {
      'Content-Type': 'text/plain; charset=utf-8'
    });
    response.end('not-found');
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('Failed to start the local classroom smoke server.');
  }

  return {
    server,
    origin: `http://127.0.0.1:${address.port}`,
    url: `http://127.0.0.1:${address.port}/classroom.html`
  };
}

function patchEmbeddedConfig(rawConfig, options = {}) {
  const patched = JSON.parse(JSON.stringify(rawConfig || {}));
  const allowedTopLevelUrlPrefixes = Array.isArray(patched.allowedTopLevelUrlPrefixes)
    ? [...patched.allowedTopLevelUrlPrefixes]
    : [];
  const allowedResourceHostnames = Array.isArray(patched.allowedResourceHostnames)
    ? [...patched.allowedResourceHostnames]
    : [];

  if (!allowedTopLevelUrlPrefixes.includes(options.localOriginPrefix)) {
    allowedTopLevelUrlPrefixes.push(options.localOriginPrefix);
  }

  if (!allowedResourceHostnames.includes('127.0.0.1')) {
    allowedResourceHostnames.push('127.0.0.1');
  }

  patched.allowedTopLevelUrlPrefixes = allowedTopLevelUrlPrefixes;
  patched.allowedResourceHostnames = allowedResourceHostnames;

  return patched;
}

async function withPatchedEmbeddedConfig(configPath, patchedConfig, callback) {
  const originalConfig = await fsp.readFile(configPath, 'utf8');

  try {
    await fsp.writeFile(configPath, `${JSON.stringify(patchedConfig, null, 2)}\n`, 'utf8');
    return await callback();
  } finally {
    await fsp.writeFile(configPath, originalConfig, 'utf8');
  }
}

async function readDocumentZoom(pageOrFrame) {
  const zoomValue = await pageOrFrame.evaluate(() => {
    const rawValue = document.documentElement && document.documentElement.style
      ? document.documentElement.style.zoom
      : '';
    return Number(rawValue || 1) || 1;
  });
  return Number(zoomValue) || 1;
}

async function waitForDocumentZoomChange(pageOrFrame, previousZoomFactor, timeoutMs) {
  await pageOrFrame.waitForFunction(
    (previous) => {
      const rawValue = document.documentElement && document.documentElement.style
        ? document.documentElement.style.zoom
        : '';
      const currentZoom = Number(rawValue || 1) || 1;
      return Math.abs(currentZoom - previous) >= 0.05;
    },
    previousZoomFactor,
    { timeout: timeoutMs }
  );
}

async function runStudyGateAdvancedSmoke(options = {}) {
  const rootDir = options.rootDir || path.resolve(__dirname, '..', '..');
  const outputDir = options.outputDir || path.join(rootDir, 'temp', 'ui-smoke', 'studygate-advanced');
  const studyGatePath =
    options.studyGatePath || path.join(rootDir, 'dist', 'StudyGate-win32-x64', 'StudyGate.exe');
  const embeddedConfigPath =
    options.embeddedConfigPath ||
    path.join(rootDir, 'dist', 'StudyGate-win32-x64', 'resources', 'app', 'embedded-config.json');
  const packagedLearningToolsPath = path.join(
    rootDir,
    'dist',
    'StudyGate-win32-x64',
    'resources',
    'app',
    'src',
    'learning-tools.js'
  );
  const debugPort = Number.isFinite(Number(options.debugPort)) ? Number(options.debugPort) : DEFAULT_DEBUG_PORT;
  const learningToolPath = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'notepad.exe');
  const report = {
    passed: false,
    failedChecks: [],
    studyGatePath,
    embeddedConfigPath,
    learningToolPath,
    screenshots: {}
  };

  let browser = null;
  let localServer = null;
  let spawnedNotepadIds = [];

  try {
    if (!fs.existsSync(studyGatePath)) {
      throw new Error(`StudyGate executable was not found: ${studyGatePath}`);
    }

    if (!fs.existsSync(embeddedConfigPath)) {
      throw new Error(`Embedded config was not found: ${embeddedConfigPath}`);
    }

    if (!fs.existsSync(learningToolPath)) {
      throw new Error(`Smoke learning tool executable was not found: ${learningToolPath}`);
    }

    if (!fs.existsSync(packagedLearningToolsPath)) {
      throw new Error(`Packaged learning-tools module was not found: ${packagedLearningToolsPath}`);
    }

    await fsp.mkdir(outputDir, { recursive: true });
    localServer = await startLocalClassroomServer();
    report.classroomUrl = localServer.url;
    const { launchLearningTool } = require(packagedLearningToolsPath);

    const rawConfig = JSON.parse(await fsp.readFile(embeddedConfigPath, 'utf8'));
    const patchedConfig = patchEmbeddedConfig(rawConfig, {
      classroomUrl: localServer.url,
      localOriginPrefix: `${localServer.origin}/`
    });

    await withPatchedEmbeddedConfig(embeddedConfigPath, patchedConfig, async () => {
      const beforeNotepadIds = processIdsByName('notepad');
      const launchResult = launchLearningTool(
        {
          title: '学习工具冒烟',
          appPath: learningToolPath
        },
        {
          executableDir: path.dirname(studyGatePath),
          projectRoot: rootDir
        }
      );
      report.learningToolLaunchResult = launchResult;

      if (!launchResult || !launchResult.ok) {
        report.failedChecks.push(
          `学习工具 launcher 没有成功启动测试 exe：${(launchResult && launchResult.error) || 'unknown_error'}`
        );
      } else {
        const deadline = Date.now() + 10000;

        while (Date.now() < deadline) {
          const currentIds = processIdsByName('notepad');
          spawnedNotepadIds = currentIds.filter((value) => !beforeNotepadIds.includes(value));

          if (spawnedNotepadIds.length > 0) {
            break;
          }

          await delay(250);
        }

        report.learningToolLaunched = spawnedNotepadIds.length > 0;
        report.learningToolProcessIds = spawnedNotepadIds;

        if (!report.learningToolLaunched) {
          report.failedChecks.push('学习工具 launcher 调起后，没有出现新的记事本进程。');
        }
      }

      stopProcessesByPath(studyGatePath);
      const environment = { ...process.env };
      delete environment.ELECTRON_RUN_AS_NODE;

      const child = spawn(studyGatePath, [`--remote-debugging-port=${debugPort}`], {
        cwd: path.dirname(studyGatePath),
        env: environment,
        stdio: 'ignore',
        windowsHide: true
      });
      report.processId = child.pid || null;

      browser = await connectToStudyGate(debugPort, 30000);
      const homePage = await findPage(browser, (url) => /home\.html$/i.test(url), 30000);
      await homePage.waitForLoadState('domcontentloaded');
      await homePage.setViewportSize({ width: 1440, height: 960 });
      await waitForHomeReady(homePage);

      report.screenshots.home = path.join(outputDir, 'advanced-home.png');
      await takeScreenshot(homePage, report.screenshots.home);
      const navigationResult = await homePage.evaluate(async (targetUrl) => {
        return window.studyGate.enterStudyTarget({ target: targetUrl });
      }, localServer.url);
      report.classroomNavigationResult = navigationResult;

      if (!navigationResult || navigationResult.success === false) {
        report.failedChecks.push(
          `在线课堂缩放 smoke 没有打开本地课堂页：${(navigationResult && navigationResult.message) || 'open_failed'}`
        );
        return;
      }

      const classroomPage = await findPage(browser, (url) => url.startsWith(localServer.url), 15000);
      const classroomShellPage = await findPage(browser, (url) => /classroom-shell\.html$/i.test(url), 15000);
      await classroomPage.waitForLoadState('domcontentloaded');
      await classroomPage.bringToFront();
      await classroomPage.waitForFunction(() => window.frames && window.frames.length > 0, null, { timeout: 10000 });
      const classroomFrame = classroomPage.frames().find((frame) => frame.url().includes('/frame.html'));

      if (!classroomFrame) {
        report.failedChecks.push('本地课堂 smoke 没有加载 iframe，无法验证子 frame 缩放桥接。');
        return;
      }

      report.subframeZoomBridgeInstalled = await classroomFrame.evaluate(
        () => Boolean(window.__studygateClassroomSubframeZoomInstalled)
      );
      report.topframeTestHooksInstalled = await classroomPage.evaluate(
        () => Boolean(window.__studygateClassroomTopframeTestHooks)
      );

      if (!report.subframeZoomBridgeInstalled) {
        report.failedChecks.push('在线课堂子 frame 没有注入缩放桥接脚本。');
        return;
      }

      if (!report.topframeTestHooksInstalled) {
        report.failedChecks.push('在线课堂主 frame 没有注入缩放桥接脚本。');
        return;
      }

      report.subframeTestHooksInstalled = await classroomFrame.evaluate(
        () => Boolean(window.__studygateClassroomSubframeTestHooks)
      );
      report.initialZoomFactor = await readDocumentZoom(classroomPage);
      report.initialContentZoom = await readDocumentZoom(classroomFrame);
      await classroomPage.evaluate(() => {
        if (!window.__studygateClassroomTopframeTestHooks) {
          throw new Error('topframe_test_hooks_missing');
        }
        window.__studygateClassroomTopframeTestHooks.triggerWheel(-240);
      });

      await waitForDocumentZoomChange(classroomFrame, report.initialContentZoom, 10000);
      report.zoomAfterCtrlWheel = {
        top: await readDocumentZoom(classroomPage),
        frame: await readDocumentZoom(classroomFrame)
      };

      if (Math.abs(report.zoomAfterCtrlWheel.top - report.initialZoomFactor) >= 0.01) {
        report.failedChecks.push(
          `在线课堂主 frame 不应该缩放，初始 ${report.initialZoomFactor}，滚轮后 ${report.zoomAfterCtrlWheel.top}。`
        );
      }

      if (!(report.zoomAfterCtrlWheel.frame > report.initialContentZoom)) {
        report.failedChecks.push(
          `在线课堂 Ctrl+滚轮 没有放大内容子 frame，初始 ${report.initialContentZoom}，滚轮后 ${report.zoomAfterCtrlWheel.frame}。`
        );
      }

      await classroomFrame.evaluate(() => {
        if (!window.__studygateClassroomSubframeTestHooks) {
          throw new Error('subframe_test_hooks_missing');
        }
        window.__studygateClassroomSubframeTestHooks.triggerWheel(-240);
      });
      await classroomFrame.waitForFunction(
        (previous) => {
          const rawValue = document.documentElement && document.documentElement.style
            ? document.documentElement.style.zoom
            : '';
          const currentZoom = Number(rawValue || 1) || 1;
          return currentZoom > previous;
        },
        report.zoomAfterCtrlWheel.frame,
        { timeout: 10000 }
      );
      report.zoomAfterSubframeCtrlWheel = await readDocumentZoom(classroomFrame);

      if (!(report.zoomAfterSubframeCtrlWheel > report.zoomAfterCtrlWheel.frame)) {
        report.failedChecks.push(
          `在线课堂子 frame Ctrl+滚轮 没有继续放大，第一次后 ${report.zoomAfterCtrlWheel.frame}，桥接后 ${report.zoomAfterSubframeCtrlWheel}。`
        );
      }

      await classroomPage.evaluate(() => {
        if (!window.__studygateClassroomTopframeTestHooks) {
          throw new Error('topframe_test_hooks_missing');
        }
        window.__studygateClassroomTopframeTestHooks.resetZoom();
      });
      await classroomFrame.evaluate(() => {
        if (!window.__studygateClassroomSubframeTestHooks) {
          throw new Error('subframe_test_hooks_missing');
        }
        window.__studygateClassroomSubframeTestHooks.resetZoom();
      });
      await classroomPage.waitForFunction(
        () => {
          const rawValue = document.documentElement && document.documentElement.style
            ? document.documentElement.style.zoom
            : '';
          const currentZoom = Number(rawValue || 1) || 1;
          return Math.abs(currentZoom - 1) < 0.01;
        },
        null,
        { timeout: 5000 }
      );
      await classroomFrame.waitForFunction(
        () => {
          const rawValue = document.documentElement && document.documentElement.style
            ? document.documentElement.style.zoom
            : '';
          const currentZoom = Number(rawValue || 1) || 1;
          return Math.abs(currentZoom - 1) < 0.01;
        },
        null,
        { timeout: 5000 }
      );
      report.zoomAfterReset = {
        top: await readDocumentZoom(classroomPage),
        frame: await readDocumentZoom(classroomFrame)
      };
      if (Math.abs(report.zoomAfterReset.top - 1) >= 0.01 || Math.abs(report.zoomAfterReset.frame - 1) >= 0.01) {
        report.failedChecks.push(`在线课堂 Ctrl+0 没有把课堂内容缩放重置回 1，实际 top=${report.zoomAfterReset.top} frame=${report.zoomAfterReset.frame}。`);
      }
      report.screenshots.classroom = path.join(outputDir, 'classroom.png');
      await takeScreenshot(classroomPage, report.screenshots.classroom);
    });

    report.passed = report.failedChecks.length === 0;
  } catch (error) {
    report.failedChecks.push((error && error.message) || String(error));
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // Ignore close failures.
      }
    }

    if (localServer && localServer.server) {
      await new Promise((resolve) => {
        localServer.server.close(() => resolve());
      });
    }

    if (spawnedNotepadIds.length > 0) {
      stopProcessesByIds(spawnedNotepadIds);
    }

    stopProcessesByPath(studyGatePath);
  }

  return report;
}

if (require.main === module) {
  runStudyGateAdvancedSmoke()
    .then((report) => {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      process.exitCode = report.passed ? 0 : 1;
    })
    .catch((error) => {
      process.stderr.write(`${(error && error.stack) || String(error)}\n`);
      process.exitCode = 1;
    });
}

module.exports = {
  runStudyGateAdvancedSmoke
};
