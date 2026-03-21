using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using HomeworkApp.Models;
using Newtonsoft.Json;

namespace HomeworkApp.Services
{
    internal static class AgentHomeworkCommand
    {
        private sealed class CreateHomeworkPayload
        {
            [JsonProperty("subject")]
            public string Subject { get; set; } = "作业";

            [JsonProperty("bucket")]
            public string Bucket { get; set; } = string.Empty;

            [JsonProperty("targetDate")]
            public string TargetDate { get; set; } = string.Empty;

            [JsonProperty("sourceFiles")]
            public List<string> SourceFiles { get; set; } = new();
        }

        private sealed class DeleteHomeworkPayload
        {
            [JsonProperty("jobId")]
            public string JobId { get; set; } = string.Empty;
        }

        private sealed class CreateHomeworkResult
        {
            [JsonProperty("ok")]
            public bool Ok { get; set; }

            [JsonProperty("jobId")]
            public string JobId { get; set; } = string.Empty;

            [JsonProperty("subject")]
            public string Subject { get; set; } = string.Empty;

            [JsonProperty("bucket")]
            public string Bucket { get; set; } = string.Empty;

            [JsonProperty("targetDate")]
            public string TargetDate { get; set; } = string.Empty;

            [JsonProperty("totalPages")]
            public int TotalPages { get; set; }

            [JsonProperty("error")]
            public string Error { get; set; } = string.Empty;
        }

        public static bool TryHandle(string[] args)
        {
            if (HasFlag(args, "--agent-create-homework"))
            {
                Environment.ExitCode = HandleCreate(args);
                return true;
            }

            if (HasFlag(args, "--agent-delete-homework"))
            {
                Environment.ExitCode = HandleDelete(args);
                return true;
            }

            return false;
        }

        private static int HandleCreate(string[] args)
        {
            string payloadFile = ReadOption(args, "--payload-file");
            string resultFile = ReadOption(args, "--result-file");
            int exitCode = 0;

            try
            {
                if (string.IsNullOrWhiteSpace(payloadFile))
                {
                    throw new InvalidOperationException("缺少 --payload-file。");
                }

                var payload = ReadCreatePayload(payloadFile);
                var targetDate = ParseTargetDate(payload.TargetDate);
                var sourceFiles = NormalizeSourceFiles(payload.SourceFiles);
                var subject = string.IsNullOrWhiteSpace(payload.Subject) ? "作业" : payload.Subject.Trim();
                JobSession job = sourceFiles.Count > 0
                    ? JobManager.CreateJob(subject, sourceFiles, targetDate, payload.Bucket)
                    : JobManager.CreateBlankJob(subject, targetDate, payload.Bucket);
                WriteResult(resultFile, new CreateHomeworkResult
                {
                    Ok = true,
                    JobId = job.JobId,
                    Subject = job.Subject,
                    Bucket = job.Bucket,
                    TargetDate = job.CreateTime.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                    TotalPages = job.TotalPages
                });
            }
            catch (Exception ex)
            {
                exitCode = 1;
                WriteResult(resultFile, new CreateHomeworkResult
                {
                    Ok = false,
                    Error = ex.Message
                });
            }

            return exitCode;
        }

        private static int HandleDelete(string[] args)
        {
            string payloadFile = ReadOption(args, "--payload-file");
            string resultFile = ReadOption(args, "--result-file");
            int exitCode = 0;

            try
            {
                if (string.IsNullOrWhiteSpace(payloadFile))
                {
                    throw new InvalidOperationException("缺少 --payload-file。");
                }

                var payload = ReadDeletePayload(payloadFile);
                string jobId = string.IsNullOrWhiteSpace(payload.JobId) ? string.Empty : payload.JobId.Trim();

                if (string.IsNullOrWhiteSpace(jobId))
                {
                    throw new InvalidOperationException("缺少作业 jobId。");
                }

                JobSession? job = JobManager.LoadJob(jobId);

                if (job == null)
                {
                    throw new InvalidOperationException("找不到要删除的作业。");
                }

                JobManager.DeleteJob(jobId);
                WriteResult(resultFile, new CreateHomeworkResult
                {
                    Ok = true,
                    JobId = jobId,
                    Subject = job.Subject,
                    Bucket = job.Bucket,
                    TargetDate = job.CreateTime.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                    TotalPages = 0
                });
            }
            catch (Exception ex)
            {
                exitCode = 1;
                WriteResult(resultFile, new CreateHomeworkResult
                {
                    Ok = false,
                    Error = ex.Message
                });
            }

            return exitCode;
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

        private static CreateHomeworkPayload ReadCreatePayload(string payloadFile)
        {
            if (!File.Exists(payloadFile))
            {
                throw new FileNotFoundException("找不到作业创建参数文件。", payloadFile);
            }

            string json = File.ReadAllText(payloadFile);
            return JsonConvert.DeserializeObject<CreateHomeworkPayload>(json) ?? new CreateHomeworkPayload();
        }

        private static DeleteHomeworkPayload ReadDeletePayload(string payloadFile)
        {
            if (!File.Exists(payloadFile))
            {
                throw new FileNotFoundException("找不到作业删除参数文件。", payloadFile);
            }

            string json = File.ReadAllText(payloadFile);
            return JsonConvert.DeserializeObject<DeleteHomeworkPayload>(json) ?? new DeleteHomeworkPayload();
        }

        private static DateTime ParseTargetDate(string rawValue)
        {
            if (DateTime.TryParseExact(
                rawValue,
                "yyyy-MM-dd",
                CultureInfo.InvariantCulture,
                DateTimeStyles.None,
                out DateTime value))
            {
                return value;
            }

            return DateTime.Today;
        }

        private static List<string> NormalizeSourceFiles(IEnumerable<string> files)
        {
            var result = new List<string>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            foreach (string file in files ?? Array.Empty<string>())
            {
                string fullPath = string.IsNullOrWhiteSpace(file) ? string.Empty : Path.GetFullPath(file.Trim());

                if (string.IsNullOrWhiteSpace(fullPath) || !File.Exists(fullPath) || !seen.Add(fullPath))
                {
                    continue;
                }

                result.Add(fullPath);
            }

            return result;
        }

        private static void WriteResult(string resultFile, CreateHomeworkResult result)
        {
            if (string.IsNullOrWhiteSpace(resultFile))
            {
                return;
            }

            Directory.CreateDirectory(Path.GetDirectoryName(resultFile)!);
            File.WriteAllText(resultFile, JsonConvert.SerializeObject(result, Formatting.Indented));
        }
    }
}
