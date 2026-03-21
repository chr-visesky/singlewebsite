using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using HomeworkApp.Models;
using HomeworkApp.Services;
using HomeworkApp.Views;

var report = await HomeworkAppUiSmoke.RunAsync(args);
var json = JsonSerializer.Serialize(report, new JsonSerializerOptions
{
    WriteIndented = true,
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase
});
Console.WriteLine(json);
Environment.ExitCode = report.Passed ? 0 : 1;

internal static class HomeworkAppUiSmoke
{
    public static async Task<SmokeReport> RunAsync(string[] args)
    {
        string command = args.Length > 0 ? args[0] : "run-print-smoke";
        return command switch
        {
            "run-print-smoke" => await RunPrintSmokeAsync(args.Skip(1).ToArray()),
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

        try
        {
            string appPath = GetOption(args, "--app") ??
                Path.Combine(Environment.CurrentDirectory, "dist", "StudyGate-win32-x64", "modules", "homework", "HomeworkApp.exe");
            string outputDir = GetOption(args, "--output-dir") ??
                Path.Combine(Environment.CurrentDirectory, "temp", "ui-smoke", "homework");
            string? explicitJobDir = GetOption(args, "--job-dir");
            int existingProcessId = ParseIntOption(args, "--process-id");
            string? jobDir = explicitJobDir ?? FindLatestJobDirectory();

            report.AppPath = appPath;
            report.OutputDirectory = outputDir;
            report.JobDirectory = jobDir ?? string.Empty;

            if (!File.Exists(appPath))
            {
                report.FailedChecks.Add($"HomeworkApp executable was not found: {appPath}");
                return report;
            }

            if (string.IsNullOrWhiteSpace(jobDir) || !Directory.Exists(jobDir))
            {
                report.FailedChecks.Add("HomeworkApp 当前没有可继续的旧作业数据。");
                return report;
            }

            ResetDirectory(outputDir);

            string pdfPath = Path.Combine(outputDir, "manual-print.pdf");
            report.PrintedPdfPath = pdfPath;
            report.ExpectedDirectory = Path.Combine(outputDir, "expected");
            report.ActualDirectory = Path.Combine(outputDir, "actual");

            if (File.Exists(pdfPath))
            {
                File.Delete(pdfPath);
            }

            Process process;
            if (existingProcessId > 0)
            {
                process = Process.GetProcessById(existingProcessId);
            }
            else
            {
                KillProcessesByPath(appPath);
                process = StartHomeworkApp(appPath);
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

                IntPtr saveDialogHandle = WaitForSaveDialogHandle(TimeSpan.FromSeconds(30));
                report.SaveDialogTitle = GetWindowText(saveDialogHandle);
                SetSaveDialogFileName(saveDialogHandle, pdfPath);
                ClickSaveDialogButton(saveDialogHandle);
            });

            await WaitForFileAsync(pdfPath, TimeSpan.FromSeconds(30));
            VerifyPrintedPdf(jobDir!, pdfPath, report);
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

    private static void ResetDirectory(string path)
    {
        if (Directory.Exists(path))
        {
            Directory.Delete(path, recursive: true);
        }

        Directory.CreateDirectory(path);
    }

    private static Process StartHomeworkApp(string appPath)
    {
        var startInfo = new ProcessStartInfo(appPath)
        {
            WorkingDirectory = Path.GetDirectoryName(appPath) ?? Environment.CurrentDirectory,
            UseShellExecute = false
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

    private static IntPtr WaitForSaveDialogHandle(TimeSpan timeout)
    {
        DateTime deadline = DateTime.UtcNow.Add(timeout);

        while (DateTime.UtcNow < deadline)
        {
            foreach (IntPtr handle in EnumerateTopLevelWindows())
            {
                string title = GetWindowText(handle);
                if (title.Contains("将打印输出另存为", StringComparison.OrdinalIgnoreCase) ||
                    title.Contains("Save Print Output", StringComparison.OrdinalIgnoreCase))
                {
                    return handle;
                }
            }

            Thread.Sleep(250);
        }

        throw new TimeoutException("打印保存对话框没有出现。");
    }

    private static void SetSaveDialogFileName(IntPtr dialogHandle, string filePath)
    {
        NativeMethods.SetForegroundWindow(dialogHandle);
        Thread.Sleep(250);

        IntPtr editHandle = EnumerateChildWindows(dialogHandle)
            .Where((handle) => NativeMethods.IsWindowVisible(handle))
            .Where((handle) => string.Equals(GetClassName(handle), "Edit", StringComparison.OrdinalIgnoreCase))
            .OrderByDescending((handle) => GetWindowRect(handle).Top)
            .ThenByDescending((handle) => GetWindowRect(handle).Right - GetWindowRect(handle).Left)
            .FirstOrDefault();

        if (editHandle == IntPtr.Zero)
        {
            throw new InvalidOperationException($"没有找到“文件名”输入框。现有窗口标题: {GetWindowText(dialogHandle)}");
        }

        if (NativeMethods.SendMessage(editHandle, NativeMethods.WmSetText, IntPtr.Zero, filePath) == IntPtr.Zero)
        {
            throw new InvalidOperationException("无法给保存框写入文件名。");
        }
    }

    private static void ClickSaveDialogButton(IntPtr dialogHandle)
    {
        IntPtr buttonHandle = EnumerateChildWindows(dialogHandle)
            .Where((handle) => NativeMethods.IsWindowVisible(handle))
            .Where((handle) => string.Equals(GetClassName(handle), "Button", StringComparison.OrdinalIgnoreCase))
            .FirstOrDefault((handle) =>
            {
                string title = GetWindowText(handle);
                return title.Contains("保存", StringComparison.OrdinalIgnoreCase) ||
                    title.Contains("Save", StringComparison.OrdinalIgnoreCase);
            });

        if (buttonHandle == IntPtr.Zero)
        {
            throw new InvalidOperationException($"没有找到保存按钮。现有窗口标题: {GetWindowText(dialogHandle)}");
        }

        _ = NativeMethods.SendMessage(buttonHandle, NativeMethods.BmClick, IntPtr.Zero, IntPtr.Zero);
    }

    private static void SetElementValue(AutomationElement element, string value)
    {
        if (element.TryGetCurrentPattern(ValuePattern.Pattern, out object valuePattern))
        {
            ((ValuePattern)valuePattern).SetValue(value);
            return;
        }

        throw new InvalidOperationException("文件名输入框不支持 ValuePattern。");
    }

    private static async Task WaitForFileAsync(string path, TimeSpan timeout)
    {
        DateTime deadline = DateTime.UtcNow.Add(timeout);
        long previousLength = -1;
        int stableCount = 0;

        while (DateTime.UtcNow < deadline)
        {
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

    private static void VerifyPrintedPdf(string jobDirectory, string pdfPath, SmokeReport report)
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

            int expectedPageCount = Math.Max(1, job.TotalPages);
            int actualPageCount = Math.Max(0, actualDocumentService.PageCount);
            report.ExpectedPageCount = expectedPageCount;
            report.ActualPageCount = actualPageCount;

            if (expectedPageCount != actualPageCount)
            {
                report.FailedChecks.Add($"打印 PDF 页数不对。期望 {expectedPageCount} 页，实际 {actualPageCount} 页。");
            }

            for (int pageIndex = 0; pageIndex < Math.Min(expectedPageCount, actualPageCount); pageIndex += 1)
            {
                string expectedPath = Path.Combine(report.ExpectedDirectory, $"page-{pageIndex + 1}.png");
                string actualPath = Path.Combine(report.ActualDirectory, $"page-{pageIndex + 1}.png");

                BitmapSource expectedBitmap = renderer.RenderPagePreview(pageIndex, HomeworkPrintRenderer.DefaultPageSize, 144);
                SavePng(expectedBitmap, expectedPath);

                var actualPage = actualDocumentService
                    .GetPageAsync(pageIndex, expectedBitmap.PixelWidth, expectedBitmap.PixelHeight)
                    .ConfigureAwait(false)
                    .GetAwaiter()
                    .GetResult();

                if (actualPage?.Image == null)
                {
                    report.FailedChecks.Add($"打印 PDF 第 {pageIndex + 1} 页没有正确渲染出来。");
                    continue;
                }

                if (actualPage.Image is not BitmapSource actualSource)
                {
                    report.FailedChecks.Add($"打印 PDF 第 {pageIndex + 1} 页返回了非位图结果。");
                    continue;
                }

                BitmapSource actualBitmap = ResizeBitmap(actualSource, expectedBitmap.PixelWidth, expectedBitmap.PixelHeight);
                SavePng(actualBitmap, actualPath);

                PageComparison pageReport = ComparePages(pageIndex + 1, expectedBitmap, actualBitmap);
                report.Pages.Add(pageReport);

                bool likelyBlank = pageReport.ExpectedNonWhiteRatio > 0.02 &&
                    pageReport.ActualNonWhiteRatio < pageReport.ExpectedNonWhiteRatio * 0.55;
                bool tooDifferent = pageReport.ChangedPixelRatio > 0.20 && pageReport.AverageChannelDifference > 8;

                if (likelyBlank || tooDifferent)
                {
                    report.FailedChecks.Add(
                        $"打印 PDF 第 {pageIndex + 1} 页和预期渲染差异过大: changed={pageReport.ChangedPixelRatio:F4}, avg={pageReport.AverageChannelDifference:F2}, actualInk={pageReport.ActualNonWhiteRatio:F4}。");
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

    private static string DumpControls(AutomationElement root)
    {
        var descendants = root.FindAll(TreeScope.Descendants, System.Windows.Automation.Condition.TrueCondition);
        return string.Join(
            " | ",
            descendants.Cast<AutomationElement>()
                .Take(20)
                .Select((element) =>
                    $"{element.Current.ControlType.ProgrammaticName}:{element.Current.AutomationId}:{element.Current.Name}"));
    }

    private static IEnumerable<IntPtr> EnumerateTopLevelWindows()
    {
        var handles = new List<IntPtr>();
        NativeMethods.EnumWindows((handle, _) =>
        {
            if (NativeMethods.IsWindowVisible(handle))
            {
                handles.Add(handle);
            }

            return true;
        }, IntPtr.Zero);
        return handles;
    }

    private static IEnumerable<IntPtr> EnumerateChildWindows(IntPtr parentHandle)
    {
        var handles = new List<IntPtr>();
        NativeMethods.EnumChildWindows(parentHandle, (handle, _) =>
        {
            handles.Add(handle);
            return true;
        }, IntPtr.Zero);
        return handles;
    }

    private static string GetWindowText(IntPtr handle)
    {
        var builder = new StringBuilder(256);
        _ = NativeMethods.GetWindowText(handle, builder, builder.Capacity);
        return builder.ToString();
    }

    private static string GetClassName(IntPtr handle)
    {
        var builder = new StringBuilder(256);
        _ = NativeMethods.GetClassName(handle, builder, builder.Capacity);
        return builder.ToString();
    }

    private static NativeMethods.Rect GetWindowRect(IntPtr handle)
    {
        _ = NativeMethods.GetWindowRect(handle, out NativeMethods.Rect rect);
        return rect;
    }

    private static class NativeMethods
    {
        public const uint WmSetText = 0x000C;
        public const uint BmClick = 0x00F5;

        public delegate bool EnumWindowProc(IntPtr handle, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential)]
        public struct Rect
        {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
        }

        [DllImport("user32.dll")]
        public static extern bool EnumWindows(EnumWindowProc callback, IntPtr lParam);

        [DllImport("user32.dll")]
        public static extern bool EnumChildWindows(IntPtr parentHandle, EnumWindowProc callback, IntPtr lParam);

        [DllImport("user32.dll")]
        public static extern bool IsWindowVisible(IntPtr handle);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern int GetWindowText(IntPtr handle, StringBuilder builder, int maxCount);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern int GetClassName(IntPtr handle, StringBuilder builder, int maxCount);

        [DllImport("user32.dll")]
        public static extern bool GetWindowRect(IntPtr handle, out Rect rect);

        [DllImport("user32.dll")]
        public static extern bool SetForegroundWindow(IntPtr handle);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern IntPtr SendMessage(IntPtr handle, uint message, IntPtr wParam, string lParam);

        [DllImport("user32.dll")]
        public static extern IntPtr SendMessage(IntPtr handle, uint message, IntPtr wParam, IntPtr lParam);
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
    public int ExpectedPageCount { get; set; }
    public int ActualPageCount { get; set; }
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
