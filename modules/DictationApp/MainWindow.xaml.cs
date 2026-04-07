using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using DictationApp.Models;
using DictationApp.Services;
using DictationApp.Views;

namespace DictationApp;

public partial class MainWindow : Window
{
    private const int PreviewItemLimit = 8;
    private readonly DictationTaskStore _taskStore;
    private readonly DictationSpeechService _speechService;
    private List<DictationTask> _tasks = new();

    public MainWindow(DictationTaskStore taskStore, DictationSpeechService speechService)
    {
        InitializeComponent();
        _taskStore = taskStore;
        _speechService = speechService;
        LoadTasks();
    }

    private DictationTask? SelectedTask => TaskListBox.SelectedItem as DictationTask;

    private void LoadTasks(string? selectedTaskId = null)
    {
        _tasks = _taskStore.GetAllTasks().ToList();
        TaskListBox.ItemsSource = _tasks;
        DictationTask? selectedTask = _tasks.FirstOrDefault(item => item.TaskId == selectedTaskId)
            ?? _tasks.FirstOrDefault();
        TaskListBox.SelectedItem = selectedTask;
        UpdateTaskDetails(selectedTask);
    }

    private void UpdateTaskDetails(DictationTask? task)
    {
        bool hasTask = task is not null;
        EditButton.IsEnabled = hasTask;
        StartButton.IsEnabled = hasTask;

        if (task is null)
        {
            TitleTextBlock.Text = "请选择一个听写任务";
            MetaTextBlock.Text = string.Empty;
            DescriptionTextBlock.Text = "支持手工创建、AI agent 导入和后续云端导入。";
            PreviewListBox.ItemsSource = Array.Empty<string>();
            return;
        }

        TitleTextBlock.Text = task.Title;
        MetaTextBlock.Text = $"{task.Subject} | {task.Bucket} | {task.TargetDate:yyyy-MM-dd} | {task.Language}";
        DescriptionTextBlock.Text = $"共 {task.Items.Count} 项。首页只显示轻量预览，开始后先自己写，再核对答案。";
        PreviewListBox.ItemsSource = BuildPreviewItems(task);
    }

    private void TaskListBox_OnSelectionChanged(object sender, System.Windows.Controls.SelectionChangedEventArgs e)
    {
        UpdateTaskDetails(SelectedTask);
    }

    private void CreateButton_OnClick(object sender, RoutedEventArgs e)
    {
        var editorWindow = new TaskEditorWindow();

        if (editorWindow.ShowDialog() == true)
        {
            DictationTask savedTask = _taskStore.Save(editorWindow.BuildTask());
            LoadTasks(savedTask.TaskId);
        }
    }

    private void EditButton_OnClick(object sender, RoutedEventArgs e)
    {
        if (SelectedTask is null)
        {
            return;
        }

        var editorWindow = new TaskEditorWindow(SelectedTask);

        if (editorWindow.ShowDialog() == true)
        {
            DictationTask savedTask = _taskStore.Save(editorWindow.BuildTask(SelectedTask.TaskId, SelectedTask.CreatedAt));
            LoadTasks(savedTask.TaskId);
        }
    }

    private void RefreshButton_OnClick(object sender, RoutedEventArgs e)
    {
        LoadTasks(SelectedTask?.TaskId);
    }

    private void StartButton_OnClick(object sender, RoutedEventArgs e)
    {
        if (SelectedTask is null)
        {
            return;
        }

        var sessionWindow = new TaskSessionWindow(SelectedTask, _speechService)
        {
            Owner = this
        };
        sessionWindow.ShowDialog();
    }

    private void CloseButton_OnClick(object sender, RoutedEventArgs e)
    {
        Close();
    }

    private static List<string> BuildPreviewItems(DictationTask task)
    {
        List<string> previewItems = task.Items
            .Take(PreviewItemLimit)
            .Select((item, index) => BuildPreviewLine(item, task.Language, index + 1))
            .ToList();

        int remainingCount = Math.Max(0, task.Items.Count - previewItems.Count);

        if (remainingCount > 0)
        {
            previewItems.Add($"还有 {remainingCount} 项未展开，进入听写后逐项核对。");
        }

        if (previewItems.Count == 0)
        {
            previewItems.Add("当前任务还没有可执行的听写内容。");
        }

        return previewItems;
    }

    private static string BuildPreviewLine(DictationTaskItem item, string language, int index)
    {
        if (!string.IsNullOrWhiteSpace(item.Hint))
        {
            return $"{index}. 提示：{item.Hint}";
        }

        string text = item.Text?.Trim() ?? string.Empty;
        int visibleCount = text.Count((character) => !char.IsWhiteSpace(character));
        bool isEnglish = (language ?? string.Empty).Contains("英", StringComparison.OrdinalIgnoreCase);
        string unit = isEnglish ? "letters" : "字";
        string maskedText = new string('•', Math.Max(2, Math.Min(visibleCount, 8)));

        return $"{index}. {maskedText} ({visibleCount} {unit})";
    }
}
