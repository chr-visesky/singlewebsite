namespace DictationApp.Models;

public sealed class DictationTaskCardItem
{
    public DictationTaskCardItem(DictationTask task, bool isSelected)
    {
        Task = task;
        IsSelected = isSelected;
    }

    public DictationTask Task { get; }

    public string TaskId => Task.TaskId;

    public string Title => Task.Title;

    public string Summary => Task.Summary;

    public string GroupLabel => Task.GroupLabel;

    public bool IsSelected { get; }

    public string DeleteAutomationId => IsSelected ? "DictationDeleteTaskButton" : $"DictationDeleteTaskButton_{TaskId}";
}
