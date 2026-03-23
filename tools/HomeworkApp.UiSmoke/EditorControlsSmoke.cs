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

internal static partial class HomeworkAppUiSmoke
{
    private static async Task<SmokeReport> RunEditorControlsSmokeAsync(string[] args)
    {
        var report = new SmokeReport();
        StudyGateStateBackup? stateBackup = null;
        FakeHomeworkSyncServer? syncServer = null;
        string cleanupJobDir = string.Empty;
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
                        $"收起作业助手后不应继续增大缩放，展开最大 {report.ZoomAtExpandedMaximum}，收起最大 {report.ZoomAtCollapsedMaximum}。");
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

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        internal static extern bool SetCursorPos(int x, int y);

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        internal static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    }
}
