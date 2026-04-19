using System;
using DictationApp.Models;
using Newtonsoft.Json;
using StudyModules.Shared;

namespace DictationApp.Services;

public sealed class DictationSessionSettingsStore
{
    private const string AppFolderName = "DictationApp";
    private readonly JsonFileStore<DictationSessionSettings> _store;

    public DictationSessionSettingsStore()
    {
        _store = new JsonFileStore<DictationSessionSettings>(AppPaths.ResolveDataFile(AppFolderName, "settings.json"));
    }

    public DictationSessionSettings Read()
    {
        try
        {
            return Normalize(_store.Read());
        }
        catch (JsonException)
        {
            return new DictationSessionSettings();
        }
    }

    public DictationSessionSettings Save(DictationSessionSettings settings)
    {
        DictationSessionSettings normalized = Normalize(settings);
        _store.Write(normalized);
        return normalized;
    }

    private static DictationSessionSettings Normalize(DictationSessionSettings? settings)
    {
        return new DictationSessionSettings
        {
            RepeatCount = Math.Clamp(settings?.RepeatCount ?? 2, 1, 4),
            WriteSeconds = Math.Clamp(settings?.WriteSeconds ?? 6, 2, 20)
        };
    }
}
