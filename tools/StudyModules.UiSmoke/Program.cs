using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

internal static class Program
{
    private sealed class CommandResult
    {
        [JsonPropertyName("exitCode")]
        public int ExitCode { get; set; }

        [JsonPropertyName("stdout")]
        public string Stdout { get; set; } = string.Empty;

        [JsonPropertyName("stderr")]
        public string Stderr { get; set; } = string.Empty;
    }

    private sealed class AgentCreateResult
    {
        [JsonPropertyName("ok")]
        public bool Ok { get; set; }

        [JsonPropertyName("taskId")]
        public string TaskId { get; set; } = string.Empty;

        [JsonPropertyName("title")]
        public string Title { get; set; } = string.Empty;

        [JsonPropertyName("subject")]
        public string Subject { get; set; } = string.Empty;

        [JsonPropertyName("bucket")]
        public string Bucket { get; set; } = string.Empty;

        [JsonPropertyName("targetDate")]
        public string TargetDate { get; set; } = string.Empty;

        [JsonPropertyName("itemCount")]
        public int ItemCount { get; set; }

        [JsonPropertyName("error")]
        public string Error { get; set; } = string.Empty;
    }

    private sealed class ModuleSmokeReport
    {
        [JsonPropertyName("passed")]
        public bool Passed { get; set; }

        [JsonPropertyName("failedChecks")]
        public List<string> FailedChecks { get; set; } = new();

        [JsonPropertyName("dictation")]
        public Dictionary<string, object?> Dictation { get; set; } = new();

        [JsonPropertyName("recitation")]
        public Dictionary<string, object?> Recitation { get; set; } = new();
    }

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true
    };

    private static int Main(string[] args)
    {
        var report = new ModuleSmokeReport();

        try
        {
            if (args.Length == 0 || !string.Equals(args[0], "run-agent-create-smoke", StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("用法：StudyModules.UiSmoke run-agent-create-smoke --dictation-app <path> --recitation-app <path> --output-dir <path>");
            }

            string dictationAppPath = ReadOption(args, "--dictation-app");
            string recitationAppPath = ReadOption(args, "--recitation-app");
            string outputDir = ReadOption(args, "--output-dir");

            if (string.IsNullOrWhiteSpace(dictationAppPath) || !File.Exists(dictationAppPath))
            {
                throw new FileNotFoundException("找不到 DictationApp.exe。", dictationAppPath);
            }

            if (string.IsNullOrWhiteSpace(recitationAppPath) || !File.Exists(recitationAppPath))
            {
                throw new FileNotFoundException("找不到 RecitationApp.exe。", recitationAppPath);
            }

            if (string.IsNullOrWhiteSpace(outputDir))
            {
                throw new InvalidOperationException("缺少 --output-dir。");
            }

            Directory.CreateDirectory(outputDir);
            string dataRoot = Path.Combine(outputDir, "module-data-root");
            Directory.CreateDirectory(dataRoot);

            RunDictationSmoke(dictationAppPath, outputDir, dataRoot, report);
            RunRecitationSmoke(recitationAppPath, outputDir, dataRoot, report);
            report.Passed = report.FailedChecks.Count == 0;
        }
        catch (Exception ex)
        {
            report.FailedChecks.Add(ex.Message);
            report.Passed = false;
        }

        Console.WriteLine(JsonSerializer.Serialize(report, JsonOptions));
        return report.Passed ? 0 : 1;
    }

    private static void RunDictationSmoke(string appPath, string outputDir, string dataRoot, ModuleSmokeReport report)
    {
        string payloadPath = Path.Combine(outputDir, "dictation-payload.json");
        string resultPath = Path.Combine(outputDir, "dictation-result.json");
        string targetDate = DateTime.Today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

        File.WriteAllText(payloadPath, JsonSerializer.Serialize(new
        {
            title = "英语听写 smoke",
            subject = "英语",
            bucket = "课外",
            targetDate,
            language = "英语",
            items = new[] { "apple", "banana", "orange" }
        }, JsonOptions));

        CommandResult command = RunProcess(appPath, $"--agent-create-dictation --payload-file \"{payloadPath}\" --result-file \"{resultPath}\"", dataRoot);
        AgentCreateResult result = ReadJsonFile<AgentCreateResult>(resultPath);
        string tasksPath = Path.Combine(dataRoot, "DictationApp", "tasks.json");
        string tasksText = File.Exists(tasksPath) ? File.ReadAllText(tasksPath) : string.Empty;
        using JsonDocument tasksJson = string.IsNullOrWhiteSpace(tasksText)
            ? JsonDocument.Parse("{\"tasks\":[]}")
            : JsonDocument.Parse(tasksText);
        JsonElement tasks = tasksJson.RootElement.GetProperty("tasks");
        JsonElement? createdTask = FindTaskById(tasks, result.TaskId);

        report.Dictation["commandExitCode"] = command.ExitCode;
        report.Dictation["taskId"] = result.TaskId;
        report.Dictation["resultOk"] = result.Ok;
        report.Dictation["createdTaskCount"] = tasks.GetArrayLength();
        report.Dictation["dataPath"] = tasksPath;

        if (command.ExitCode != 0)
        {
            report.FailedChecks.Add($"听写模块 agent 创建退出码异常：{command.ExitCode}");
        }

        if (!result.Ok)
        {
            report.FailedChecks.Add($"听写模块 agent 创建失败：{result.Error}");
        }

        if (createdTask is null)
        {
            report.FailedChecks.Add("听写模块没有把新任务写入 tasks.json。");
            return;
        }

        if (!string.Equals(createdTask.Value.GetProperty("subject").GetString(), "英语", StringComparison.Ordinal))
        {
            report.FailedChecks.Add("听写模块创建后的 subject 不正确。");
        }

        if (!string.Equals(createdTask.Value.GetProperty("bucket").GetString(), "课外", StringComparison.Ordinal))
        {
            report.FailedChecks.Add("听写模块创建后的 bucket 不正确。");
        }

        int itemCount = createdTask.Value.GetProperty("items").GetArrayLength();

        if (itemCount != 3)
        {
            report.FailedChecks.Add($"听写模块创建后的 items 数量不对：{itemCount}");
        }

        DictationUiSmoke.Run(appPath, dataRoot, report.Dictation, report.FailedChecks);
    }

    private static void RunRecitationSmoke(string appPath, string outputDir, string dataRoot, ModuleSmokeReport report)
    {
        string payloadPath = Path.Combine(outputDir, "recitation-payload.json");
        string resultPath = Path.Combine(outputDir, "recitation-result.json");
        string targetDate = DateTime.Today.AddDays(1).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        const string sourceText = "床前明月光，疑是地上霜。举头望明月，低头思故乡。";

        File.WriteAllText(payloadPath, JsonSerializer.Serialize(new
        {
            title = "古诗背诵 smoke",
            bucket = "课内",
            targetDate,
            sourceText
        }, JsonOptions));

        CommandResult command = RunProcess(appPath, $"--agent-create-recitation --payload-file \"{payloadPath}\" --result-file \"{resultPath}\"", dataRoot);
        AgentCreateResult result = ReadJsonFile<AgentCreateResult>(resultPath);
        string tasksPath = Path.Combine(dataRoot, "RecitationApp", "tasks.json");
        string tasksText = File.Exists(tasksPath) ? File.ReadAllText(tasksPath) : string.Empty;
        using JsonDocument tasksJson = string.IsNullOrWhiteSpace(tasksText)
            ? JsonDocument.Parse("{\"tasks\":[]}")
            : JsonDocument.Parse(tasksText);
        JsonElement tasks = tasksJson.RootElement.GetProperty("tasks");
        JsonElement? createdTask = FindTaskById(tasks, result.TaskId);

        report.Recitation["commandExitCode"] = command.ExitCode;
        report.Recitation["taskId"] = result.TaskId;
        report.Recitation["resultOk"] = result.Ok;
        report.Recitation["createdTaskCount"] = tasks.GetArrayLength();
        report.Recitation["dataPath"] = tasksPath;

        if (command.ExitCode != 0)
        {
            report.FailedChecks.Add($"背诵模块 agent 创建退出码异常：{command.ExitCode}");
        }

        if (!result.Ok)
        {
            report.FailedChecks.Add($"背诵模块 agent 创建失败：{result.Error}");
        }

        if (createdTask is null)
        {
            report.FailedChecks.Add("背诵模块没有把新任务写入 tasks.json。");
            return;
        }

        if (!string.Equals(createdTask.Value.GetProperty("bucket").GetString(), "课内", StringComparison.Ordinal))
        {
            report.FailedChecks.Add("背诵模块创建后的 bucket 不正确。");
        }

        if (!string.Equals(createdTask.Value.GetProperty("sourceText").GetString(), sourceText, StringComparison.Ordinal))
        {
            report.FailedChecks.Add("背诵模块创建后的原文不正确。");
        }
    }

    private static T ReadJsonFile<T>(string filePath)
    {
        using FileStream stream = File.OpenRead(filePath);
        return JsonSerializer.Deserialize<T>(stream, JsonOptions) ?? throw new InvalidOperationException($"无法读取 {filePath}");
    }

    private static JsonElement? FindTaskById(JsonElement tasks, string taskId)
    {
        foreach (JsonElement item in tasks.EnumerateArray())
        {
            if (string.Equals(item.GetProperty("taskId").GetString(), taskId, StringComparison.OrdinalIgnoreCase))
            {
                return item;
            }
        }

        return null;
    }

    private static CommandResult RunProcess(string executablePath, string arguments, string dataRoot)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = executablePath,
            Arguments = arguments,
            WorkingDirectory = Path.GetDirectoryName(executablePath) ?? Environment.CurrentDirectory,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        startInfo.Environment["STUDYGATE_MODULES_DATA_ROOT"] = dataRoot;
        ApplyDotnetEnvironment(startInfo);

        using var process = Process.Start(startInfo) ?? throw new InvalidOperationException($"无法启动 {executablePath}");
        string stdout = process.StandardOutput.ReadToEnd();
        string stderr = process.StandardError.ReadToEnd();
        process.WaitForExit();

        return new CommandResult
        {
            ExitCode = process.ExitCode,
            Stdout = stdout,
            Stderr = stderr
        };
    }

    private static string ReadOption(IReadOnlyList<string> args, string optionName)
    {
        for (int index = 0; index < args.Count - 1; index += 1)
        {
            if (string.Equals(args[index], optionName, StringComparison.OrdinalIgnoreCase))
            {
                return args[index + 1];
            }
        }

        return string.Empty;
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
}
