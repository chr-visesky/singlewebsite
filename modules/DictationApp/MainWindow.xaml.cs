using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using DictationApp.Models;
using DictationApp.Services;
using DictationApp.Views;

namespace DictationApp;

public partial class MainWindow : Window
{
    private readonly DictationTaskStore _taskStore;
    private readonly DictationSessionSettingsStore _sessionSettingsStore;
    private readonly DictationSpeechService _speechService;
    private readonly DictationHandwritingRecognitionService _recognitionService;
    private readonly ObservableCollection<DictationEditorItem> _editorItems = new();
    private List<DictationTask> _tasks = new();
    private DictationTask? _loadedEditorTask;
    private bool _isCreateMode;
    private bool _hasUnsavedChanges;
    private bool _suppressEditorChangeTracking;

    public MainWindow(
        DictationTaskStore taskStore,
        DictationSessionSettingsStore sessionSettingsStore,
        DictationSpeechService speechService,
        DictationHandwritingRecognitionService recognitionService)
    {
        InitializeComponent();
        _taskStore = taskStore;
        _sessionSettingsStore = sessionSettingsStore;
        _speechService = speechService;
        _recognitionService = recognitionService;
        EditorItemsControl.ItemsSource = _editorItems;
        LoadTasks();
    }

    private string? SelectedTaskId => _loadedEditorTask?.TaskId;

    private void LoadTasks(string? selectedTaskId = null, bool openCreateMode = false)
    {
        _tasks = _taskStore.GetAllTasks().ToList();
        UpdateSidebarMeta();

        if (openCreateMode)
        {
            LoadEditorFromTask(null);
            return;
        }

        DictationTask? selectedTask = ResolveSelectedTask(selectedTaskId);
        LoadEditorFromTask(selectedTask);
    }

    private DictationTask? ResolveSelectedTask(string? taskId)
    {
        if (!string.IsNullOrWhiteSpace(taskId))
        {
            DictationTask? exactMatch = _tasks.FirstOrDefault((item) => string.Equals(item.TaskId, taskId, StringComparison.OrdinalIgnoreCase));
            if (exactMatch is not null)
            {
                return exactMatch;
            }
        }

        return _tasks.FirstOrDefault();
    }

    private void LoadEditorFromTask(DictationTask? task)
    {
        _suppressEditorChangeTracking = true;
        _loadedEditorTask = task;
        _isCreateMode = task is null;
        _hasUnsavedChanges = false;

        if (task is null)
        {
            TaskTitleTextBox.Text = string.Empty;
            LessonTitleTextBox.Text = string.Empty;
            SelectComboItem(SubjectComboBox, "语文");
            SelectComboItem(BucketComboBox, "课内");
            SelectComboItem(LanguageComboBox, "中文");
            TargetDatePicker.SelectedDate = DateTime.Today;
            ReplaceEditorItems(Array.Empty<string>());
        }
        else
        {
            TaskTitleTextBox.Text = task.Title;
            LessonTitleTextBox.Text = task.LessonTitle;
            SelectComboItem(SubjectComboBox, task.Subject);
            SelectComboItem(BucketComboBox, task.Bucket);
            SelectComboItem(LanguageComboBox, task.Language);
            TargetDatePicker.SelectedDate = task.TargetDate.Date;
            ReplaceEditorItems(task.Items.Select((item) => item.Text));
        }

        _suppressEditorChangeTracking = false;
        RefreshTaskGroups(task?.TaskId);
        UpdateEditorUi();
    }

    private void RefreshTaskGroups(string? selectedTaskId)
    {
        List<DictationTaskCardGroup> groups = _tasks
            .GroupBy((item) => item.GroupLabel)
            .Select((group) => new DictationTaskCardGroup(
                group.Key,
                group
                    .OrderByDescending((item) => item.TargetDate)
                    .ThenBy((item) => item.Title, StringComparer.CurrentCulture)
                    .Select((item) => new DictationTaskCardItem(
                        item,
                        string.Equals(item.TaskId, selectedTaskId, StringComparison.OrdinalIgnoreCase)))))
            .OrderByDescending((group) => group.Tasks.Max((item) => item.Task.TargetDate))
            .ThenBy((group) => group.Title, StringComparer.CurrentCulture)
            .ToList();

        TaskGroupsItemsControl.ItemsSource = groups;
    }

    private void UpdateSidebarMeta()
    {
        int groupCount = _tasks.Select((item) => item.GroupLabel).Distinct(StringComparer.CurrentCultureIgnoreCase).Count();
        SidebarMetaTextBlock.Text = _tasks.Count == 0
            ? "左侧按分组管理任务，右侧直接编辑待听写词组。"
            : $"共 {groupCount} 组，{_tasks.Count} 个任务。";
    }

    private void ReplaceEditorItems(IEnumerable<string> items)
    {
        _editorItems.Clear();

        foreach (string item in items.Where((item) => !string.IsNullOrWhiteSpace(item)))
        {
            _editorItems.Add(new DictationEditorItem
            {
                Text = item.Trim()
            });
        }

        if (_editorItems.Count == 0)
        {
            _editorItems.Add(new DictationEditorItem());
        }

        RenumberEditorItems();
    }

    private void RenumberEditorItems()
    {
        for (int index = 0; index < _editorItems.Count; index += 1)
        {
            _editorItems[index].DisplayIndex = (index + 1).ToString();
        }

        UpdateItemsSummary();
    }

    private void UpdateItemsSummary()
    {
        int nonEmptyItemCount = GetEditorTexts().Count;
        ItemsSummaryTextBlock.Text = $"共 {nonEmptyItemCount} 组";
    }

    private void UpdateEditorUi()
    {
        string lessonLabel = string.IsNullOrWhiteSpace(LessonTitleTextBox.Text)
            ? "未分组"
            : LessonTitleTextBox.Text.Trim();
        string titleLabel = string.IsNullOrWhiteSpace(TaskTitleTextBox.Text)
            ? (_isCreateMode ? "新词组" : "未命名词组")
            : TaskTitleTextBox.Text.Trim();

        EditorModeTextBlock.Text = _isCreateMode ? "新建词组" : "编辑词组";
        EditorMetaTextBlock.Text = $"{titleLabel} · {lessonLabel}";
        EditorStatusTextBlock.Text = _hasUnsavedChanges
            ? "右侧有未保存改动，保存后才会写入任务。"
            : (_isCreateMode
                ? "在右侧逐条录入待听写词组，保存后会出现在左侧分组卡片里。"
                : "右侧直接编辑当前任务里的词组，保存后立即生效。");
        FooterHintTextBlock.Text = _isCreateMode
            ? "新建词组时，先保存，再开始听写。"
            : (_hasUnsavedChanges ? "当前内容还没保存，开始听写会先被禁用。" : "可以继续修改词组，也可以直接开始听写。");

        ResetButton.Content = _isCreateMode ? "清空" : "恢复";
        SaveButton.IsEnabled = GetEditorTexts().Count > 0;
        StartButton.IsEnabled = !_isCreateMode && _loadedEditorTask is not null && !_hasUnsavedChanges && GetEditorTexts().Count > 0;
    }

    private List<string> GetEditorTexts()
    {
        return _editorItems
            .Select((item) => item.Text?.Trim() ?? string.Empty)
            .Where((item) => !string.IsNullOrWhiteSpace(item))
            .ToList();
    }

    private bool ConfirmDiscardChangesIfNeeded()
    {
        if (!_hasUnsavedChanges)
        {
            return true;
        }

        MessageBoxResult result = MessageBox.Show(
            this,
            "右侧有未保存改动，确定放弃吗？",
            "放弃未保存改动",
            MessageBoxButton.YesNo,
            MessageBoxImage.Warning);

        return result == MessageBoxResult.Yes;
    }

    private void CreateButton_OnClick(object sender, RoutedEventArgs e)
    {
        if (!ConfirmDiscardChangesIfNeeded())
        {
            return;
        }

        LoadEditorFromTask(null);
    }

    private void TaskCard_OnMouseLeftButtonUp(object sender, MouseButtonEventArgs e)
    {
        OpenTaskFromSender(sender);
    }

    private void TaskCardEditButton_OnClick(object sender, RoutedEventArgs e)
    {
        OpenTaskFromSender(sender);
    }

    private void OpenTaskFromSender(object sender)
    {
        string taskId = ReadTaskIdFromSender(sender);

        if (string.IsNullOrWhiteSpace(taskId))
        {
            return;
        }

        if (!ConfirmDiscardChangesIfNeeded())
        {
            return;
        }

        DictationTask? task = ResolveSelectedTask(taskId);
        if (task is null)
        {
            return;
        }

        LoadEditorFromTask(task);
    }

    private void TaskCardDeleteButton_OnClick(object sender, RoutedEventArgs e)
    {
        string taskId = ReadTaskIdFromSender(sender);

        if (string.IsNullOrWhiteSpace(taskId))
        {
            return;
        }

        DictationTask? task = ResolveSelectedTask(taskId);
        if (task is null)
        {
            return;
        }

        MessageBoxResult result = MessageBox.Show(
            this,
            $"确定删除“{task.Title}”吗？\n删除后不会自动恢复。",
            "删除听写任务",
            MessageBoxButton.YesNo,
            MessageBoxImage.Warning);

        if (result != MessageBoxResult.Yes)
        {
            return;
        }

        bool deletingCurrentTask = string.Equals(task.TaskId, SelectedTaskId, StringComparison.OrdinalIgnoreCase);
        _taskStore.Delete(task.TaskId);
        _tasks = _taskStore.GetAllTasks().ToList();
        UpdateSidebarMeta();

        if (deletingCurrentTask)
        {
            DictationTask? nextTask = _tasks.FirstOrDefault();
            LoadEditorFromTask(nextTask);
            return;
        }

        RefreshTaskGroups(SelectedTaskId);
        UpdateEditorUi();
    }

    private void EditorValue_OnChanged(object sender, RoutedEventArgs e)
    {
        MarkEditorDirty();
    }

    private void TargetDatePicker_OnSelectedDateChanged(object? sender, SelectionChangedEventArgs e)
    {
        MarkEditorDirty();
    }

    private void EditorItemTextBox_OnTextChanged(object sender, TextChangedEventArgs e)
    {
        MarkEditorDirty();
    }

    private void AddItemButton_OnClick(object sender, RoutedEventArgs e)
    {
        _editorItems.Add(new DictationEditorItem());
        RenumberEditorItems();
        MarkEditorDirty();
    }

    private void RemoveItemButton_OnClick(object sender, RoutedEventArgs e)
    {
        if (sender is not FrameworkElement element || element.DataContext is not DictationEditorItem item)
        {
            return;
        }

        if (_editorItems.Count == 1)
        {
            item.Text = string.Empty;
            RenumberEditorItems();
            MarkEditorDirty();
            EditorItemsControl.Items.Refresh();
            return;
        }

        _editorItems.Remove(item);
        RenumberEditorItems();
        MarkEditorDirty();
    }

    private void ResetButton_OnClick(object sender, RoutedEventArgs e)
    {
        if (_isCreateMode)
        {
            LoadEditorFromTask(null);
            return;
        }

        DictationTask? currentTask = ResolveSelectedTask(SelectedTaskId);
        LoadEditorFromTask(currentTask);
    }

    private void SaveButton_OnClick(object sender, RoutedEventArgs e)
    {
        List<string> items = GetEditorTexts();

        if (items.Count == 0)
        {
            MessageBox.Show(this, "至少要有 1 组待听写词组。", "无法保存", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        DictationTask taskToSave = BuildTaskFromEditor(items);
        DictationTask savedTask = _taskStore.Save(taskToSave);
        LoadTasks(savedTask.TaskId);
    }

    private DictationTask BuildTaskFromEditor(IReadOnlyList<string> items)
    {
        DictationTask? sourceTask = _loadedEditorTask;

        return new DictationTask
        {
            TaskId = sourceTask?.TaskId ?? string.Empty,
            Title = TaskTitleTextBox.Text,
            Subject = ComboText(SubjectComboBox),
            Bucket = ComboText(BucketComboBox),
            Language = ComboText(LanguageComboBox),
            TargetDate = TargetDatePicker.SelectedDate ?? DateTime.Today,
            LessonTitle = LessonTitleTextBox.Text,
            SourceType = sourceTask?.SourceType ?? "manual",
            Textbook = sourceTask?.Textbook ?? string.Empty,
            Grade = sourceTask?.Grade ?? string.Empty,
            Term = sourceTask?.Term ?? string.Empty,
            UnitTitle = sourceTask?.UnitTitle ?? string.Empty,
            CourseKey = sourceTask?.CourseKey ?? string.Empty,
            CreatedAt = sourceTask?.CreatedAt ?? default,
            Items = items.Select((item) => new DictationTaskItem
            {
                Text = item
            }).ToList()
        };
    }

    private void SettingsButton_OnClick(object sender, RoutedEventArgs e)
    {
        DictationSessionSettings currentSettings = _sessionSettingsStore.Read();
        var settingsWindow = new SessionSettingsWindow(currentSettings)
        {
            Owner = this
        };

        if (settingsWindow.ShowDialog() != true)
        {
            return;
        }

        _sessionSettingsStore.Save(settingsWindow.BuildSettings());
        UpdateEditorUi();
    }

    private void StartButton_OnClick(object sender, RoutedEventArgs e)
    {
        if (_hasUnsavedChanges)
        {
            MessageBox.Show(this, "请先保存词组，再开始听写。", "请先保存", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }

        DictationTask? selectedTask = ResolveSelectedTask(SelectedTaskId);
        if (selectedTask is null)
        {
            return;
        }

        DictationSessionSettings settings = _sessionSettingsStore.Read();
        var sessionWindow = new TaskSessionWindow(selectedTask, settings, _speechService, _recognitionService)
        {
            Owner = this
        };
        sessionWindow.ShowDialog();
        LoadTasks(selectedTask.TaskId);
    }

    private void MarkEditorDirty()
    {
        if (_suppressEditorChangeTracking)
        {
            return;
        }

        _hasUnsavedChanges = true;
        UpdateItemsSummary();
        UpdateEditorUi();
    }

    private static void SelectComboItem(ComboBox comboBox, string value)
    {
        foreach (ComboBoxItem item in comboBox.Items)
        {
            if (string.Equals(item.Content?.ToString(), value, StringComparison.OrdinalIgnoreCase))
            {
                comboBox.SelectedItem = item;
                return;
            }
        }

        if (comboBox.Items.Count > 0)
        {
            comboBox.SelectedIndex = 0;
        }
    }

    private static string ComboText(ComboBox comboBox)
    {
        return (comboBox.SelectedItem as ComboBoxItem)?.Content?.ToString() ?? string.Empty;
    }

    private static string ReadTaskIdFromSender(object sender)
    {
        return (sender as FrameworkElement)?.Tag?.ToString() ?? string.Empty;
    }
}
