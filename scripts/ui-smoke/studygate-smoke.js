'use strict';

const fs = require('node:fs/promises');
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
      firstModelCardId: model && Array.isArray(model.cards) && model.cards[0] ? String(model.cards[0].id || '') : '',
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
  const debugPort = Number.isFinite(Number(options.debugPort)) ? Number(options.debugPort) : DEFAULT_DEBUG_PORT;
  const report = {
    passed: false,
    studyGatePath,
    screenshots: {},
    failedChecks: []
  };

  let browser = null;

  try {
    await fs.mkdir(outputDir, { recursive: true });
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
