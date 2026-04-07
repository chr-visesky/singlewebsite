using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using DictationApp.Models;
using Newtonsoft.Json;
using StudyModules.Shared;

namespace DictationApp.Services;

public sealed class DictationTaskStore
{
    private const string AppFolderName = "DictationApp";
    private readonly JsonFileStore<DictationTaskIndex> _store;
    private readonly string _tasksFilePath;

    public DictationTaskStore()
    {
        _tasksFilePath = AppPaths.ResolveDataFile(AppFolderName, "tasks.json");
        _store = new JsonFileStore<DictationTaskIndex>(_tasksFilePath);
    }

    public IReadOnlyList<DictationTask> GetAllTasks()
    {
        return ReadIndexSafely()
            .Tasks
            .OrderByDescending(item => item.TargetDate)
            .ThenBy(item => item.Title, StringComparer.CurrentCulture)
            .ToList();
    }

    public DictationTask Save(DictationTask task)
    {
        DictationTaskIndex index = ReadIndexSafely();
        DictationTask normalizedTask = NormalizeTask(task);
        index.Tasks.RemoveAll(item => string.Equals(item.TaskId, normalizedTask.TaskId, StringComparison.OrdinalIgnoreCase));
        index.Tasks.Add(normalizedTask);
        _store.Write(index);
        return normalizedTask;
    }

    public DictationTask CreateFromAgent(
        string title,
        string subject,
        string bucket,
        string targetDate,
        string language,
        IEnumerable<string> items)
    {
        var task = new DictationTask
        {
            Title = title,
            Subject = subject,
            Bucket = bucket,
            TargetDate = ParseTargetDate(targetDate),
            Language = language,
            Items = items.Select(item => new DictationTaskItem
            {
                Text = item?.Trim() ?? string.Empty
            }).Where(item => !string.IsNullOrWhiteSpace(item.Text)).ToList()
        };

        return Save(task);
    }

    private DictationTaskIndex ReadIndex()
    {
        DictationTaskIndex index = _store.Read();
        index.Tasks ??= new List<DictationTask>();
        return index;
    }

    private DictationTaskIndex ReadIndexSafely()
    {
        try
        {
            return ReadIndex();
        }
        catch (JsonException)
        {
            BackupCorruptedTaskFile();
            return new DictationTaskIndex();
        }
    }

    private void BackupCorruptedTaskFile()
    {
        if (!File.Exists(_tasksFilePath))
        {
            return;
        }

        string backupPath = Path.Combine(
            Path.GetDirectoryName(_tasksFilePath) ?? Path.GetTempPath(),
            $"tasks.corrupted.{DateTime.Now:yyyyMMddHHmmss}.json");

        try
        {
            File.Move(_tasksFilePath, backupPath, overwrite: false);
        }
        catch (IOException)
        {
            // Keep the original file in place if a backup with the same timestamp already exists.
        }
    }

    private static DictationTask NormalizeTask(DictationTask task)
    {
        DateTime now = DateTime.Now;
        List<DictationTaskItem> items = (task.Items ?? new List<DictationTaskItem>())
            .Where(item => item is not null)
            .Select(item => new DictationTaskItem
            {
                Text = item.Text?.Trim() ?? string.Empty,
                Hint = item.Hint?.Trim() ?? string.Empty
            })
            .Where(item => !string.IsNullOrWhiteSpace(item.Text))
            .ToList();

        if (items.Count == 0)
        {
            throw new InvalidOperationException("听写任务至少要有 1 项内容。");
        }

        string subject = string.IsNullOrWhiteSpace(task.Subject) ? "语文" : task.Subject.Trim();
        DateTime targetDate = task.TargetDate == default ? DateTime.Today : task.TargetDate.Date;

        return new DictationTask
        {
            TaskId = string.IsNullOrWhiteSpace(task.TaskId) ? Guid.NewGuid().ToString("D") : task.TaskId.Trim(),
            Title = string.IsNullOrWhiteSpace(task.Title)
                ? $"{subject}听写 {targetDate:yyyy-MM-dd}"
                : task.Title.Trim(),
            Subject = subject,
            Bucket = string.IsNullOrWhiteSpace(task.Bucket) ? "课内" : task.Bucket.Trim(),
            TargetDate = targetDate,
            Language = string.IsNullOrWhiteSpace(task.Language)
                ? (string.Equals(subject, "英语", StringComparison.OrdinalIgnoreCase) ? "英语" : "中文")
                : task.Language.Trim(),
            Items = items,
            CreatedAt = task.CreatedAt == default ? now : task.CreatedAt,
            UpdatedAt = now
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
