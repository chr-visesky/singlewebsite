'use strict';

const syncFs = require('node:fs');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { chromium } = require('playwright-core');

const DEFAULT_DEBUG_PORT = 9333;

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
    // Ignore cleanup failures so smoke results reflect app behavior, not CIM availability.
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

function processIdsByPath(exePath) {
  const normalizedPath = normalizeWindowsPath(exePath);
  const command = `
$target = '${escapePowerShellSingleQuoted(normalizedPath)}'
$rows = Get-CimInstance Win32_Process |
  Where-Object { $_.ExecutablePath -and $_.ExecutablePath -ieq $target } |
  Select-Object -ExpandProperty ProcessId
($rows | ForEach-Object { $_.ToString() }) -join ','
`;
  let output = '';

  try {
    output = runPowerShell(command).trim();
  } catch {
    return [];
  }

  return output
    ? output
        .split(',')
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isFinite(value))
    : [];
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

  throw new Error('The expected StudyGate page did not appear in time.');
}

async function clickToolbarAction(page, actionLabel) {
  return page.evaluate((label) => {
    const host = document.getElementById('studygate-nav-host');
    const shadowRoot = host && host.shadowRoot;

    if (!shadowRoot) {
      return false;
    }

    const buttons = Array.from(shadowRoot.querySelectorAll('.toolbar-actions button'));
    const target = buttons.find((button) => {
      const text = String(button.textContent || '').trim();
      const title = String(button.getAttribute('title') || '').trim();
      const ariaLabel = String(button.getAttribute('aria-label') || '').trim();
      return text === label || title === label || ariaLabel === label;
    });

    if (!target) {
      return false;
    }

    target.click();
    return true;
  }, actionLabel);
}

async function clickToolbarHome(page) {
  return page.evaluate(() => {
    const host = document.getElementById('studygate-nav-host');
    const shadowRoot = host && host.shadowRoot;

    if (!shadowRoot) {
      return false;
    }

    const homeButton = shadowRoot.querySelector('.nav-button--home');

    if (!homeButton || homeButton.hidden || homeButton.disabled) {
      return false;
    }

    homeButton.click();
    return true;
  });
}

async function openInternalLibrary(page) {
  return page.evaluate(async () => {
    if (!window.studyGate || typeof window.studyGate.navigate !== 'function') {
      return false;
    }

    window.studyGate.navigate('internal:library');
    return true;
  });
}

async function summarizeHome(page) {
  return page.evaluate(async () => {
    const layoutOrder = Array.from(document.querySelectorAll('.dashboard > .dashboard__column')).map((node) =>
      Array.from(node.classList).find((className) => className.startsWith('dashboard__column--')) || node.className
    );
    const modulesColumn = document.querySelector('.dashboard__column--modules');
    const calendarColumn = document.querySelector('.dashboard__column--calendar');
    const todayColumn = document.querySelector('.dashboard__column--today');
    const homeNoticeNode = document.getElementById('home-notice');
    const firstCard = document.querySelector('#card-grid .card');
    const model = window.studyGate ? await window.studyGate.getHomeModel({ syncRemote: false }) : null;
    const host = document.getElementById('studygate-nav-host');
    const shadowRoot = host && host.shadowRoot;
    const updateButton = shadowRoot
      ? Array.from(shadowRoot.querySelectorAll('.toolbar-actions button')).find((button) =>
          String(button.getAttribute('title') || button.getAttribute('aria-label') || button.textContent || '').trim() === '检查更新'
        )
      : null;

    return {
      layoutOrder,
      cardCount: model && Array.isArray(model.cards) ? model.cards.length : 0,
      firstCardTitle: firstCard ? String(firstCard.querySelector('h2')?.textContent || '').trim() : '',
      firstCardBadge: firstCard ? String(firstCard.querySelector('.card__tag')?.textContent || '').trim() : '',
      cardResetButtons: Array.from(document.querySelectorAll('#card-grid .card button'))
        .map((button) => String(button.textContent || '').trim())
        .filter((text) => text === '初始化').length,
      firstModelCardId: model && Array.isArray(model.cards) && model.cards[0] ? String(model.cards[0].id || '') : '',
      modulesColumnWidth: modulesColumn ? Math.round(modulesColumn.getBoundingClientRect().width) : 0,
      calendarColumnWidth: calendarColumn ? Math.round(calendarColumn.getBoundingClientRect().width) : 0,
      todayColumnWidth: todayColumn ? Math.round(todayColumn.getBoundingClientRect().width) : 0,
      hasCalendarSelectedList: Boolean(document.getElementById('calendar-selected-list')),
      homeNoticeVisible: Boolean(homeNoticeNode && homeNoticeNode.hidden === false),
      updateButtonCompact: Boolean(updateButton && updateButton.classList.contains('nav-button--icon-only')),
      toolbarActions: shadowRoot
        ? Array.from(shadowRoot.querySelectorAll('.toolbar-actions button')).map((button) =>
            String(button.getAttribute('title') || button.getAttribute('aria-label') || button.textContent || '').trim()
          )
        : []
    };
  });
}

async function openUpdateDialogAndSummarize(page) {
  const opened = await clickToolbarAction(page, '检查更新');

  if (!opened) {
    return { opened: false };
  }

  await page.waitForFunction(() => {
    const host = document.getElementById('studygate-nav-host');
    const shadowRoot = host && host.shadowRoot;
    const overlay = shadowRoot && shadowRoot.querySelector('.update-overlay[data-visible="true"]');
    const statusNode = overlay && overlay.querySelector('[data-role="status-text"]');
    return Boolean(overlay && statusNode && String(statusNode.textContent || '').trim().length > 0);
  }, null, { timeout: 10000 });

  const summary = await page.evaluate(() => {
    const host = document.getElementById('studygate-nav-host');
    const shadowRoot = host && host.shadowRoot;
    const overlay = shadowRoot && shadowRoot.querySelector('.update-overlay[data-visible="true"]');

    if (!overlay) {
      return { opened: false };
    }

    return {
      opened: true,
      currentVersion: String(overlay.querySelector('[data-role="current-version"]')?.textContent || '').trim(),
      latestVersion: String(overlay.querySelector('[data-role="latest-version"]')?.textContent || '').trim(),
      statusText: String(overlay.querySelector('[data-role="status-text"]')?.textContent || '').trim(),
      hasPrimaryButton: Boolean(overlay.querySelector('[data-role="primary"]:not([hidden])'))
    };
  });

  await page.evaluate(() => {
    const host = document.getElementById('studygate-nav-host');
    const shadowRoot = host && host.shadowRoot;
    const closeButton = shadowRoot && shadowRoot.querySelector('.update-dialog__close');

    if (closeButton) {
      closeButton.click();
    }
  });

  await page.waitForFunction(() => {
    const host = document.getElementById('studygate-nav-host');
    const shadowRoot = host && host.shadowRoot;
    const overlay = shadowRoot && shadowRoot.querySelector('.update-overlay');
    return Boolean(!overlay || overlay.getAttribute('data-visible') === 'false');
  }, null, { timeout: 5000 });

  return summary;
}

async function summarizeLibrary(page) {
  return page.evaluate(() => {
    const pageNode = document.querySelector('.page');
    const headerNode = document.querySelector('.page-header');
    const playerNode = document.querySelector('.player-shell');
    const titleNode = document.getElementById('library-title');

    const pageRect = pageNode ? pageNode.getBoundingClientRect() : null;
    const headerRect = headerNode ? headerNode.getBoundingClientRect() : null;
    const playerRect = playerNode ? playerNode.getBoundingClientRect() : null;

    return {
      title: titleNode ? String(titleNode.textContent || '').trim() : '',
      pageTopPadding: pageRect && headerRect ? Math.round(headerRect.top - pageRect.top) : null,
      headerHeight: headerRect ? Math.round(headerRect.height) : null,
      playerTop: pageRect && playerRect ? Math.round(playerRect.top - pageRect.top) : null
    };
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
  const originalConfig = await fs.readFile(configPath, 'utf8');

  try {
    await fs.writeFile(configPath, `${JSON.stringify(patchedConfig, null, 2)}\n`, 'utf8');
    return await callback();
  } finally {
    await fs.writeFile(configPath, originalConfig, 'utf8');
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

async function waitForHomeReady(page) {
  await page.waitForFunction(() => {
    const cardGrid = document.getElementById('card-grid');
    const host = document.getElementById('studygate-nav-host');
    const shadowRoot = host && host.shadowRoot;
    const actionCount = shadowRoot ? shadowRoot.querySelectorAll('.toolbar-actions button').length : 0;
    return Boolean(window.studyGate && cardGrid && cardGrid.children.length > 0 && actionCount > 0);
  }, null, { timeout: 10000 });
}

async function waitForStudentPlanReady(page) {
  await page.waitForFunction(() => {
    const statusNode = document.getElementById('access-status');
    const host = document.getElementById('studygate-nav-host');
    const shadowRoot = host && host.shadowRoot;
    const actionCount = shadowRoot ? shadowRoot.querySelectorAll('.toolbar-actions button').length : 0;
    return Boolean(statusNode && actionCount > 0);
  }, null, { timeout: 10000 });
}

async function waitForLibraryReady(page) {
  await page.waitForFunction(() => {
    const titleNode = document.getElementById('library-title');
    const host = document.getElementById('studygate-nav-host');
    const shadowRoot = host && host.shadowRoot;
    const actionCount = shadowRoot ? shadowRoot.querySelectorAll('.toolbar-actions button').length : 0;
    return Boolean(titleNode && titleNode.textContent && actionCount > 0);
  }, null, { timeout: 10000 });
}

async function dismissHomeNoticeIfVisible(page) {
  return page.evaluate(() => {
    const notice = document.getElementById('home-notice');
    const dismissButton = document.getElementById('home-notice-dismiss');

    if (!notice || notice.hidden || !dismissButton) {
      return false;
    }

    dismissButton.click();
    return notice.hidden === true;
  });
}

async function takeScreenshot(page, targetPath) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await page.screenshot({
    path: targetPath,
    fullPage: true
  });
}

async function runStudyGateSmoke(options = {}) {
  const rootDir = options.rootDir || path.resolve(__dirname, '..', '..');
  const outputDir = options.outputDir || path.join(rootDir, 'temp', 'ui-smoke', 'studygate');
  const studyGatePath =
    options.studyGatePath || path.join(rootDir, 'dist', 'StudyGate-win32-x64', 'StudyGate.exe');
  const homeworkAppPath =
    options.homeworkAppPath ||
    path.join(rootDir, 'dist', 'StudyGate-win32-x64', 'modules', 'homework', 'HomeworkApp.exe');
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
  const learningToolPath = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'notepad.exe');
  const debugPort = Number.isFinite(Number(options.debugPort)) ? Number(options.debugPort) : DEFAULT_DEBUG_PORT;
  const report = {
    passed: false,
    studyGatePath,
    embeddedConfigPath,
    learningToolPath,
    screenshots: {},
    failedChecks: []
  };

  let browser = null;
  let localServer = null;
  let spawnedNotepadIds = [];

  try {
    await fs.mkdir(outputDir, { recursive: true });
    if (!syncFs.existsSync(embeddedConfigPath)) {
      throw new Error(`Embedded config was not found: ${embeddedConfigPath}`);
    }

    if (!syncFs.existsSync(packagedLearningToolsPath)) {
      throw new Error(`Packaged learning-tools module was not found: ${packagedLearningToolsPath}`);
    }

    if (!syncFs.existsSync(learningToolPath)) {
      throw new Error(`Smoke learning tool executable was not found: ${learningToolPath}`);
    }

    localServer = await startLocalClassroomServer();
    report.classroomUrl = localServer.url;

    const rawConfig = JSON.parse(await fs.readFile(embeddedConfigPath, 'utf8'));
    const patchedConfig = patchEmbeddedConfig(rawConfig, {
      classroomUrl: localServer.url,
      localOriginPrefix: `${localServer.origin}/`
    });

    await withPatchedEmbeddedConfig(embeddedConfigPath, patchedConfig, async () => {
      const { launchLearningTool } = require(packagedLearningToolsPath);
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
    stopProcessesByPath(homeworkAppPath);

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

    report.screenshots.home = path.join(outputDir, 'home.png');
    await takeScreenshot(homePage, report.screenshots.home);
    report.home = await summarizeHome(homePage);

    const expectedLayout = [
      'dashboard__column--modules',
      'dashboard__column--calendar',
      'dashboard__column--today'
    ];
    if (JSON.stringify(report.home.layoutOrder) !== JSON.stringify(expectedLayout)) {
      report.failedChecks.push(`首页布局顺序异常: ${report.home.layoutOrder.join(' -> ')}`);
    }

    if (report.home.calendarColumnWidth <= report.home.modulesColumnWidth) {
      report.failedChecks.push(
        `首页宽度分配异常: 日历列 ${report.home.calendarColumnWidth}px 没有宽于左侧模块列 ${report.home.modulesColumnWidth}px。`
      );
    }

    if (report.home.hasCalendarSelectedList) {
      report.failedChecks.push('首页日历下方仍然保留了选中日期计划列表。');
    }

    if (report.home.cardResetButtons > 0) {
      report.failedChecks.push(`首页卡片仍然显示了 ${report.home.cardResetButtons} 个“初始化”按钮。`);
    }

    if (report.home.homeNoticeVisible) {
      const dismissed = await dismissHomeNoticeIfVisible(homePage);
      await homePage.waitForFunction(() => {
        const notice = document.getElementById('home-notice');
        return !notice || notice.hidden === true;
      });
      report.home.homeNoticeDismissed = dismissed;
      report.screenshots.homeAfterNotice = path.join(outputDir, 'home-after-notice.png');
      await takeScreenshot(homePage, report.screenshots.homeAfterNotice);

      if (!dismissed) {
        report.failedChecks.push('首页提醒弹窗出现后未能通过按钮正常关闭。');
      }
    }

    if (!report.home.toolbarActions.includes('检查更新')) {
      report.failedChecks.push('首页共享工具栏缺少“检查更新”按钮。');
    }

    if (!report.home.updateButtonCompact) {
      report.failedChecks.push('首页“检查更新”按钮不是图标按钮。');
    }

    report.updateDialog = await openUpdateDialogAndSummarize(homePage);
    if (!report.updateDialog.opened) {
      report.failedChecks.push('首页未能打开自定义检查更新弹框。');
    } else {
      report.screenshots.updateDialog = path.join(outputDir, 'update-dialog.png');
      await takeScreenshot(homePage, report.screenshots.updateDialog);

      if (!report.updateDialog.currentVersion) {
        report.failedChecks.push('检查更新弹框没有显示当前版本。');
      }

      if (!report.updateDialog.latestVersion) {
        report.failedChecks.push('检查更新弹框没有显示最新版本。');
      }
    }

    const openedStudentPlan = await clickToolbarAction(homePage, '学生计划');
    if (!openedStudentPlan) {
      report.failedChecks.push('首页工具栏未找到“学生计划”按钮。');
    } else {
      await homePage.waitForFunction(() => /student-plan\.html$/i.test(window.location.href));
      await waitForStudentPlanReady(homePage);
      report.studentPlanUrl = homePage.url();
      report.screenshots.studentPlan = path.join(outputDir, 'student-plan.png');
      await takeScreenshot(homePage, report.screenshots.studentPlan);

      report.studentPlan = await homePage.evaluate(() => ({
        hasHero: Boolean(document.querySelector('.hero')),
        hasStatusBanner: Boolean(document.getElementById('access-status')),
        hasSaveButton: Boolean(document.getElementById('save-plan')),
        toolbarActions: (() => {
          const host = document.getElementById('studygate-nav-host');
          const shadowRoot = host && host.shadowRoot;
          return shadowRoot
            ? Array.from(shadowRoot.querySelectorAll('.toolbar-actions button')).map((button) =>
                String(button.getAttribute('title') || button.getAttribute('aria-label') || button.textContent || '').trim()
              )
            : [];
        })()
      }));

      if (report.studentPlan.hasHero) {
        report.failedChecks.push('学生计划页仍然保留了单独的 hero 头部，没有完全复用共享 banner。');
      }

      if (!report.studentPlan.toolbarActions.includes('刷新')) {
        report.failedChecks.push('学生计划页的共享 banner 丢失了“刷新”按钮。');
      }

      if (!report.studentPlan.toolbarActions.includes('检查更新')) {
        report.failedChecks.push('学生计划页的共享 banner 缺少“检查更新”按钮。');
      }

      const returnedHome = await clickToolbarHome(homePage);
      if (!returnedHome) {
        report.failedChecks.push('学生计划页没有通过共享工具栏提供返回首页入口。');
      } else {
        await homePage.waitForFunction(() => /home\.html$/i.test(window.location.href));
        await waitForHomeReady(homePage);
        report.screenshots.homeAfterBack = path.join(outputDir, 'home-after-back.png');
        await takeScreenshot(homePage, report.screenshots.homeAfterBack);
      }
    }

    const openedLibrary = await openInternalLibrary(homePage);
    if (!openedLibrary) {
      report.failedChecks.push('未能通过内置导航打开百度网盘页。');
    } else {
      await homePage.waitForFunction(() => /library\.html/i.test(window.location.href));
      await waitForLibraryReady(homePage);
      report.libraryUrl = homePage.url();
      report.screenshots.library = path.join(outputDir, 'library.png');
      await takeScreenshot(homePage, report.screenshots.library);
      report.library = await summarizeLibrary(homePage);

      if (typeof report.library.pageTopPadding === 'number' && report.library.pageTopPadding > 24) {
        report.failedChecks.push(`百度网盘页顶部留白过大: ${report.library.pageTopPadding}px。`);
      }

      if (typeof report.library.playerTop === 'number' && report.library.playerTop > 140) {
        report.failedChecks.push(`百度网盘页正经内容区起点过低: ${report.library.playerTop}px。`);
      }

      const returnedHome = await clickToolbarHome(homePage);
      if (!returnedHome) {
        report.failedChecks.push('百度网盘页没有通过共享工具栏提供返回首页入口。');
      } else {
        await homePage.waitForFunction(() => /home\.html$/i.test(window.location.href));
        await waitForHomeReady(homePage);
      }
    }

    report.homeworkModuleCard = {
      title: report.home.firstCardTitle,
      badge: report.home.firstCardBadge,
      id: report.home.firstModelCardId
    };

      report.classroomNavigationResult = await homePage.evaluate((targetUrl) => {
        window.studyGate.enterStudyTarget({ target: targetUrl });
        return { success: true };
      }, localServer.url);

      if (!report.classroomNavigationResult || report.classroomNavigationResult.success === false) {
        report.failedChecks.push(
          `在线课堂缩放 smoke 没有打开本地课堂页：${(report.classroomNavigationResult && report.classroomNavigationResult.message) || 'open_failed'}`
        );
      } else {
        const classroomPage = await findPage(browser, (url) => url.startsWith(localServer.url), 15000);
        await classroomPage.waitForLoadState('domcontentloaded');
        await classroomPage.bringToFront();
        await classroomPage.waitForFunction(() => window.frames && window.frames.length > 0, null, { timeout: 10000 });
        const classroomFrame = classroomPage.frames().find((frame) => frame.url().includes('/frame.html'));

        if (!classroomFrame) {
          report.failedChecks.push('本地课堂 smoke 没有加载 iframe，无法验证子 frame 缩放桥接。');
        } else {
          report.subframeZoomBridgeInstalled = await classroomFrame.evaluate(
            () => Boolean(window.__studygateClassroomSubframeZoomInstalled)
          );
          report.topframeTestHooksInstalled = await classroomPage.evaluate(
            () => Boolean(window.__studygateClassroomTopframeTestHooks)
          );
          report.subframeTestHooksInstalled = await classroomFrame.evaluate(
            () => Boolean(window.__studygateClassroomSubframeTestHooks)
          );

          if (!report.subframeZoomBridgeInstalled) {
            report.failedChecks.push('在线课堂子 frame 没有注入缩放桥接脚本。');
          }

          if (!report.topframeTestHooksInstalled) {
            report.failedChecks.push('在线课堂主 frame 没有注入缩放桥接脚本。');
          }

          if (!report.subframeTestHooksInstalled) {
            report.failedChecks.push('在线课堂子 frame 没有注入缩放测试钩子。');
          }

          if (report.failedChecks.length === 0 || (report.subframeZoomBridgeInstalled && report.topframeTestHooksInstalled && report.subframeTestHooksInstalled)) {
            report.initialZoomFactor = await readDocumentZoom(classroomPage);
            report.initialContentZoom = await readDocumentZoom(classroomFrame);
            await classroomPage.evaluate(() => {
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
              window.__studygateClassroomTopframeTestHooks.resetZoom();
            });
            await classroomFrame.evaluate(() => {
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
          }
        }
      }
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

    stopProcessesByPath(homeworkAppPath);
    stopProcessesByPath(studyGatePath);
  }

  return report;
}

if (require.main === module) {
  runStudyGateSmoke()
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
  runStudyGateSmoke
};
