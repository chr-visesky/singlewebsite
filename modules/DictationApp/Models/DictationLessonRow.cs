using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Windows.Ink;
using System.Windows.Media;
using DictationApp.Services;

namespace DictationApp.Models;

public sealed class DictationLessonRow : INotifyPropertyChanged
{
    private string _statusLevel = "Pending";
    private string _statusText = "待听写";
    private string _detailText = "准备好后开始本课听写。";
    private ImageSource? _savedPreviewImage;
    private string _savedDisplayText = "待作答";
    private string _recognizedText = string.Empty;
    private bool _showRecognition;
    private bool _showAnswer;
    private bool _isCurrentItem;
    private bool _needsRetry;

    public DictationLessonRow(int itemNumber, DictationTaskItem item)
    {
        ItemNumber = itemNumber;
        Item = item;
    }

    public int ItemNumber { get; }

    public DictationTaskItem Item { get; }

    public StrokeCollection? SavedStrokes { get; private set; }

    public string ItemNumberLabel => ItemNumber.ToString("00");

    public string AnswerText => Item.Text?.Trim() ?? string.Empty;

    public string HintText => Item.Hint?.Trim() ?? string.Empty;

    public bool HasHint => !string.IsNullOrWhiteSpace(HintText);

    public string StatusAutomationId => $"DictationLessonStatusRow{ItemNumber}";

    public string CardAutomationId => $"DictationLessonCardRow{ItemNumber}";

    public string SavedDisplayAutomationId => $"DictationLessonSavedRow{ItemNumber}";

    public string RecognitionAutomationId => $"DictationLessonRecognitionRow{ItemNumber}";

    public string AnswerAutomationId => $"DictationLessonAnswerRow{ItemNumber}";

    public string CardAutomationName => BuildCardAutomationName();

    public string StatusLevel
    {
        get => _statusLevel;
        private set => SetField(ref _statusLevel, value);
    }

    public string StatusText
    {
        get => _statusText;
        private set => SetField(ref _statusText, value);
    }

    public string DetailText
    {
        get => _detailText;
        private set => SetField(ref _detailText, value);
    }

    public ImageSource? SavedPreviewImage
    {
        get => _savedPreviewImage;
        private set
        {
            if (!SetField(ref _savedPreviewImage, value))
            {
                return;
            }

            RaisePropertyChanged(nameof(HasSavedPreview));
            RaisePropertyChanged(nameof(ShowSavedPlaceholder));
        }
    }

    public bool HasSavedPreview => SavedPreviewImage is not null;

    public bool ShowSavedPlaceholder => !HasSavedPreview;

    public string SavedDisplayText
    {
        get => _savedDisplayText;
        private set => SetField(ref _savedDisplayText, value);
    }

    public string RecognizedText
    {
        get => _recognizedText;
        private set => SetField(ref _recognizedText, value);
    }

    public bool ShowRecognition
    {
        get => _showRecognition;
        private set => SetField(ref _showRecognition, value);
    }

    public bool ShowAnswer
    {
        get => _showAnswer;
        private set => SetField(ref _showAnswer, value);
    }

    public bool IsCurrentItem
    {
        get => _isCurrentItem;
        private set => SetField(ref _isCurrentItem, value);
    }

    public bool NeedsRetry
    {
        get => _needsRetry;
        private set => SetField(ref _needsRetry, value);
    }

    public void ResetForLessonStart()
    {
        SavedStrokes = null;
        SavedPreviewImage = null;
        SavedDisplayText = "待作答";
        RecognizedText = string.Empty;
        ShowRecognition = false;
        ShowAnswer = false;
        NeedsRetry = false;
        IsCurrentItem = false;
        StatusLevel = "Pending";
        StatusText = "待听写";
        DetailText = "准备好后开始本课听写。";
    }

    public void PrepareForRetryRound()
    {
        RecognizedText = string.Empty;
        ShowRecognition = false;
        ShowAnswer = false;
        NeedsRetry = true;
        IsCurrentItem = false;
        StatusLevel = "Retry";
        StatusText = "待重写";
        DetailText = "这一题会进入错词重听，重写后再统一批改。";
    }

    public void SetPresenting(string detailText)
    {
        StatusLevel = "Presenting";
        StatusText = "正在听题";
        DetailText = detailText;
        IsCurrentItem = true;
    }

    public void SetWriting(string detailText)
    {
        StatusLevel = "Writing";
        StatusText = "正在作答";
        DetailText = detailText;
        IsCurrentItem = true;
    }

    public void SaveAttempt(StrokeCollection? strokes, ImageSource? previewImage, string fallbackDisplayText, bool isRetryRound)
    {
        SavedStrokes = strokes?.Clone();
        SavedPreviewImage = previewImage;
        SavedDisplayText = previewImage is not null
            ? (isRetryRound ? "已重写笔迹" : "已保存笔迹")
            : fallbackDisplayText;
        RecognizedText = string.Empty;
        ShowRecognition = false;
        ShowAnswer = false;
        NeedsRetry = false;
        IsCurrentItem = false;
        StatusLevel = "Captured";
        StatusText = isRetryRound ? "已重写" : "已保存";
        DetailText = isRetryRound
            ? "这题已经重新书写，等待统一批改。"
            : "这题已经保存，继续下一题。";
    }

    public void SetChecking()
    {
        StatusLevel = "Checking";
        StatusText = "识别中";
        DetailText = "正在识别这一题的手写内容。";
        IsCurrentItem = false;
    }

    public void ApplyAssessment(DictationAssessment assessment)
    {
        StatusLevel = assessment.StatusLevel;
        StatusText = assessment.StatusText;
        DetailText = assessment.DetailText;
        RecognizedText = assessment.RecognizedText;
        ShowRecognition = assessment.ShowRecognition;
        ShowAnswer = assessment.ShowAnswer;
        NeedsRetry = assessment.NeedsRetry;
        IsCurrentItem = false;
    }

    public void ClearCurrentMarker()
    {
        IsCurrentItem = false;
    }

    public StrokeCollection? GetSavedStrokesClone()
    {
        return SavedStrokes?.Clone();
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    private bool SetField<T>(ref T field, T value, [CallerMemberName] string? propertyName = null)
    {
        if (Equals(field, value))
        {
            return false;
        }

        field = value;
        RaisePropertyChanged(propertyName);
        RaisePropertyChanged(nameof(CardAutomationName));
        return true;
    }

    private string BuildCardAutomationName()
    {
        string recognizedText = string.IsNullOrWhiteSpace(RecognizedText) ? "无" : RecognizedText.Trim();
        string savedText = string.IsNullOrWhiteSpace(SavedDisplayText) ? "空白" : SavedDisplayText.Trim();
        return $"题号 {ItemNumberLabel}；状态 {StatusText}；展示 {savedText}；识别 {recognizedText}；标准答案 {AnswerText}";
    }

    private void RaisePropertyChanged(string? propertyName)
    {
        if (string.IsNullOrWhiteSpace(propertyName))
        {
            return;
        }

        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
    }
}
