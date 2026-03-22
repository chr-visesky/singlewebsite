using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using RecitationApp.Models;
using StudyModules.Shared;

namespace RecitationApp.Services;

public sealed class RecitationTaskStore
{
    private const string AppFolderName = "RecitationApp";
    private readonly JsonFileStore<RecitationTaskIndex> _store;

    public RecitationTaskStore()
    {
        _store = new JsonFileStore<RecitationTaskIndex>(
            AppPaths.ResolveDataFile(AppFolderName, "tasks.json"));
    }

    public IReadOnlyList<RecitationTask> GetAllTasks()
    {
        return ReadIndex()
            .Tasks
            .OrderByDescending(item => item.TargetDate)
            .ThenBy(item => item.Title, StringComparer.CurrentCulture)
            .ToList();
    }

    public RecitationTask Save(RecitationTask task)
    {
        RecitationTaskIndex index = ReadIndex();
        RecitationTask normalizedTask = NormalizeTask(task);
        index.Tasks.RemoveAll(item => string.Equals(item.TaskId, normalizedTask.TaskId, StringComparison.OrdinalIgnoreCase));
        index.Tasks.Add(normalizedTask);
        _store.Write(index);
        return normalizedTask;
    }

    public RecitationTask SaveResult(string taskId, string transcript, string diffSummary, string recordingPath)
    {
        RecitationTask task = GetAllTasks().First(item => string.Equals(item.TaskId, taskId, StringComparison.OrdinalIgnoreCase));
        task.LastTranscript = transcript?.Trim() ?? string.Empty;
        task.LastDiffSummary = diffSummary?.Trim() ?? string.Empty;
        task.LastRecordingPath = recordingPath?.Trim() ?? string.Empty;
        return Save(task);
    }

    public RecitationTask CreateFromAgent(string title, string bucket, string targetDate, string sourceText)
    {
        var task = new RecitationTask
        {
            Title = title,
            Bucket = bucket,
            TargetDate = ParseTargetDate(targetDate),
            SourceText = sourceText
        };

        return Save(task);
    }

    private RecitationTaskIndex ReadIndex()
    {
        RecitationTaskIndex index = _store.Read();
        index.Tasks ??= new List<RecitationTask>();
        return index;
    }

    private static RecitationTask NormalizeTask(RecitationTask task)
    {
        DateTime now = DateTime.Now;
        string sourceText = task.SourceText?.Trim() ?? string.Empty;

        if (string.IsNullOrWhiteSpace(sourceText))
        {
            throw new InvalidOperationException("背诵任务必须有原文。");
        }

        DateTime targetDate = task.TargetDate == default ? DateTime.Today : task.TargetDate.Date;

        return new RecitationTask
        {
            TaskId = string.IsNullOrWhiteSpace(task.TaskId) ? Guid.NewGuid().ToString("D") : task.TaskId.Trim(),
            Title = string.IsNullOrWhiteSpace(task.Title) ? $"背诵任务 {targetDate:yyyy-MM-dd}" : task.Title.Trim(),
            Subject = "语文",
            Bucket = string.IsNullOrWhiteSpace(task.Bucket) ? "课内" : task.Bucket.Trim(),
            TargetDate = targetDate,
            SourceText = sourceText,
            CreatedAt = task.CreatedAt == default ? now : task.CreatedAt,
            UpdatedAt = now,
            LastTranscript = task.LastTranscript?.Trim() ?? string.Empty,
            LastDiffSummary = task.LastDiffSummary?.Trim() ?? string.Empty,
            LastRecordingPath = task.LastRecordingPath?.Trim() ?? string.Empty
        };
    }

    private static DateTime ParseTargetDate(string rawValue)
    {
        return DateTime.TryParseExact(
            rawValue,
            "yyyy-MM-dd",
            CultureInfo.InvariantCulture,
            DateTimeStyles.None,
            out DateTime targetDate)
            ? targetDate
            : DateTime.Today;
    }
}
