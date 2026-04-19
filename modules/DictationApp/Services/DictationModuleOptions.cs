using System;

namespace DictationApp.Services;

public sealed class DictationModuleOptions
{
    public string RemoteServiceUrl { get; init; } = string.Empty;

    public string RemoteAuthToken { get; init; } = string.Empty;

    public bool HasRemoteSpeech => !string.IsNullOrWhiteSpace(RemoteServiceUrl)
        && !string.IsNullOrWhiteSpace(RemoteAuthToken);

    public static DictationModuleOptions LoadFromEnvironment()
    {
        return new DictationModuleOptions
        {
            RemoteServiceUrl = Normalize(Environment.GetEnvironmentVariable("STUDYGATE_DICTATION_SERVICE_URL")),
            RemoteAuthToken = Normalize(Environment.GetEnvironmentVariable("STUDYGATE_DICTATION_SERVICE_TOKEN"))
        };
    }

    private static string Normalize(string? value)
    {
        return value?.Trim() ?? string.Empty;
    }
}
