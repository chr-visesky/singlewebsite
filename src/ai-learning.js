'use strict';

const metricTotal = document.getElementById('metric-total');
const metricCorrect = document.getElementById('metric-correct');
const metricXp = document.getElementById('metric-xp');
const assignmentStatus = document.getElementById('assignment-status');
const questionList = document.getElementById('question-list');
const questionPane = document.getElementById('question-pane');
const submitMessage = document.getElementById('submit-message');
const submitButton = document.getElementById('submit-button');
const reloadButton = document.getElementById('reload-button');
const resultList = document.getElementById('result-list');
const aiFeedback = document.getElementById('ai-feedback');
const masteryList = document.getElementById('mastery-list');

const params = new URLSearchParams(window.location.search);
const studentId = params.get('studentId') || window.localStorage.getItem('aiLearningStudentId') || 'default_child';
const profileId = params.get('profileId') || 'math_olympiad_daily_set_v1';
const dateKey = params.get('dateKey') || localDateKey();

const state = {
  assignment: null,
  contentItems: [],
  responses: new Map(),
  selectedIndex: 0,
  submitted: false
};

let i18n = {
  t(_key, fallback, variables = {}) {
    return formatMessage(fallback || '', variables);
  }
};

window.localStorage.setItem('aiLearningStudentId', studentId);

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatMessage(message, variables = {}) {
  return String(message === undefined || message === null ? '' : message).replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) => {
    return Object.prototype.hasOwnProperty.call(variables, name) ? String(variables[name]) : match;
  });
}

function t(key, fallback, variables = {}) {
  return i18n.t(key, fallback, variables);
}

function applyStaticI18n() {
  document.title = t('aiLearning.pageTitle', 'AI Math Daily Practice');

  document.querySelectorAll('[data-i18n]').forEach((node) => {
    node.textContent = t(node.getAttribute('data-i18n'), node.textContent || '');
  });

  document.querySelectorAll('[data-i18n-aria-label]').forEach((node) => {
    node.setAttribute('aria-label', t(node.getAttribute('data-i18n-aria-label'), node.getAttribute('aria-label') || ''));
  });
}

function safeText(value, fallback = '') {
  const text = value === undefined || value === null ? '' : String(value);
  return text || fallback;
}

function answerHint(item) {
  const schema = item && item.answerSchema && typeof item.answerSchema === 'object' ? item.answerSchema : {};

  if (schema.type === 'object' && Array.isArray(schema.fields)) {
    const fields = schema.fields.map((field) => safeText(field.name)).filter(Boolean).join(', ');
    return t('aiLearning.answerHints.object', 'Fields: {fields}', { fields });
  }

  if (schema.type === 'fraction') {
    return t('aiLearning.answerHints.fraction', 'For example: 3/4');
  }

  if (schema.type === 'list') {
    return t('aiLearning.answerHints.list', 'Separate answers with commas');
  }

  return t('aiLearning.answerHints.default', 'Enter the final answer');
}

function setMessage(text, isError = false) {
  submitMessage.textContent = text;
  submitMessage.className = isError ? 'error' : '';
}

function setLoading(isLoading) {
  reloadButton.disabled = isLoading;
  submitButton.disabled = isLoading || state.submitted || !state.assignment;
}

function selectedItem() {
  return state.contentItems[state.selectedIndex] || null;
}

function renderQuestionList() {
  questionList.replaceChildren();

  state.contentItems.forEach((item, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'question-tab';
    button.setAttribute('aria-selected', String(index === state.selectedIndex));
    button.dataset.contentItemId = item.id;

    const order = document.createElement('span');
    order.className = 'question-tab__index';
    order.textContent = String(index + 1);

    const title = document.createElement('span');
    title.className = 'question-tab__title';
    title.textContent = safeText(item.prompt).slice(0, 24);

    const mark = document.createElement('span');
    mark.className = 'question-tab__mark';
    mark.textContent = state.responses.get(item.id) ? '*' : '';

    button.append(order, title, mark);
    button.addEventListener('click', () => {
      state.selectedIndex = index;
      render();
    });
    questionList.append(button);
  });
}

function renderQuestionPane() {
  questionPane.replaceChildren();
  const item = selectedItem();

  if (!item) {
    const empty = document.createElement('p');
    empty.textContent = t('aiLearning.status.emptyQuestions', 'No questions yet');
    questionPane.append(empty);
    return;
  }

  const article = document.createElement('article');
  article.className = 'question-card';

  const meta = document.createElement('div');
  meta.className = 'question-meta';
  [
    t('aiLearning.question.index', 'Question {index}', { index: state.selectedIndex + 1 }),
    t('aiLearning.question.difficulty', 'Difficulty {difficulty}', { difficulty: item.difficulty || 1 }),
    safeText((item.skillNodeIds || [])[0], t('aiLearning.question.skillFallback', 'Skill'))
  ].forEach((text) => {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = text;
    meta.append(tag);
  });

  const prompt = document.createElement('div');
  prompt.className = 'prompt';
  prompt.textContent = safeText(item.prompt);

  const answerBox = document.createElement('div');
  answerBox.className = 'answer-box';

  const label = document.createElement('label');
  label.setAttribute('for', 'current-answer');
  label.textContent = answerHint(item);

  const textarea = document.createElement('textarea');
  textarea.id = 'current-answer';
  textarea.dataset.contentItemId = item.id;
  textarea.value = state.responses.get(item.id) || '';
  textarea.disabled = state.submitted;
  textarea.addEventListener('input', () => {
    state.responses.set(item.id, textarea.value);
    renderQuestionList();
  });

  answerBox.append(label, textarea);
  article.append(meta, prompt, answerBox);
  questionPane.append(article);
}

function renderMetrics() {
  metricTotal.textContent = String(state.contentItems.length);

  if (!state.assignment) {
    assignmentStatus.textContent = t('aiLearning.status.notLoaded', 'Not loaded');
    submitButton.disabled = true;
    return;
  }

  state.submitted = state.assignment.status === 'submitted';
  assignmentStatus.textContent = state.submitted
    ? t('aiLearning.status.submitted', '{dateKey} submitted', { dateKey })
    : t('aiLearning.status.pending', '{dateKey} pending', { dateKey });
  submitButton.disabled = state.submitted;
}

function render() {
  renderMetrics();
  renderQuestionList();
  renderQuestionPane();
}

function renderEvaluations(result) {
  const evaluations = result && result.evaluationBatch && Array.isArray(result.evaluationBatch.evaluations)
    ? result.evaluationBatch.evaluations
    : [];
  const summary = result && result.evaluationBatch ? result.evaluationBatch.summary || {} : {};

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

function renderAiFeedback(aiResult) {
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
    title.textContent = safeText(mastery.skillNodeId);

    const detail = document.createElement('span');
    detail.textContent = t('aiLearning.mastery.percent', 'Mastery {percent}%', {
      percent: Math.round((Number(mastery.mastery) || 0) * 100)
    });

    node.append(title, detail);
    masteryList.append(node);
  });
}

async function refreshSideState() {
  const [mastery, gameState] = await Promise.all([
    window.studyGate.getAiLearningMastery({ studentId }),
    window.studyGate.getAiLearningGameState({ studentId })
  ]);

  metricXp.textContent = String((gameState && gameState.xp) || 0);
  renderMastery(mastery);
}

function attemptsPayload() {
  return state.contentItems.map((item) => ({
    contentItemId: item.id,
    response: {
      type: 'final_answer',
      raw: state.responses.get(item.id) || ''
    }
  }));
}

async function loadAssignment() {
  setLoading(true);
  setMessage(t('aiLearning.status.loadingAssignment', 'Loading assignment'));

  try {
    if (!window.studyGate || typeof window.studyGate.getAiLearningAssignment !== 'function') {
      throw new Error(t('aiLearning.errors.apiUnavailable', 'AI learning API is unavailable'));
    }

    const response = await window.studyGate.getAiLearningAssignment({
      studentId,
      dateKey,
      profileId
    });

    state.assignment = response.assignment;
    state.contentItems = Array.isArray(response.contentItems) ? response.contentItems : [];
    state.selectedIndex = Math.min(state.selectedIndex, Math.max(0, state.contentItems.length - 1));
    state.submitted = state.assignment && state.assignment.status === 'submitted';
    render();
    await refreshSideState();
    setMessage(state.submitted
      ? t('aiLearning.status.alreadySubmitted', "Today's set has already been submitted")
      : t('aiLearning.status.ready', 'Assignment ready'));
  } catch (error) {
    setMessage((error && error.message) || t('aiLearning.errors.loadFailed', 'Load failed'), true);
  } finally {
    setLoading(false);
  }
}

async function submitAssignment() {
  if (!state.assignment || state.submitted) {
    return;
  }

  setLoading(true);
  setMessage(t('aiLearning.status.submitting', 'Submitting'));

  try {
    const result = await window.studyGate.submitAiLearningAttemptBatch({
      studentId,
      assignmentId: state.assignment.id,
      attempts: attemptsPayload(),
      behavior: {
        source: 'ai-learning-ui'
      }
    });

    state.assignment = result.assignment;
    state.submitted = true;
    render();
    renderEvaluations(result);
    renderAiFeedback(result.aiResult);
    await refreshSideState();
    setMessage(t('aiLearning.status.submitDone', 'Submitted'));
  } catch (error) {
    setMessage((error && error.message) || t('aiLearning.errors.submitFailed', 'Submit failed'), true);
  } finally {
    setLoading(false);
  }
}

async function bootstrap() {
  if (window.studyGateI18n && typeof window.studyGateI18n.createI18n === 'function') {
    i18n = await window.studyGateI18n.createI18n();
  }

  applyStaticI18n();
  reloadButton.addEventListener('click', () => {
    void loadAssignment();
  });
  submitButton.addEventListener('click', () => {
    void submitAssignment();
  });
  await loadAssignment();
}

bootstrap().catch((error) => {
  setMessage((error && error.message) || t('aiLearning.errors.loadFailed', 'Load failed'), true);
});
