using System;
using System.Collections.Generic;
using Newtonsoft.Json;

namespace RecitationApp.Models;

public sealed class RecitationTask
{
    [JsonProperty("taskId")]
    public string TaskId { get; set; } = string.Empty;

    [JsonProperty("title")]
    public string Title { get; set; } = string.Empty;

    [JsonProperty("subject")]
    public string Subject { get; set; } = "语文";

    [JsonProperty("bucket")]
    public string Bucket { get; set; } = "课内";

    [JsonProperty("targetDate")]
    public DateTime TargetDate { get; set; } = DateTime.Today;

    [JsonProperty("sourceText")]
    public string SourceText { get; set; } = string.Empty;

    [JsonProperty("createdAt")]
    public DateTime CreatedAt { get; set; } = DateTime.Now;

    [JsonProperty("updatedAt")]
    public DateTime UpdatedAt { get; set; } = DateTime.Now;

    [JsonProperty("lastTranscript")]
    public string LastTranscript { get; set; } = string.Empty;

    [JsonProperty("lastDiffSummary")]
    public string LastDiffSummary { get; set; } = string.Empty;

    [JsonProperty("lastRecordingPath")]
    public string LastRecordingPath { get; set; } = string.Empty;

    [JsonIgnore]
    public string Summary => $"{Subject} · {Bucket} · {TargetDate:yyyy-MM-dd}";
}

public sealed class RecitationTaskIndex
{
    [JsonProperty("tasks")]
    public List<RecitationTask> Tasks { get; set; } = new();
}
