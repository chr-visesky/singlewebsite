'use strict';

function createReminderRuntime(dependencies = {}) {
  const {
    app,
    crypto,
    fs,
    os,
    path,
    shell,
    spawn,
    normalizePrefix,
    clockTimeToMinutes,
    logDebug,
    getAppConfig,
    processExecPath,
    processCwd
  } = dependencies;

  const PIPER_RUNTIME_RELATIVE_DIR = path.join('vendor', 'piper', 'runtime', 'piper');
  const PIPER_EXECUTABLE_NAME = 'piper.exe';
  const PIPER_MODEL_RELATIVE_PATH = path.join('vendor', 'piper', 'models', 'zh_CN-huayan-medium.onnx');
  const PIPER_MODEL_CONFIG_RELATIVE_PATH = `${PIPER_MODEL_RELATIVE_PATH}.json`;
  const REMINDER_AUDIO_CACHE_DIR = 'reminder-audio-cache';
  const REMINDER_REPEAT_PAUSE_MS = 450;
  const REMINDER_SEQUENCE_REPEAT_COUNT = 3;
  const REMINDER_AUDIO_TEMPLATE_VERSION = 'template-v3';
  const REMINDER_FIXED_TEXT_COMPONENTS = Object.freeze({
    distance: '距离',
    remain: '还剩',
    five_minutes: '5分钟',
    one_minutes: '1分钟'
  });
  const REMINDER_SILENCE_COMPONENTS_MS = Object.freeze({
    s120: 120,
    s180: 180,
    s220: 220
  });
  const REMINDER_FALLBACK_AUDIO_FORMAT = Object.freeze({
    channels: 1,
    sampleRate: 22050,
    bitsPerSample: 16,
    blockAlign: 2
  });

  let reminderAudioPrewarmTimer = null;
  let reminderAudioPrewarmInFlight = false;
  let reminderAudioPrewarmQueued = false;
  let reminderAudioProcess = null;
  let lastReminderPrewarmSignature = '';
  let pendingReminderPrewarmSignature = '';

  const logReminderDebug = (eventName, payload = {}) => {
    if (typeof logDebug === 'function') {
      logDebug(eventName, payload);
    }
  };

  const currentConfig = () => (typeof getAppConfig === 'function' ? getAppConfig() : null);

  function bundledPiperExecutablePath() {
    return path.join(app.getAppPath(), PIPER_RUNTIME_RELATIVE_DIR, PIPER_EXECUTABLE_NAME);
  }

  function bundledPiperModelPath() {
    return path.join(app.getAppPath(), PIPER_MODEL_RELATIVE_PATH);
  }

  function bundledPiperModelConfigPath() {
    return path.join(app.getAppPath(), PIPER_MODEL_CONFIG_RELATIVE_PATH);
  }

  function reminderAudioCacheDirPath() {
    const stateDir = currentConfig() && currentConfig().stateDir;
    return path.join(stateDir || app.getPath('userData'), REMINDER_AUDIO_CACHE_DIR);
  }

  function createReminderTitleComponentCacheKey(title) {
    return crypto
      .createHash('sha1')
      .update(`${REMINDER_AUDIO_TEMPLATE_VERSION}|title|${normalizePrefix(title)}`)
      .digest('hex');
  }

  function reminderAudioComponentDirPath() {
    return path.join(reminderAudioCacheDirPath(), 'components');
  }

  function reminderStaticAudioDirCandidates() {
    return [...new Set([
      path.join(path.dirname(processExecPath), 'videos'),
      path.join(app.getAppPath(), 'videos'),
      path.join(path.resolve(app.getAppPath(), '..'), 'videos'),
      path.join(path.resolve(app.getAppPath(), '..', '..'), 'videos'),
      path.join(processCwd(), 'videos')
    ])];
  }

  function resolveReminderStaticAudioPath(componentName) {
    const normalizedComponentName = normalizePrefix(componentName).toLowerCase();

    if (!normalizedComponentName) {
      return '';
    }

    for (const candidateDirectory of reminderStaticAudioDirCandidates()) {
      if (!candidateDirectory || !fs.existsSync(candidateDirectory)) {
        continue;
      }

      try {
        const fileEntries = fs.readdirSync(candidateDirectory, { withFileTypes: true }).filter((entry) => {
          if (!entry.isFile()) {
            return false;
          }

          const parsed = path.parse(entry.name);
          return ['.wav', '.mp3'].includes(parsed.ext.toLowerCase()) && parsed.name.trim().toLowerCase() === normalizedComponentName;
        });
        const sortedMatches = fileEntries.sort((left, right) => {
          const leftExt = path.extname(left.name).toLowerCase();
          const rightExt = path.extname(right.name).toLowerCase();

          if (leftExt === rightExt) {
            return left.name.localeCompare(right.name, 'en-US');
          }

          if (leftExt === '.wav') {
            return -1;
          }

          if (rightExt === '.wav') {
            return 1;
          }

          return left.name.localeCompare(right.name, 'en-US');
        });

        if (sortedMatches.length) {
          return path.join(candidateDirectory, sortedMatches[0].name);
        }
      } catch {
        // Ignore scan failures for optional static audio directories.
      }
    }

    return '';
  }

  function reminderTemplateForLeadMinutes(leadMinutes) {
    const numericLeadMinutes = Number(leadMinutes);

    if (!Number.isFinite(numericLeadMinutes) || numericLeadMinutes <= 0) {
      return null;
    }

    return [
      'alarm',
      's120',
      'alarm',
      's220',
      'distance',
      's180',
      'planName',
      's180',
      'remain',
      's120',
      reminderLeadComponentName(numericLeadMinutes)
    ];
  }

  function reminderLeadComponentName(leadMinutes) {
    const numericLeadMinutes = Number(leadMinutes);

    if (numericLeadMinutes === 5) {
      return 'five_minutes';
    }

    if (numericLeadMinutes === 1) {
      return 'one_minutes';
    }

    return `lead_${Math.max(1, Math.round(numericLeadMinutes))}_minutes`;
  }

  function pruneReminderAudioCache(cacheDirectory) {
    if (!fs.existsSync(cacheDirectory)) {
      return;
    }

    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;

    for (const entry of fs.readdirSync(cacheDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.wav') {
        continue;
      }

      const entryPath = path.join(cacheDirectory, entry.name);

      try {
        const stats = fs.statSync(entryPath);

        if (stats.mtimeMs < cutoff) {
          fs.unlinkSync(entryPath);
        }
      } catch {
        // Ignore cache pruning failures.
      }
    }
  }

  function runPiperToWave(text, outputPath) {
    return new Promise((resolve) => {
      const executablePath = bundledPiperExecutablePath();
      const modelPath = bundledPiperModelPath();
      const modelConfigPath = bundledPiperModelConfigPath();
      logReminderDebug('audio-segment-build-start', {
        text: normalizePrefix(text),
        outputPath
      });
      const child = spawn(
        executablePath,
        ['--model', modelPath, '--config', modelConfigPath, '--output_file', outputPath],
        {
          cwd: path.dirname(executablePath),
          windowsHide: true,
          stdio: ['pipe', 'ignore', 'pipe']
        }
      );

      let stderr = '';

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('error', () => {
        logReminderDebug('audio-segment-build-error', {
          text: normalizePrefix(text),
          outputPath
        });
        resolve(false);
      });

      child.on('close', (code) => {
        if (code === 0 && fs.existsSync(outputPath)) {
          logReminderDebug('audio-segment-build-complete', {
            text: normalizePrefix(text),
            outputPath
          });
          resolve(true);
          return;
        }

        try {
          if (fs.existsSync(outputPath)) {
            fs.unlinkSync(outputPath);
          }
        } catch {
          // Ignore partial file cleanup failures.
        }

        if (stderr.trim()) {
          process.stderr.write(`[Piper] ${stderr.trim()}${os.EOL}`);
        }

        logReminderDebug('audio-segment-build-failed', {
          text: normalizePrefix(text),
          outputPath,
          code,
          stderr: stderr.trim()
        });

        resolve(false);
      });

      child.stdin.end(normalizePrefix(text), 'utf8');
    });
  }

  function findWaveChunk(buffer, chunkId) {
    for (let offset = 12; offset + 8 <= buffer.length; ) {
      const currentChunkId = buffer.toString('ascii', offset, offset + 4);
      const chunkSize = buffer.readUInt32LE(offset + 4);
      const chunkDataOffset = offset + 8;

      if (currentChunkId === chunkId) {
        return {
          dataOffset: chunkDataOffset,
          size: chunkSize
        };
      }

      offset = chunkDataOffset + chunkSize + (chunkSize % 2);
    }

    return null;
  }

  function readPcmWaveFile(filePath) {
    const buffer = fs.readFileSync(filePath);

    if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
      throw new Error('不是有效的 WAV 文件。');
    }

    const fmtChunk = findWaveChunk(buffer, 'fmt ');
    const dataChunk = findWaveChunk(buffer, 'data');

    if (!fmtChunk || !dataChunk) {
      throw new Error('WAV 文件缺少 fmt 或 data 区块。');
    }

    const audioFormat = buffer.readUInt16LE(fmtChunk.dataOffset);
    const channels = buffer.readUInt16LE(fmtChunk.dataOffset + 2);
    const sampleRate = buffer.readUInt32LE(fmtChunk.dataOffset + 4);
    const blockAlign = buffer.readUInt16LE(fmtChunk.dataOffset + 12);
    const bitsPerSample = buffer.readUInt16LE(fmtChunk.dataOffset + 14);

    if (audioFormat !== 1) {
      throw new Error('仅支持 PCM WAV。');
    }

    return {
      channels,
      sampleRate,
      bitsPerSample,
      blockAlign,
      data: buffer.subarray(dataChunk.dataOffset, dataChunk.dataOffset + dataChunk.size)
    };
  }

  function buildPcmWaveBuffer(format, dataBuffer) {
    const header = Buffer.alloc(44);
    header.write('RIFF', 0, 4, 'ascii');
    header.writeUInt32LE(36 + dataBuffer.length, 4);
    header.write('WAVE', 8, 4, 'ascii');
    header.write('fmt ', 12, 4, 'ascii');
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(format.channels, 22);
    header.writeUInt32LE(format.sampleRate, 24);
    header.writeUInt32LE(format.sampleRate * format.blockAlign, 28);
    header.writeUInt16LE(format.blockAlign, 32);
    header.writeUInt16LE(format.bitsPerSample, 34);
    header.write('data', 36, 4, 'ascii');
    header.writeUInt32LE(dataBuffer.length, 40);
    return Buffer.concat([header, dataBuffer]);
  }

  function createSilenceDataBuffer(format, durationMs) {
    const frameCount = Math.max(1, Math.round((format.sampleRate * durationMs) / 1000));
    return Buffer.alloc(frameCount * format.blockAlign);
  }

  function createToneDataBuffer(format, frequency, durationMs, amplitude = 0.25) {
    const frameCount = Math.max(1, Math.round((format.sampleRate * durationMs) / 1000));
    const buffer = Buffer.alloc(frameCount * format.blockAlign);

    if (format.bitsPerSample !== 16) {
      return buffer;
    }

    const peak = Math.max(0, Math.min(0.9, amplitude)) * 32767;

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const t = frameIndex / format.sampleRate;
      const envelope = Math.sin(Math.PI * Math.min(1, frameIndex / Math.max(1, frameCount - 1)));
      const sampleValue = Math.round(Math.sin(2 * Math.PI * frequency * t) * peak * envelope);

      for (let channelIndex = 0; channelIndex < format.channels; channelIndex += 1) {
        buffer.writeInt16LE(sampleValue, (frameIndex * format.channels + channelIndex) * 2);
      }
    }

    return buffer;
  }

  function createReminderAlarmClipData(format) {
    return Buffer.concat([
      createToneDataBuffer(format, 1046.5, 150, 0.26),
      createSilenceDataBuffer(format, 30)
    ]);
  }

  function loadWaveFormat(filePath) {
    const wave = readPcmWaveFile(filePath);
    return {
      channels: wave.channels,
      sampleRate: wave.sampleRate,
      bitsPerSample: wave.bitsPerSample,
      blockAlign: wave.blockAlign
    };
  }

  function ensureGeneratedPcmWaveFile(filePath, format, buildDataBuffer) {
    if (fs.existsSync(filePath)) {
      return filePath;
    }

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const dataBuffer = buildDataBuffer();
    fs.writeFileSync(filePath, buildPcmWaveBuffer(format, dataBuffer));
    return filePath;
  }

  async function ensureReminderFixedTextComponentWave(componentName, cacheDirectory) {
    let text = REMINDER_FIXED_TEXT_COMPONENTS[componentName];
    let fileName = `${componentName}.wav`;

    if (!text) {
      const dynamicLeadMatch = /^lead_(\d+)_minutes$/.exec(normalizePrefix(componentName).toLowerCase());

      if (dynamicLeadMatch) {
        text = `${dynamicLeadMatch[1]}分钟`;
        fileName = `lead-${dynamicLeadMatch[1]}-minutes.wav`;
      }
    }

    if (!text) {
      return '';
    }

    const componentPath = path.join(cacheDirectory, fileName);

    if (!fs.existsSync(componentPath)) {
      const built = await runPiperToWave(text, componentPath);

      if (!built) {
        return '';
      }
    }

    return componentPath;
  }

  async function ensureReminderTitleComponentWave(title, cacheDirectory) {
    const normalizedTitle = normalizePrefix(title) || '学习计划';
    const componentPath = path.join(cacheDirectory, `title-${createReminderTitleComponentCacheKey(normalizedTitle)}.wav`);

    if (!fs.existsSync(componentPath)) {
      const built = await runPiperToWave(normalizedTitle, componentPath);

      if (!built) {
        return '';
      }
    }

    return componentPath;
  }

  function ensureReminderGeneratedComponentWaves(cacheDirectory, format) {
    const generatedPaths = {};

    generatedPaths.alarm = ensureGeneratedPcmWaveFile(
      path.join(cacheDirectory, 'alarm-generated.wav'),
      format,
      () => createReminderAlarmClipData(format)
    );

    for (const [componentName, durationMs] of Object.entries(REMINDER_SILENCE_COMPONENTS_MS)) {
      generatedPaths[componentName] = ensureGeneratedPcmWaveFile(
        path.join(cacheDirectory, `${componentName}.wav`),
        format,
        () => createSilenceDataBuffer(format, durationMs)
      );
    }

    return generatedPaths;
  }

  function collectReminderAudioPrewarmEntries() {
    const appConfig = currentConfig();

    if (!appConfig || !Array.isArray(appConfig.studySchedule) || !appConfig.studySchedule.length) {
      return [];
    }

    const leadMinutes = Array.isArray(appConfig.reminders && appConfig.reminders.leadMinutes)
      ? appConfig.reminders.leadMinutes
      : [5, 1];
    const seen = new Set();
    const entries = [];

    for (const schedule of appConfig.studySchedule) {
      if (!schedule || schedule.enabled === false) {
        continue;
      }

      const title = normalizePrefix(schedule.title);

      if (!title) {
        continue;
      }

      for (const leadMinute of leadMinutes) {
        const key = `${title}|${leadMinute}`;

        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        entries.push({
          title,
          leadMinute
        });
      }
    }

    return entries.sort((left, right) =>
      left.title.localeCompare(right.title, 'zh-CN') || left.leadMinute - right.leadMinute
    );
  }

  function reminderAudioPrewarmSignature(entries) {
    return JSON.stringify(
      (Array.isArray(entries) ? entries : []).map((entry) => ({
        title: entry.title,
        leadMinute: entry.leadMinute
      }))
    );
  }

  async function ensureReminderPlanTitleAudioPath(title) {
    const componentDirectory = reminderAudioComponentDirPath();
    fs.mkdirSync(componentDirectory, { recursive: true });
    return ensureReminderTitleComponentWave(title, componentDirectory);
  }

  async function prewarmReminderAudioCache() {
    if (reminderAudioPrewarmInFlight) {
      reminderAudioPrewarmQueued = true;
      return;
    }

    const entries = collectReminderAudioPrewarmEntries();
    const signature = reminderAudioPrewarmSignature(entries);

    if (!entries.length) {
      logReminderDebug('audio-prewarm-skip', {
        reason: 'empty_schedule'
      });
      lastReminderPrewarmSignature = '';
      pendingReminderPrewarmSignature = '';
      return;
    }

    if (signature && signature === lastReminderPrewarmSignature) {
      logReminderDebug('audio-prewarm-skip', {
        reason: 'unchanged_schedule',
        count: entries.length
      });
      return;
    }

    reminderAudioPrewarmInFlight = true;
    reminderAudioPrewarmQueued = false;
    pendingReminderPrewarmSignature = signature;

    try {
      logReminderDebug('audio-prewarm-start', {
        count: entries.length
      });

      for (const entry of entries) {
        const audioPath = await ensureReminderPlanTitleAudioPath(entry.title);
        logReminderDebug('audio-prewarm-entry', {
          title: entry.title,
          leadMinute: entry.leadMinute,
          audioPath
        });
      }

      logReminderDebug('audio-prewarm-complete', {
        count: entries.length
      });
      lastReminderPrewarmSignature = signature;
    } catch (error) {
      logReminderDebug('audio-prewarm-error', {
        message: error && error.message ? error.message : 'unknown'
      });
    } finally {
      reminderAudioPrewarmInFlight = false;
      pendingReminderPrewarmSignature = '';

      if (reminderAudioPrewarmQueued) {
        reminderAudioPrewarmQueued = false;
        scheduleReminderAudioPrewarm(200);
      }
    }
  }

  function scheduleReminderAudioPrewarm(delayMs = 400) {
    const signature = reminderAudioPrewarmSignature(collectReminderAudioPrewarmEntries());

    if (signature && (signature === lastReminderPrewarmSignature || signature === pendingReminderPrewarmSignature)) {
      return;
    }

    if (reminderAudioPrewarmTimer) {
      clearTimeout(reminderAudioPrewarmTimer);
    }

    pendingReminderPrewarmSignature = signature;
    reminderAudioPrewarmTimer = setTimeout(() => {
      reminderAudioPrewarmTimer = null;
      void prewarmReminderAudioCache();
    }, Math.max(0, Number(delayMs) || 0));
  }

  async function buildReminderAudioSequence(schedule, leadMinutes) {
    const sequence = reminderTemplateForLeadMinutes(leadMinutes);

    if (!sequence) {
      return [];
    }

    const title = normalizePrefix(schedule && schedule.title) || '学习计划';
    const titlePath = await ensureReminderPlanTitleAudioPath(title);
    const hasTitleAudio = Boolean(titlePath && fs.existsSync(titlePath));

    const componentDirectory = reminderAudioComponentDirPath();
    const titleFormat = hasTitleAudio ? loadWaveFormat(titlePath) : REMINDER_FALLBACK_AUDIO_FORMAT;
    const sequenceParts = [];
    let fallbackAlarmPath = '';

    if (!hasTitleAudio) {
      logReminderDebug('audio-sequence-title-missing', {
        title,
        leadMinutes,
        titlePath
      });
    }

    for (const componentName of sequence) {
      if (Object.prototype.hasOwnProperty.call(REMINDER_SILENCE_COMPONENTS_MS, componentName)) {
        sequenceParts.push({
          componentName,
          kind: 'pause',
          ms: REMINDER_SILENCE_COMPONENTS_MS[componentName]
        });
        continue;
      }

      if (componentName === 'planName') {
        if (!hasTitleAudio) {
          logReminderDebug('audio-sequence-component-skipped', {
            title,
            leadMinutes,
            componentName,
            reason: 'missing_title_audio'
          });
          continue;
        }

        sequenceParts.push({
          componentName,
          kind: 'file',
          path: titlePath,
          source: 'title'
        });
        continue;
      }

      const staticPath = resolveReminderStaticAudioPath(componentName);

      if (staticPath) {
        sequenceParts.push({
          componentName,
          kind: 'file',
          path: staticPath,
          source: 'videos'
        });
        continue;
      }

      if (componentName === 'alarm') {
        if (!fallbackAlarmPath) {
          fallbackAlarmPath = ensureGeneratedPcmWaveFile(
            path.join(componentDirectory, 'alarm-generated.wav'),
            titleFormat,
            () => createReminderAlarmClipData(titleFormat)
          );
        }

        sequenceParts.push({
          componentName,
          kind: 'file',
          path: fallbackAlarmPath,
          source: 'generated'
        });
        continue;
      }

      const fallbackSpeechPath = await ensureReminderFixedTextComponentWave(componentName, componentDirectory);

      if (fallbackSpeechPath) {
        sequenceParts.push({
          componentName,
          kind: 'file',
          path: fallbackSpeechPath,
          source: 'generated'
        });
        continue;
      }

      logReminderDebug('audio-sequence-component-missing', {
        title,
        leadMinutes,
        componentName
      });
      continue;
    }

    if (!sequenceParts.some((part) => part.kind === 'file' && part.componentName !== 'alarm')) {
      return [];
    }

    const spokenStartIndex = sequenceParts.findIndex((part) => part.componentName === 'distance');
    let finalParts = sequenceParts;

    if (spokenStartIndex >= 0 && REMINDER_SEQUENCE_REPEAT_COUNT > 1) {
      const preamble = sequenceParts.slice(0, spokenStartIndex).map((part) => ({ ...part }));
      const spoken = sequenceParts.slice(spokenStartIndex).map((part) => ({ ...part }));
      finalParts = [...preamble];

      for (let repeatIndex = 0; repeatIndex < REMINDER_SEQUENCE_REPEAT_COUNT; repeatIndex += 1) {
        finalParts.push(...spoken.map((part) => ({ ...part })));

        if (repeatIndex < REMINDER_SEQUENCE_REPEAT_COUNT - 1) {
          finalParts.push({
            componentName: 'repeatPause',
            kind: 'pause',
            ms: REMINDER_REPEAT_PAUSE_MS
          });
        }
      }
    }

    logReminderDebug('audio-sequence-built', {
      title,
      leadMinutes,
      repeatCount: REMINDER_SEQUENCE_REPEAT_COUNT,
      sequenceParts: finalParts.map((part) => (part.kind === 'pause' ? `pause:${part.ms}` : `${part.source}:${path.basename(part.path)}`))
    });
    return finalParts.map((part) =>
      part.kind === 'pause'
        ? {
            kind: 'pause',
            ms: part.ms
          }
        : {
            kind: 'file',
            path: part.path,
            source: part.source
          }
    );
  }

  function playReminderAlarmFallback() {
    for (const offsetMs of [0, 220, 480]) {
      setTimeout(() => {
        try {
          shell.beep();
          logReminderDebug('alarm-fallback-beep', {
            offsetMs
          });
        } catch {
          // Ignore system beep failures.
        }
      }, offsetMs);
    }
  }

  function stopReminderAudioProcess() {
    if (reminderAudioProcess && !reminderAudioProcess.killed) {
      try {
        reminderAudioProcess.kill();
      } catch {
        // Ignore player termination failures.
      }
    }

    reminderAudioProcess = null;
  }

  function playReminderSequenceNative(sequenceParts) {
    if (!Array.isArray(sequenceParts) || !sequenceParts.length) {
      logReminderDebug('audio-sequence-empty');
      playReminderAlarmFallback();
      return;
    }

    stopReminderAudioProcess();

    const encodedSequence = Buffer.from(JSON.stringify(sequenceParts), 'utf8').toString('base64');
    const command = [
      'Add-Type -AssemblyName PresentationCore',
      `$json = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${encodedSequence}'))`,
      '$sequence = $json | ConvertFrom-Json',
      'function Play-StudyGateMedia([string] $mediaPath) {',
      '  $player = New-Object System.Windows.Media.MediaPlayer',
      '  try {',
      '    $uri = New-Object System.Uri($mediaPath)',
      '    $player.Open($uri)',
      '    $player.Volume = 1.0',
      '    $player.Play()',
      '    $deadline = [DateTime]::UtcNow.AddSeconds(30)',
      '    while ([DateTime]::UtcNow -lt $deadline) {',
      '      Start-Sleep -Milliseconds 50',
      '      if ($player.NaturalDuration.HasTimeSpan) {',
      '        if ($player.Position -ge $player.NaturalDuration.TimeSpan -and $player.NaturalDuration.TimeSpan.TotalMilliseconds -gt 0) { break }',
      '      }',
      '    }',
      '  } finally {',
      '    $player.Stop()',
      '    $player.Close()',
      '  }',
      '}',
      'foreach ($item in $sequence) {',
      "  if ($item.kind -eq 'pause') { Start-Sleep -Milliseconds ([int]$item.ms); continue }",
      "  if ($item.kind -eq 'file' -and (Test-Path -LiteralPath $item.path)) { Play-StudyGateMedia $item.path }",
      '}'
    ].join('; ');
    const playerProcess = spawn(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', command],
      {
        windowsHide: true
      }
    );

    reminderAudioProcess = playerProcess;
    logReminderDebug('audio-sequence-play-start', {
      pid: playerProcess.pid,
      parts: sequenceParts.map((part) => (part.kind === 'pause' ? `pause:${part.ms}` : path.basename(part.path)))
    });
    playerProcess.stderr.on('data', (chunk) => {
      logReminderDebug('audio-sequence-play-stderr', {
        message: String(chunk || '').trim()
      });
    });
    playerProcess.on('exit', () => {
      logReminderDebug('audio-sequence-play-exit');
      if (reminderAudioProcess === playerProcess) {
        reminderAudioProcess = null;
      }
    });
    playerProcess.on('error', (error) => {
      if (reminderAudioProcess === playerProcess) {
        reminderAudioProcess = null;
      }
      logReminderDebug('audio-sequence-play-error', {
        message: error && error.message ? error.message : 'unknown'
      });
      playReminderAlarmFallback();
    });
  }

  function scheduleStartDateTimeForDate(schedule, date = new Date()) {
    const minutes = clockTimeToMinutes(schedule && schedule.time);

    if (minutes === null) {
      return null;
    }

    return new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      Math.floor(minutes / 60),
      minutes % 60,
      0,
      0
    );
  }

  function reminderIsDue(now, targetTime, graceMs = 2 * 60 * 1000) {
    if (!(targetTime instanceof Date) || Number.isNaN(targetTime.getTime())) {
      return false;
    }

    const deltaMs = now.getTime() - targetTime.getTime();
    return deltaMs >= 0 && deltaMs < graceMs;
  }

  function buildReminderSpeechText(schedule, leadMinutes) {
    const title = normalizePrefix(schedule && schedule.title) || '学习计划';

    if (leadMinutes > 0) {
      return `距离，${title}，还剩，${leadMinutes}分钟。`;
    }

    return `${title}，现在开始。`;
  }

  function stop() {
    if (reminderAudioPrewarmTimer) {
      clearTimeout(reminderAudioPrewarmTimer);
      reminderAudioPrewarmTimer = null;
    }

    stopReminderAudioProcess();
  }

  return {
    buildReminderAudioSequence,
    buildReminderSpeechText,
    playReminderAlarmFallback,
    playReminderSequenceNative,
    reminderIsDue,
    scheduleReminderAudioPrewarm,
    scheduleStartDateTimeForDate,
    stop
  };
}

module.exports = {
  createReminderRuntime
};
