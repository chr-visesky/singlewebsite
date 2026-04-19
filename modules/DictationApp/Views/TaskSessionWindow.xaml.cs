using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Ink;
using System.Windows.Media;
using DictationApp.Models;
using DictationApp.Services;

namespace DictationApp.Views;

public partial class TaskSessionWindow : Window
{
    private const int RepeatPauseMilliseconds = 500;
    private readonly DictationTask _task;
    private readonly DictationSessionSettings _settings;
    private readonly DictationSpeechService _speechService;
    private readonly DictationHandwritingRecognitionService _recognitionService;
    private readonly DictationAssessmentService _assessmentService = new();
    private readonly List<DictationLessonRow> _allRows;
    private readonly Dictionary<int, DictationHandwritingRecognitionResult> _recognitionFixture;
    private bool _isInkCanvasLoaded;
    private bool _isClosed;
    private bool _flowStarted;
    private List<DictationLessonRow> _currentRoundRows = new();
    private SessionPhase _phase = SessionPhase.Preparing;
    private SessionRound _round = SessionRound.Lesson;
    private int _currentRoundIndex = -1;
    private string _lastSummary = string.Empty;

    private enum SessionPhase
    {
        Preparing,
        Prompting,
        Writing,
        Checking,
        Completed
    }

    private enum SessionRound
    {
        Lesson,
        WrongOnly
    }

    public TaskSessionWindow(
        DictationTask task,
        DictationSessionSettings settings,
        DictationSpeechService speechService,
        DictationHandwritingRecognitionService recognitionService)
    {
        InitializeComponent();
        _task = task;
        _settings = settings ?? new DictationSessionSettings();
        _speechService = speechService;
        _recognitionService = recognitionService;
        _recognitionFixture = LoadRecognitionFixture();
        _allRows = task.Items.Select((item, index) => new DictationLessonRow(index + 1, item)).ToList();
        LessonItemsControl.ItemsSource = _allRows;
        InitializeSession();
    }

    private bool HasItems => _allRows.Count > 0;

    private DictationLessonRow? CurrentRow => _currentRoundIndex >= 0 && _currentRoundIndex < _currentRoundRows.Count
        ? _currentRoundRows[_currentRoundIndex]
        : null;

    private IReadOnlyList<DictationLessonRow> RetryRows => _currentRoundRows.Where((row) => row.NeedsRetry).ToList();

    private void InitializeSession()
    {
        Title = "本课听写";

        if (!HasItems)
        {
            _phase = SessionPhase.Completed;
            ProgressTextBlock.Text = "当前任务没有可执行内容";
            ModeTextBlock.Text = "空任务";
            SummaryTextBlock.Text = "这一课没有可听写的内容。";
            InstructionTextBlock.Text = "没有可执行内容";
            FooterTextBlock.Text = "请关闭窗口后返回任务列表。";
            CurrentQuestionTextBlock.Text = "当前题目：暂无内容";
            CurrentStatusTextBlock.Text = "无法开始";
            ClearWritingButton.IsEnabled = false;
            AnswerInkCanvas.IsEnabled = false;
            return;
        }

        ResetLessonRows();
        ProgressTextBlock.Text = $"本课共 {_allRows.Count} 题";
        ModeTextBlock.Text = "整课听写";
        SummaryTextBlock.Text = $"设置：每题播放 {_settings.RepeatCount} 遍，等待书写 {_settings.WriteSeconds} 秒。";
        InstructionTextBlock.Text = "进入后会自动开始，按题推进。";
        FooterTextBlock.Text = "上方只保留题号展示区，下方只保留单一手写区。";
        CurrentQuestionTextBlock.Text = "当前题目：准备开始";
        CurrentStatusTextBlock.Text = "等待开始";
        ClearWritingButton.IsEnabled = false;
        AnswerInkCanvas.IsEnabled = false;
    }

    private void ResetLessonRows()
    {
        foreach (DictationLessonRow row in _allRows)
        {
            row.ResetForLessonStart();
        }
    }

    private async void Window_OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_flowStarted || !HasItems)
        {
            return;
        }

        _flowStarted = true;
        await Task.Delay(450);

        if (_isClosed)
        {
            return;
        }

        await RunRoundAsync(SessionRound.Lesson, _allRows, isFirstLessonRound: true);
    }

    private void Window_OnClosed(object sender, EventArgs e)
    {
        _isClosed = true;
    }

    private async Task RunRoundAsync(SessionRound round, IReadOnlyList<DictationLessonRow> rows, bool isFirstLessonRound)
    {
        _round = round;
        _currentRoundRows = rows
            .Distinct()
            .OrderBy((row) => row.ItemNumber)
            .ToList();
        _currentRoundIndex = -1;
        _lastSummary = string.Empty;

        if (round == SessionRound.Lesson && isFirstLessonRound)
        {
            ResetLessonRows();
        }

        if (round == SessionRound.WrongOnly)
        {
            foreach (DictationLessonRow row in _currentRoundRows)
            {
                row.PrepareForRetryRound();
            }
        }

        ClearWritingSurface();
        ProgressTextBlock.Text = round == SessionRound.Lesson
            ? $"本课共 {_currentRoundRows.Count} 题"
            : $"错词重听 {_currentRoundRows.Count} 题";
        ModeTextBlock.Text = round == SessionRound.Lesson ? "整课听写" : "错词重听";
        SummaryTextBlock.Text = $"设置：每题播放 {_settings.RepeatCount} 遍，等待书写 {_settings.WriteSeconds} 秒。";
        InstructionTextBlock.Text = round == SessionRound.Lesson ? "整课自动推进中。" : "正在重听没有通过的题。";
        FooterTextBlock.Text = "底部手写区时间到后会自动收进上方对应题号。";

        for (int index = 0; index < _currentRoundRows.Count; index += 1)
        {
            if (_isClosed)
            {
                return;
            }

            _currentRoundIndex = index;
            DictationLessonRow row = _currentRoundRows[index];
            SetCurrentRow(row);

            await PresentCurrentRowAsync(row, index + 1, _currentRoundRows.Count);

            if (_isClosed)
            {
                return;
            }

            await CaptureCurrentRowAfterWritingWindowAsync(row);
        }

        if (_isClosed)
        {
            return;
        }

        _currentRoundIndex = -1;
        ClearCurrentMarkers();
        await CheckCurrentRoundAsync();

        if (_isClosed)
        {
            return;
        }

        if (RetryRows.Count > 0 && round == SessionRound.Lesson)
        {
            await Task.Delay(900);
            await RunRoundAsync(SessionRound.WrongOnly, RetryRows, isFirstLessonRound: false);
            return;
        }

        _phase = SessionPhase.Completed;
        UpdateCompletionUi();
    }

    private void SetCurrentRow(DictationLessonRow row)
    {
        foreach (DictationLessonRow item in _allRows)
        {
            item.ClearCurrentMarker();
        }

        row.SetPresenting(string.Empty);
    }

    private async Task PresentCurrentRowAsync(DictationLessonRow row, int displayIndex, int totalCount)
    {
        _phase = SessionPhase.Prompting;
        ClearWritingSurface();
        AnswerInkCanvas.IsEnabled = false;
        ClearWritingButton.IsEnabled = false;
        ProgressTextBlock.Text = _round == SessionRound.Lesson
            ? $"本课第 {displayIndex}/{totalCount} 题"
            : $"错词第 {displayIndex}/{totalCount} 题";
        InstructionTextBlock.Text = "正在播放当前题。";
        FooterTextBlock.Text = "播放结束后进入书写时间。";
        CurrentQuestionTextBlock.Text = $"当前题目：第 {row.ItemNumberLabel} 题";
        CurrentStatusTextBlock.Text = "正在播放";

        for (int repeatIndex = 0; repeatIndex < _settings.RepeatCount; repeatIndex += 1)
        {
            await _speechService.SpeakAsync(row.AnswerText, _task.Language);

            if (repeatIndex < _settings.RepeatCount - 1)
            {
                await Task.Delay(RepeatPauseMilliseconds);
            }
        }
    }

    private async Task CaptureCurrentRowAfterWritingWindowAsync(DictationLessonRow row)
    {
        row.SetWriting(string.Empty);
        _phase = SessionPhase.Writing;
        AnswerInkCanvas.IsEnabled = true;
        ClearWritingButton.IsEnabled = true;
        InstructionTextBlock.Text = "正在书写当前题。";
        FooterTextBlock.Text = "只有清空手写按钮，其余操作会自动推进。";
        CurrentStatusTextBlock.Text = "正在书写";

        await Task.Delay(TimeSpan.FromSeconds(_settings.WriteSeconds));

        if (_isClosed)
        {
            return;
        }

        SaveCurrentInkToRow(row);
        ClearWritingSurface();
        AnswerInkCanvas.IsEnabled = false;
        ClearWritingButton.IsEnabled = false;
    }

    private void SaveCurrentInkToRow(DictationLessonRow row)
    {
        bool hasInk = _isInkCanvasLoaded && AnswerInkCanvas.Strokes.Count > 0;
        bool hasFixture = TryGetFixtureResult(row, out DictationHandwritingRecognitionResult fixtureResult);
        StrokeCollection? savedStrokes = hasInk ? AnswerInkCanvas.Strokes.Clone() : null;
        ImageSource? previewImage = DictationInkPreviewRenderer.Render(savedStrokes);
        string fallbackDisplayText = hasFixture ? BuildFixtureDisplayText(fixtureResult) : string.Empty;
        row.SaveAttempt(savedStrokes, previewImage, fallbackDisplayText, _round == SessionRound.WrongOnly);
    }

    private async Task CheckCurrentRoundAsync()
    {
        _phase = SessionPhase.Checking;
        InstructionTextBlock.Text = "正在批改本轮听写。";
        FooterTextBlock.Text = "系统会严格识别和判对，不会把模糊笔迹直接判对。";
        CurrentQuestionTextBlock.Text = "当前题目：批改中";
        CurrentStatusTextBlock.Text = "批改中";

        int correctCount = 0;
        int retryCount = 0;
        int wrongCount = 0;

        foreach (DictationLessonRow row in _currentRoundRows)
        {
            row.SetChecking();
            await Dispatcher.InvokeAsync(() => { }, System.Windows.Threading.DispatcherPriority.Background);
            DictationHandwritingRecognitionResult recognition = TryGetFixtureResult(row, out DictationHandwritingRecognitionResult fixtureResult)
                ? fixtureResult
                : await _recognitionService.RecognizeAsync(row.GetSavedStrokesClone(), _task.Language);
            DictationAssessment assessment = _assessmentService.Evaluate(recognition, row.AnswerText, _task.Language);
            row.ApplyAssessment(assessment);

            switch (assessment.StatusLevel)
            {
                case "Correct":
                    correctCount += 1;
                    break;

                case "Wrong":
                    wrongCount += 1;
                    break;

                default:
                    retryCount += 1;
                    break;
            }
        }

        _lastSummary = $"本轮 {_currentRoundRows.Count} 题，正确 {correctCount} 题，需要重写 {retryCount} 题，写错 {wrongCount} 题。";
        SummaryTextBlock.Text = _lastSummary;
    }

    private void UpdateCompletionUi()
    {
        ProgressTextBlock.Text = RetryRows.Count == 0
            ? $"本课共 {_allRows.Count} 题"
            : $"错词重听 {_currentRoundRows.Count} 题";
        ModeTextBlock.Text = RetryRows.Count == 0 ? "本课完成" : "本轮结束";
        SummaryTextBlock.Text = _lastSummary;
        InstructionTextBlock.Text = RetryRows.Count == 0 ? "本课已完成。" : "这一轮结束，仍有题目未通过。";
        FooterTextBlock.Text = RetryRows.Count == 0
            ? "可以直接关闭窗口。"
            : "可以关闭后重新进入本课继续练习。";
        CurrentQuestionTextBlock.Text = RetryRows.Count == 0 ? "当前题目：本课完成" : "当前题目：仍有未通过题";
        CurrentStatusTextBlock.Text = RetryRows.Count == 0 ? "已完成" : "本轮结束";
        AnswerInkCanvas.IsEnabled = false;
        ClearWritingButton.IsEnabled = false;
    }

    private void ClearCurrentMarkers()
    {
        foreach (DictationLessonRow row in _allRows)
        {
            row.ClearCurrentMarker();
        }
    }

    private static string BuildFixtureDisplayText(DictationHandwritingRecognitionResult fixtureResult)
    {
        return string.IsNullOrWhiteSpace(fixtureResult.Text) ? string.Empty : fixtureResult.Text;
    }

    private void ClearWritingSurface()
    {
        if (_isInkCanvasLoaded)
        {
            AnswerInkCanvas.Strokes.Clear();
        }
    }

    private void AnswerInkCanvas_OnLoaded(object sender, RoutedEventArgs e)
    {
        AnswerInkCanvas.DefaultDrawingAttributes = new DrawingAttributes
        {
            Color = Colors.Black,
            Width = 3.6,
            Height = 3.6,
            FitToCurve = true,
            IgnorePressure = false,
            StylusTip = StylusTip.Ellipse,
            StylusTipTransform = Matrix.Identity,
            IsHighlighter = false
        };
        AnswerInkCanvas.EditingMode = InkCanvasEditingMode.Ink;
        AnswerInkCanvas.Strokes.StrokesChanged += AnswerInkCanvasStrokes_OnChanged;
        _isInkCanvasLoaded = true;
    }

    private void AnswerInkCanvas_OnUnloaded(object sender, RoutedEventArgs e)
    {
        AnswerInkCanvas.Strokes.StrokesChanged -= AnswerInkCanvasStrokes_OnChanged;
        _isInkCanvasLoaded = false;
    }

    private void AnswerInkCanvasStrokes_OnChanged(object? sender, StrokeCollectionChangedEventArgs e)
    {
        // The visible session UI intentionally keeps the writing area clean.
    }

    private void ClearWritingButton_OnClick(object sender, RoutedEventArgs e)
    {
        if (_phase != SessionPhase.Writing)
        {
            return;
        }

        ClearWritingSurface();
    }

    private static Dictionary<int, DictationHandwritingRecognitionResult> LoadRecognitionFixture()
    {
        string raw = Environment.GetEnvironmentVariable("STUDYGATE_DICTATION_RECOGNITION_FIXTURE") ?? string.Empty;

        if (string.IsNullOrWhiteSpace(raw))
        {
            return new Dictionary<int, DictationHandwritingRecognitionResult>();
        }

        try
        {
            using JsonDocument document = JsonDocument.Parse(raw);
            var results = new Dictionary<int, DictationHandwritingRecognitionResult>();

            foreach (JsonProperty property in document.RootElement.EnumerateObject())
            {
                if (!int.TryParse(property.Name, out int itemNumber))
                {
                    continue;
                }

                if (property.Value.ValueKind == JsonValueKind.String)
                {
                    results[itemNumber] = new DictationHandwritingRecognitionResult
                    {
                        HasInk = true,
                        IsSuccessful = true,
                        IsReliable = true,
                        ConfidenceLevel = "Strong",
                        Text = property.Value.GetString() ?? string.Empty
                    };
                    continue;
                }

                if (property.Value.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }

                results[itemNumber] = new DictationHandwritingRecognitionResult
                {
                    HasInk = property.Value.TryGetProperty("hasInk", out JsonElement hasInkElement) ? hasInkElement.GetBoolean() : true,
                    IsSuccessful = property.Value.TryGetProperty("isSuccessful", out JsonElement isSuccessfulElement) ? isSuccessfulElement.GetBoolean() : true,
                    IsReliable = property.Value.TryGetProperty("isReliable", out JsonElement isReliableElement) ? isReliableElement.GetBoolean() : true,
                    ConfidenceLevel = property.Value.TryGetProperty("confidenceLevel", out JsonElement confidenceElement)
                        ? confidenceElement.GetString() ?? "Strong"
                        : "Strong",
                    Text = property.Value.TryGetProperty("text", out JsonElement textElement) ? textElement.GetString() ?? string.Empty : string.Empty,
                    Error = property.Value.TryGetProperty("error", out JsonElement errorElement) ? errorElement.GetString() ?? string.Empty : string.Empty
                };
            }

            return results;
        }
        catch
        {
            return new Dictionary<int, DictationHandwritingRecognitionResult>();
        }
    }

    private bool TryGetFixtureResult(DictationLessonRow row, out DictationHandwritingRecognitionResult result)
    {
        return _recognitionFixture.TryGetValue(row.ItemNumber, out result!);
    }
}
