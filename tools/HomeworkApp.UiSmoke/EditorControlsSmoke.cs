using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Threading;
using System.Threading.Tasks;
using System.Text;
using System.Windows.Automation;
using HomeworkApp;
using HomeworkApp.Models;
using HomeworkApp.Services;

internal static partial class HomeworkAppUiSmoke
{
    private static async Task<SmokeReport> RunEditorControlsSmokeAsync(string[] args)
    {
        var report = new SmokeReport();
        StudyGateStateBackup? stateBackup = null;
        FakeHomeworkSyncServer? syncServer = null;
        string cleanupJobDir = string.Empty;
        string createdNewHomeworkJobId = string.Empty;
        string createdEditorJobId = string.Empty;
        string titlePreservationJobId = string.Empty;
        bool startedProcess = false;

        try
        {
            string appPath = GetOption(args, "--app") ??
                Path.Combine(Environment.CurrentDirectory, "dist", "StudyGate-win32-x64", "modules", "homework", "HomeworkApp.exe");
            string outputDir = GetOption(args, "--output-dir") ??
                Path.Combine(Environment.CurrentDirectory, "temp", "ui-smoke", "homework-editor");
            cleanupJobDir = GetOption(args, "--cleanup-job-dir") ?? string.Empty;
            int existingProcessId = ParseIntOption(args, "--process-id");
            string token = "homework-editor-smoke-token";

            report.AppPath = appPath;
            report.OutputDirectory = outputDir;

            if (!File.Exists(appPath))
            {
                report.FailedChecks.Add($"HomeworkApp executable was not found: {appPath}");
                return report;
            }

            Directory.CreateDirectory(outputDir);
            stateBackup = BackupStudyGateState();
            WriteStudyGateState(token);
            syncServer = new FakeHomeworkSyncServer(token);
            await syncServer.StartAsync();

            Process process;
            if (existingProcessId > 0)
            {
                process = Process.GetProcessById(existingProcessId);
            }
            else
            {
                string titlePreservationSubject = $"标题保留测试-{DateTime.Now:HHmmssfff}";
                var titlePreservationJob = JobManager.CreateBlankJob(
                    titlePreservationSubject,
                    DateTime.Today,
                    "课外",
                    "不要被覆盖",
                    false);
                titlePreservationJobId = titlePreservationJob.JobId;
                JobManager.CreateBlankJob(titlePreservationSubject, DateTime.Today, "课外", null, true);
                var titlePreservationReloaded = JobManager.LoadJob(titlePreservationJobId);
                if (!string.Equals(titlePreservationReloaded?.Title, "不要被覆盖", StringComparison.Ordinal) ||
                    titlePreservationReloaded?.TotalPages != 2)
                {
                    report.FailedChecks.Add("追加空白页时覆盖了已有作业的自定义名称，或没有追加页面。");
                }

                var editorJob = JobManager.CreateBlankJob(
                    $"编辑器功能测试-{DateTime.Now:HHmmssfff}",
                    DateTime.Today,
                    "课外");
                createdEditorJobId = editorJob.JobId;
                KillProcessesByPath(appPath);
                process = StartHomeworkApp(appPath);
                startedProcess = true;
            }

            report.ProcessId = process.Id;

            RunSta(() =>
            {
                var mainWindow = WaitForMainWindow(process.Id, TimeSpan.FromSeconds(30));
                report.MainWindowTitle = mainWindow.Current.Name;
                ContinueIntoEditor(mainWindow, process.Id);

                var zoomText = EnsureToolsPanelOpen(process.Id);
                if (!string.Equals(ReadElementText(zoomText), "100%", StringComparison.Ordinal))
                {
                    report.FailedChecks.Add($"初始缩放不是 100%，实际是 {ReadElementText(zoomText)}。");
                }

                InvokeElement(WaitForDescendant(process.Id, "BtnZoomIn", TimeSpan.FromSeconds(5)), "BtnZoomIn");
                report.ZoomAfterFirstStep = WaitForElementText(process.Id, "TxtZoom", "105%", TimeSpan.FromSeconds(5));

                report.ZoomAtExpandedMaximum = ZoomUntilStable(process.Id, "BtnZoomIn", "TxtZoom", 80);
                report.ZoomAtMaximum = report.ZoomAtExpandedMaximum;
                if (ParseZoomPercent(report.ZoomAtExpandedMaximum) != 500)
                {
                    report.FailedChecks.Add($"作业纸最大缩放应为 500%，实际是 {report.ZoomAtExpandedMaximum}。");
                }

                var homeworkViewport = WaitForDescendant(process.Id, "HomeworkScrollViewer", TimeSpan.FromSeconds(5));
                var horizontalScrollBar = homeworkViewport.FindAll(
                        TreeScope.Descendants,
                        new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.ScrollBar))
                    .Cast<AutomationElement>()
                    .FirstOrDefault(element =>
                        !element.Current.IsOffscreen &&
                        Equals(element.GetCurrentPropertyValue(AutomationElement.OrientationProperty), OrientationType.Horizontal));
                var viewportBounds = homeworkViewport.Current.BoundingRectangle;
                var windowBounds = mainWindow.Current.BoundingRectangle;
                report.HorizontalScrollBarPassed = horizontalScrollBar != null &&
                    viewportBounds.Left >= windowBounds.Left &&
                    viewportBounds.Right <= windowBounds.Right;
                if (!report.HorizontalScrollBarPassed)
                {
                    report.FailedChecks.Add("500% 缩放时作业区没有被限制在窗口内，或底部横向滚动条不可见。");
                }
                string resetZoom = ZoomUntilStable(process.Id, "BtnZoomOut", "TxtZoom", 85);
                if (ParseZoomPercent(resetZoom) != 100)
                {
                    report.FailedChecks.Add($"编辑历史测试前无法恢复 100% 缩放，实际是 {resetZoom}。");
                }

                var activeJob = JobManager.GetLastJob() ?? throw new InvalidOperationException("撤销测试没有找到当前作业。");
                int baselineStrokeCount = CountInkStrokes(activeJob);
                var inkCanvas = WaitForDescendant(process.Id, "MainInkCanvas", TimeSpan.FromSeconds(5));
                DrawInkStroke(inkCanvas);
                WaitForCondition(
                    () => CountInkStrokes(activeJob) > baselineStrokeCount,
                    TimeSpan.FromSeconds(5),
                    "真实笔迹没有保存，无法测试撤销。");
                SendControlShortcut(CursorInterop.VirtualKeyZ);
                WaitForCondition(
                    () => CountInkStrokes(activeJob) == baselineStrokeCount,
                    TimeSpan.FromSeconds(5),
                    "Ctrl+Z 没有撤销刚才的笔迹。");
                SendControlShortcut(CursorInterop.VirtualKeyY);
                WaitForCondition(
                    () => CountInkStrokes(activeJob) > baselineStrokeCount,
                    TimeSpan.FromSeconds(5),
                    "Ctrl+Y 没有恢复刚才的笔迹。");
                report.UndoRedoPassed = true;

                for (int strokeIndex = 0; strokeIndex < 5; strokeIndex += 1)
                {
                    DrawInkStroke(inkCanvas, strokeIndex + 1);
                }
                WaitForCondition(
                    () => CountInkStrokes(activeJob) >= baselineStrokeCount + 6,
                    TimeSpan.FromSeconds(8),
                    "没有写入用于五步历史测试的六条笔迹。");
                for (int undoIndex = 0; undoIndex < 5; undoIndex += 1)
                {
                    SendControlShortcut(CursorInterop.VirtualKeyZ);
                }
                WaitForCondition(
                    () => CountInkStrokes(activeJob) == baselineStrokeCount + 1,
                    TimeSpan.FromSeconds(5),
                    "最近五步撤销没有停在预期笔画数。");
                SendControlShortcut(CursorInterop.VirtualKeyZ);
                Thread.Sleep(300);
                report.HistoryStepLimitPassed = CountInkStrokes(activeJob) == baselineStrokeCount + 1;
                if (!report.HistoryStepLimitPassed)
                {
                    report.FailedChecks.Add("第六次 Ctrl+Z 仍然撤销了内容，历史没有限制为五步。");
                }

                JobSession? TryReloadActiveJob()
                {
                    try
                    {
                        return JobManager.LoadJob(activeJob.JobId);
                    }
                    catch (IOException)
                    {
                        return null;
                    }
                }
                int baselinePageCount = activeJob.TotalPages;
                InvokeElement(WaitForDescendant(process.Id, "AddHomeworkPage", TimeSpan.FromSeconds(5)), "AddHomeworkPage");
                WaitForCondition(() => TryReloadActiveJob()?.TotalPages == baselinePageCount + 1, TimeSpan.FromSeconds(5), "添加页面失败。");

                InvokeElement(
                    WaitForDescendant(process.Id, $"DeleteHomeworkPage{baselinePageCount + 1}", TimeSpan.FromSeconds(8)),
                    "DeleteHomeworkPage");
                IntPtr deletePageDialog = WaitForDialogHandle(["删除页"], TimeSpan.FromSeconds(5));
                ClickDialogButton(deletePageDialog, ["是", "Yes"]);
                WaitForCondition(
                    () => FindDialogHandle(["删除页"]) == IntPtr.Zero,
                    TimeSpan.FromSeconds(5),
                    "删除页确认框没有关闭。");
                WaitForCondition(() => TryReloadActiveJob()?.TotalPages == baselinePageCount, TimeSpan.FromSeconds(5), "删除页面失败。");

                bool originalOrientation = TryReloadActiveJob()?.IsPortrait ?? activeJob.IsPortrait;
                InvokeElement(WaitForDescendant(process.Id, "BtnPageRatio", TimeSpan.FromSeconds(5)), "BtnPageRatio");
                WaitForCondition(() => TryReloadActiveJob()?.IsPortrait != originalOrientation, TimeSpan.FromSeconds(5), "纸张方向没有切换。");

                if (WaitForVisibleDescendant(process.Id, "ColorGray", TimeSpan.FromSeconds(5)) == null)
                {
                    report.FailedChecks.Add("画笔颜色列表中没有灰色。");
                }

                var toggleButton = WaitForVisibleDescendant(process.Id, "BtnExpandLeft", TimeSpan.FromSeconds(5));
                report.AssistantCollapseGlyph = ReadElementText(toggleButton!);
                InvokeElement(toggleButton!, "BtnExpandLeft");
                var collapsedButton = WaitForVisibleDescendant(process.Id, "BtnExpandLeft", TimeSpan.FromSeconds(5));
                report.AssistantCollapsed = collapsedButton != null;
                if (!report.AssistantCollapsed)
                {
                    report.FailedChecks.Add("收起作业助手后，没有出现展开按钮。");
                }

                if (!string.Equals(report.AssistantCollapseGlyph, "◀", StringComparison.Ordinal))
                {
                    report.FailedChecks.Add($"展开状态的收起按钮箭头不对，实际是 {report.AssistantCollapseGlyph}。");
                }

                report.AssistantExpandGlyph = ReadElementText(collapsedButton!);
                if (!string.Equals(report.AssistantExpandGlyph, "▶", StringComparison.Ordinal))
                {
                    report.FailedChecks.Add($"收起状态的展开按钮箭头不对，实际是 {report.AssistantExpandGlyph}。");
                }

                report.ZoomAtCollapsedMaximum = ZoomUntilStable(process.Id, "BtnZoomIn", "TxtZoom", 80);
                if (ParseZoomPercent(report.ZoomAtCollapsedMaximum) != ParseZoomPercent(report.ZoomAtExpandedMaximum))
                {
                    report.FailedChecks.Add(
                        $"收起作业助手后缩放上限发生变化，展开最大 {report.ZoomAtExpandedMaximum}，收起最大 {report.ZoomAtCollapsedMaximum}。");
                }

                InvokeElement(collapsedButton!, "BtnExpandLeft");
                var expandedButton = WaitForVisibleDescendant(process.Id, "BtnExpandLeft", TimeSpan.FromSeconds(5));
                report.AssistantExpanded = expandedButton != null;
                if (!report.AssistantExpanded)
                {
                    report.FailedChecks.Add("重新展开作业助手后，没有保留同一个侧边按钮。");
                }
                else if (!string.Equals(ReadElementText(expandedButton!), "◀", StringComparison.Ordinal))
                {
                    report.FailedChecks.Add($"重新展开作业助手后，按钮箭头没有切回 ◀，实际是 {ReadElementText(expandedButton!)}。");
                }

                var toolsButtonAfterExpand = WaitForVisibleDescendant(process.Id, "BtnTools", TimeSpan.FromSeconds(5));
                if (toolsButtonAfterExpand == null)
                {
                    report.FailedChecks.Add("重新展开作业助手后，工具按钮消失了。");
                }

                ClickSyncHomeworkMenuEntry(process.Id);

                WaitForCondition(() => syncServer.HitCount > 0, TimeSpan.FromSeconds(10), "手动同步没有触发本地 StudyGate 同步接口。");
                IntPtr dialogHandle = WaitForDialogHandle(["作业同步"], TimeSpan.FromSeconds(10));
                report.SyncDialogTitle = GetWindowText(dialogHandle);
                report.HomeworkSyncTriggered = true;
                ClickDialogButton(dialogHandle, ["确定", "OK"]);

                string selectedSubject = $"功能测试-{DateTime.Now:HHmmssfff}";
                MoveCursorToSafeMenuZone(process.Id);
                InvokeElement(WaitForDescendant(process.Id, "BtnMenu", TimeSpan.FromSeconds(5)), "BtnMenu");
                var newHomeworkItem = WaitForMenuItem(
                    process.Id,
                    "MenuActionnew-homework",
                    "新建作业",
                    TimeSpan.FromSeconds(5)) ?? throw new InvalidOperationException("没有找到新建作业菜单项。");
                InvokeElement(newHomeworkItem, "MenuActionnew-homework");
                SetElementValue(
                    WaitForProcessDescendant(process.Id, "NewHomeworkSubject", TimeSpan.FromSeconds(5)),
                    selectedSubject);
                InvokeElement(
                    WaitForProcessDescendant(process.Id, "ConfirmNewHomework", TimeSpan.FromSeconds(5)),
                    "ConfirmNewHomework");
                WaitForCondition(
                    () => string.Equals(JobManager.GetLastJob()?.Subject, selectedSubject, StringComparison.Ordinal),
                    TimeSpan.FromSeconds(5),
                    "新建作业没有保存选择的科目。");
                var createdJob = JobManager.GetLastJob()!;
                createdNewHomeworkJobId = createdJob.JobId;
                string expectedTitle = $"{DateTime.Today:yyyy-MM-dd} {selectedSubject}";
                if (!string.Equals(createdJob.Title, expectedTitle, StringComparison.Ordinal))
                {
                    report.FailedChecks.Add($"未命名作业的默认名称不对，期望 {expectedTitle}，实际 {createdJob.Title}。");
                }
                else
                {
                    report.NewHomeworkDefaultTitle = createdJob.Title;
                }
            });

            report.Passed = report.FailedChecks.Count == 0;
        }
        catch (Exception exception)
        {
            report.FailedChecks.Add(exception.Message);
            report.ErrorMessage = exception.ToString();
        }
        finally
        {
            if ((startedProcess || report.ProcessId > 0) && !string.IsNullOrWhiteSpace(report.AppPath))
            {
                KillProcessesByPath(report.AppPath);
            }

            if (syncServer != null)
            {
                await syncServer.DisposeAsync();
            }

            RestoreStudyGateState(stateBackup);

            if (!string.IsNullOrWhiteSpace(createdNewHomeworkJobId))
            {
                JobManager.DeleteJob(createdNewHomeworkJobId);
            }

            if (!string.IsNullOrWhiteSpace(createdEditorJobId))
            {
                JobManager.DeleteJob(createdEditorJobId);
            }

            if (!string.IsNullOrWhiteSpace(titlePreservationJobId))
            {
                JobManager.DeleteJob(titlePreservationJobId);
            }

            if (!string.IsNullOrWhiteSpace(cleanupJobDir) && Directory.Exists(cleanupJobDir))
            {
                try
                {
                    string jobId = Path.GetFileName(cleanupJobDir.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
                    if (!string.IsNullOrWhiteSpace(jobId))
                    {
                        JobManager.DeleteJob(jobId);
                    }
                }
                catch
                {
                    // Ignore smoke cleanup failures.
                }
            }
        }

        return report;
    }

    private static string ZoomUntilStable(int processId, string buttonAutomationId, string zoomAutomationId, int maxClicks)
    {
        string lastValue = ReadElementText(WaitForDescendant(processId, zoomAutomationId, TimeSpan.FromSeconds(5)));
        int stableCount = 0;

        for (int clickIndex = 0; clickIndex < maxClicks; clickIndex += 1)
        {
            var button = WaitForVisibleDescendant(processId, buttonAutomationId, TimeSpan.FromSeconds(1));
            if (button == null)
            {
                return lastValue;
            }

            InvokeElement(button, buttonAutomationId);
            Thread.Sleep(150);
            var zoomElement = WaitForVisibleDescendant(processId, zoomAutomationId, TimeSpan.FromSeconds(1));
            if (zoomElement == null)
            {
                return lastValue;
            }

            string currentValue = ReadElementText(zoomElement);

            if (string.Equals(currentValue, lastValue, StringComparison.Ordinal))
            {
                stableCount += 1;
                if (stableCount >= 2)
                {
                    return currentValue;
                }
            }
            else
            {
                stableCount = 0;
                lastValue = currentValue;
            }
        }

        return lastValue;
    }

    private static AutomationElement EnsureToolsPanelOpen(int processId)
    {
        var zoomText = WaitForVisibleDescendant(processId, "TxtZoom", TimeSpan.FromSeconds(1));
        if (zoomText != null)
        {
            return zoomText;
        }

        var toolsButton = WaitForDescendant(processId, "BtnTools", TimeSpan.FromSeconds(20));
        InvokeElement(toolsButton, "BtnTools");
        return WaitForDescendant(processId, "TxtZoom", TimeSpan.FromSeconds(10));
    }

    private static int ParseZoomPercent(string text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return 0;
        }

        string digits = new string(text.Where(char.IsDigit).ToArray());
        return int.TryParse(digits, out int value) ? value : 0;
    }

    private static int CountInkStrokes(JobSession job)
    {
        return InkService.LoadInk(job.GetInkFilePath(job.CurrentPage))?.Count ?? 0;
    }

    private static void DrawInkStroke(AutomationElement canvas, int offset = 0)
    {
        var bounds = canvas.Current.BoundingRectangle;
        int startX = (int)Math.Round(bounds.Left + Math.Min(120, bounds.Width * 0.2));
        int startY = (int)Math.Round(bounds.Top + Math.Min(140 + (offset * 12), bounds.Height * 0.3));
        int endX = (int)Math.Round(Math.Min(bounds.Right - 20, startX + 120));
        int endY = (int)Math.Round(Math.Min(bounds.Bottom - 20, startY + 60));

        CursorInterop.SetCursorPos(startX, startY);
        CursorInterop.mouse_event(CursorInterop.MouseEventLeftDown, 0, 0, 0, UIntPtr.Zero);
        for (int step = 1; step <= 8; step += 1)
        {
            CursorInterop.SetCursorPos(
                startX + ((endX - startX) * step / 8),
                startY + ((endY - startY) * step / 8));
            Thread.Sleep(25);
        }
        CursorInterop.mouse_event(CursorInterop.MouseEventLeftUp, 0, 0, 0, UIntPtr.Zero);
    }

    private static void SendControlShortcut(byte key)
    {
        CursorInterop.keybd_event(CursorInterop.VirtualKeyControl, 0, 0, UIntPtr.Zero);
        CursorInterop.keybd_event(key, 0, 0, UIntPtr.Zero);
        CursorInterop.keybd_event(key, 0, CursorInterop.KeyEventKeyUp, UIntPtr.Zero);
        CursorInterop.keybd_event(CursorInterop.VirtualKeyControl, 0, CursorInterop.KeyEventKeyUp, UIntPtr.Zero);
    }

    private static void SetElementValue(AutomationElement element, string value)
    {
        if (!element.TryGetCurrentPattern(ValuePattern.Pattern, out object pattern))
        {
            throw new InvalidOperationException($"控件 {element.Current.AutomationId} 不支持输入值。");
        }

        ((ValuePattern)pattern).SetValue(value);
    }

    private static void ContinueIntoEditor(AutomationElement mainWindow, int processId)
    {
        var continueButton = FindDescendantByAutomationId(mainWindow, "BtnContinueHomework");
        if (continueButton != null)
        {
            InvokeElement(continueButton, "BtnContinueHomework");
            _ = WaitForDescendant(processId, "BtnTools", TimeSpan.FromSeconds(20));
        }
    }

    private static AutomationElement? WaitForVisibleDescendant(int processId, string automationId, TimeSpan timeout)
    {
        DateTime deadline = DateTime.UtcNow.Add(timeout);

        while (DateTime.UtcNow < deadline)
        {
            var root = WaitForMainWindow(processId, TimeSpan.FromSeconds(2));
            var match = FindDescendantByAutomationId(root, automationId);

            if (match != null && !match.Current.IsOffscreen)
            {
                return match;
            }

            Thread.Sleep(200);
        }

        return null;
    }

    private static bool WaitForElementHidden(int processId, string automationId, TimeSpan timeout)
    {
        DateTime deadline = DateTime.UtcNow.Add(timeout);

        while (DateTime.UtcNow < deadline)
        {
            var root = WaitForMainWindow(processId, TimeSpan.FromSeconds(2));
            var match = FindDescendantByAutomationId(root, automationId);

            if (match == null || match.Current.IsOffscreen)
            {
                return true;
            }

            Thread.Sleep(200);
        }

        return false;
    }

    private static string WaitForElementText(int processId, string automationId, string expectedText, TimeSpan timeout)
    {
        DateTime deadline = DateTime.UtcNow.Add(timeout);

        while (DateTime.UtcNow < deadline)
        {
            var element = WaitForDescendant(processId, automationId, TimeSpan.FromSeconds(2));
            string text = ReadElementText(element);
            if (string.Equals(text, expectedText, StringComparison.Ordinal))
            {
                return text;
            }

            Thread.Sleep(150);
        }

        throw new TimeoutException($"控件 {automationId} 没有在预期时间内变成 {expectedText}。");
    }

    private static string ReadElementText(AutomationElement element)
    {
        return string.IsNullOrWhiteSpace(element.Current.Name)
            ? string.Empty
            : element.Current.Name.Trim();
    }

    private static void WaitForCondition(Func<bool> condition, TimeSpan timeout, string timeoutMessage)
    {
        DateTime deadline = DateTime.UtcNow.Add(timeout);

        while (DateTime.UtcNow < deadline)
        {
            if (condition())
            {
                return;
            }

            Thread.Sleep(150);
        }

        throw new TimeoutException(timeoutMessage);
    }

    private static void MoveCursorToSafeMenuZone(int processId)
    {
        var root = WaitForMainWindow(processId, TimeSpan.FromSeconds(5));
        var bounds = root.Current.BoundingRectangle;
        int targetX = Math.Max(0, (int)Math.Round(bounds.Left + 48));
        int targetY = Math.Max(0, (int)Math.Round(bounds.Top + 64));
        CursorInterop.SetCursorPos(targetX, targetY);
        Thread.Sleep(150);
    }

    private static void ClickSyncHomeworkMenuEntry(int processId)
    {
        MoveCursorToSafeMenuZone(processId);
        var menuButton = WaitForDescendant(processId, "BtnMenu", TimeSpan.FromSeconds(5));
        InvokeElement(menuButton, "BtnMenu");
        var syncMenuItem = WaitForMenuItem(processId, "MenuActionsync", "同步云端作业", TimeSpan.FromSeconds(5));

        if (syncMenuItem != null)
        {
            InvokeElement(syncMenuItem, "MenuActionSync");
            return;
        }

        CursorInterop.keybd_event((byte)CursorInterop.VirtualKeyReturn, 0, 0, UIntPtr.Zero);
        Thread.Sleep(40);
        CursorInterop.keybd_event((byte)CursorInterop.VirtualKeyReturn, 0, CursorInterop.KeyEventKeyUp, UIntPtr.Zero);
    }

    private static AutomationElement? WaitForMenuItem(int processId, string automationId, string displayName, TimeSpan timeout)
    {
        DateTime deadline = DateTime.UtcNow.Add(timeout);

        while (DateTime.UtcNow < deadline)
        {
            var root = WaitForMainWindow(processId, TimeSpan.FromSeconds(2));
            var match = FindMenuItem(root, automationId, displayName);
            if (match != null && !match.Current.IsOffscreen)
            {
                return match;
            }

            var windows = AutomationElement.RootElement.FindAll(
                TreeScope.Children,
                new PropertyCondition(AutomationElement.ProcessIdProperty, processId));

            foreach (AutomationElement window in windows)
            {
                match = FindMenuItem(window, automationId, displayName);
                if (match != null && !match.Current.IsOffscreen)
                {
                    return match;
                }
            }

            Thread.Sleep(150);
        }

        return null;
    }

    private static AutomationElement? FindMenuItem(AutomationElement root, string automationId, string displayName)
    {
        var matches = root.FindAll(
            TreeScope.Descendants,
            new AndCondition(
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.MenuItem),
                new OrCondition(
                    new PropertyCondition(AutomationElement.AutomationIdProperty, automationId),
                    new PropertyCondition(AutomationElement.NameProperty, displayName))));

        return matches.Cast<AutomationElement>().FirstOrDefault();
    }

    private static StudyGateStateBackup BackupStudyGateState()
    {
        string statePath = ResolveStudyGateStatePath();

        return new StudyGateStateBackup
        {
            StatePath = statePath,
            Existed = File.Exists(statePath),
            Json = File.Exists(statePath) ? File.ReadAllText(statePath) : string.Empty
        };
    }

    private static void RestoreStudyGateState(StudyGateStateBackup? backup)
    {
        if (backup == null || string.IsNullOrWhiteSpace(backup.StatePath))
        {
            return;
        }

        Directory.CreateDirectory(Path.GetDirectoryName(backup.StatePath)!);

        if (backup.Existed)
        {
            File.WriteAllText(backup.StatePath, backup.Json ?? string.Empty);
            return;
        }

        if (File.Exists(backup.StatePath))
        {
            File.Delete(backup.StatePath);
        }
    }

    private static void WriteStudyGateState(string mobileToken)
    {
        string statePath = ResolveStudyGateStatePath();
        Directory.CreateDirectory(Path.GetDirectoryName(statePath)!);
        File.WriteAllText(
            statePath,
            $$"""
            {
              "classMarks": {},
              "mobileToken": "{{mobileToken}}",
              "uiZoomFactor": 1,
              "studentDeviceCredential": {
                "deviceId": "",
                "deviceSecret": "",
                "label": ""
              }
            }
            """);
    }

    private static string ResolveStudyGateStatePath()
    {
        return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "StudyGate",
            "study-tools-state.json");
    }

    private sealed class StudyGateStateBackup
    {
        public string StatePath { get; init; } = string.Empty;
        public bool Existed { get; init; }
        public string? Json { get; init; }
    }

    private sealed class FakeHomeworkSyncServer : IAsyncDisposable
    {
        private readonly HttpListener _listener = new();
        private readonly CancellationTokenSource _cancellationTokenSource = new();
        private readonly string _token;
        private Task? _listenTask;
        private int _hitCount;

        public FakeHomeworkSyncServer(string token)
        {
            _token = token;
            _listener.Prefixes.Add("http://127.0.0.1:32147/");
        }

        public int HitCount => _hitCount;

        public Task StartAsync()
        {
            _listener.Start();
            _listenTask = Task.Run(ListenLoopAsync);
            return Task.CompletedTask;
        }

        public async ValueTask DisposeAsync()
        {
            _cancellationTokenSource.Cancel();
            if (_listener.IsListening)
            {
                _listener.Close();
            }

            if (_listenTask != null)
            {
                await _listenTask.ConfigureAwait(false);
            }
        }

        private async Task ListenLoopAsync()
        {
            while (!_cancellationTokenSource.IsCancellationRequested)
            {
                HttpListenerContext? context = null;

                try
                {
                    context = await _listener.GetContextAsync().ConfigureAwait(false);
                }
                catch (HttpListenerException)
                {
                    break;
                }
                catch (ObjectDisposedException)
                {
                    break;
                }

                if (context == null)
                {
                    continue;
                }

                await HandleContextAsync(context).ConfigureAwait(false);
            }
        }

        private async Task HandleContextAsync(HttpListenerContext context)
        {
            string path = context.Request.Url?.AbsolutePath ?? string.Empty;
            string token = context.Request.QueryString["token"] ?? string.Empty;

            if (string.Equals(path, "/__studygate/homework/sync", StringComparison.OrdinalIgnoreCase) &&
                string.Equals(context.Request.HttpMethod, "POST", StringComparison.OrdinalIgnoreCase) &&
                string.Equals(token, _token, StringComparison.Ordinal))
            {
                Interlocked.Increment(ref _hitCount);
                string json = "{\"success\":true,\"enabled\":true,\"requestCount\":2,\"processedCount\":2,\"message\":\"已同步 2 条云端作业请求。\"}";
                byte[] payload = Encoding.UTF8.GetBytes(json);
                context.Response.StatusCode = 200;
                context.Response.ContentType = "application/json; charset=utf-8";
                context.Response.ContentLength64 = payload.Length;
                await context.Response.OutputStream.WriteAsync(payload, 0, payload.Length).ConfigureAwait(false);
                context.Response.Close();
                return;
            }

            context.Response.StatusCode = 404;
            context.Response.Close();
        }
    }

    private static class CursorInterop
    {
        internal const uint KeyEventKeyUp = 0x0002;
        internal const int VirtualKeyReturn = 0x0D;
        internal const byte VirtualKeyControl = 0x11;
        internal const byte VirtualKeyY = 0x59;
        internal const byte VirtualKeyZ = 0x5A;
        internal const uint MouseEventLeftDown = 0x0002;
        internal const uint MouseEventLeftUp = 0x0004;

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        internal static extern bool SetCursorPos(int x, int y);

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        internal static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        internal static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
    }
}
