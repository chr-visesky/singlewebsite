using System;
using System.Collections.Generic;
using Newtonsoft.Json;

namespace DictationApp.Models;

public sealed class DictationTask
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

    [JsonProperty("language")]
    public string Language { get; set; } = "中文";

    [JsonProperty("items")]
    public List<DictationTaskItem> Items { get; set; } = new();

    [JsonProperty("createdAt")]
    public DateTime CreatedAt { get; set; } = DateTime.Now;

    [JsonProperty("updatedAt")]
    public DateTime UpdatedAt { get; set; } = DateTime.Now;

    [JsonIgnore]
    public string Summary => $"{Subject} · {Bucket} · {TargetDate:yyyy-MM-dd} · {Items.Count} 项";
}

public sealed class DictationTaskItem
{
    [JsonProperty("text")]
    public string Text { get; set; } = string.Empty;

    [JsonProperty("hint")]
    public string Hint { get; set; } = string.Empty;

    [JsonIgnore]
    public string DisplayText => string.IsNullOrWhiteSpace(Hint) ? Text : $"{Text}（{Hint}）";
}

public sealed class DictationTaskIndex
{
    [JsonProperty("tasks")]
    public List<DictationTask> Tasks { get; set; } = new();
}
