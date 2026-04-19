'use strict';

const { tts } = require('tencentcloud-sdk-nodejs-tts');

const TtsClient = tts.v20190823.Client;

function createDictationSpeechRuntime(options = {}) {
  const { normalizePrefix } = options;

  function normalizeText(value) {
    return normalizePrefix(value).slice(0, 300);
  }

  function isEnglishLanguage(value) {
    const normalized = normalizePrefix(value).toLowerCase();
    return normalized.includes('英') || normalized.includes('en');
  }

  function buildClient() {
    const secretId = normalizePrefix(process.env.TENCENTCLOUD_SECRET_ID || process.env.SECRET_ID);
    const secretKey = normalizePrefix(process.env.TENCENTCLOUD_SECRET_KEY || process.env.SECRET_KEY);

    if (!secretId || !secretKey) {
      const error = new Error('missing_dictation_tts_secret');
      error.code = 'missing_dictation_tts_secret';
      throw error;
    }

    return new TtsClient({
      credential: {
        secretId,
        secretKey
      },
      region: normalizePrefix(process.env.DICTATION_TTS_REGION || process.env.TENCENTCLOUD_REGION || 'ap-shanghai'),
      profile: {
        httpProfile: {
          reqMethod: 'POST',
          reqTimeout: 30
        }
      }
    });
  }

  async function synthesizeSpeech(payload = {}) {
    const text = normalizeText(payload.text);

    if (!text) {
      const error = new Error('missing_dictation_tts_text');
      error.code = 'missing_dictation_tts_text';
      throw error;
    }

    const englishMode = isEnglishLanguage(payload.language);
    const chineseVoiceType = Number(process.env.DICTATION_TTS_CHINESE_VOICE_TYPE || process.env.DICTATION_TTS_VOICE_TYPE || 1001);
    const englishVoiceType = Number(process.env.DICTATION_TTS_ENGLISH_VOICE_TYPE || process.env.DICTATION_TTS_VOICE_TYPE || 1001);
    const client = buildClient();
    const response = await client.TextToVoice({
      Text: text,
      SessionId: `dictation-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`,
      Volume: 1,
      Speed: 0,
      ProjectId: 0,
      ModelType: 1,
      VoiceType: englishMode ? englishVoiceType : chineseVoiceType,
      PrimaryLanguage: englishMode ? 2 : 1,
      SampleRate: 16000,
      Codec: 'wav'
    });

    return {
      ok: true,
      audioBase64: normalizePrefix(response && response.Audio),
      requestId: normalizePrefix(response && response.RequestId),
      sessionId: normalizePrefix(response && response.SessionId)
    };
  }

  return {
    synthesizeSpeech
  };
}

module.exports = {
  createDictationSpeechRuntime
};
