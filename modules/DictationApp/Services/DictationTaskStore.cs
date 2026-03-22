using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using DictationApp.Models;
using StudyModules.Shared;

namespace DictationApp.Services;

public sealed class DictationTaskStore
{
    private const string AppFolderName = "DictationApp";
    private readonly JsonFileStore<DictationTaskIndex> _store;

    public DictationTaskStore()
    {
        _store = new JsonFileStore<DictationTaskIndex>(
            AppPaths.ResolveDataFile(AppFolderName, "tasks.json"));
    }

    public IReadOnlyList<DictationTask> GetAllTasks()
    {
        return ReadIndex()
            .Tasks
            .OrderByDescending(item => item.TargetDate)
            .ThenBy(item => item.Title, StringComparer.CurrentCulture)
            .ToList();
    }

    public DictationTask Save(DictationTask task)
    {
        DictationTaskIndex index = ReadIndex();
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
