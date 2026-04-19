using System;
using System.IO;
using System.Linq;
using System.Media;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Speech.Synthesis;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace DictationApp.Services;

public sealed class DictationSpeechService
{
    private static readonly HttpClient HttpClient = new()
    {
        Timeout = TimeSpan.FromSeconds(20)
    };
    private readonly DictationModuleOptions _options;

    public DictationSpeechService(DictationModuleOptions options)
    {
        _options = options;
    }

    public async Task SpeakAsync(string text, string language)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return;
        }

        if (_options.HasRemoteSpeech && await TrySpeakWithRemoteAsync(text, language))
        {
            return;
        }

        await SpeakWithSystemAsync(text, language);
    }

    private async Task<bool> TrySpeakWithRemoteAsync(string text, string language)
    {
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, _options.RemoteServiceUrl);
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _options.RemoteAuthToken);
            request.Content = new StringContent(
                JsonSerializer.Serialize(new
                {
                    action = "synthesizeDictationSpeech",
                    text,
                    language
                }),
                Encoding.UTF8,
                "application/json");

            using HttpResponseMessage response = await HttpClient.SendAsync(request);
            string body = await response.Content.ReadAsStringAsync();

            if (!response.IsSuccessStatusCode)
            {
                return false;
            }

            RemoteSpeechResponse? payload = JsonSerializer.Deserialize<RemoteSpeechResponse>(body);

            if (payload?.Ok != true || string.IsNullOrWhiteSpace(payload.AudioBase64))
            {
                return false;
            }

            byte[] audioBytes = Convert.FromBase64String(payload.AudioBase64);
            await PlayWaveAsync(audioBytes);
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static Task PlayWaveAsync(byte[] audioBytes)
    {
        return Task.Run(() =>
        {
            using var stream = new MemoryStream(audioBytes);
            using var player = new SoundPlayer(stream);
            player.Load();
            player.PlaySync();
        });
    }

    private static Task SpeakWithSystemAsync(string text, string language)
    {
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
            .Where((item) => item.Enabled)
            .FirstOrDefault((item) =>
            {
                string cultureName = item.VoiceInfo.Culture.Name;
                return normalizedLanguage.Contains("英", StringComparison.OrdinalIgnoreCase)
                    || normalizedLanguage.Contains("en", StringComparison.OrdinalIgnoreCase)
                    ? cultureName.StartsWith("en", StringComparison.OrdinalIgnoreCase)
                    : cultureName.StartsWith("zh", StringComparison.OrdinalIgnoreCase);
            });

        if (preferredVoice is not null)
        {
            synthesizer.SelectVoice(preferredVoice.VoiceInfo.Name);
        }
    }

    private sealed class RemoteSpeechResponse
    {
        public bool Ok { get; set; }

        public string AudioBase64 { get; set; } = string.Empty;
    }
}
