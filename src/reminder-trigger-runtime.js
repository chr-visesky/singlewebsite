'use strict';

function normalizeLeadMinutes(leadMinutes = []) {
  return [...new Set(
    (Array.isArray(leadMinutes) ? leadMinutes : [])
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value >= 0)
  )].sort((left, right) => right - left);
}

function minutesUntilSchedule(now, scheduleStartTime) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    return null;
  }

  if (!(scheduleStartTime instanceof Date) || Number.isNaN(scheduleStartTime.getTime())) {
    return null;
  }

  return Math.ceil((scheduleStartTime.getTime() - now.getTime()) / 60000);
}

function selectReminderTrigger(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now);
  const scheduleStartTime =
    options.scheduleStartTime instanceof Date
      ? options.scheduleStartTime
      : new Date(options.scheduleStartTime);
  const graceMs = Number.isFinite(Number(options.graceMs)) ? Math.max(0, Number(options.graceMs)) : 0;
  const reminderMarks =
    options.reminderMarks && typeof options.reminderMarks === 'object' ? options.reminderMarks : {};
  const leadMinutes = normalizeLeadMinutes(options.leadMinutes);

  if (
    !(now instanceof Date)
    || Number.isNaN(now.getTime())
    || !(scheduleStartTime instanceof Date)
    || Number.isNaN(scheduleStartTime.getTime())
  ) {
    return null;
  }

  const remainingMinutes = minutesUntilSchedule(now, scheduleStartTime);

  if (!Number.isFinite(remainingMinutes) || remainingMinutes <= 0) {
    return null;
  }

  for (const configuredLeadMinute of leadMinutes) {
    const reminderKey = String(configuredLeadMinute);

    if (reminderMarks[reminderKey]) {
      continue;
    }

    const reminderTime = new Date(scheduleStartTime.getTime() - configuredLeadMinute * 60 * 1000);
    const deltaMs = now.getTime() - reminderTime.getTime();

    if (deltaMs < 0) {
      continue;
    }

    if (deltaMs < graceMs) {
      return {
        configuredLeadMinute,
        spokenLeadMinute: configuredLeadMinute,
        reminderTime,
        mode: 'due'
      };
    }

    if (remainingMinutes < configuredLeadMinute) {
      return {
        configuredLeadMinute,
        spokenLeadMinute: remainingMinutes,
        reminderTime,
        mode: 'catchup'
      };
    }
  }

  return null;
}

module.exports = {
  minutesUntilSchedule,
  normalizeLeadMinutes,
  selectReminderTrigger
};
