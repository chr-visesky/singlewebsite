'use strict';

const metricCorrect = document.getElementById('metric-correct');
const metricXp = document.getElementById('metric-xp');
const resultList = document.getElementById('result-list');
const aiFeedback = document.getElementById('ai-feedback');
const masteryList = document.getElementById('mastery-list');

const params = new URLSearchParams(window.location.search);
const studentId = params.get('studentId') || window.localStorage.getItem('aiLearningStudentId') || 'default_child';
const reportId = params.get('reportId') || '';

let i18n = {
  t(_key, fallback, variables = {}) {
    return String(fallback || '').replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) => {
      return Object.prototype.hasOwnProperty.call(variables, name) ? String(variables[name]) : match;
    });
  }
};

function t(key, fallback, variables = {}) {
  return i18n.t(key, fallback, variables);
}

function applyStaticI18n() {
  document.title = t('aiLearning.report.title', 'Learning Report');
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    node.textContent = t(node.getAttribute('data-i18n'), node.textContent || '');
  });
}

function readReport() {
  if (!reportId) {
    return null;
  }

  try {
    return JSON.parse(window.sessionStorage.getItem(reportId) || 'null');
  } catch {
    return null;
  }
}

function renderEvaluations(report) {
  const evaluations = report && report.evaluationBatch && Array.isArray(report.evaluationBatch.evaluations)
    ? report.evaluationBatch.evaluations
    : [];
  const summary = report && report.evaluationBatch ? report.evaluationBatch.summary || {} : {};

  metricCorrect.textContent = Number.isFinite(Number(summary.correct)) ? String(summary.correct) : '-';
  resultList.replaceChildren();

  if (!evaluations.length) {
    resultList.textContent = t('aiLearning.status.noResult', 'No result yet');
    return;
  }

  evaluations.forEach((evaluation, index) => {
    const verdict = evaluation.verdict || {};
    const status = verdict.status || 'unknown';
    const item = document.createElement('div');
    item.className = 'result-item';
    item.dataset.status = status;

    const title = document.createElement('strong');
    const statusText = status === 'correct'
      ? t('aiLearning.result.correct', 'Correct')
      : status === 'unanswered'
        ? t('aiLearning.result.unanswered', 'Unanswered')
        : t('aiLearning.result.wrong', 'Needs revision');
    title.textContent = `${t('aiLearning.question.index', 'Question {index}', { index: index + 1 })} ${statusText}`;

    const score = document.createElement('span');
    score.textContent = t('aiLearning.result.score', '{score}/{maxScore} points', {
      score: verdict.score || 0,
      maxScore: verdict.maxScore || 10
    });

    item.append(title, score);
    resultList.append(item);
  });
}

function appendFeedbackBlock(titleText, rows) {
  const block = document.createElement('div');
  block.className = 'feedback-block';

  const title = document.createElement('strong');
  title.textContent = titleText;
  block.append(title);

  const list = document.createElement('p');
  list.textContent = Array.isArray(rows) && rows.length ? rows.join('; ') : t('aiLearning.feedback.empty', 'None');
  block.append(list);
  aiFeedback.append(block);
}

function renderAiFeedback(report) {
  const aiResult = report && report.aiResult;
  const output = aiResult && aiResult.output && typeof aiResult.output === 'object' ? aiResult.output : {};
  const dailySummary = output.dailySummary && typeof output.dailySummary === 'object' ? output.dailySummary : {};

  aiFeedback.replaceChildren();

  if (aiResult && aiResult.status === 'failed') {
    aiFeedback.textContent = aiResult.error || t('aiLearning.errors.aiFailed', 'AI feedback failed');
    aiFeedback.classList.add('error');
    return;
  }

  aiFeedback.classList.remove('error');
  appendFeedbackBlock(t('aiLearning.feedback.strengths', 'Strengths'), dailySummary.strengths || []);
  appendFeedbackBlock(t('aiLearning.feedback.weaknesses', 'Weaknesses'), dailySummary.weaknesses || []);
  appendFeedbackBlock(t('aiLearning.feedback.nextPlan', 'Next step'), dailySummary.nextPlanSuggestion || []);
}

function renderMastery(items) {
  masteryList.replaceChildren();

  if (!Array.isArray(items) || !items.length) {
    masteryList.textContent = t('aiLearning.status.masteryEmpty', 'Complete one set to update');
    return;
  }

  items.slice(0, 8).forEach((mastery) => {
    const node = document.createElement('div');
    node.className = 'mastery-item';

    const title = document.createElement('strong');
    title.textContent = mastery.skillNodeId || '';

    const detail = document.createElement('span');
    detail.textContent = t('aiLearning.mastery.percent', 'Mastery {percent}%', {
      percent: Math.round((Number(mastery.mastery) || 0) * 100)
    });

    node.append(title, detail);
    masteryList.append(node);
  });
}

async function bootstrap() {
  if (window.studyGateI18n && typeof window.studyGateI18n.createI18n === 'function') {
    i18n = await window.studyGateI18n.createI18n();
  }

  applyStaticI18n();
  const report = readReport();
  renderEvaluations(report);
  renderAiFeedback(report);

  const [mastery, gameState] = await Promise.all([
    window.studyGate.getAiLearningMastery({ studentId }),
    window.studyGate.getAiLearningGameState({ studentId })
  ]);
  metricXp.textContent = String((gameState && gameState.xp) || 0);
  renderMastery(mastery);
}

bootstrap().catch((error) => {
  resultList.textContent = (error && error.message) || t('aiLearning.errors.loadFailed', 'Load failed');
});
