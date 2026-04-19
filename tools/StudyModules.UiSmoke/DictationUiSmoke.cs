using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Windows.Automation;

internal static class DictationUiSmoke
{
    private const string RecognitionFixtureJson = """
        {
          "1": { "text": "apple", "confidenceLevel": "Strong" },
          "2": { "text": "banan", "confidenceLevel": "Intermediate", "isReliable": false },
          "3": { "text": "grape", "confidenceLevel": "Strong" }
        }
        """;

    private const string SettingsJson = """
        {
          "repeatCount": 1,
          "writeSeconds": 1
        }
        """;

    public static void Run(string appPath, string dataRoot, Dictionary<string, object?> dictationReport, List<string> failedChecks)
    {
        KillProcessesByPath(appPath);

        try
        {
            EnsureSettingsFile(dataRoot);
            using Process process = StartDictationApp(appPath, dataRoot);

            AutomationElement mainWindow = WaitForWindow(process.Id, "DictationMainWindow", TimeSpan.FromSeconds(20));
            AutomationElement createButton = WaitForElementByAutomationId(process.Id, "DictationCreateTaskButton", TimeSpan.FromSeconds(20));
            AutomationElement taskList = WaitForElementByAutomationId(process.Id, "DictationTaskList", TimeSpan.FromSeconds(20));
            AutomationElement editorItems = WaitForElementByAutomationId(process.Id, "DictationEditorItemsControl", TimeSpan.FromSeconds(20));
            AutomationElement addItemButton = WaitForElementByAutomationId(process.Id, "DictationAddItemButton", TimeSpan.FromSeconds(20));
            AutomationElement startButton = WaitForElementByAutomationId(process.Id, "DictationStartSessionButton", TimeSpan.FromSeconds(20));
            AutomationElement deleteButton = WaitForElementByAutomationId(process.Id, "DictationDeleteTaskButton", TimeSpan.FromSeconds(20));

            if (!createButton.Current.IsEnabled)
            {
                throw new InvalidOperationException("The dictation create button is not enabled.");
            }

            if (!startButton.Current.IsEnabled)
            {
                throw new InvalidOperationException("The dictation start button is not enabled.");
            }

            if (!deleteButton.Current.IsEnabled)
            {
                throw new InvalidOperationException("The dictation delete button is not enabled.");
            }

            dictationReport["uiMainWindowTitle"] = mainWindow.Current.Name;
            dictationReport["uiCreateButtonText"] = createButton.Current.Name;
            dictationReport["uiTaskListAutomationId"] = taskList.Current.AutomationId;
            dictationReport["uiEditorItemsAutomationId"] = editorItems.Current.AutomationId;
            dictationReport["uiAddItemButtonText"] = addItemButton.Current.Name;
            dictationReport["uiStartButtonText"] = startButton.Current.Name;
            dictationReport["uiDeleteButtonText"] = deleteButton.Current.Name;
            dictationReport["uiMainWindowState"] = ReadWindowState(mainWindow);

            if (!string.Equals(ReadWindowState(mainWindow), WindowVisualState.Maximized.ToString(), StringComparison.Ordinal))
            {
                failedChecks.Add("The dictation main window was not maximized by default.");
            }

            InvokeElement(startButton, "Start Dictation");

            AutomationElement lessonItems = WaitForElementByAutomationId(process.Id, "DictationLessonItemsControl", TimeSpan.FromSeconds(10));
            AutomationElement inkCanvas = WaitForElementByAutomationId(process.Id, "DictationLessonInkCanvas", TimeSpan.FromSeconds(10));
            AutomationElement clearButton = WaitForElementByAutomationId(process.Id, "DictationClearWritingButton", TimeSpan.FromSeconds(10));
            AutomationElement progressText = WaitForElementByAutomationId(process.Id, "DictationLessonProgressText", TimeSpan.FromSeconds(10));
            AutomationElement sessionWindow = FindOwningWindow(inkCanvas) ?? throw new InvalidOperationException("Unable to locate the dictation session window.");

            dictationReport["uiSessionWindowTitle"] = sessionWindow.Current.Name;
            dictationReport["uiSessionWindowState"] = ReadWindowState(sessionWindow);
            dictationReport["uiProgressText"] = progressText.Current.Name;
            dictationReport["uiTopStripAutomationId"] = lessonItems.Current.AutomationId;
            dictationReport["uiInkCanvasAutomationId"] = inkCanvas.Current.AutomationId;
            dictationReport["uiClearButtonText"] = clearButton.Current.Name;
            dictationReport["uiAutoFlow"] = "entered";

            if (!string.Equals(ReadWindowState(sessionWindow), WindowVisualState.Maximized.ToString(), StringComparison.Ordinal))
            {
                failedChecks.Add("The dictation session window was not maximized by default.");
            }

            AutomationElement statusRow1 = WaitForElementNameContains(process.Id, "DictationLessonStatusRow1", "正确", TimeSpan.FromSeconds(60));
            AutomationElement statusRow2 = WaitForElementNameContains(process.Id, "DictationLessonStatusRow2", "请重写", TimeSpan.FromSeconds(60));
            AutomationElement statusRow3 = WaitForElementNameContains(process.Id, "DictationLessonStatusRow3", "写错了", TimeSpan.FromSeconds(60));
            AutomationElement recognitionRow1 = WaitForElementNameContains(process.Id, "DictationLessonRecognitionRow1", "apple", TimeSpan.FromSeconds(10));
            AutomationElement recognitionRow2 = WaitForElementNameContains(process.Id, "DictationLessonRecognitionRow2", "banan", TimeSpan.FromSeconds(10));
            AutomationElement recognitionRow3 = WaitForElementNameContains(process.Id, "DictationLessonRecognitionRow3", "grape", TimeSpan.FromSeconds(10));
            AutomationElement summaryText = WaitForElementByAutomationId(process.Id, "DictationLessonSummaryText", TimeSpan.FromSeconds(10));
            AutomationElement currentStatusText = WaitForElementNameContainsAny(
                process.Id,
                "DictationCurrentStatusText",
                new[] { "本轮结束", "已完成" },
                TimeSpan.FromSeconds(60));

            dictationReport["uiLessonSummary"] = summaryText.Current.Name;
            dictationReport["uiStatusRow1"] = statusRow1.Current.Name;
            dictationReport["uiStatusRow2"] = statusRow2.Current.Name;
            dictationReport["uiStatusRow3"] = statusRow3.Current.Name;
            dictationReport["uiRecognitionRow1"] = recognitionRow1.Current.Name;
            dictationReport["uiRecognitionRow2"] = recognitionRow2.Current.Name;
            dictationReport["uiRecognitionRow3"] = recognitionRow3.Current.Name;
            dictationReport["uiFinalStatus"] = currentStatusText.Current.Name;
            dictationReport["uiSmokePassed"] = true;

            if (!string.Equals(clearButton.Current.Name, "清空手写", StringComparison.Ordinal))
            {
                failedChecks.Add($"Unexpected clear button text: {clearButton.Current.Name}");
            }

            if (!summaryText.Current.Name.Contains("本轮 1 题", StringComparison.Ordinal)
                && !summaryText.Current.Name.Contains("本轮 2 题", StringComparison.Ordinal)
                && !summaryText.Current.Name.Contains("本轮 3 题", StringComparison.Ordinal))
            {
                failedChecks.Add($"Unexpected dictation summary text: {summaryText.Current.Name}");
            }
        }
        catch (Exception ex)
        {
            dictationReport["uiSmokePassed"] = false;
            dictationReport["uiSmokeError"] = ex.Message;
            failedChecks.Add($"Dictation UI smoke failed: {ex.Message}");
        }
        finally
        {
            KillProcessesByPath(appPath);
        }
    }

    private static void EnsureSettingsFile(string dataRoot)
    {
        string settingsDirectory = Path.Combine(dataRoot, "DictationApp");
        Directory.CreateDirectory(settingsDirectory);
        File.WriteAllText(Path.Combine(settingsDirectory, "settings.json"), SettingsJson);
    }

    private static Process StartDictationApp(string appPath, string dataRoot)
    {
        var startInfo = new ProcessStartInfo(appPath)
        {
            WorkingDirectory = Path.GetDirectoryName(appPath) ?? Environment.CurrentDirectory,
            UseShellExecute = false
        };
        startInfo.Environment["STUDYGATE_MODULES_DATA_ROOT"] = dataRoot;
        startInfo.Environment["STUDYGATE_DICTATION_RECOGNITION_FIXTURE"] = RecognitionFixtureJson;
        ApplyDotnetEnvironment(startInfo);
        var process = Process.Start(startInfo) ?? throw new InvalidOperationException("Failed to start DictationApp.");
        process.WaitForInputIdle(15000);
        return process;
    }

    private static void KillProcessesByPath(string appPath)
    {
        string processName = Path.GetFileNameWithoutExtension(appPath);

        foreach (Process process in Process.GetProcessesByName(processName))
        {
            try
            {
                string? executablePath = process.MainModule?.FileName;
                if (!string.Equals(executablePath, appPath, StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                process.Kill(entireProcessTree: true);
                process.WaitForExit(5000);
            }
            catch
            {
                // Ignore stale or inaccessible processes.
            }
        }
    }

    private static AutomationElement WaitForWindow(int processId, string automationId, TimeSpan timeout)
    {
        DateTime deadline = DateTime.UtcNow.Add(timeout);

        while (DateTime.UtcNow < deadline)
        {
            var windows = AutomationElement.RootElement.FindAll(
                TreeScope.Children,
                new PropertyCondition(AutomationElement.ProcessIdProperty, processId));

            foreach (AutomationElement window in windows)
            {
                if (window.Current.ControlType != ControlType.Window)
                {
                    continue;
                }

                if (string.Equals(window.Current.AutomationId, automationId, StringComparison.Ordinal))
                {
                    return window;
                }
            }

            Thread.Sleep(250);
        }

        throw new TimeoutException($"Could not find window {automationId}.");
    }

    private static AutomationElement WaitForElementByAutomationId(int processId, string automationId, TimeSpan timeout)
    {
        DateTime deadline = DateTime.UtcNow.Add(timeout);

        while (DateTime.UtcNow < deadline)
        {
            AutomationElement? element = FindElementByAutomationId(processId, automationId);
            if (element != null && !element.Current.IsOffscreen)
            {
                return element;
            }

            Thread.Sleep(200);
        }

        throw new TimeoutException($"Could not find element {automationId}.");
    }

    private static AutomationElement WaitForElementNameContains(int processId, string automationId, string expectedText, TimeSpan timeout)
    {
        DateTime deadline = DateTime.UtcNow.Add(timeout);

        while (DateTime.UtcNow < deadline)
        {
            AutomationElement? element = FindElementByAutomationId(processId, automationId);

            if (element != null && element.Current.Name.Contains(expectedText, StringComparison.Ordinal))
            {
                return element;
            }

            Thread.Sleep(250);
        }

        throw new TimeoutException($"Element {automationId} never contained text {expectedText}.");
    }

    private static AutomationElement WaitForElementNameContainsAny(int processId, string automationId, IReadOnlyList<string> expectedTexts, TimeSpan timeout)
    {
        DateTime deadline = DateTime.UtcNow.Add(timeout);

        while (DateTime.UtcNow < deadline)
        {
            AutomationElement? element = FindElementByAutomationId(processId, automationId);

            if (element != null)
            {
                foreach (string expectedText in expectedTexts)
                {
                    if (element.Current.Name.Contains(expectedText, StringComparison.Ordinal))
                    {
                        return element;
                    }
                }
            }

            Thread.Sleep(250);
        }

        throw new TimeoutException($"Element {automationId} never showed any expected text.");
    }

    private static AutomationElement? FindElementByAutomationId(int processId, string automationId)
    {
        var windows = AutomationElement.RootElement.FindAll(
            TreeScope.Children,
            new PropertyCondition(AutomationElement.ProcessIdProperty, processId));

        foreach (AutomationElement window in windows)
        {
            if (window.Current.ControlType == ControlType.Window
                && string.Equals(window.Current.AutomationId, automationId, StringComparison.Ordinal))
            {
                return window;
            }

            AutomationElement? match = window.FindFirst(
                TreeScope.Descendants,
                new PropertyCondition(AutomationElement.AutomationIdProperty, automationId));

            if (match != null)
            {
                return match;
            }
        }

        return null;
    }

    private static void InvokeElement(AutomationElement element, string label)
    {
        if (element.TryGetCurrentPattern(InvokePattern.Pattern, out object invokePattern))
        {
            ((InvokePattern)invokePattern).Invoke();
            return;
        }

        throw new InvalidOperationException($"Element {label} does not support InvokePattern.");
    }

    private static void ApplyDotnetEnvironment(ProcessStartInfo startInfo)
    {
        string dotnetRoot = Environment.GetEnvironmentVariable("DOTNET_ROOT_X64")
            ?? Environment.GetEnvironmentVariable("DOTNET_ROOT")
            ?? Path.GetDirectoryName(Environment.ProcessPath ?? string.Empty)
            ?? string.Empty;

        if (!string.IsNullOrWhiteSpace(dotnetRoot))
        {
            startInfo.Environment["DOTNET_ROOT"] = dotnetRoot;
            startInfo.Environment["DOTNET_ROOT_X64"] = dotnetRoot;
        }
    }

    private static string ReadWindowState(AutomationElement window)
    {
        if (window.TryGetCurrentPattern(WindowPattern.Pattern, out object pattern))
        {
            return ((WindowPattern)pattern).Current.WindowVisualState.ToString();
        }

        return "Unknown";
    }

    private static AutomationElement? FindOwningWindow(AutomationElement element)
    {
        AutomationElement? current = element;

        while (current != null)
        {
            if (current.Current.ControlType == ControlType.Window)
            {
                return current;
            }

            current = TreeWalker.ControlViewWalker.GetParent(current);
        }

        return null;
    }
}
