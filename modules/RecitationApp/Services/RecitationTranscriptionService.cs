using System;
using System.Linq;
using System.Speech.Recognition;
using System.Threading.Tasks;

namespace RecitationApp.Services;

public sealed class RecitationTranscriptionService
{
    public Task<RecitationTranscriptionResult> TranscribeAsync(string waveFilePath)
    {
        if (string.IsNullOrWhiteSpace(waveFilePath))
        {
            return Task.FromResult(new RecitationTranscriptionResult
            {
                Error = "缺少录音文件。"
            });
        }

        return Task.Run(() =>
        {
            RecognizerInfo? recognizer = SpeechRecognitionEngine.InstalledRecognizers()
                .FirstOrDefault(item => item.Culture.Name.StartsWith("zh", StringComparison.OrdinalIgnoreCase))
                ?? SpeechRecognitionEngine.InstalledRecognizers().FirstOrDefault();

            if (recognizer is null)
            {
                return new RecitationTranscriptionResult
                {
                    Error = "当前系统没有可用的语音识别器。"
                };
            }

            try
            {
                using var engine = new SpeechRecognitionEngine(recognizer);
                engine.LoadGrammar(new DictationGrammar());
                engine.SetInputToWaveFile(waveFilePath);
                RecognitionResult? result = engine.Recognize();

                return new RecitationTranscriptionResult
                {
                    Text = result?.Text?.Trim() ?? string.Empty,
                    Confidence = result?.Confidence ?? 0,
                    Error = string.IsNullOrWhiteSpace(result?.Text) ? "没有识别出有效文本。" : string.Empty
                };
            }
            catch (Exception ex)
            {
                return new RecitationTranscriptionResult
                {
                    Error = ex.Message
                };
            }
        });
    }
}

public sealed class RecitationTranscriptionResult
{
    public string Text { get; set; } = string.Empty;

    public double Confidence { get; set; }

    public string Error { get; set; } = string.Empty;
}
