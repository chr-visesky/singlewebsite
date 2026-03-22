using System;
using System.Linq;
using System.Speech.Synthesis;
using System.Threading.Tasks;

namespace DictationApp.Services;

public sealed class DictationSpeechService
{
    public Task SpeakAsync(string text, string language)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return Task.CompletedTask;
        }

        return Task.Run(() =>
        {
            using var synthesizer = new SpeechSynthesizer
            {
                Rate = -1,
                Volume = 100
            };

            SelectVoice(synthesizer, language);
            synthesizer.Speak(text);
        });
    }

    private static void SelectVoice(SpeechSynthesizer synthesizer, string language)
    {
        string normalizedLanguage = string.IsNullOrWhiteSpace(language) ? "中文" : language.Trim();
        InstalledVoice? preferredVoice = synthesizer.GetInstalledVoices()
            .Where(item => item.Enabled)
            .FirstOrDefault(item =>
            {
                string cultureName = item.VoiceInfo.Culture.Name;
                return normalizedLanguage.Contains("英", StringComparison.OrdinalIgnoreCase)
                    ? cultureName.StartsWith("en", StringComparison.OrdinalIgnoreCase)
                    : cultureName.StartsWith("zh", StringComparison.OrdinalIgnoreCase);
            });

        if (preferredVoice is not null)
        {
            synthesizer.SelectVoice(preferredVoice.VoiceInfo.Name);
        }
    }
}
