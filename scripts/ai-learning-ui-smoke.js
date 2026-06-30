'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');

const rootDir = path.resolve(__dirname, '..');

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function connectToElectron(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    } catch (error) {
      lastError = error;
      await delay(400);
    }
  }

  throw lastError || new Error('Unable to connect to Electron.');
}

async function findPage(browser, predicate, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        if (predicate(page.url())) {
          return page;
        }
      }
    }

    await delay(250);
  }

  throw new Error('Expected page was not found.');
}

async function waitForQuestionCount(page, expectedCount) {
  await page.waitForFunction(
    (count) => document.querySelectorAll('#question-list .question-tab').length === count,
    expectedCount,
    { timeout: 20000 }
  );
}

async function fillAllAnswers(page, answerText) {
  const count = await page.locator('#question-list .question-tab').count();

  for (let index = 0; index < count; index += 1) {
    await page.locator('#question-list .question-tab').nth(index).click();
    await page.locator('#current-answer').fill(answerText);
  }

  return count;
}

async function main() {
  const electronPath = require('electron');
  const outputDir = path.join(rootDir, 'temp', 'ai-learning-ui-smoke');
  const appDataDir = path.join(os.tmpdir(), `studygate-ai-learning-ui-${process.pid}-${Date.now()}`);
  const port = 9444 + Math.floor(Math.random() * 300);
  const studentId = `ui_smoke_${Date.now()}`;
  const dateKey = '2026-06-30';
  const report = {
    passed: false,
    failedChecks: [],
    studentId,
    dateKey,
    screenshots: {}
  };

  let browser = null;
  let child = null;

  try {
    await fs.rm(outputDir, { recursive: true, force: true });
    await fs.mkdir(outputDir, { recursive: true });

    const env = {
      ...process.env,
      APPDATA: appDataDir,
      AI_PROVIDER: 'mock'
    };
    delete env.ELECTRON_RUN_AS_NODE;

    child = spawn(electronPath, [`--remote-debugging-port=${port}`, '.'], {
      cwd: rootDir,
      env,
      stdio: 'ignore',
      windowsHide: true
    });
    report.processId = child.pid || null;

    browser = await connectToElectron(port);
    const homePage = await findPage(browser, (url) => /home\.html(?:$|\?)/i.test(url));
    await homePage.waitForLoadState('domcontentloaded');
    await homePage.setViewportSize({ width: 1440, height: 960 });
    await homePage.waitForSelector('#card-grid .card');

    const hasAiCard = await homePage.evaluate(() =>
      Array.from(document.querySelectorAll('#card-grid .card h2')).some((node) => /AI/.test(node.textContent || ''))
    );
    if (!hasAiCard) {
      report.failedChecks.push('Home page does not show the AI learning card.');
    }

    await homePage.evaluate(
      ({ studentId: nextStudentId, dateKey: nextDateKey }) => {
        window.studyGate.navigate(`internal:ai-learning?studentId=${encodeURIComponent(nextStudentId)}&dateKey=${encodeURIComponent(nextDateKey)}`);
      },
      { studentId, dateKey }
    );

    const page = await findPage(browser, (url) => /ai-learning\.html/i.test(url));
    await page.waitForLoadState('domcontentloaded');
    await page.setViewportSize({ width: 1440, height: 960 });
    await waitForQuestionCount(page, 10);

    report.screenshots.loaded = path.join(outputDir, 'ai-learning-loaded.png');
    await page.screenshot({ path: report.screenshots.loaded, fullPage: true });

    const loadedState = await page.evaluate(() => ({
      title: document.querySelector('h1') ? document.querySelector('h1').textContent.trim() : '',
      questionCount: document.querySelectorAll('#question-list .question-tab').length,
      totalMetric: document.getElementById('metric-total')?.textContent || '',
      hasStandardAnswerText: document.body.textContent.includes('standardAnswer')
    }));
    report.loadedState = loadedState;

    if (loadedState.questionCount !== 10) {
      report.failedChecks.push(`Expected 10 questions, got ${loadedState.questionCount}.`);
    }
    if (loadedState.totalMetric !== '10') {
      report.failedChecks.push(`Total metric did not show 10, got ${loadedState.totalMetric}.`);
    }
    if (loadedState.hasStandardAnswerText) {
      report.failedChecks.push('Page appears to expose standard answer text.');
    }

    report.filledAnswers = await fillAllAnswers(page, '0');
    await page.locator('#submit-button').click();
    await page.waitForFunction(
      () => document.querySelectorAll('#result-list .result-item').length === 10,
      null,
      { timeout: 30000 }
    );
    await page.waitForFunction(
      () => document.querySelectorAll('#ai-feedback .feedback-block').length > 0,
      null,
      { timeout: 30000 }
    );

    report.screenshots.submitted = path.join(outputDir, 'ai-learning-submitted.png');
    await page.screenshot({ path: report.screenshots.submitted, fullPage: true });

    const submittedState = await page.evaluate(() => ({
      resultCount: document.querySelectorAll('#result-list .result-item').length,
      correctMetric: document.getElementById('metric-correct')?.textContent || '',
      xpMetric: Number(document.getElementById('metric-xp')?.textContent || '0'),
      submitDisabled: Boolean(document.getElementById('submit-button')?.disabled),
      message: document.getElementById('submit-message')?.textContent || '',
      aiFeedbackText: document.getElementById('ai-feedback')?.textContent || '',
      masteryCount: document.querySelectorAll('#mastery-list .mastery-item').length
    }));
    report.submittedState = submittedState;

    if (submittedState.resultCount !== 10) {
      report.failedChecks.push(`Expected 10 result rows, got ${submittedState.resultCount}.`);
    }
    if (!Number.isFinite(submittedState.xpMetric) || submittedState.xpMetric <= 0) {
      report.failedChecks.push(`XP did not update after submit: ${submittedState.xpMetric}.`);
    }
    if (!submittedState.submitDisabled) {
      report.failedChecks.push('Submit button was not disabled after submitting.');
    }
    if (!submittedState.aiFeedbackText.trim()) {
      report.failedChecks.push('AI feedback area is empty after submitting.');
    }
    if (submittedState.masteryCount <= 0) {
      report.failedChecks.push('Mastery list did not update after submitting.');
    }

    report.passed = report.failedChecks.length === 0;
  } catch (error) {
    report.failedChecks.push((error && error.stack) || String(error));
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }

    if (child && !child.killed) {
      child.kill();
    }

    await fs.rm(appDataDir, { recursive: true, force: true }).catch(() => {});
    await fs.writeFile(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2));
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.passed ? 0 : 1;
}

main().catch((error) => {
  process.stderr.write(`${(error && error.stack) || String(error)}\n`);
  process.exitCode = 1;
});
