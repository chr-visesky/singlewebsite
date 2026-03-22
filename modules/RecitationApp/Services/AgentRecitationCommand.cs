using System;
using Newtonsoft.Json;
using RecitationApp.Models;
using StudyModules.Shared;

namespace RecitationApp.Services;

public static class AgentRecitationCommand
{
    private sealed class CreateRecitationPayload
    {
        [JsonProperty("title")]
        public string Title { get; set; } = string.Empty;

        [JsonProperty("bucket")]
        public string Bucket { get; set; } = "课内";

        [JsonProperty("targetDate")]
        public string TargetDate { get; set; } = string.Empty;

        [JsonProperty("sourceText")]
        public string SourceText { get; set; } = string.Empty;
    }

    private sealed class CreateRecitationResult
    {
        [JsonProperty("ok")]
        public bool Ok { get; set; }

        [JsonProperty("taskId")]
        public string TaskId { get; set; } = string.Empty;

        [JsonProperty("title")]
        public string Title { get; set; } = string.Empty;

        [JsonProperty("bucket")]
        public string Bucket { get; set; } = string.Empty;

        [JsonProperty("targetDate")]
        public string TargetDate { get; set; } = string.Empty;

        [JsonProperty("error")]
        public string Error { get; set; } = string.Empty;
    }

    public static bool TryHandle(string[] args, RecitationTaskStore taskStore)
    {
        if (!HasFlag(args, "--agent-create-recitation"))
        {
            return false;
        }

        Environment.ExitCode = HandleCreate(args, taskStore);
        return true;
    }

    private static int HandleCreate(string[] args, RecitationTaskStore taskStore)
    {
        string payloadFile = ReadOption(args, "--payload-file");
        string resultFile = ReadOption(args, "--result-file");

        try
        {
            CreateRecitationPayload payload = CommandFileIO.ReadJsonFile<CreateRecitationPayload>(payloadFile);
            RecitationTask task = taskStore.CreateFromAgent(
                payload.Title,
                payload.Bucket,
                payload.TargetDate,
                payload.SourceText);
            CommandFileIO.WriteJsonFile(resultFile, new CreateRecitationResult
            {
                Ok = true,
                TaskId = task.TaskId,
                Title = task.Title,
                Bucket = task.Bucket,
                TargetDate = task.TargetDate.ToString("yyyy-MM-dd")
            });
            return 0;
        }
        catch (Exception ex)
        {
            CommandFileIO.WriteJsonFile(resultFile, new CreateRecitationResult
            {
                Ok = false,
                Error = ex.Message
            });
            return 1;
        }
    }

    private static bool HasFlag(string[] args, string flag)
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

    private static string ReadOption(string[] args, string optionName)
    {
        for (int index = 0; index < args.Length - 1; index += 1)
        {
            if (string.Equals(args[index], optionName, StringComparison.OrdinalIgnoreCase))
            {
                return args[index + 1];
            }
        }

        return string.Empty;
    }
}
