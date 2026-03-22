using System.Collections.Generic;
using System.Linq;
using System.Windows;
using RecitationApp.Models;
using RecitationApp.Services;
using RecitationApp.Views;

namespace RecitationApp;

public partial class MainWindow : Window
{
    private readonly RecitationTaskStore _taskStore;
    private readonly RecitationAudioRecorder _audioRecorder;
    private readonly RecitationTranscriptionService _transcriptionService;
    private readonly RecitationDiffService _diffService;
    private List<RecitationTask> _tasks = new();

    public MainWindow(
        RecitationTaskStore taskStore,
        RecitationAudioRecorder audioRecorder,
        RecitationTranscriptionService transcriptionService,
        RecitationDiffService diffService)
    {
        InitializeComponent();
        _taskStore = taskStore;
        _audioRecorder = audioRecorder;
        _transcriptionService = transcriptionService;
        _diffService = diffService;
        LoadTasks();
    }

    private RecitationTask? SelectedTask => TaskListBox.SelectedItem as RecitationTask;

    private void LoadTasks(string? selectedTaskId = null)
    {
        _tasks = _taskStore.GetAllTasks().ToList();
        TaskListBox.ItemsSource = _tasks;
        RecitationTask? selectedTask = _tasks.FirstOrDefault(item => item.TaskId == selectedTaskId)
            ?? _tasks.FirstOrDefault();
        TaskListBox.SelectedItem = selectedTask;
        UpdateTaskDetails(selectedTask);
    }

    private void UpdateTaskDetails(RecitationTask? task)
    {
        EditButton.IsEnabled = task is not null;
        StartButton.IsEnabled = task is not null;

        if (task is null)
        {
            TitleTextBlock.Text = "请选择一个背诵任务";
            MetaTextBlock.Text = string.Empty;
            SourceTextBox.Text = string.Empty;
            LatestResultTextBox.Text = "背诵结束后会显示最近一次转写和差异摘要。";
            return;
        }

        TitleTextBlock.Text = task.Title;
        MetaTextBlock.Text = $"{task.Subject} · {task.Bucket} · {task.TargetDate:yyyy-MM-dd}";
        SourceTextBox.Text = task.SourceText;
        LatestResultTextBox.Text = string.IsNullOrWhiteSpace(task.LastDiffSummary)
            ? "还没有背诵结果。"
            : $"转写：{task.LastTranscript}\n\n差异：\n{task.LastDiffSummary}";
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
            RecitationTask task = _taskStore.Save(editorWindow.BuildTask());
            LoadTasks(task.TaskId);
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
            RecitationTask task = _taskStore.Save(editorWindow.BuildTask(SelectedTask.TaskId, SelectedTask.CreatedAt));
            LoadTasks(task.TaskId);
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

        var sessionWindow = new TaskSessionWindow(
            SelectedTask,
            _taskStore,
            _audioRecorder,
            _transcriptionService,
            _diffService)
        {
            Owner = this
        };

        sessionWindow.ShowDialog();
        LoadTasks(SelectedTask.TaskId);
    }

    private void CloseButton_OnClick(object sender, RoutedEventArgs e)
    {
        Close();
    }
}
