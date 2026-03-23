'use strict';

function createReminderPollingRuntime(dependencies = {}) {
  const {
    Notification,
    logDebug,
    getMainWindow,
    focusMainWindow,
    getAppConfig,
    formatLocalDateKey,
    getTodaySchedules,
    getScheduleMark,
    normalizeReminderMarks,
    upsertScheduleMark,
    reminderRuntime,
    selectReminderTrigger,
    defaultLeadMinutes,
    triggerGraceMs,
    checkAlignmentFuzzMs
  } = dependencies;

  let reminderPollTimer = null;
  let reminderFlashTimer = null;
  let reminderCheckInFlight = false;

  const logReminderDebug = (eventName, payload = {}) => {
    if (typeof logDebug === 'function') {
      logDebug(eventName, payload);
    }
  };

  const currentWindow = () => (typeof getMainWindow === 'function' ? getMainWindow() : null);
  const currentConfig = () => (typeof getAppConfig === 'function' ? getAppConfig() : null);

  function showReminderNotification(payload) {
    if (!Notification || (typeof Notification.isSupported === 'function' && !Notification.isSupported())) {
      logReminderDebug('notification-unsupported');
      return false;
    }

    try {
      const notification = new Notification({
        title: payload && payload.title ? payload.title : '学习提醒',
        body: payload && payload.message ? payload.message : '到学习时间了。',
        silent: false
      });

      notification.on('click', () => {
        if (typeof focusMainWindow === 'function') {
          focusMainWindow();
        }
      });
      notification.show();
      logReminderDebug('notification-shown', {
        title: payload && payload.title ? payload.title : '',
        message: payload && payload.message ? payload.message : ''
      });
      return true;
    } catch {
      logReminderDebug('notification-failed');
      return false;
    }
  }

  function createBaseReminderPayload(schedule, trigger) {
    const configuredLeadMinutes = Number(trigger && trigger.configuredLeadMinute);
    const spokenLeadMinutes = Number(trigger && trigger.spokenLeadMinute);
    const effectiveLeadMinutes = Number.isFinite(spokenLeadMinutes) ? spokenLeadMinutes : configuredLeadMinutes;
    const offsetLabel = effectiveLeadMinutes > 0 ? `还剩${effectiveLeadMinutes}分钟` : '到点提醒';
    const speechText = reminderRuntime.buildReminderSpeechText(schedule, effectiveLeadMinutes);
    return {
      id: schedule.id,
      time: `${offsetLabel} · ${schedule.time}`,
      title: schedule.title,
      message: speechText,
      speechText,
      leadMinutes: configuredLeadMinutes,
      spokenLeadMinutes: effectiveLeadMinutes,
      reminderMode: trigger && trigger.mode ? trigger.mode : 'due',
      audioPath: ''
    };
  }

  async function pushReminderToWindow(schedule, trigger) {
    const configuredLeadMinutes = Number(trigger && trigger.configuredLeadMinute);
    const spokenLeadMinutes = Number(trigger && trigger.spokenLeadMinute);
    const effectiveLeadMinutes = Number.isFinite(spokenLeadMinutes) ? spokenLeadMinutes : configuredLeadMinutes;
    const payload = createBaseReminderPayload(schedule, trigger);
    logReminderDebug('reminder-dispatch-start', {
      scheduleId: schedule.id,
      title: schedule.title,
      leadMinutes: configuredLeadMinutes,
      spokenLeadMinutes: effectiveLeadMinutes,
      reminderMode: trigger && trigger.mode ? trigger.mode : 'due',
      time: schedule.time
    });

    const notificationShown = showReminderNotification(payload);
    const popupShown = false;
    let rendererShown = false;
    const mainWindow = currentWindow();

    if (!mainWindow || mainWindow.isDestroyed()) {
      logReminderDebug('reminder-main-window-missing', {
        scheduleId: schedule.id
      });
    } else {
      if (reminderFlashTimer) {
        clearTimeout(reminderFlashTimer);
        reminderFlashTimer = null;
      }

      try {
        mainWindow.flashFrame(true);
        mainWindow.webContents.send('shell:study-reminder', payload);
        rendererShown = true;
      } catch (error) {
        logReminderDebug('renderer-reminder-failed', {
          scheduleId: schedule.id,
          message: error && error.message ? error.message : 'unknown'
        });
      }

      reminderFlashTimer = setTimeout(() => {
        const nextMainWindow = currentWindow();

        if (nextMainWindow && !nextMainWindow.isDestroyed()) {
          nextMainWindow.flashFrame(false);
        }

        reminderFlashTimer = null;
      }, 8000);
    }

    let audioSequence = [];

    try {
      audioSequence = await reminderRuntime.buildReminderAudioSequence(schedule, effectiveLeadMinutes);
    } catch (error) {
      logReminderDebug('audio-sequence-build-uncaught', {
        scheduleId: schedule.id,
        message: error && error.message ? error.message : 'unknown'
      });
      audioSequence = [];
    }

    if (audioSequence.length) {
      reminderRuntime.playReminderSequenceNative(audioSequence);
    } else {
      logReminderDebug('audio-sequence-empty-fallback', {
        scheduleId: schedule.id,
        title: schedule.title
      });
      reminderRuntime.playReminderAlarmFallback();
    }

    logReminderDebug('reminder-dispatch-complete', {
      scheduleId: schedule.id,
      title: schedule.title,
      leadMinutes: configuredLeadMinutes,
      spokenLeadMinutes: effectiveLeadMinutes,
      reminderMode: trigger && trigger.mode ? trigger.mode : 'due',
      time: schedule.time,
      notificationShown,
      popupShown,
      rendererShown,
      audioPath: payload.audioPath,
      audioSequenceCount: audioSequence.length
    });

    return notificationShown || popupShown || rendererShown;
  }

  async function checkStudyReminders() {
    const config = currentConfig();

    if (!config || !Array.isArray(config.studySchedule) || !config.studySchedule.length) {
      logReminderDebug('check-skip-empty-schedule');
      return;
    }

    if (reminderCheckInFlight) {
      logReminderDebug('check-skip-inflight');
      return;
    }

    reminderCheckInFlight = true;

    try {
      const now = new Date();
      const todayKey = formatLocalDateKey(now);
      const leadMinutes = Array.isArray(config.reminders && config.reminders.leadMinutes)
        ? config.reminders.leadMinutes
        : defaultLeadMinutes;
      const todaySchedules = typeof getTodaySchedules === 'function' ? getTodaySchedules(now) : [];

      logReminderDebug('check-start', {
        now: now.toISOString(),
        todayKey,
        scheduleCount: todaySchedules.length,
        leadMinutes
      });

      for (const schedule of todaySchedules) {
        if (!schedule.enabled) {
          continue;
        }

        const mark = typeof getScheduleMark === 'function' ? getScheduleMark(schedule.id, todayKey) : null;

        if (mark && mark.completedAt) {
          continue;
        }

        const scheduleStartTime = reminderRuntime.scheduleStartDateTimeForDate(schedule, now);

        if (!scheduleStartTime) {
          continue;
        }

        const reminderMarks = typeof normalizeReminderMarks === 'function' ? normalizeReminderMarks(mark) : {};

        const trigger =
          typeof selectReminderTrigger === 'function'
            ? selectReminderTrigger({
                now,
                scheduleStartTime,
                leadMinutes,
                reminderMarks,
                graceMs: triggerGraceMs
              })
            : null;

        if (!trigger) {
          continue;
        }

        const reminderKey = String(trigger.configuredLeadMinute);

        logReminderDebug('check-due', {
          scheduleId: schedule.id,
          title: schedule.title,
          leadMinute: trigger.configuredLeadMinute,
          spokenLeadMinutes: trigger.spokenLeadMinute,
          reminderMode: trigger.mode,
          scheduleTime: schedule.time,
          reminderTime: trigger.reminderTime.toISOString(),
          now: now.toISOString()
        });

        const delivered = await pushReminderToWindow(schedule, trigger);

        if (!delivered) {
          logReminderDebug('check-delivery-failed', {
            scheduleId: schedule.id,
            title: schedule.title,
            leadMinute: trigger.configuredLeadMinute,
            spokenLeadMinutes: trigger.spokenLeadMinute,
            reminderMode: trigger.mode,
            scheduleTime: schedule.time
          });
          continue;
        }

        if (typeof upsertScheduleMark === 'function') {
          upsertScheduleMark(
            schedule,
            {
              remindedAt: now.toISOString(),
              reminderMarks: {
                ...reminderMarks,
                [reminderKey]: now.toISOString()
              }
            },
            now
          );
        }

        return;
      }

      logReminderDebug('check-no-trigger', {
        now: now.toISOString(),
        todayKey
      });
    } catch (error) {
      logReminderDebug('check-error', {
        message: error && error.message ? error.message : 'unknown',
        stack: error && error.stack ? error.stack : ''
      });
    } finally {
      reminderCheckInFlight = false;
    }
  }

  function start() {
    if (reminderPollTimer) {
      return;
    }

    void checkStudyReminders();

    const scheduleNextRun = () => {
      const delayMs = Math.max(250, 60000 - (Date.now() % 60000) + checkAlignmentFuzzMs);
      reminderPollTimer = setTimeout(async () => {
        reminderPollTimer = null;

        try {
          await checkStudyReminders();
        } finally {
          scheduleNextRun();
        }
      }, delayMs);
    };

    scheduleNextRun();
  }

  function stop() {
    if (reminderPollTimer) {
      clearTimeout(reminderPollTimer);
      reminderPollTimer = null;
    }

    reminderRuntime.stop();

    if (reminderFlashTimer) {
      clearTimeout(reminderFlashTimer);
      reminderFlashTimer = null;
    }

    const mainWindow = currentWindow();

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.flashFrame(false);
    }
  }

  return {
    start,
    stop
  };
}

module.exports = {
  createReminderPollingRuntime
};
