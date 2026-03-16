using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using HomeworkApp.Models;
using PDFtoImage;

namespace HomeworkApp
{
    /// <summary>
    /// Manages job sessions - creation, loading, saving, and history
    /// </summary>
    public static class JobManager
    {
        private static readonly string AppDataPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "HomeworkApp");

        private static readonly string JobsPath = Path.Combine(AppDataPath, "Jobs");

        private static readonly string LastJobPath = Path.Combine(AppDataPath, "lastJob.txt");

        static JobManager()
        {
            if (!Directory.Exists(JobsPath))
            {
                Directory.CreateDirectory(JobsPath);
            }
        }

        /// <summary>
        /// Creates a new job session
        /// </summary>
        public static JobSession CreateJob(string subject, List<string> sourceFiles)
        {
            if (sourceFiles == null || sourceFiles.Count == 0)
            {
                throw new InvalidOperationException("没有可导入的作业文件。");
            }

            ValidateSourceFiles(sourceFiles);
            bool isPdfJob = sourceFiles.Count == 1 && IsPdfFile(sourceFiles[0]);

            var job = new JobSession
            {
                Subject = subject,
                SourceFiles = new List<string>(sourceFiles),
                CreateTime = DateTime.Now,
                UpdateTime = DateTime.Now,
                DocumentType = isPdfJob ? "Pdf" : "Image"
            };

            // Create job directory
            string jobDir = Path.Combine(JobsPath, job.JobId);
            Directory.CreateDirectory(jobDir);

            // Copy source files
            string sourceDir = Path.Combine(jobDir, "source");
            Directory.CreateDirectory(sourceDir);

            var newSourceFiles = new List<string>();
            foreach (var file in sourceFiles)
            {
                string destFile = Path.Combine(sourceDir, Path.GetFileName(file));
                try
                {
                    File.Copy(file, destFile, true);
                    newSourceFiles.Add(destFile);
                }
                catch (Exception ex)
                {
                    System.Diagnostics.Debug.WriteLine($"Error copying file: {ex.Message}");
                }
            }

            job.SourceFiles = newSourceFiles;
            job.TotalPages = isPdfJob
                ? Conversion.GetPageCount(File.ReadAllBytes(newSourceFiles[0]))
                : newSourceFiles.Count; // Will be updated by document service

            if (job.SourceFiles.Count == 0)
            {
                throw new IOException("作业文件复制失败，请确认文件仍然存在且可读取。");
            }

            // Save job
            job.Save(jobDir);

            // Set as last job
            MarkAsLastJob(job.JobId);

            return job;
        }

        public static JobSession CreateBlankJob(string subject)
        {
            var job = new JobSession
            {
                Subject = subject,
                SourceFiles = new List<string>(),
                CreateTime = DateTime.Now,
                UpdateTime = DateTime.Now,
                DocumentType = "Blank",
                TotalPages = 1
            };

            string jobDir = Path.Combine(JobsPath, job.JobId);
            Directory.CreateDirectory(jobDir);
            job.Save(jobDir);
            MarkAsLastJob(job.JobId);
            return job;
        }

        /// <summary>
        /// Saves a job session
        /// </summary>
        public static void SaveJob(JobSession job)
        {
            job.Save(job.JobDirectory);
            MarkAsLastJob(job.JobId);
        }

        /// <summary>
        /// Gets the last used job
        /// </summary>
        public static JobSession? GetLastJob()
        {
            if (!File.Exists(LastJobPath))
            {
                return null;
            }

            string lastJobId = File.ReadAllText(LastJobPath).Trim();
            return LoadJob(lastJobId);
        }

        public static JobSession GetPreferredStartupJob(string blankSubject = "作业")
        {
            var lastJob = GetLastJob();
            if (lastJob != null)
            {
                return lastJob;
            }

            var latestJob = GetAllJobs().FirstOrDefault();
            if (latestJob != null)
            {
                MarkAsLastJob(latestJob.JobId);
                return latestJob;
            }

            return CreateBlankJob(blankSubject);
        }

        /// <summary>
        /// Loads a specific job by ID
        /// </summary>
        public static JobSession? LoadJob(string jobId)
        {
            string jobDir = Path.Combine(JobsPath, jobId);
            return JobSession.Load(jobDir);
        }

        /// <summary>
        /// Gets all jobs sorted by update time (newest first)
        /// </summary>
        public static List<JobSession> GetAllJobs()
        {
            var jobs = new List<JobSession>();

            if (!Directory.Exists(JobsPath))
            {
                return jobs;
            }

            foreach (var dir in Directory.GetDirectories(JobsPath))
            {
                var job = JobSession.Load(dir);
                if (job != null)
                {
                    jobs.Add(job);
                }
            }

            return jobs.OrderByDescending(j => j.UpdateTime).ToList();
        }

        /// <summary>
        /// Gets jobs within a date range
        /// </summary>
        public static List<JobSession> GetJobsByDateRange(DateTime start, DateTime end)
        {
            var jobs = new List<JobSession>();

            if (!Directory.Exists(JobsPath))
            {
                return jobs;
            }

            foreach (var dir in Directory.GetDirectories(JobsPath))
            {
                var job = JobSession.Load(dir);
                if (job != null && job.UpdateTime >= start && job.UpdateTime <= end)
                {
                    jobs.Add(job);
                }
            }

            return jobs.OrderBy(j => j.UpdateTime).ToList();
        }

        /// <summary>
        /// Deletes a job
        /// </summary>
        public static void DeleteJob(string jobId)
        {
            string lastJobId = File.Exists(LastJobPath) ? File.ReadAllText(LastJobPath).Trim() : string.Empty;
            string jobDir = Path.Combine(JobsPath, jobId);
            if (Directory.Exists(jobDir))
            {
                try
                {
                    Directory.Delete(jobDir, true);
                }
                catch (Exception ex)
                {
                    System.Diagnostics.Debug.WriteLine($"Error deleting job: {ex.Message}");
                }
            }

            if (string.Equals(lastJobId, jobId, StringComparison.OrdinalIgnoreCase))
            {
                try
                {
                    File.Delete(LastJobPath);
                }
                catch (Exception ex)
                {
                    System.Diagnostics.Debug.WriteLine($"Error clearing last job pointer: {ex.Message}");
                }
            }
        }

        public static void MarkAsLastJob(string jobId)
        {
            File.WriteAllText(LastJobPath, jobId);
        }

        private static void ValidateSourceFiles(List<string> sourceFiles)
        {
            bool hasPdf = sourceFiles.Any(IsPdfFile);
            bool hasImage = sourceFiles.Any(IsImageFile);
            bool hasUnsupported = sourceFiles.Any(file => !IsPdfFile(file) && !IsImageFile(file));

            if (hasUnsupported)
            {
                throw new InvalidOperationException("只支持 PDF 或图片作业文件。");
            }

            if (hasPdf && hasImage)
            {
                throw new InvalidOperationException("PDF 作业和图片作业不能混合导入，请分开创建。");
            }

            if (sourceFiles.Count(IsPdfFile) > 1)
            {
                throw new InvalidOperationException("一次只能导入一个 PDF 作业文件。");
            }
        }

        private static bool IsPdfFile(string path)
        {
            return string.Equals(Path.GetExtension(path), ".pdf", StringComparison.OrdinalIgnoreCase);
        }

        private static bool IsImageFile(string path)
        {
            string extension = Path.GetExtension(path);
            return extension.Equals(".jpg", StringComparison.OrdinalIgnoreCase)
                || extension.Equals(".jpeg", StringComparison.OrdinalIgnoreCase)
                || extension.Equals(".png", StringComparison.OrdinalIgnoreCase)
                || extension.Equals(".bmp", StringComparison.OrdinalIgnoreCase)
                || extension.Equals(".gif", StringComparison.OrdinalIgnoreCase);
        }
    }
}
