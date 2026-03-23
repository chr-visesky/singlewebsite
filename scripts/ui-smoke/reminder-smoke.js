'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { createReminderRuntime } = require('../../src/reminder-runtime');
const { selectReminderTrigger } = require('../../src/reminder-trigger-runtime');

function normalizePrefix(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function clockTimeToMinutes(value) {
  const normalized = normalizePrefix(value);

  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(normalized)) {
    return null;
  }

  const [hours, minutes] = normalized.split(':').map((item) => Number(item));
  return hours * 60 + minutes;
}

async function runReminderSmoke({ rootDir, outputDir }) {
  const failedChecks = [];
  await fs.mkdir(outputDir, { recursive: true });

  const scheduleStartTime = new Date('2026-03-23T20:40:00+08:00');
  const dueTrigger = selectReminderTrigger({
    now: new Date('2026-03-23T20:35:30+08:00'),
    scheduleStartTime,
    leadMinutes: [5, 1],
    reminderMarks: {},
    graceMs: 2 * 60 * 1000
  });
  const catchupTrigger = selectReminderTrigger({
    now: new Date('2026-03-23T20:37:10+08:00'),
    scheduleStartTime,
    leadMinutes: [5, 1],
    reminderMarks: {},
    graceMs: 2 * 60 * 1000
  });
  const finalTrigger = selectReminderTrigger({
    now: new Date('2026-03-23T20:39:10+08:00'),
    scheduleStartTime,
    leadMinutes: [5, 1],
    reminderMarks: { 5: '2026-03-23T12:37:10.000Z' },
    graceMs: 2 * 60 * 1000
  });

  if (!dueTrigger || dueTrigger.configuredLeadMinute !== 5 || dueTrigger.spokenLeadMinute !== 5 || dueTrigger.mode !== 'due') {
    failedChecks.push('Reminder due selection should keep the configured 5-minute lead inside the grace window.');
  }

  if (!catchupTrigger || catchupTrigger.configuredLeadMinute !== 5 || catchupTrigger.spokenLeadMinute !== 3 || catchupTrigger.mode !== 'catchup') {
    failedChecks.push('Reminder catch-up selection should keep the 5-minute slot but speak the actual remaining 3 minutes.');
  }

  if (!finalTrigger || finalTrigger.configuredLeadMinute !== 1 || finalTrigger.spokenLeadMinute !== 1 || finalTrigger.mode !== 'due') {
    failedChecks.push('Reminder due selection should still emit the 1-minute reminder after the 5-minute reminder was already marked.');
  }

  const reminderRuntime = createReminderRuntime({
    app: {
      getAppPath: () => rootDir,
      getPath: () => outputDir
    },
    crypto,
    fs: require('node:fs'),
    os,
    path,
    shell: {
      beep() {}
    },
    spawn,
    normalizePrefix,
    clockTimeToMinutes,
    logDebug() {},
    getAppConfig: () => ({
      stateDir: outputDir,
      reminders: {
        leadMinutes: [5, 1]
      }
    }),
    processExecPath: process.execPath,
    processCwd: () => rootDir
  });

  const dynamicSequence = await reminderRuntime.buildReminderAudioSequence({
    id: 'agent-reminder-smoke',
    title: '口算打卡',
    time: '20:40'
  }, 3);

  if (!Array.isArray(dynamicSequence) || !dynamicSequence.length) {
    failedChecks.push('Dynamic reminder sequence should be generated for non-default remaining minutes.');
  }

  if (!dynamicSequence.some((part) => part && part.kind === 'file' && /lead-3-minutes\.wav$/i.test(String(part.path || '')))) {
    failedChecks.push('Dynamic reminder sequence should include a generated 3-minute speech segment.');
  }

  if (!dynamicSequence.some((part) => part && part.kind === 'file' && /distance\.wav$/i.test(String(part.path || '')))) {
    failedChecks.push('Dynamic reminder sequence should retain the fixed “距离” segment.');
  }

  if (!dynamicSequence.some((part) => part && part.kind === 'file' && /title-/i.test(String(part.path || '')))) {
    failedChecks.push('Dynamic reminder sequence should retain the generated plan-title speech segment.');
  }

  reminderRuntime.stop();

  return {
    passed: failedChecks.length === 0,
    failedChecks,
    dueTrigger,
    catchupTrigger,
    finalTrigger,
    dynamicSequencePartCount: dynamicSequence.length
  };
}

module.exports = {
  runReminderSmoke
};
