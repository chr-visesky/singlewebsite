using System;
using System.Collections.Generic;
using System.IO;
using Newtonsoft.Json;

namespace HomeworkApp.Models
{
    /// <summary>
    /// Represents a homework job session
    /// </summary>
    public class JobSession
    {
        [JsonProperty("jobId")]
        public string JobId { get; set; } = Guid.NewGuid().ToString();

        [JsonProperty("subject")]
        public string Subject { get; set; } = "语文";

        [JsonProperty("bucket")]
        public string Bucket { get; set; } = string.Empty;

        [JsonProperty("sourceFiles")]
        public List<string> SourceFiles { get; set; } = new List<string>();

        [JsonProperty("totalPages")]
        public int TotalPages { get; set; }

        [JsonProperty("currentPage")]
        public int CurrentPage { get; set; } = 0;

        [JsonProperty("isPortrait")]
        public bool IsPortrait { get; set; } = true;

        [JsonProperty("createTime")]
        public DateTime CreateTime { get; set; } = DateTime.Now;

        [JsonProperty("updateTime")]
        public DateTime UpdateTime { get; set; } = DateTime.Now;

        [JsonProperty("isPrinted")]
        public bool IsPrinted { get; set; }

        [JsonProperty("inkFilePaths")]
        public Dictionary<int, string> InkFilePaths { get; set; } = new Dictionary<int, string>();

        [JsonProperty("documentType")]
        public string DocumentType { get; set; } = "Image"; // "Image" or "Pdf"

        [JsonIgnore]
        public string JobDirectory { get; set; } = string.Empty;

        [JsonIgnore]
        public string InkDirectory => Path.Combine(JobDirectory, "ink");

        [JsonIgnore]
        public string SourceDirectory => Path.Combine(JobDirectory, "source");

        [JsonIgnore]
        public string CacheDirectory => Path.Combine(JobDirectory, "cache");

        [JsonIgnore]
        public string DraftInkPath => Path.Combine(JobDirectory, "draft.ink");

        public string GetDraftInkFilePath()
        {
            return DraftInkPath;
        }

        public string GetInkFilePath(int pageIndex)
        {
            if (InkFilePaths.TryGetValue(pageIndex, out string? path))
            {
                return path;
            }

            string newInkPath = Path.Combine(InkDirectory, $"page_{pageIndex}.ink");
            InkFilePaths[pageIndex] = newInkPath;
            return newInkPath;
        }

        public void Save(string directory)
        {
            JobDirectory = directory;
            UpdateTime = DateTime.Now;

            // Ensure directories exist
            Directory.CreateDirectory(JobDirectory);
            Directory.CreateDirectory(InkDirectory);
            Directory.CreateDirectory(SourceDirectory);
            Directory.CreateDirectory(CacheDirectory);

            // Save job metadata
            string jsonPath = Path.Combine(JobDirectory, "job.json");
            string json = JsonConvert.SerializeObject(this, Formatting.Indented);
            File.WriteAllText(jsonPath, json);
        }

        public static JobSession? Load(string directory)
        {
            string jsonPath = Path.Combine(directory, "job.json");
            if (!File.Exists(jsonPath))
            {
                return null;
            }

            string json = File.ReadAllText(jsonPath);
            var job = JsonConvert.DeserializeObject<JobSession>(json);
            if (job != null)
            {
                job.JobDirectory = directory;
            }
            return job;
        }
    }
}
