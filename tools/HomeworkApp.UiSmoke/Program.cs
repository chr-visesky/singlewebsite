using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Ink;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using HomeworkApp;
using HomeworkApp.Models;
using HomeworkApp.Services;
using HomeworkApp.Views;
using Newtonsoft.Json;

var report = await HomeworkAppUiSmoke.RunAsync(args);
var json = System.Text.Json.JsonSerializer.Serialize(report, new JsonSerializerOptions
{
    WriteIndented = true,
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase
});
Console.WriteLine(json);
Environment.ExitCode = report.Passed ? 0 : 1;

internal static partial class HomeworkAppUiSmoke
{
    public static async Task<SmokeReport> RunAsync(string[] args)
    {
        string command = args.Length > 0 ? args[0] : "run-print-smoke";
        return command switch
        {
            "run-print-smoke" => await RunPrintSmokeAsync(args.Skip(1).ToArray()),
            "run-editor-controls-smoke" => await RunEditorControlsSmokeAsync(args.Skip(1).ToArray()),
            "run-history-delete-smoke" => await RunHistoryDeleteSmokeAsync(args.Skip(1).ToArray()),
            _ => new SmokeReport
            {
                Passed = false,
                FailedChecks = { $"Unsupported command: {command}" }
            }
        };
    }

    private static async Task<SmokeReport> RunPrintSmokeAsync(string[] args)
    {
        var report = new SmokeReport();
        string createdSmokeJobId = string.Empty;
        bool startedProcess = false;
        bool leaveProcessRunning = HasFlag(args, "--leave-process-running");
        bool forceSmokeJob = HasFlag(args, "--force-smoke-job");

        try
        {
            string appPath = GetOption(args, "--app") ??
                Path.Combine(Environment.CurrentDirectory, "dist", "StudyGate-win32-x64", "modules", "homework", "HomeworkApp.exe");
            string outputDir = GetOption(args, "--output-dir") ??
                Path.Combine(Environment.CurrentDirectory, "temp", "ui-smoke", "homework");
            string? explicitJobDir = GetOption(args, "--job-dir");
            int existingProcessId = ParseIntOption(args, "--process-id");
            string? jobDir = explicitJobDir ?? (forceSmokeJob ? null : FindLatestJobDirectory());

            report.AppPath = appPath;
            report.OutputDirectory = outputDir;
            report.JobDirectory = jobDir ?? string.Empty;

            if (!File.Exists(appPath))
            {
                report.FailedChecks.Add($"HomeworkApp executable was not found: {appPath}");
                return report;
            }

            ResetDirectory(outputDir);

            if (string.IsNullOrWhiteSpace(jobDir) || !Directory.Exists(jobDir))
            {
                var smokeJob = CreateSmokePrintJob(outputDir);
                createdSmokeJobId = smokeJob.JobId;
                jobDir = smokeJob.JobDirectory;
                report.JobDirectory = smokeJob.JobDirectory;
            }

            string pdfPath = Path.Combine(outputDir, "manual-print.pdf");
            report.PrintedPdfPath = pdfPath;
            report.ExpectedDirectory = Path.Combine(outputDir, "expected");
            report.ActualDirectory = Path.Combine(outputDir, "actual");

            if (File.Exists(pdfPath))
            {
                File.Delete(pdfPath);
            }

            AppSettingsStore.Save(new AppSettings
            {
                DefaultPrinterName = "Microsoft Print to PDF",
                PaperSize = "A4"
            });

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

                var continueButton = FindDescendantByAutomationId(mainWindow, "BtnContinueHomework");
                if (continueButton != null)
                {
                    InvokeElement(continueButton, "BtnContinueHomework");
                }
                else if (FindDescendantByAutomationId(mainWindow, "BtnTools") == null)
                {
                    throw new InvalidOperationException("HomeworkApp 没有停在首页，也没有进入编辑页。");
                }

                var toolsButton = WaitForDescendant(process.Id, "BtnTools", TimeSpan.FromSeconds(20));
                InvokeElement(toolsButton, "BtnTools");

                var printButton = WaitForDescendant(process.Id, "BtnPrint", TimeSpan.FromSeconds(20));
                InvokeElement(printButton, "BtnPrint");
                var confirmPagesButton = WaitForProcessDescendant(
                    process.Id,
                    "ConfirmPrintPages",
                    TimeSpan.FromSeconds(10));
                var secondPage = WaitForProcessDescendant(process.Id, "PrintPage2", TimeSpan.FromSeconds(5));
                if (secondPage.TryGetCurrentPattern(TogglePattern.Pattern, out object togglePattern) &&
                    ((TogglePattern)togglePattern).Current.ToggleState == ToggleState.On)
                {
                    ((TogglePattern)togglePattern).Toggle();
                }
                InvokeElement(confirmPagesButton, "ConfirmPrintPages");

                IntPtr saveDialogHandle = WaitForSaveDialogHandle(TimeSpan.FromSeconds(30));
                report.SaveDialogTitle = GetWindowText(saveDialogHandle);
                SetSaveDialogFileName(saveDialogHandle, pdfPath);
                ClickSaveDialogButton(saveDialogHandle);
            });

            await WaitForFileAsync(pdfPath, TimeSpan.FromSeconds(30));
            report.DeleteDialogTitle = await WaitForOptionalPrintCompleteDialogAsync(TimeSpan.FromSeconds(4))
                ? "打印完成"
                : string.Empty;
            VerifyPrintedPdf(jobDir!, pdfPath, report, [0]);
            report.Passed = report.FailedChecks.Count == 0;
        }
        catch (Exception exception)
        {
            report.FailedChecks.Add(exception.Message);
            report.ErrorMessage = exception.ToString();
        }
        finally
        {
            if (startedProcess && !leaveProcessRunning && !string.IsNullOrWhiteSpace(report.AppPath))
            {
                KillProcessesByPath(report.AppPath);
            }

            if (!leaveProcessRunning && !string.IsNullOrWhiteSpace(createdSmokeJobId))
            {
                try
                {
                    JobManager.DeleteJob(createdSmokeJobId);
                }
                catch
                {
                    // Ignore smoke cleanup failures.
                }
            }
        }

        return report;
    }

    private static async Task<SmokeReport> RunHistoryDeleteSmokeAsync(string[] args)
    {
        var report = new SmokeReport();

        try
        {
            string appPath = GetOption(args, "--app") ??
                Path.Combine(Environment.CurrentDirectory, "dist", "StudyGate-win32-x64", "modules", "homework", "HomeworkApp.exe");
            string? jobDir = GetOption(args, "--job-dir") ?? FindLatestJobDirectory();

            report.AppPath = appPath;
            report.JobDirectory = jobDir ?? string.Empty;

            if (!File.Exists(appPath))
            {
                report.FailedChecks.Add($"HomeworkApp executable was not found: {appPath}");
                return report;
            }

            if (string.IsNullOrWhiteSpace(jobDir) || !Directory.Exists(jobDir))
            {
                report.FailedChecks.Add("没有可删除的本地作业目录。");
                return report;
            }

            var job = PromoteJobToHistory(jobDir);
            report.DeletedJobId = job.JobId;
            report.DeletedJobSubject = job.Subject;

            KillProcessesByPath(appPath);
            Process process = StartHomeworkApp(appPath);
            report.ProcessId = process.Id;

            RunSta(() =>
            {
                var mainWindow = WaitForMainWindow(process.Id, TimeSpan.FromSeconds(30));
                report.MainWindowTitle = mainWindow.Current.Name;

                var historyButton = FindDescendantByAutomationId(mainWindow, "BtnHistory");
                if (historyButton != null)
                {
                    InvokeElement(historyButton, "BtnHistory");
                }
                else
                {
                    var menuButton = WaitForDescendant(process.Id, "BtnMenu", TimeSpan.FromSeconds(20));
                    InvokeElement(menuButton, "BtnMenu");
                    var historyMenuItem = WaitForElementByName(process.Id, "历史作业", TimeSpan.FromSeconds(10));
                    InvokeElement(historyMenuItem, "历史作业");
                }

                var deleteButton = WaitForHistoryDeleteButton(process.Id, job.Subject, TimeSpan.FromSeconds(20));
                InvokeElement(deleteButton, "HistoryDeleteButton");

                IntPtr confirmDialogHandle = WaitForDialogHandle(
                    ["确认删除", "Delete"],
                    TimeSpan.FromSeconds(15));
                report.DeleteDialogTitle = GetWindowText(confirmDialogHandle);
                ClickDialogButton(confirmDialogHandle, ["是", "Yes"]);
            });

            await WaitForDirectoryDeletedAsync(jobDir, TimeSpan.FromSeconds(20));
            report.Passed = report.FailedChecks.Count == 0;
        }
        catch (Exception exception)
        {
            report.FailedChecks.Add(exception.Message);
            report.ErrorMessage = exception.ToString();
        }
        finally
        {
            if (!string.IsNullOrWhiteSpace(report.AppPath))
            {
                KillProcessesByPath(report.AppPath);
            }
        }

        return report;
    }

    private static string? GetOption(string[] args, string name)
    {
        for (int index = 0; index < args.Length - 1; index += 1)
        {
            if (string.Equals(args[index], name, StringComparison.OrdinalIgnoreCase))
            {
                return args[index + 1];
            }
        }

        return null;
    }

    private static int ParseIntOption(string[] args, string name)
    {
        string? rawValue = GetOption(args, name);
        return int.TryParse(rawValue, out int value) && value > 0 ? value : 0;
    }

    private static bool HasFlag(string[] args, string name)
    {
        return args.Any((value) => string.Equals(value, name, StringComparison.OrdinalIgnoreCase));
    }

    private static void ResetDirectory(string path)
    {
        if (Directory.Exists(path))
        {
            Directory.Delete(path, recursive: true);
        }

        Directory.CreateDirectory(path);
    }

    private static JobSession CreateSmokePrintJob(string outputDir)
    {
        var job = JobManager.CreateBlankJob(
            $"打印冒烟-{DateTime.Now:HHmmssfff}",
            DateTime.Today,
            "课内");
        JobManager.AddBlankPage(job);
        var stroke = new Stroke(new StylusPointCollection(new[]
        {
            new StylusPoint(86, 140),
            new StylusPoint(220, 168),
            new StylusPoint(356, 152),
            new StylusPoint(492, 194),
            new StylusPoint(628, 182)
        }))
        {
            DrawingAttributes = new DrawingAttributes
            {
                Color = Colors.DarkBlue,
                Width = 4,
                Height = 4,
                FitToCurve = false
            }
        };
        var strokes = new StrokeCollection { stroke };
        InkService.SaveInk(strokes, job.GetInkFilePath(0));
        JobManager.SaveJob(job);
        return job;
    }

    private static Process StartHomeworkApp(string appPath)
    {
        var startInfo = new ProcessStartInfo(appPath)
        {
            WorkingDirectory = Path.GetDirectoryName(appPath) ?? Environment.CurrentDirectory,
            UseShellExecute = true
        };
        var process = Process.Start(startInfo) ?? throw new InvalidOperationException("HomeworkApp 启动失败。");
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

    private static AutomationElement WaitForMainWindow(int processId, TimeSpan timeout)
    {
        DateTime deadline = DateTime.UtcNow.Add(timeout);

        while (DateTime.UtcNow < deadline)
        {
            var windows = AutomationElement.RootElement.FindAll(
                TreeScope.Children,
                new PropertyCondition(AutomationElement.ProcessIdProperty, processId));

            foreach (AutomationElement window in windows)
            {
                if (window.Current.ControlType == ControlType.Window)
                {
                    return window;
                }
            }

            Thread.Sleep(250);
        }

        throw new TimeoutException("HomeworkApp 主窗口没有在预期时间内出现。");
    }

    private static AutomationElement WaitForDescendant(int processId, string automationId, TimeSpan timeout)
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

            Thread.Sleep(250);
        }

        throw new TimeoutException($"未找到控件 {automationId}。");
    }

    private static AutomationElement WaitForProcessDescendant(int processId, string automationId, TimeSpan timeout)
    {
        DateTime deadline = DateTime.UtcNow.Add(timeout);

        while (DateTime.UtcNow < deadline)
        {
            var windows = AutomationElement.RootElement.FindAll(
                TreeScope.Children,
                new PropertyCondition(AutomationElement.ProcessIdProperty, processId));

            foreach (AutomationElement window in windows)
            {
                var match = FindDescendantByAutomationId(window, automationId);
                if (match != null && !match.Current.IsOffscreen)
                {
                    return match;
                }
            }

            Thread.Sleep(200);
        }

        throw new TimeoutException($"未找到进程控件 {automationId}。");
    }

    private static AutomationElement WaitForElementByName(int processId, string name, TimeSpan timeout)
    {
        DateTime deadline = DateTime.UtcNow.Add(timeout);

        while (DateTime.UtcNow < deadline)
        {
            var root = WaitForMainWindow(processId, TimeSpan.FromSeconds(2));
            var match = root.FindAll(
                TreeScope.Descendants,
                new PropertyCondition(AutomationElement.NameProperty, name))
                .Cast<AutomationElement>()
                .FirstOrDefault((element) => !element.Current.IsOffscreen);

            if (match != null)
            {
                return match;
            }

            Thread.Sleep(200);
        }

        throw new TimeoutException($"未找到名称为 {name} 的控件。");
    }

    private static AutomationElement? FindDescendantByAutomationId(AutomationElement root, string automationId)
    {
        var matches = root.FindAll(
            TreeScope.Descendants,
            new PropertyCondition(AutomationElement.AutomationIdProperty, automationId));

        return matches.Cast<AutomationElement>().FirstOrDefault();
    }

    private static void InvokeElement(AutomationElement element, string label)
    {
        if (element.TryGetCurrentPattern(InvokePattern.Pattern, out object invokePattern))
        {
            ((InvokePattern)invokePattern).Invoke();
            return;
        }

        throw new InvalidOperationException($"控件 {label} 不支持 InvokePattern。");
    }

    private static JobSession PromoteJobToHistory(string jobDirectory)
    {
        var job = JobSession.Load(jobDirectory) ?? throw new InvalidDataException("无法读取待删除作业。");
        DateTime historyTime = DateTime.Today.AddDays(-15).AddHours(8);
        job.CreateTime = historyTime;
        job.UpdateTime = historyTime.AddMinutes(5);

        string jsonPath = Path.Combine(jobDirectory, "job.json");
        File.WriteAllText(jsonPath, JsonConvert.SerializeObject(job, Formatting.Indented));
        return job;
    }

    private static AutomationElement WaitForHistoryDeleteButton(int processId, string subject, TimeSpan timeout)
    {
        DateTime deadline = DateTime.UtcNow.Add(timeout);

        while (DateTime.UtcNow < deadline)
        {
            var root = WaitForMainWindow(processId, TimeSpan.FromSeconds(2));
            var subjectMatches = root.FindAll(
                TreeScope.Descendants,
                new PropertyCondition(AutomationElement.NameProperty, subject));

            foreach (AutomationElement subjectElement in subjectMatches)
            {
                AutomationElement? container = subjectElement;

                while (container != null)
                {
                    var deleteButton = FindButtonByName(container, "删除");
                    if (deleteButton != null && !deleteButton.Current.IsOffscreen)
                    {
                        return deleteButton;
                    }

                    container = TreeWalker.ControlViewWalker.GetParent(container);
                }
            }

            Thread.Sleep(250);
        }

        throw new TimeoutException($"没有找到作业“{subject}”对应的删除按钮。");
    }

    private static AutomationElement? FindButtonByName(AutomationElement root, string name)
    {
        var matches = root.FindAll(
            TreeScope.Descendants,
            new AndCondition(
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button),
                new PropertyCondition(AutomationElement.NameProperty, name)));

        return matches.Cast<AutomationElement>().FirstOrDefault();
    }

    private static async Task WaitForFileAsync(string path, TimeSpan timeout)
    {
        DateTime deadline = DateTime.UtcNow.Add(timeout);
        long previousLength = -1;
        int stableCount = 0;

        while (DateTime.UtcNow < deadline)
        {
            _ = TryDismissPrintCompleteDialog();

            if (File.Exists(path))
            {
                long currentLength = new FileInfo(path).Length;
                if (currentLength > 0 && currentLength == previousLength)
                {
                    stableCount += 1;
                    if (stableCount >= 4)
                    {
                        return;
                    }
                }
                else
                {
                    stableCount = 0;
                    previousLength = currentLength;
                }
            }

            await Task.Delay(250);
        }

        throw new TimeoutException("打印后的 PDF 没有在预期时间内生成。");
    }

    private static async Task<bool> WaitForOptionalPrintCompleteDialogAsync(TimeSpan timeout)
    {
        DateTime deadline = DateTime.UtcNow.Add(timeout);
        bool dismissed = false;

        while (DateTime.UtcNow < deadline)
        {
            if (TryDismissPrintCompleteDialog())
            {
                dismissed = true;
                await Task.Delay(200);
                continue;
            }

            if (dismissed)
            {
                return true;
            }

            await Task.Delay(200);
        }

        return dismissed;
    }

    private static async Task WaitForDirectoryDeletedAsync(string path, TimeSpan timeout)
    {
        DateTime deadline = DateTime.UtcNow.Add(timeout);

        while (DateTime.UtcNow < deadline)
        {
            if (!Directory.Exists(path))
            {
                return;
            }

            await Task.Delay(250);
        }

        throw new TimeoutException("本地作业目录没有在预期时间内删除。");
    }

    private static void VerifyPrintedPdf(
        string jobDirectory,
        string pdfPath,
        SmokeReport report,
        IReadOnlyList<int> expectedPageIndexes)
    {
        RunSta(() =>
        {
            var job = JobSession.Load(jobDirectory) ?? throw new InvalidDataException("无法读取当前作业数据。");
            Directory.CreateDirectory(report.ExpectedDirectory);
            Directory.CreateDirectory(report.ActualDirectory);

            using var expectedDocumentService = new DocumentService();
            LoadJobDocument(expectedDocumentService, job);
            var renderer = new HomeworkPrintRenderer(job, expectedDocumentService);

            using var actualDocumentService = new DocumentService();
            actualDocumentService.LoadDocument(pdfPath);

            int expectedPageCount = expectedPageIndexes.Count;
            int actualPageCount = Math.Max(0, actualDocumentService.PageCount);
            report.ExpectedPageCount = expectedPageCount;
            report.ActualPageCount = actualPageCount;

            if (expectedPageCount != actualPageCount)
            {
                report.FailedChecks.Add($"打印 PDF 页数不对。期望 {expectedPageCount} 页，实际 {actualPageCount} 页。");
            }

            for (int outputPageIndex = 0; outputPageIndex < Math.Min(expectedPageCount, actualPageCount); outputPageIndex += 1)
            {
                int sourcePageIndex = expectedPageIndexes[outputPageIndex];
                string expectedPath = Path.Combine(report.ExpectedDirectory, $"page-{outputPageIndex + 1}.png");
                string actualPath = Path.Combine(report.ActualDirectory, $"page-{outputPageIndex + 1}.png");

                BitmapSource expectedBitmap = renderer.RenderPagePreview(sourcePageIndex, HomeworkPrintRenderer.DefaultPageSize, 144);
                SavePng(expectedBitmap, expectedPath);

                var actualPage = actualDocumentService
                    .GetPageAsync(outputPageIndex, expectedBitmap.PixelWidth, expectedBitmap.PixelHeight)
                    .ConfigureAwait(false)
                    .GetAwaiter()
                    .GetResult();

                if (actualPage?.Image == null)
                {
                    report.FailedChecks.Add($"打印 PDF 第 {outputPageIndex + 1} 页没有正确渲染出来。");
                    continue;
                }

                if (actualPage.Image is not BitmapSource actualSource)
                {
                    report.FailedChecks.Add($"打印 PDF 第 {outputPageIndex + 1} 页返回了非位图结果。");
                    continue;
                }

                BitmapSource actualBitmap = ResizeBitmap(actualSource, expectedBitmap.PixelWidth, expectedBitmap.PixelHeight);
                SavePng(actualBitmap, actualPath);

                PageComparison pageReport = ComparePages(outputPageIndex + 1, expectedBitmap, actualBitmap);
                report.Pages.Add(pageReport);

                bool likelyBlank = pageReport.ExpectedNonWhiteRatio > 0.02 &&
                    pageReport.ActualNonWhiteRatio < pageReport.ExpectedNonWhiteRatio * 0.55;
                bool tooDifferent = pageReport.ChangedPixelRatio > 0.20 && pageReport.AverageChannelDifference > 8;

                if (likelyBlank || tooDifferent)
                {
                    report.FailedChecks.Add(
                        $"打印 PDF 第 {outputPageIndex + 1} 页和预期渲染差异过大: changed={pageReport.ChangedPixelRatio:F4}, avg={pageReport.AverageChannelDifference:F2}, actualInk={pageReport.ActualNonWhiteRatio:F4}。");
                }
            }
        });
    }

    private static void LoadJobDocument(DocumentService documentService, JobSession job)
    {
        if (job.SourceFiles.Count == 0)
        {
            return;
        }

        if (job.SourceFiles.Count == 1)
        {
            documentService.LoadDocument(job.SourceFiles[0]);
            return;
        }

        documentService.LoadMultipleImages(job.SourceFiles);
    }

    private static string? FindLatestJobDirectory()
    {
        string jobsPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "HomeworkApp",
            "Jobs");

        if (!Directory.Exists(jobsPath))
        {
            return null;
        }

        return Directory.GetDirectories(jobsPath)
            .Select((path) => new DirectoryInfo(path))
            .OrderByDescending((info) => info.LastWriteTimeUtc)
            .Select((info) => info.FullName)
            .FirstOrDefault();
    }

    private static void SavePng(BitmapSource bitmap, string outputPath)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
        var encoder = new PngBitmapEncoder();
        encoder.Frames.Add(BitmapFrame.Create(bitmap));
        using var stream = File.Create(outputPath);
        encoder.Save(stream);
    }

    private static BitmapSource ResizeBitmap(BitmapSource bitmap, int width, int height)
    {
        var drawingVisual = new DrawingVisual();
        using (DrawingContext drawingContext = drawingVisual.RenderOpen())
        {
            drawingContext.DrawImage(bitmap, new Rect(0, 0, width, height));
        }

        var renderTarget = new RenderTargetBitmap(width, height, 96, 96, PixelFormats.Pbgra32);
        renderTarget.Render(drawingVisual);
        renderTarget.Freeze();
        return renderTarget;
    }

    private static PageComparison ComparePages(int pageNumber, BitmapSource expected, BitmapSource actual)
    {
        var normalizedExpected = EnsureBgra32(expected);
        var normalizedActual = EnsureBgra32(actual);
        int width = Math.Min(normalizedExpected.PixelWidth, normalizedActual.PixelWidth);
        int height = Math.Min(normalizedExpected.PixelHeight, normalizedActual.PixelHeight);
        int stride = width * 4;
        byte[] expectedPixels = new byte[stride * height];
        byte[] actualPixels = new byte[stride * height];

        normalizedExpected.CopyPixels(new Int32Rect(0, 0, width, height), expectedPixels, stride, 0);
        normalizedActual.CopyPixels(new Int32Rect(0, 0, width, height), actualPixels, stride, 0);

        double totalDifference = 0;
        int changedPixels = 0;
        int expectedNonWhite = 0;
        int actualNonWhite = 0;

        for (int index = 0; index < expectedPixels.Length; index += 4)
        {
            int blueDiff = Math.Abs(expectedPixels[index] - actualPixels[index]);
            int greenDiff = Math.Abs(expectedPixels[index + 1] - actualPixels[index + 1]);
            int redDiff = Math.Abs(expectedPixels[index + 2] - actualPixels[index + 2]);
            int pixelDifference = redDiff + greenDiff + blueDiff;

            totalDifference += pixelDifference;

            if (pixelDifference > 24)
            {
                changedPixels += 1;
            }

            if (!IsNearlyWhite(expectedPixels[index], expectedPixels[index + 1], expectedPixels[index + 2]))
            {
                expectedNonWhite += 1;
            }

            if (!IsNearlyWhite(actualPixels[index], actualPixels[index + 1], actualPixels[index + 2]))
            {
                actualNonWhite += 1;
            }
        }

        int pixelCount = width * height;
        return new PageComparison
        {
            PageNumber = pageNumber,
            ChangedPixelRatio = pixelCount == 0 ? 0 : (double)changedPixels / pixelCount,
            AverageChannelDifference = pixelCount == 0 ? 0 : totalDifference / (pixelCount * 3),
            ExpectedNonWhiteRatio = pixelCount == 0 ? 0 : (double)expectedNonWhite / pixelCount,
            ActualNonWhiteRatio = pixelCount == 0 ? 0 : (double)actualNonWhite / pixelCount
        };
    }

    private static BitmapSource EnsureBgra32(BitmapSource bitmap)
    {
        if (bitmap.Format == PixelFormats.Bgra32 || bitmap.Format == PixelFormats.Pbgra32)
        {
            return bitmap;
        }

        var converted = new FormatConvertedBitmap();
        converted.BeginInit();
        converted.Source = bitmap;
        converted.DestinationFormat = PixelFormats.Bgra32;
        converted.EndInit();
        converted.Freeze();
        return converted;
    }

    private static bool IsNearlyWhite(byte blue, byte green, byte red)
    {
        return red >= 245 && green >= 245 && blue >= 245;
    }

    private static void RunSta(Action action)
    {
        Exception? failure = null;
        using var completed = new ManualResetEventSlim(false);
        var thread = new Thread(() =>
        {
            try
            {
                action();
            }
            catch (Exception exception)
            {
                failure = exception;
            }
            finally
            {
                completed.Set();
            }
        });

        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        completed.Wait();
        thread.Join();

        if (failure != null)
        {
            throw failure;
        }
    }
}

internal sealed class SmokeReport
{
    public bool Passed { get; set; }
    public string AppPath { get; set; } = string.Empty;
    public string OutputDirectory { get; set; } = string.Empty;
    public string JobDirectory { get; set; } = string.Empty;
    public string PrintedPdfPath { get; set; } = string.Empty;
    public string ExpectedDirectory { get; set; } = string.Empty;
    public string ActualDirectory { get; set; } = string.Empty;
    public int ProcessId { get; set; }
    public string MainWindowTitle { get; set; } = string.Empty;
    public string SaveDialogTitle { get; set; } = string.Empty;
    public string DeleteDialogTitle { get; set; } = string.Empty;
    public string DeletedJobId { get; set; } = string.Empty;
    public string DeletedJobSubject { get; set; } = string.Empty;
    public int ExpectedPageCount { get; set; }
    public int ActualPageCount { get; set; }
    public string ZoomAfterFirstStep { get; set; } = string.Empty;
    public string ZoomAtMaximum { get; set; } = string.Empty;
    public string ZoomAtExpandedMaximum { get; set; } = string.Empty;
    public string ZoomAtCollapsedMaximum { get; set; } = string.Empty;
    public bool AssistantCollapsed { get; set; }
    public bool AssistantExpanded { get; set; }
    public string AssistantCollapseGlyph { get; set; } = string.Empty;
    public string AssistantExpandGlyph { get; set; } = string.Empty;
    public bool HomeworkSyncTriggered { get; set; }
    public string SyncDialogTitle { get; set; } = string.Empty;
    public bool UndoRedoPassed { get; set; }
    public bool HistoryStepLimitPassed { get; set; }
    public bool HorizontalScrollBarPassed { get; set; }
    public string NewHomeworkDefaultTitle { get; set; } = string.Empty;
    public string? ErrorMessage { get; set; }
    public List<string> FailedChecks { get; } = [];
    public List<PageComparison> Pages { get; } = [];
}

internal sealed class PageComparison
{
    public int PageNumber { get; set; }
    public double ChangedPixelRatio { get; set; }
    public double AverageChannelDifference { get; set; }
    public double ExpectedNonWhiteRatio { get; set; }
    public double ActualNonWhiteRatio { get; set; }
}
