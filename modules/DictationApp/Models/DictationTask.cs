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

    [JsonProperty("sourceType")]
    public string SourceType { get; set; } = "manual";

    [JsonProperty("textbook")]
    public string Textbook { get; set; } = string.Empty;

    [JsonProperty("grade")]
    public string Grade { get; set; } = string.Empty;

    [JsonProperty("term")]
    public string Term { get; set; } = string.Empty;

    [JsonProperty("unitTitle")]
    public string UnitTitle { get; set; } = string.Empty;

    [JsonProperty("lessonTitle")]
    public string LessonTitle { get; set; } = string.Empty;

    [JsonProperty("courseKey")]
    public string CourseKey { get; set; } = string.Empty;

    [JsonProperty("items")]
    public List<DictationTaskItem> Items { get; set; } = new();

    [JsonProperty("createdAt")]
    public DateTime CreatedAt { get; set; } = DateTime.Now;

    [JsonProperty("updatedAt")]
    public DateTime UpdatedAt { get; set; } = DateTime.Now;

    [JsonIgnore]
    public string Summary => BuildSummary();

    [JsonIgnore]
    public string CourseLabel => BuildCourseLabel();

    [JsonIgnore]
    public string GroupLabel => BuildGroupLabel();

    private string BuildSummary()
    {
        string courseLabel = BuildCourseLabel();
        string prefix = string.IsNullOrWhiteSpace(courseLabel)
            ? $"{Subject} · {Bucket}"
            : $"{Subject} · {courseLabel}";
        return $"{prefix} · {Items.Count} 题";
    }

    private string BuildCourseLabel()
    {
        var parts = new List<string>();

        if (!string.IsNullOrWhiteSpace(Textbook))
        {
            parts.Add(Textbook.Trim());
        }

        if (!string.IsNullOrWhiteSpace(Grade))
        {
            parts.Add(Grade.Trim());
        }

        if (!string.IsNullOrWhiteSpace(Term))
        {
            parts.Add(Term.Trim());
        }

        if (!string.IsNullOrWhiteSpace(UnitTitle))
        {
            parts.Add(UnitTitle.Trim());
        }

        if (!string.IsNullOrWhiteSpace(LessonTitle))
        {
            parts.Add(LessonTitle.Trim());
        }

        return parts.Count == 0 ? string.Empty : string.Join(" · ", parts);
    }

    private string BuildGroupLabel()
    {
        string courseLabel = BuildCourseLabel();

        if (!string.IsNullOrWhiteSpace(courseLabel))
        {
            return courseLabel;
        }

        if (!string.IsNullOrWhiteSpace(LessonTitle))
        {
            return LessonTitle.Trim();
        }

        return $"{Subject} · {Bucket}";
    }
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
