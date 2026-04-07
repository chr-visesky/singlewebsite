using System;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using DictationApp.Models;
using DictationApp.Services;

namespace DictationApp.Views;

public partial class TaskSessionWindow : Window
{
    private readonly DictationTask _task;
    private readonly DictationSpeechService _speechService;
    private int _currentIndex;
    private bool _checked;
    private bool _revealed;

    public TaskSessionWindow(DictationTask task, DictationSpeechService speechService)
    {
        InitializeComponent();
        _task = task;
        _speechService = speechService;
        HeaderTextBlock.Text = task.Title;
        UpdateCurrentItem();
    }

    private bool HasItems => _task.Items is { Count: > 0 };

    private DictationTaskItem? CurrentItem => HasItems ? _task.Items[_currentIndex] : null;

    private void UpdateCurrentItem()
    {
        if (!HasItems || CurrentItem is null)
        {
            ProgressTextBlock.Text = "当前任务没有可执行内容";
            InstructionTextBlock.Text = "请返回上一页检查任务内容。";
            AnswerTextBlock.Text = "当前任务为空";
            ResultTextBlock.Text = string.Empty;
            AttemptTextBox.Text = string.Empty;
            AttemptTextBox.IsEnabled = false;
            PlayButton.IsEnabled = false;
            CheckButton.IsEnabled = false;
            RevealButton.IsEnabled = false;
            NextButton.IsEnabled = false;
            return;
        }

        ProgressTextBlock.Text = $"第 {_currentIndex + 1} 项 / 共 {_task.Items.Count} 项";
        InstructionTextBlock.Text = "先播放并自己写下来，再核对答案。";
        AnswerTextBlock.Text = _revealed ? CurrentItem.Text : "先完成作答，再核对答案";
        AttemptTextBox.IsEnabled = true;
        PlayButton.IsEnabled = true;
        RevealButton.IsEnabled = !_revealed;
        CheckButton.IsEnabled = !_checked && !string.IsNullOrWhiteSpace(AttemptTextBox.Text);
        NextButton.IsEnabled = _checked && _currentIndex < _task.Items.Count - 1;
    }

    private async Task PlayCurrentAsync()
    {
        if (CurrentItem is null)
        {
            return;
        }

        try
        {
            await _speechService.SpeakAsync(CurrentItem.Text, _task.Language);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "播放失败", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private static string NormalizeComparisonValue(string value)
    {
        var builder = new StringBuilder();

        foreach (char character in value ?? string.Empty)
        {
            if (!char.IsWhiteSpace(character) && !char.IsPunctuation(character))
            {
                builder.Append(char.ToUpperInvariant(character));
            }
        }

        return builder.ToString();
    }

    private static int CountMatchingPrefixLength(string left, string right)
    {
        int length = Math.Min(left.Length, right.Length);
        int matchCount = 0;

        while (matchCount < length && left[matchCount] == right[matchCount])
        {
            matchCount += 1;
        }

        return matchCount;
    }

    private string BuildCheckResult(string attempt, string answer)
    {
        string normalizedAttempt = NormalizeComparisonValue(attempt);
        string normalizedAnswer = NormalizeComparisonValue(answer);

        if (normalizedAttempt.Length == 0)
        {
            return "还没有填写内容，请先自己写再核对。";
        }

        if (string.Equals(normalizedAttempt, normalizedAnswer, StringComparison.Ordinal))
        {
            return "答对了，可以进入下一项。";
        }

        int prefixMatches = CountMatchingPrefixLength(normalizedAttempt, normalizedAnswer);
        int missingCount = Math.Max(0, normalizedAnswer.Length - prefixMatches);

        return $"未完全匹配。你先自己写了 {normalizedAttempt.Length} 个有效字符，和标准答案前 {prefixMatches} 个字符一致，后面还有 {missingCount} 个字符需要再听。";
    }

    private async void PlayButton_OnClick(object sender, RoutedEventArgs e)
    {
        await PlayCurrentAsync();
    }

    private void AttemptTextBox_OnTextChanged(object sender, TextChangedEventArgs e)
    {
        CheckButton.IsEnabled = HasItems && !_checked && !string.IsNullOrWhiteSpace(AttemptTextBox.Text);
    }

    private void CheckButton_OnClick(object sender, RoutedEventArgs e)
    {
        if (CurrentItem is null)
        {
            return;
        }

        string attempt = AttemptTextBox.Text.Trim();

        if (string.IsNullOrWhiteSpace(attempt))
        {
            MessageBox.Show(this, "请先自己写，再核对答案。", "还不能核对", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }

        _checked = true;
        _revealed = true;
        ResultTextBlock.Text = BuildCheckResult(attempt, CurrentItem.Text);
        UpdateCurrentItem();
    }

    private void RevealButton_OnClick(object sender, RoutedEventArgs e)
    {
        if (CurrentItem is null)
        {
            return;
        }

        _checked = true;
        _revealed = true;

        if (string.IsNullOrWhiteSpace(AttemptTextBox.Text))
        {
            ResultTextBlock.Text = "本项已跳过。建议先听一遍并自己写，再进入下一项。";
        }
        else
        {
            ResultTextBlock.Text = $"{BuildCheckResult(AttemptTextBox.Text.Trim(), CurrentItem.Text)} 已为你展开标准答案。";
        }

        UpdateCurrentItem();
    }

    private void NextButton_OnClick(object sender, RoutedEventArgs e)
    {
        if (!HasItems || _currentIndex >= _task.Items.Count - 1)
        {
            return;
        }

        _currentIndex += 1;
        _checked = false;
        _revealed = false;
        AttemptTextBox.Text = string.Empty;
        ResultTextBlock.Text = string.Empty;
        UpdateCurrentItem();
    }

    private void FinishButton_OnClick(object sender, RoutedEventArgs e)
    {
        DialogResult = true;
    }
}
