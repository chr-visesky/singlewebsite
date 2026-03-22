using System;
using System.Collections.Generic;
using DictationApp.Models;
using Newtonsoft.Json;
using StudyModules.Shared;

namespace DictationApp.Services;

public static class AgentDictationCommand
{
    private sealed class CreateDictationPayload
    {
        [JsonProperty("title")]
        public string Title { get; set; } = string.Empty;

        [JsonProperty("subject")]
        public string Subject { get; set; } = "语文";

        [JsonProperty("bucket")]
        public string Bucket { get; set; } = "课内";

        [JsonProperty("targetDate")]
        public string TargetDate { get; set; } = string.Empty;

        [JsonProperty("language")]
        public string Language { get; set; } = string.Empty;

        [JsonProperty("items")]
        public List<string> Items { get; set; } = new();
    }

    private sealed class CreateDictationResult
    {
        [JsonProperty("ok")]
        public bool Ok { get; set; }

        [JsonProperty("taskId")]
        public string TaskId { get; set; } = string.Empty;

        [JsonProperty("title")]
        public string Title { get; set; } = string.Empty;

        [JsonProperty("subject")]
        public string Subject { get; set; } = string.Empty;

        [JsonProperty("bucket")]
        public string Bucket { get; set; } = string.Empty;

        [JsonProperty("targetDate")]
        public string TargetDate { get; set; } = string.Empty;

        [JsonProperty("itemCount")]
        public int ItemCount { get; set; }

        [JsonProperty("error")]
        public string Error { get; set; } = string.Empty;
    }

    public static bool TryHandle(string[] args, DictationTaskStore taskStore)
    {
        if (!HasFlag(args, "--agent-create-dictation"))
        {
            return false;
        }

        Environment.ExitCode = HandleCreate(args, taskStore);
        return true;
    }

    private static int HandleCreate(IReadOnlyList<string> args, DictationTaskStore taskStore)
    {
        string payloadFile = ReadOption(args, "--payload-file");
        string resultFile = ReadOption(args, "--result-file");

        try
        {
            CreateDictationPayload payload = CommandFileIO.ReadJsonFile<CreateDictationPayload>(payloadFile);
            DictationTask task = taskStore.CreateFromAgent(
                payload.Title,
                payload.Subject,
                payload.Bucket,
                payload.TargetDate,
                payload.Language,
                payload.Items);
            CommandFileIO.WriteJsonFile(resultFile, new CreateDictationResult
            {
                Ok = true,
                TaskId = task.TaskId,
                Title = task.Title,
                Subject = task.Subject,
                Bucket = task.Bucket,
                TargetDate = task.TargetDate.ToString("yyyy-MM-dd"),
                ItemCount = task.Items.Count
            });
            return 0;
        }
        catch (Exception ex)
        {
            CommandFileIO.WriteJsonFile(resultFile, new CreateDictationResult
            {
                Ok = false,
                Error = ex.Message
            });
            return 1;
        }
    }

    private static bool HasFlag(IEnumerable<string> args, string flag)
    {
        foreach (string arg in args)
        {
            if (string.Equals(arg, flag, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
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
}
