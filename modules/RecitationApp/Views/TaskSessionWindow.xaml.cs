using System;
using System.Windows;
using RecitationApp.Models;
using RecitationApp.Services;

namespace RecitationApp.Views;

public partial class TaskSessionWindow : Window
{
    private readonly RecitationTask _task;
    private readonly RecitationTaskStore _taskStore;
    private readonly RecitationAudioRecorder _audioRecorder;
    private readonly RecitationTranscriptionService _transcriptionService;
    private readonly RecitationDiffService _diffService;

    public TaskSessionWindow(
        RecitationTask task,
        RecitationTaskStore taskStore,
        RecitationAudioRecorder audioRecorder,
        RecitationTranscriptionService transcriptionService,
        RecitationDiffService diffService)
    {
        InitializeComponent();
        _task = task;
        _taskStore = taskStore;
        _audioRecorder = audioRecorder;
        _transcriptionService = transcriptionService;
        _diffService = diffService;
        HeaderTextBlock.Text = task.Title;
        SourceTextBox.Text = task.SourceText;
        TranscriptTextBox.Text = task.LastTranscript;
        DiffTextBox.Text = task.LastDiffSummary;
        UpdateRecordingButtons();
    }

    private void UpdateRecordingButtons()
    {
        StartRecordingButton.IsEnabled = !_audioRecorder.IsRecording;
        StopRecordingButton.IsEnabled = _audioRecorder.IsRecording;
    }

    private void HideSourceCheckBox_OnChanged(object sender, RoutedEventArgs e)
    {
        SourceTextBox.Visibility = HideSourceCheckBox.IsChecked == true
            ? Visibility.Collapsed
            : Visibility.Visible;
    }

    private void StartRecordingButton_OnClick(object sender, RoutedEventArgs e)
    {
        try
        {
            _audioRecorder.Start(_task.TaskId);
            StatusTextBlock.Text = "录音中，请开始背诵。";
            UpdateRecordingButtons();
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "开始录音失败", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private async void StopRecordingButton_OnClick(object sender, RoutedEventArgs e)
    {
        try
        {
            string recordingPath = await _audioRecorder.StopAsync();
            StatusTextBlock.Text = "正在转写并比对。";
            UpdateRecordingButtons();
            RecitationTranscriptionResult transcription = await _transcriptionService.TranscribeAsync(recordingPath);
            string transcript = transcription.Text;
            string diffSummary = string.IsNullOrWhiteSpace(transcript)
                ? transcription.Error
                : _diffService.BuildSummary(_task.SourceText, transcript);
            RecitationTask updatedTask = _taskStore.SaveResult(_task.TaskId, transcript, diffSummary, recordingPath);
            TranscriptTextBox.Text = updatedTask.LastTranscript;
            DiffTextBox.Text = updatedTask.LastDiffSummary;
            StatusTextBlock.Text = string.IsNullOrWhiteSpace(transcription.Error)
                ? $"转写完成，置信度 {transcription.Confidence:P0}。"
                : $"转写完成，但结果不完整：{transcription.Error}";
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "停止录音失败", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private void FinishButton_OnClick(object sender, RoutedEventArgs e)
    {
        DialogResult = true;
    }
}
