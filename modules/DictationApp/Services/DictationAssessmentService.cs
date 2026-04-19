using System;
using System.Collections.Generic;
using System.Linq;

namespace DictationApp.Services;

public sealed class DictationAssessmentService
{
    public DictationAssessment Evaluate(
        DictationHandwritingRecognitionResult recognition,
        string expectedText,
        string language)
    {
        string normalizedExpected = NormalizeForCompare(expectedText, language);
        string normalizedRecognized = NormalizeForCompare(recognition.Text, language);
        List<string> normalizedAlternates = recognition.Alternates
            .Select((item) => NormalizeForCompare(item, language))
            .Where((item) => !string.IsNullOrWhiteSpace(item))
            .Distinct(StringComparer.Ordinal)
            .ToList();
        bool hasConflictingAlternates = normalizedAlternates.Count > 0
            && normalizedAlternates.Any((item) => !string.Equals(item, normalizedRecognized, StringComparison.Ordinal));
        bool isExactMatch = normalizedExpected.Length > 0
            && string.Equals(normalizedRecognized, normalizedExpected, StringComparison.Ordinal);
        bool isStableMatch = isExactMatch
            && (recognition.ConfidenceLevel == "Strong" || !hasConflictingAlternates);

        if (!recognition.HasInk)
        {
            return new DictationAssessment
            {
                StatusLevel = "Retry",
                StatusText = "请书写",
                DetailText = "这一项还没有写内容，请补写后再批改。",
                RecognizedText = string.Empty,
                ShowRecognition = false,
                ShowAnswer = true,
                NeedsRetry = true
            };
        }

        if (!recognition.IsSuccessful || string.IsNullOrWhiteSpace(normalizedRecognized))
        {
            return new DictationAssessment
            {
                StatusLevel = "Retry",
                StatusText = "请重写",
                DetailText = string.IsNullOrWhiteSpace(recognition.Error)
                    ? "识别不到稳定字迹，请重写得更清楚一点。"
                    : recognition.Error,
                RecognizedText = string.Empty,
                ShowRecognition = false,
                ShowAnswer = true,
                NeedsRetry = true
            };
        }

        if (isStableMatch)
        {
            return new DictationAssessment
            {
                StatusLevel = "Correct",
                StatusText = "正确",
                DetailText = BuildConfidenceDetail(recognition),
                RecognizedText = recognition.Text,
                ShowRecognition = true,
                ShowAnswer = false,
                NeedsRetry = false
            };
        }

        if (!recognition.IsReliable || hasConflictingAlternates)
        {
            return new DictationAssessment
            {
                StatusLevel = "Retry",
                StatusText = "请重写",
                DetailText = "识别结果不够稳定，这一项不会直接判对，请再写一次。",
                RecognizedText = recognition.Text,
                ShowRecognition = true,
                ShowAnswer = true,
                NeedsRetry = true
            };
        }

        return new DictationAssessment
        {
            StatusLevel = "Wrong",
            StatusText = "写错了",
            DetailText = "识别结果和标准答案不一致，需要重听错词。",
            RecognizedText = recognition.Text,
            ShowRecognition = true,
            ShowAnswer = true,
            NeedsRetry = true
        };
    }

    private static string BuildConfidenceDetail(DictationHandwritingRecognitionResult recognition)
    {
        return string.IsNullOrWhiteSpace(recognition.ConfidenceLevel)
            ? "识别结果稳定，判定为正确。"
            : $"识别结果稳定，当前置信等级：{recognition.ConfidenceLevel}。";
    }

    private static string NormalizeForCompare(string? text, string language)
    {
        string normalized = string.Concat((text ?? string.Empty).Trim().Where((character) => !char.IsWhiteSpace(character)));

        if (language.Contains("英", StringComparison.OrdinalIgnoreCase)
            || language.Contains("en", StringComparison.OrdinalIgnoreCase))
        {
            return normalized.ToLowerInvariant();
        }

        return normalized;
    }
}

public sealed class DictationAssessment
{
    public string StatusLevel { get; init; } = "Pending";

    public string StatusText { get; init; } = "待听写";

    public string DetailText { get; init; } = string.Empty;

    public string RecognizedText { get; init; } = string.Empty;

    public bool ShowRecognition { get; init; }

    public bool ShowAnswer { get; init; }

    public bool NeedsRetry { get; init; }
}
