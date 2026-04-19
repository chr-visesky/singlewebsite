using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Ink;
using Microsoft.Ink;

namespace DictationApp.Services;

public sealed class DictationHandwritingRecognitionService
{
    public Task<DictationHandwritingRecognitionResult> RecognizeAsync(StrokeCollection? strokes, string language)
    {
        return Task.Run(() => Recognize(strokes, language));
    }

    private static DictationHandwritingRecognitionResult Recognize(StrokeCollection? strokes, string language)
    {
        if (strokes is null || strokes.Count == 0)
        {
            return new DictationHandwritingRecognitionResult
            {
                HasInk = false,
                Error = "这一项还没有写内容。"
            };
        }

        try
        {
            Recognizer? recognizer = SelectRecognizer(language);

            if (recognizer is null)
            {
                return new DictationHandwritingRecognitionResult
                {
                    HasInk = true,
                    Error = "当前设备没有可用的手写识别器。"
                };
            }

            using RecognizerContext context = recognizer.CreateRecognizerContext();
            context.RecognitionFlags = RecognitionModes.DisablePersonalization;
            context.Strokes = ConvertToInkStrokes(strokes);
            RecognitionStatus status;
            RecognitionResult? result = context.Recognize(out status);

            if (status != RecognitionStatus.NoError || result is null)
            {
                return new DictationHandwritingRecognitionResult
                {
                    HasInk = true,
                    Error = $"识别失败：{status}"
                };
            }

            string text = (result.TopString ?? string.Empty).Trim();
            List<string> alternates = result
                .GetAlternatesFromSelection()
                .Cast<RecognitionAlternate>()
                .Take(3)
                .Select((item) => item.ToString())
                .Where((item) => !string.IsNullOrWhiteSpace(item))
                .ToList();

            return new DictationHandwritingRecognitionResult
            {
                HasInk = true,
                IsSuccessful = !string.IsNullOrWhiteSpace(text),
                IsReliable = result.TopConfidence != Microsoft.Ink.RecognitionConfidence.Poor,
                ConfidenceLevel = result.TopConfidence.ToString(),
                Text = text,
                Alternates = alternates
            };
        }
        catch (Exception ex)
        {
            return new DictationHandwritingRecognitionResult
            {
                HasInk = true,
                Error = ex.Message
            };
        }
    }

    private static Microsoft.Ink.Strokes ConvertToInkStrokes(StrokeCollection strokes)
    {
        using var stream = new MemoryStream();
        strokes.Save(stream);
        var ink = new Ink();
        ink.Load(stream.ToArray());
        return ink.Strokes;
    }

    private static Recognizer? SelectRecognizer(string language)
    {
        var recognizers = new Recognizers();
        int preferredLanguageId = language.Contains("英", StringComparison.OrdinalIgnoreCase)
            || language.Contains("en", StringComparison.OrdinalIgnoreCase)
            ? 1033
            : 2052;

        foreach (Recognizer recognizer in recognizers)
        {
            if (MatchesLanguage(recognizer, preferredLanguageId))
            {
                return recognizer;
            }
        }

        foreach (Recognizer recognizer in recognizers)
        {
            if (!recognizer.Name.Contains("Gesture", StringComparison.OrdinalIgnoreCase))
            {
                return recognizer;
            }
        }

        return null;
    }

    private static bool MatchesLanguage(Recognizer recognizer, int languageId)
    {
        return recognizer.Languages.Cast<short>().Any((item) => item == languageId);
    }
}

public sealed class DictationHandwritingRecognitionResult
{
    public bool HasInk { get; init; }

    public bool IsSuccessful { get; init; }

    public bool IsReliable { get; init; }

    public string ConfidenceLevel { get; init; } = string.Empty;

    public string Text { get; init; } = string.Empty;

    public string Error { get; init; } = string.Empty;

    public List<string> Alternates { get; init; } = new();
}
