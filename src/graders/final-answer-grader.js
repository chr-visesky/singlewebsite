'use strict';

function createFinalAnswerGrader(dependencies = {}) {
  const {
    idPrefix = 'eval'
  } = dependencies;

  function normalizePrefix(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function clampConfidence(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return 0;
    }

    return Math.max(0, Math.min(1, numeric));
  }

  function stableEvaluationId(contentItemId, attemptId = '') {
    const suffix = attemptId || contentItemId || `${Date.now()}`;
    return `${idPrefix}_${suffix}`.replace(/[^a-zA-Z0-9_-]+/g, '_');
  }

  function gcd(left, right) {
    let a = Math.abs(left);
    let b = Math.abs(right);

    while (b) {
      const next = a % b;
      a = b;
      b = next;
    }

    return a || 1;
  }

  function normalizeFraction(numerator, denominator) {
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
      return null;
    }

    const sign = denominator < 0 ? -1 : 1;
    const divisor = gcd(numerator, denominator);

    return {
      numerator: sign * numerator / divisor,
      denominator: Math.abs(denominator / divisor)
    };
  }

  function parseNumber(rawValue) {
    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
      return {
        value: rawValue,
        confidence: 1
      };
    }

    const raw = normalizePrefix(String(rawValue === undefined || rawValue === null ? '' : rawValue))
      .replace(/，/g, ',')
      .replace(/：/g, ':');

    if (!raw) {
      return {
        value: null,
        confidence: 1,
        status: 'unanswered'
      };
    }

    const match = raw.match(/-?\d+(?:\.\d+)?/);

    if (!match) {
      return {
        value: null,
        confidence: 0.4
      };
    }

    return {
      value: Number(match[0]),
      confidence: match[0] === raw ? 1 : 0.95
    };
  }

  function parseFraction(rawValue) {
    if (rawValue && typeof rawValue === 'object') {
      const normalized = normalizeFraction(Number(rawValue.numerator), Number(rawValue.denominator));
      return {
        value: normalized,
        confidence: normalized ? 1 : 0.4
      };
    }

    const raw = normalizePrefix(String(rawValue === undefined || rawValue === null ? '' : rawValue));

    if (!raw) {
      return {
        value: null,
        confidence: 1,
        status: 'unanswered'
      };
    }

    const match = raw.match(/(-?\d+)\s*\/\s*(-?\d+)/);

    if (!match) {
      return {
        value: null,
        confidence: 0.4
      };
    }

    const normalized = normalizeFraction(Number(match[1]), Number(match[2]));
    return {
      value: normalized,
      confidence: normalized ? 1 : 0.4
    };
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function parseObjectAnswer(rawValue, fields = []) {
    const rawObject = rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue) ? rawValue : null;
    const raw = normalizePrefix(String(rawValue === undefined || rawValue === null ? '' : rawValue))
      .replace(/，/g, ',')
      .replace(/：/g, ':')
      .replace(/；/g, ';');
    const value = {};
    let matched = 0;

    for (const field of fields) {
      const fieldName = normalizePrefix(field && field.name);
      if (!fieldName) {
        continue;
      }

      if (rawObject && Object.prototype.hasOwnProperty.call(rawObject, fieldName)) {
        const parsed = parseNumber(rawObject[fieldName]);
        if (parsed.value !== null) {
          value[fieldName] = parsed.value;
          matched += 1;
        }
        continue;
      }

      const pattern = new RegExp(`${escapeRegExp(fieldName)}[^0-9\\-]*(-?\\d+(?:\\.\\d+)?)`);
      const match = raw.match(pattern);

      if (match) {
        value[fieldName] = Number(match[1]);
        matched += 1;
      }
    }

    if (!raw && !matched) {
      return {
        value,
        confidence: 1,
        status: 'unanswered'
      };
    }

    return {
      value,
      confidence: fields.length && matched === fields.length ? 1 : 0.6
    };
  }

  function parseListAnswer(rawValue) {
    if (Array.isArray(rawValue)) {
      const values = rawValue
        .map((item) => parseNumber(item).value)
        .filter((item) => item !== null)
        .sort((left, right) => left - right);

      return {
        value: values,
        confidence: values.length === rawValue.length ? 1 : 0.6
      };
    }

    const raw = normalizePrefix(String(rawValue === undefined || rawValue === null ? '' : rawValue));

    if (!raw) {
      return {
        value: [],
        confidence: 1,
        status: 'unanswered'
      };
    }

    const matches = raw.match(/-?\d+(?:\.\d+)?/g) || [];

    return {
      value: matches.map((item) => Number(item)).sort((left, right) => left - right),
      confidence: matches.length ? 0.95 : 0.4
    };
  }

  function answerSchemaType(contentItem) {
    const schemaType = normalizePrefix(contentItem && contentItem.answerSchema && contentItem.answerSchema.type);

    if (schemaType) {
      return schemaType;
    }

    const contentType = normalizePrefix(contentItem && contentItem.contentType);

    if (contentType.includes('object')) {
      return 'object';
    }

    if (contentType.includes('fraction')) {
      return 'fraction';
    }

    if (contentType.includes('list')) {
      return 'list';
    }

    return 'number';
  }

  function normalizeAnswer(contentItem, rawAnswer) {
    const schema = contentItem && contentItem.answerSchema && typeof contentItem.answerSchema === 'object'
      ? contentItem.answerSchema
      : {};
    const type = answerSchemaType(contentItem);

    switch (type) {
      case 'object':
        return parseObjectAnswer(rawAnswer, Array.isArray(schema.fields) ? schema.fields : []);
      case 'fraction':
        return parseFraction(rawAnswer);
      case 'list':
        return parseListAnswer(rawAnswer);
      case 'number':
      default:
        return parseNumber(rawAnswer);
    }
  }

  function answersEqual(type, left, right) {
    if (left === null || right === null) {
      return false;
    }

    if (type === 'object') {
      const leftKeys = Object.keys(left).sort();
      const rightKeys = Object.keys(right).sort();

      if (leftKeys.length !== rightKeys.length || leftKeys.some((key, index) => key !== rightKeys[index])) {
        return false;
      }

      return leftKeys.every((key) => Number(left[key]) === Number(right[key]));
    }

    if (type === 'fraction') {
      return Boolean(left && right && left.numerator === right.numerator && left.denominator === right.denominator);
    }

    if (type === 'list') {
      if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
        return false;
      }

      return left.every((item, index) => Number(item) === Number(right[index]));
    }

    return Number(left) === Number(right);
  }

  function rawAttemptAnswer(attempt = {}) {
    const response = attempt.response && typeof attempt.response === 'object' ? attempt.response : {};
    return Object.prototype.hasOwnProperty.call(response, 'raw') ? response.raw : attempt.raw;
  }

  function evaluate({ contentItem, attempt = {} }) {
    if (!contentItem || typeof contentItem !== 'object') {
      throw new Error('final-answer-grader requires contentItem.');
    }

    const schemaType = answerSchemaType(contentItem);
    const rawAnswer = rawAttemptAnswer(attempt);
    const normalizedStudent = normalizeAnswer(contentItem, rawAnswer);
    const normalizedStandard = normalizeAnswer(contentItem, contentItem.standardAnswer);
    const isUnanswered = normalizedStudent.status === 'unanswered';
    const isCorrect = !isUnanswered && answersEqual(schemaType, normalizedStudent.value, normalizedStandard.value);
    const maxScore = 10;

    return {
      id: stableEvaluationId(contentItem.id, attempt.id),
      attemptId: normalizePrefix(attempt.id),
      contentItemId: contentItem.id,
      skillNodeIds: Array.isArray(contentItem.skillNodeIds) ? contentItem.skillNodeIds : [],
      type: 'programmatic_final_answer',
      source: 'program',
      verdict: {
        isCorrect,
        status: isUnanswered ? 'unanswered' : isCorrect ? 'correct' : 'wrong',
        score: isCorrect ? maxScore : 0,
        maxScore,
        confidence: clampConfidence(Math.min(normalizedStudent.confidence, normalizedStandard.confidence)),
        normalizedAnswer: normalizedStudent.value,
        standardAnswer: normalizedStandard.value
      },
      metadata: {
        grader: 'final-answer-grader',
        schemaType
      }
    };
  }

  return {
    evaluate,
    normalizeAnswer
  };
}

module.exports = {
  createFinalAnswerGrader
};
