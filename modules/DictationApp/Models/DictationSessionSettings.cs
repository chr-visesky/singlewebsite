using Newtonsoft.Json;

namespace DictationApp.Models;

public sealed class DictationSessionSettings
{
    [JsonProperty("repeatCount")]
    public int RepeatCount { get; set; } = 2;

    [JsonProperty("writeSeconds")]
    public int WriteSeconds { get; set; } = 6;
}
