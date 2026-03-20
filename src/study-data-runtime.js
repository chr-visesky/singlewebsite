'use strict';

function createStudyDataRuntime(dependencies = {}) {
  const {
    createEmptyRemoteScheduleStatus,
    createEmptyStudentDeviceAccessStatus,
    fetchJson,
    getAppConfig,
    getClassroomDefinitions,
    getLearningToolDefinitions,
    getLibraryDefinitions,
    fs,
    mergeStudySchedules,
    normalizeControlSettings,
    normalizeDateList,
    normalizePrefix,
    normalizeStudyData,
    normalizeStudySchedule,
    normalizeTitle,
    serializeLearningTools,
    serializeLibraries,
    serializeOnlineClassrooms,
    studentDeviceCredentialPayload,
    reminderAudioPrewarm,
    rebuildLibraryIndex,
    runtimePaths
  } = dependencies;

  let remoteSchedulePollTimer = null;
  let remoteScheduleStatus = createEmptyRemoteScheduleStatus();
  let studentDeviceAccessStatus = createEmptyStudentDeviceAccessStatus();
  let remoteScheduleSyncSerial = 0;
  let studyDataMutationSerial = 0;

  function currentConfig() {
    return getAppConfig();
  }

  function serializeStudySchedule(schedule = currentConfig().studySchedule) {
    return schedule.map((item) => ({
      id: item.id,
      enabled: item.enabled,
      mode: item.mode === 'date' || item.specificDate ? 'date' : 'weekly',
      title: item.title,
      target: item.targetId,
      time: item.time,
      weekdays: item.weekdays,
      specificDate: item.specificDate || '',
      exceptionDates: normalizeDateList(item.exceptionDates || []),
      message: item.message
    }));
  }

  function serializeStudyData(state = {}) {
    const appConfig = currentConfig();
    const parentItems = Array.isArray(state.parentItems) ? state.parentItems : appConfig.parentStudySchedule;
    const studentItems = Array.isArray(state.studentItems) ? state.studentItems : appConfig.studentStudySchedule;
    const onlineClassrooms = Array.isArray(state.onlineClassrooms) ? state.onlineClassrooms : appConfig.classrooms;
    const contentLibraries = Array.isArray(state.contentLibraries) ? state.contentLibraries : appConfig.libraries;
    const learningTools = Array.isArray(state.learningTools) ? state.learningTools : appConfig.learningTools;
    const controlSettings = normalizeControlSettings(state.controlSettings || appConfig.controlSettings);

    return {
      parentItems: serializeStudySchedule(parentItems),
      studentItems: serializeStudySchedule(studentItems),
      onlineClassrooms: serializeOnlineClassrooms(onlineClassrooms),
      contentLibraries: serializeLibraries(contentLibraries),
      learningTools: serializeLearningTools(learningTools),
      controlSettings,
      items: serializeStudySchedule(mergeStudySchedules(parentItems, studentItems))
    };
  }

  function currentStudyData() {
    const appConfig = currentConfig();
    return {
      parentItems: appConfig.parentStudySchedule || [],
      studentItems: appConfig.studentStudySchedule || [],
      onlineClassrooms: appConfig.classrooms || [],
      contentLibraries: appConfig.libraries || [],
      learningTools: appConfig.learningTools || [],
      controlSettings: normalizeControlSettings(appConfig.controlSettings)
    };
  }

  function bumpStudyDataMutation() {
    studyDataMutationSerial += 1;
    return studyDataMutationSerial;
  }

  function applyStudyData(state, source = 'local') {
    const appConfig = currentConfig();
    const normalized = normalizeStudyData(
      state,
      appConfig.baseClassrooms || appConfig.classrooms,
      appConfig.baseLibraries || appConfig.libraries,
      appConfig.baseLearningTools || appConfig.learningTools,
      {
        defaultStartUrl: appConfig.startUrl,
        fallbackControlSettings: appConfig.controlSettings
      }
    );
    appConfig.classrooms = normalized.onlineClassrooms;
    appConfig.startUrl = normalized.onlineClassrooms[0] ? normalized.onlineClassrooms[0].entryUrl : appConfig.startUrl;
    appConfig.libraries = normalized.contentLibraries;
    appConfig.learningTools = normalized.learningTools;
    rebuildLibraryIndex();
    appConfig.parentStudySchedule = normalized.parentItems;
    appConfig.studentStudySchedule = normalized.studentItems;
    appConfig.studySchedule = mergeStudySchedules(normalized.parentItems, normalized.studentItems);
    appConfig.controlSettings = normalized.controlSettings;

    if (source === 'remote') {
      remoteScheduleStatus.source = 'remote';
    }

    reminderAudioPrewarm();
  }

  function loadPersistedStudySchedule() {
    const filePath = runtimePaths.studySchedulePath();

    if (!fs.existsSync(filePath)) {
      return;
    }

    try {
      const rawState = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      applyStudyData(rawState, 'local');
    } catch {
      // Ignore broken persisted schedules and continue with config defaults.
    }
  }

  function saveStructuredStudyData(state, source = 'local') {
    if (source !== 'remote') {
      bumpStudyDataMutation();
    }

    applyStudyData(state, source);
    fs.writeFileSync(
      runtimePaths.studySchedulePath(),
      JSON.stringify(serializeStudyData(currentStudyData()), null, 2),
      'utf8'
    );
    return currentStudyData();
  }

  function loadRemoteScheduleCache() {
    const appConfig = currentConfig();

    if (!appConfig.remoteSchedule.enabled) {
      return;
    }

    const filePath = runtimePaths.remoteScheduleCachePath();

    if (!fs.existsSync(filePath)) {
      return;
    }

    try {
      const rawState = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const normalizedState = normalizeStudyData(
        rawState,
        appConfig.baseClassrooms || getClassroomDefinitions(),
        appConfig.baseLibraries || getLibraryDefinitions(),
        appConfig.baseLearningTools || getLearningToolDefinitions(),
        {
          defaultStartUrl: appConfig.startUrl,
          fallbackControlSettings: appConfig.controlSettings
        }
      );
      applyStudyData(normalizedState, 'remote');
      remoteScheduleStatus = {
        ...remoteScheduleStatus,
        enabled: true,
        source: 'remote-cache',
        message: '当前使用上一次成功同步到本机的服务器课表。'
      };
    } catch {
      // Ignore broken cache files.
    }
  }

  function saveRemoteScheduleCache(schedule) {
    const appConfig = currentConfig();
    const payload =
      schedule && typeof schedule === 'object' && !Array.isArray(schedule)
        ? serializeStudyData(schedule)
        : serializeStudyData({
            parentItems: appConfig.parentStudySchedule,
            studentItems: Array.isArray(schedule) ? schedule : appConfig.studentStudySchedule,
            onlineClassrooms: appConfig.classrooms,
            contentLibraries: appConfig.libraries,
            learningTools: appConfig.learningTools
          });

    fs.writeFileSync(runtimePaths.remoteScheduleCachePath(), JSON.stringify(payload, null, 2), 'utf8');
  }

  function normalizeStudentDeviceAccessMode(value) {
    const normalized = normalizePrefix(value).toLowerCase();
    return ['local', 'approval', 'token', 'error'].includes(normalized) ? normalized : 'approval';
  }

  function normalizeStudentDeviceAccessStatus(rawStatus = {}) {
    const source = rawStatus && typeof rawStatus === 'object' ? rawStatus : {};
    const mode = normalizeStudentDeviceAccessMode(source.mode);
    const approved = Boolean(source.approved) || mode === 'local' || mode === 'token';
    return {
      mode,
      approved,
      status: approved ? 'approved' : 'pending',
      deviceId: normalizePrefix(source.deviceId),
      label: normalizePrefix(source.label),
      requestedAt: normalizePrefix(source.requestedAt),
      approvedAt: normalizePrefix(source.approvedAt),
      updatedAt: normalizePrefix(source.updatedAt),
      message:
        normalizePrefix(source.message) ||
        (approved
          ? '当前客户端已获准修改学生计划。'
          : '已自动提交学生计划写入申请，等待家长在手机端批准。')
    };
  }

  function canWriteStudentPlan(status = studentDeviceAccessStatus) {
    return Boolean(status && (status.approved || status.mode === 'local' || status.mode === 'token'));
  }

  async function syncStudentDeviceAccessStatus(options = {}) {
    const appConfig = currentConfig();

    if (!appConfig.remoteSchedule.enabled) {
      studentDeviceAccessStatus = createEmptyStudentDeviceAccessStatus();
      return studentDeviceAccessStatus;
    }

    const statusToken = appConfig.remoteSchedule.studentWriteToken || appConfig.remoteSchedule.authToken;

    if (!statusToken) {
      studentDeviceAccessStatus = normalizeStudentDeviceAccessStatus({
        mode: 'error',
        approved: false,
        message: '云端学生计划未配置可用的访问令牌。'
      });

      if (options.throwOnError) {
        throw new Error(studentDeviceAccessStatus.message);
      }

      return studentDeviceAccessStatus;
    }

    try {
      const payload = await fetchJson(appConfig.remoteSchedule.url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${statusToken}`
        },
        body: JSON.stringify({
          action: 'getStudentDeviceAccessStatus',
          ...studentDeviceCredentialPayload()
        })
      });

      if (!payload || payload.error) {
        const errorCode = normalizePrefix(payload && payload.error);
        throw new Error(
          errorCode === 'missing_device_credential'
            ? '当前客户端缺少身份凭据，请稍后重试。'
            : errorCode
              ? `学生计划授权状态同步失败：${errorCode}`
              : '学生计划授权状态同步失败。'
        );
      }

      studentDeviceAccessStatus = normalizeStudentDeviceAccessStatus(payload);
      return studentDeviceAccessStatus;
    } catch (error) {
      studentDeviceAccessStatus = normalizeStudentDeviceAccessStatus({
        mode: 'error',
        approved: false,
        message: error && error.message ? error.message : '学生计划授权状态同步失败。'
      });

      if (options.throwOnError) {
        throw new Error(studentDeviceAccessStatus.message);
      }

      return studentDeviceAccessStatus;
    }
  }

  function saveStudySchedule(rawSchedule) {
    const appConfig = currentConfig();
    const normalizedParentItems = normalizeStudySchedule(rawSchedule, getClassroomDefinitions(), getLibraryDefinitions(), {
      planScope: 'parent',
      learningTools: getLearningToolDefinitions()
    });
    const savedState = saveStructuredStudyData(
      {
        parentItems: normalizedParentItems,
        studentItems: appConfig.studentStudySchedule,
        onlineClassrooms: appConfig.classrooms,
        contentLibraries: appConfig.libraries,
        learningTools: appConfig.learningTools
      },
      'local'
    );

    return savedState.parentItems;
  }

  async function syncRemoteStudySchedule() {
    const appConfig = currentConfig();

    if (!appConfig.remoteSchedule.enabled) {
      remoteScheduleStatus = createEmptyRemoteScheduleStatus();
      studentDeviceAccessStatus = createEmptyStudentDeviceAccessStatus();
      return false;
    }

    const syncSerial = ++remoteScheduleSyncSerial;
    const mutationSerialAtStart = studyDataMutationSerial;

    const headers = {
      Accept: 'application/json'
    };

    if (appConfig.remoteSchedule.authToken) {
      headers.Authorization = `Bearer ${appConfig.remoteSchedule.authToken}`;
    }

    const lastAttemptAt = new Date().toISOString();
    remoteScheduleStatus = {
      ...remoteScheduleStatus,
      enabled: true,
      lastAttemptAt,
      message: '正在从服务器同步课表。'
    };

    try {
      const fetchRemotePayload = async (options = {}) => {
        const abortController = new AbortController();
        const timeoutId = setTimeout(() => {
          abortController.abort();
        }, 8000);
        try {
          return await fetchJson(appConfig.remoteSchedule.url, {
            ...options,
            signal: abortController.signal
          });
        } finally {
          clearTimeout(timeoutId);
        }
      };
      let payload;

      payload = await fetchRemotePayload({
        headers
      });
      if (!Array.isArray(payload) && (!payload || typeof payload !== 'object')) {
        throw new Error('服务器返回的课表格式不对。');
      }
      if (!Array.isArray(payload) && payload && typeof payload === 'object' && payload.error) {
        throw new Error(`服务器同步失败：${payload.error}`);
      }
      let controlSettings = normalizeControlSettings(appConfig.controlSettings);

      const controlSettingsToken = appConfig.remoteSchedule.authToken;

      if (controlSettingsToken) {
        const protectedPayload = await fetchRemotePayload({
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${controlSettingsToken}`
          },
          body: JSON.stringify({
            action: 'getControlSettings'
          })
        });

        if (!protectedPayload || protectedPayload.error) {
          throw new Error(
            protectedPayload && protectedPayload.error
              ? `服务器控制设置同步失败：${protectedPayload.error}`
              : '服务器控制设置同步失败。'
          );
        }

        const syncedControlSettings = normalizeControlSettings(protectedPayload.controlSettings);

        if (syncedControlSettings.exitPasswordHash && syncedControlSettings.exitPasswordSalt) {
          controlSettings = syncedControlSettings;
        }
      }

      const normalizedState = normalizeStudyData(
        Array.isArray(payload)
          ? {
              items: payload,
              onlineClassrooms: appConfig.classrooms,
              contentLibraries: appConfig.libraries,
              learningTools: appConfig.learningTools,
              controlSettings
            }
          : {
              ...payload,
              controlSettings
            },
        appConfig.baseClassrooms || getClassroomDefinitions(),
        appConfig.baseLibraries || getLibraryDefinitions(),
        appConfig.baseLearningTools || getLearningToolDefinitions(),
        {
          defaultStartUrl: appConfig.startUrl,
          fallbackControlSettings: controlSettings
        }
      );

      if (syncSerial !== remoteScheduleSyncSerial || mutationSerialAtStart !== studyDataMutationSerial) {
        return false;
      }

      applyStudyData(normalizedState, 'remote');
      saveRemoteScheduleCache(normalizedState);
      void syncStudentDeviceAccessStatus();
      const mergedCount = normalizedState.parentItems.length + normalizedState.studentItems.length;
      remoteScheduleStatus = {
        enabled: true,
        source: 'remote',
        lastAttemptAt,
        lastSuccessAt: lastAttemptAt,
        message: mergedCount ? '服务器计划已经同步到本机。' : '服务器计划为空，已同步为空计划。'
      };
      return true;
    } catch (error) {
      if (syncSerial !== remoteScheduleSyncSerial) {
        return false;
      }

      remoteScheduleStatus = {
        ...remoteScheduleStatus,
        enabled: true,
        message: `服务器同步失败：${error.message || '未知错误'}`
      };
      return false;
    }
  }

  async function persistStudentStudySchedule(rawSchedule) {
    const appConfig = currentConfig();
    const normalizedStudentItems = normalizeStudySchedule(rawSchedule, getClassroomDefinitions(), getLibraryDefinitions(), {
      planScope: 'student',
      learningTools: getLearningToolDefinitions()
    });

    if (!appConfig.remoteSchedule.enabled) {
      saveStructuredStudyData(
        {
          parentItems: appConfig.parentStudySchedule,
          studentItems: normalizedStudentItems,
          onlineClassrooms: appConfig.classrooms,
          contentLibraries: appConfig.libraries,
          learningTools: appConfig.learningTools
        },
        'local'
      );

      return currentStudyData();
    }

    const mutationSerial = bumpStudyDataMutation();
    const writeToken = appConfig.remoteSchedule.studentWriteToken || appConfig.remoteSchedule.authToken;

    if (!writeToken) {
      throw new Error('云端学生计划未配置可用的访问令牌。');
    }

    const accessStatus = await syncStudentDeviceAccessStatus({
      throwOnError: false
    });

    if (!canWriteStudentPlan(accessStatus)) {
      throw new Error(accessStatus.message || '已自动提交学生计划写入申请，等待家长在手机端批准。');
    }

    const requestBody = {
      action: 'saveStudentItems',
      items: serializeStudySchedule(normalizedStudentItems)
    };

    if (!appConfig.remoteSchedule.studentWriteToken) {
      Object.assign(requestBody, studentDeviceCredentialPayload());
    }

    const payload = await fetchJson(appConfig.remoteSchedule.url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${writeToken}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!payload || payload.error) {
      if (payload && payload.error === 'device_not_approved') {
        const latestStatus = await syncStudentDeviceAccessStatus({
          throwOnError: false
        });
        throw new Error(latestStatus.message || '已自动提交学生计划写入申请，等待家长在手机端批准。');
      }

      throw new Error(payload && payload.error ? `学生计划保存失败：${payload.error}` : '学生计划保存失败。');
    }

    if (mutationSerial !== studyDataMutationSerial) {
      return currentStudyData();
    }

    const normalizedState = normalizeStudyData(
      payload,
      appConfig.baseClassrooms || getClassroomDefinitions(),
      appConfig.baseLibraries || getLibraryDefinitions(),
      appConfig.baseLearningTools || getLearningToolDefinitions(),
      {
        defaultStartUrl: appConfig.startUrl,
        fallbackControlSettings: appConfig.controlSettings
      }
    );
    applyStudyData(normalizedState, 'remote');
    saveRemoteScheduleCache(normalizedState);
    remoteScheduleStatus = {
      ...remoteScheduleStatus,
      enabled: true,
      source: 'remote',
      lastSuccessAt: new Date().toISOString(),
      message: '学生计划已经同步到服务器。'
    };
    studentDeviceAccessStatus = normalizeStudentDeviceAccessStatus({
      ...studentDeviceAccessStatus,
      mode: appConfig.remoteSchedule.studentWriteToken ? 'token' : studentDeviceAccessStatus.mode || 'approval',
      approved: true,
      message: appConfig.remoteSchedule.studentWriteToken
        ? '当前客户端已通过专用写入令牌授权。'
        : '当前客户端已获准修改学生计划。'
    });

    return currentStudyData();
  }

  function startRemoteSchedulePolling() {
    const appConfig = currentConfig();

    if (!appConfig.remoteSchedule.enabled || remoteSchedulePollTimer) {
      return;
    }

    const intervalMs = appConfig.remoteSchedule.refreshMinutes * 60 * 1000;
    remoteSchedulePollTimer = setInterval(() => {
      void syncRemoteStudySchedule();
    }, intervalMs);
  }

  function stopRemoteSchedulePolling() {
    if (remoteSchedulePollTimer) {
      clearInterval(remoteSchedulePollTimer);
      remoteSchedulePollTimer = null;
    }
  }

  return {
    loadPersistedStudySchedule,
    loadRemoteScheduleCache,
    persistStudentStudySchedule,
    saveStudySchedule,
    serializeStudySchedule,
    startRemoteSchedulePolling,
    stopRemoteSchedulePolling,
    syncStudentDeviceAccessStatus,
    syncRemoteStudySchedule
  };
}

module.exports = {
  createStudyDataRuntime
};
