'use strict';

const metricTotal = document.getElementById('metric-total');
const metricAnswered = document.getElementById('metric-answered');
const assignmentStatus = document.getElementById('assignment-status');
const questionTypeLabel = document.getElementById('question-type-label');
const questionList = document.getElementById('question-list');
const questionCard = document.getElementById('question-card');
const answerSlot = document.getElementById('answer-slot');
const draftInput = document.getElementById('current-draft');
const submitMessage = document.getElementById('submit-message');
const submitButton = document.getElementById('submit-button');
const reloadButton = document.getElementById('reload-button');

const params = new URLSearchParams(window.location.search);
const studentId = params.get('studentId') || window.localStorage.getItem('aiLearningStudentId') || 'default_child';
const profileId = params.get('profileId') || 'math_olympiad_daily_set_v1';
const dateKey = params.get('dateKey') || localDateKey();

const state = {
  assignment: null,
  contentItems: [],
  responses: new Map(),
  drafts: new Map(),
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
  document.title = t('aiLearning.paper.title', 'Daily Paper');
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    node.textContent = t(node.getAttribute('data-i18n'), node.textContent || '');
  });
}

function safeText(value, fallback = '') {
  const text = value === undefined || value === null ? '' : String(value);
  return text || fallback;
}

function selectedItem() {
  return state.contentItems[state.selectedIndex] || null;
}

function questionType(item) {
  return safeText(item && item.questionType, 'fill_blank');
}

function questionTypeText(item) {
  const type = questionType(item);

  if (type === 'choice') {
    return t('aiLearning.questionTypes.choice', 'Choice');
  }

  if (type === 'application') {
    return t('aiLearning.questionTypes.application', 'Word problem');
  }

  return t('aiLearning.questionTypes.fillBlank', 'Fill blank');
}

function answeredCount() {
  return state.contentItems.filter((item) => safeText(state.responses.get(item.id))).length;
}

function setMessage(text, isError = false) {
  submitMessage.textContent = text;
  submitMessage.className = isError ? 'error' : '';
}

function setLoading(isLoading) {
  reloadButton.disabled = isLoading;
  submitButton.disabled = isLoading || state.submitted || !state.assignment;
}

function syncDraftInput() {
  const item = selectedItem();
  draftInput.value = item ? state.drafts.get(item.id) || '' : '';
  draftInput.disabled = state.submitted || !item;
}

function renderMetrics() {
  metricTotal.textContent = String(state.contentItems.length);
  metricAnswered.textContent = String(answeredCount());

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

function renderQuestionList() {
  questionList.replaceChildren();

  state.contentItems.forEach((item, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'question-tab';
    button.setAttribute('aria-selected', String(index === state.selectedIndex));
    button.dataset.contentItemId = item.id;
    button.dataset.answered = String(Boolean(safeText(state.responses.get(item.id))));

    const order = document.createElement('span');
    order.className = 'question-tab__index';
    order.textContent = String(index + 1);

    const title = document.createElement('span');
    title.className = 'question-tab__title';
    title.textContent = questionTypeText(item);

    button.append(order, title);
    button.addEventListener('click', () => {
      state.selectedIndex = index;
      render();
    });
    questionList.append(button);
  });
}

function renderQuestionCard() {
  questionCard.replaceChildren();
  const item = selectedItem();

  if (!item) {
    questionCard.textContent = t('aiLearning.status.emptyQuestions', 'No questions yet');
    questionTypeLabel.textContent = '';
    return;
  }

  questionTypeLabel.textContent = questionTypeText(item);

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

  questionCard.append(meta, prompt);
}

function answerLabelText(item) {
  const type = questionType(item);

  if (type === 'choice') {
    return t('aiLearning.answerHints.choice', 'Choose one answer');
  }

  if (type === 'application') {
    return t('aiLearning.answerHints.application', 'Write the final answer');
  }

  return t('aiLearning.answerHints.default', 'Enter the final answer');
}

function saveResponse(item, value) {
  state.responses.set(item.id, value);
  renderMetrics();
  renderQuestionList();
}

function renderChoiceAnswer(item) {
  const list = document.createElement('div');
  list.className = 'choice-list';
  const currentValue = state.responses.get(item.id) || '';

  (Array.isArray(item.choices) ? item.choices : []).forEach((choice, index) => {
    const id = `choice-${item.id}-${index}`;
    const label = document.createElement('label');
    label.className = 'choice-option';
    label.setAttribute('for', id);

    const input = document.createElement('input');
    input.type = 'radio';
    input.id = id;
    input.name = `answer-${item.id}`;
    input.value = choice.value;
    input.checked = currentValue === choice.value;
    input.disabled = state.submitted;
    input.addEventListener('change', () => {
      saveResponse(item, input.value);
    });

    const text = document.createElement('span');
    text.textContent = `${choice.label}. ${choice.text}`;

    label.append(input, text);
    list.append(label);
  });

  return list;
}

function renderTextAnswer(item) {
  const input = document.createElement(questionType(item) === 'application' ? 'textarea' : 'input');
  input.id = 'current-answer';
  input.dataset.contentItemId = item.id;
  input.value = state.responses.get(item.id) || '';
  input.disabled = state.submitted;

  if (input.tagName === 'TEXTAREA') {
    input.className = 'application-answer';
  } else {
    input.className = 'blank-input';
    input.type = 'text';
  }

  input.addEventListener('input', () => {
    saveResponse(item, input.value);
  });

  return input;
}

function renderAnswerSlot() {
  answerSlot.replaceChildren();
  const item = selectedItem();

  if (!item) {
    return;
  }

  const label = document.createElement('label');
  label.setAttribute('for', 'current-answer');
  label.textContent = answerLabelText(item);
  answerSlot.append(label);
  answerSlot.append(questionType(item) === 'choice' ? renderChoiceAnswer(item) : renderTextAnswer(item));
  syncDraftInput();
}

function render() {
  renderMetrics();
  renderQuestionList();
  renderQuestionCard();
  renderAnswerSlot();
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
    setMessage(state.submitted
      ? t('aiLearning.status.alreadySubmitted', "Today's set has already been submitted")
      : t('aiLearning.status.ready', 'Assignment ready'));
  } catch (error) {
    setMessage((error && error.message) || t('aiLearning.errors.loadFailed', 'Load failed'), true);
  } finally {
    setLoading(false);
  }
}

function openReport(result) {
  const reportId = `ai-learning-report:${result.assignment.id}`;
  window.sessionStorage.setItem(reportId, JSON.stringify(result));
  window.studyGate.navigate(
    `internal:ai-learning-report?studentId=${encodeURIComponent(studentId)}&dateKey=${encodeURIComponent(dateKey)}&reportId=${encodeURIComponent(reportId)}`
  );
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
        source: 'ai-learning-ui',
        drafts: Object.fromEntries(state.drafts.entries())
      }
    });

    state.assignment = result.assignment;
    state.submitted = true;
    setMessage(t('aiLearning.status.submitDone', 'Submitted'));
    openReport(result);
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
  draftInput.addEventListener('input', () => {
    const item = selectedItem();
    if (item) {
      state.drafts.set(item.id, draftInput.value);
    }
  });
  await loadAssignment();
}

bootstrap().catch((error) => {
  setMessage((error && error.message) || t('aiLearning.errors.loadFailed', 'Load failed'), true);
});
