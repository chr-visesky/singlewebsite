using System;
using System.Threading.Tasks;
using System.Windows;
using DictationApp.Models;
using DictationApp.Services;

namespace DictationApp.Views;

public partial class TaskSessionWindow : Window
{
    private readonly DictationTask _task;
    private readonly DictationSpeechService _speechService;
    private int _currentIndex;
    private bool _revealed;

    public TaskSessionWindow(DictationTask task, DictationSpeechService speechService)
    {
        InitializeComponent();
        _task = task;
        _speechService = speechService;
        HeaderTextBlock.Text = task.Title;
        UpdateCurrentItem();
    }

    private DictationTaskItem CurrentItem => _task.Items[_currentIndex];

    private void UpdateCurrentItem()
    {
        ProgressTextBlock.Text = $"第 {_currentIndex + 1} 项 / 共 {_task.Items.Count} 项";
        AnswerTextBlock.Text = _revealed ? CurrentItem.Text : "******";
        RevealButton.Content = _revealed ? "隐藏答案" : "查看答案";
        NextButton.IsEnabled = _currentIndex < _task.Items.Count - 1;
    }

    private async Task PlayCurrentAsync()
    {
        try
        {
            await _speechService.SpeakAsync(CurrentItem.Text, _task.Language);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "播放失败", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private async void PlayButton_OnClick(object sender, RoutedEventArgs e)
    {
        await PlayCurrentAsync();
    }

    private void RevealButton_OnClick(object sender, RoutedEventArgs e)
    {
        _revealed = !_revealed;
        UpdateCurrentItem();
    }

    private void NextButton_OnClick(object sender, RoutedEventArgs e)
    {
        if (_currentIndex >= _task.Items.Count - 1)
        {
            return;
        }

        _currentIndex += 1;
        _revealed = false;
        UpdateCurrentItem();
    }

    private void FinishButton_OnClick(object sender, RoutedEventArgs e)
    {
        DialogResult = true;
    }
}
