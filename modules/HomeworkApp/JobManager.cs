using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Windows.Ink;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using HomeworkApp.Models;
using HomeworkApp.Services;
using Newtonsoft.Json;
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
        private static readonly string RecentJobsPath = Path.Combine(AppDataPath, "recentJobs.json");
        private static readonly string[] CoreSubjects = { "语文", "数学", "英语" };

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
            return CreateJob(subject, sourceFiles, DateTime.Today, null);
        }

        public static JobSession CreateJob(string subject, List<string> sourceFiles, DateTime targetDate)
        {
            return CreateJob(subject, sourceFiles, targetDate, null);
        }

        public static JobSession CreateJob(string subject, List<string> sourceFiles, DateTime targetDate, string? bucket)
        {
            if (sourceFiles == null || sourceFiles.Count == 0)
            {
                throw new InvalidOperationException("没有可导入的作业文件。");
            }

            ValidateSourceFiles(sourceFiles);
            string normalizedBucket = NormalizeBucket(bucket, subject);
            var existingJob = FindJobBySubjectAndDate(subject, targetDate, normalizedBucket);
            if (existingJob == null)
            {
                return CreateNewImportedJob(subject, sourceFiles, targetDate, normalizedBucket);
            }

            if (IsUntouchedBlankJob(existingJob))
            {
                return ReplaceUntouchedBlankJob(existingJob, sourceFiles, targetDate, normalizedBucket);
            }

            return AppendSourcesToExistingJob(existingJob, sourceFiles);
        }

        public static JobSession CreateBlankJob(string subject)
        {
            return CreateBlankJob(subject, null);
        }

        public static JobSession CreateBlankJob(string subject, string? bucket)
        {
            string normalizedBucket = NormalizeBucket(bucket, subject);
            var existingJob = FindJobBySubjectAndDate(subject, DateTime.Today, normalizedBucket);
            if (existingJob != null)
            {
                MarkAsLastJob(existingJob.JobId);
                return existingJob;
            }

            var job = new JobSession
            {
                Subject = subject,
                Bucket = normalizedBucket,
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

        public static List<JobSession> GetRecentJobs(int maxCount = 5)
        {
            var recentIds = LoadRecentJobIds();
            var jobs = new List<JobSession>();
            bool changed = false;

            foreach (var jobId in recentIds)
            {
                if (jobs.Count >= Math.Max(1, maxCount))
                {
                    break;
                }

                var job = LoadJob(jobId);
                if (job == null)
                {
                    changed = true;
                    continue;
                }

                if (jobs.Any(existing => string.Equals(existing.JobId, job.JobId, StringComparison.OrdinalIgnoreCase)))
                {
                    changed = true;
                    continue;
                }

                jobs.Add(job);
            }

            var lastJob = GetLastJob();
            if (lastJob != null && jobs.All(item => !string.Equals(item.JobId, lastJob.JobId, StringComparison.OrdinalIgnoreCase)))
            {
                jobs.Insert(0, lastJob);
                changed = true;
            }

            jobs = jobs.Take(Math.Max(1, maxCount)).ToList();

            if (changed)
            {
                SaveRecentJobIds(jobs.Select(job => job.JobId));
            }

            return jobs;
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
            var jobs = LoadAllJobsRaw();
            if (ConsolidateSameDaySubjectJobs(jobs))
            {
                jobs = LoadAllJobsRaw();
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

            SaveRecentJobIds(
                LoadRecentJobIds().Where(id => !string.Equals(id, jobId, StringComparison.OrdinalIgnoreCase))
            );
        }

        public static void MarkAsLastJob(string jobId)
        {
            File.WriteAllText(LastJobPath, jobId);
            SaveRecentJobIds(
                new[] { jobId }
                    .Concat(LoadRecentJobIds().Where(id => !string.Equals(id, jobId, StringComparison.OrdinalIgnoreCase)))
            );
        }

        public static void DeletePage(JobSession job, int pageIndex)
        {
            EnsureJobUsesImageSources(job);

            if (job.SourceFiles.Count <= 1)
            {
                throw new InvalidOperationException("至少保留 1 页作业。");
            }

            if (pageIndex < 0 || pageIndex >= job.SourceFiles.Count)
            {
                throw new ArgumentOutOfRangeException(nameof(pageIndex));
            }

            string sourceFile = job.SourceFiles[pageIndex];
            if (File.Exists(sourceFile))
            {
                File.Delete(sourceFile);
            }

            job.SourceFiles.RemoveAt(pageIndex);
            ReindexInkFilesAfterPageDeletion(job, pageIndex);
            job.DocumentType = "Image";
            job.TotalPages = job.SourceFiles.Count;
            if (job.CurrentPage > pageIndex)
            {
                job.CurrentPage--;
            }
            job.CurrentPage = Math.Min(job.CurrentPage, Math.Max(0, job.TotalPages - 1));
            job.UpdateTime = DateTime.Now;
            job.Save(job.JobDirectory);
            MarkAsLastJob(job.JobId);
        }

        private static List<JobSession> LoadAllJobsRaw()
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

            return jobs;
        }

        private static JobSession? FindJobBySubjectAndDate(string subject, DateTime date, string bucket)
        {
            return GetAllJobs()
                .Where(job => string.Equals(NormalizeBucket(job.Bucket, job.Subject), bucket, StringComparison.OrdinalIgnoreCase))
                .Where(job => string.Equals(job.Subject, subject, StringComparison.CurrentCultureIgnoreCase))
                .Where(job => job.CreateTime.Date == date.Date)
                .OrderByDescending(job => job.UpdateTime)
                .FirstOrDefault();
        }

        private static JobSession CreateNewImportedJob(string subject, List<string> sourceFiles, DateTime targetDate, string bucket)
        {
            bool isPdfJob = sourceFiles.Count == 1 && IsPdfFile(sourceFiles[0]);

            var job = new JobSession
            {
                Subject = subject,
                Bucket = bucket,
                SourceFiles = new List<string>(),
                CreateTime = ComposeCreateTime(targetDate),
                UpdateTime = DateTime.Now,
                DocumentType = isPdfJob ? "Pdf" : "Image"
            };

            string jobDir = Path.Combine(JobsPath, job.JobId);
            Directory.CreateDirectory(jobDir);
            Directory.CreateDirectory(job.SourceDirectory);

            var importedFiles = ImportSourceFiles(job.SourceDirectory, sourceFiles, preservePdf: isPdfJob);
            if (importedFiles.Count == 0)
            {
                throw new IOException("作业文件复制失败，请确认文件仍然存在且可读取。");
            }

            job.SourceFiles = importedFiles;
            job.TotalPages = isPdfJob
                ? Conversion.GetPageCount(File.ReadAllBytes(importedFiles[0]))
                : importedFiles.Count;
            job.CurrentPage = 0;
            job.Save(jobDir);
            MarkAsLastJob(job.JobId);
            return job;
        }

        private static JobSession ReplaceUntouchedBlankJob(JobSession job, List<string> sourceFiles, DateTime targetDate, string bucket)
        {
            ClearDirectory(job.SourceDirectory);
            ClearDirectory(job.CacheDirectory);

            bool isPdfJob = sourceFiles.Count == 1 && IsPdfFile(sourceFiles[0]);
            var importedFiles = ImportSourceFiles(job.SourceDirectory, sourceFiles, preservePdf: isPdfJob);
            if (importedFiles.Count == 0)
            {
                throw new IOException("作业文件复制失败，请确认文件仍然存在且可读取。");
            }

            job.SourceFiles = importedFiles;
            job.Bucket = bucket;
            job.DocumentType = isPdfJob ? "Pdf" : "Image";
            job.CreateTime = ComposeCreateTime(targetDate);
            job.TotalPages = isPdfJob
                ? Conversion.GetPageCount(File.ReadAllBytes(importedFiles[0]))
                : importedFiles.Count;
            job.CurrentPage = 0;
            job.UpdateTime = DateTime.Now;
            job.Save(job.JobDirectory);
            MarkAsLastJob(job.JobId);
            return job;
        }

        private static JobSession AppendSourcesToExistingJob(JobSession job, List<string> sourceFiles)
        {
            EnsureJobUsesImageSources(job);

            int firstNewPageIndex = Math.Max(0, job.SourceFiles.Count);
            var appendedFiles = ImportSourceFiles(job.SourceDirectory, sourceFiles, preservePdf: false);
            if (appendedFiles.Count == 0)
            {
                throw new IOException("作业文件复制失败，请确认文件仍然存在且可读取。");
            }

            job.SourceFiles.AddRange(appendedFiles);
            job.DocumentType = "Image";
            job.TotalPages = job.SourceFiles.Count;
            job.CurrentPage = firstNewPageIndex;
            job.UpdateTime = DateTime.Now;
            job.Save(job.JobDirectory);
            MarkAsLastJob(job.JobId);
            return job;
        }

        private static bool ConsolidateSameDaySubjectJobs(List<JobSession> jobs)
        {
            bool changed = false;
            string lastJobId = GetLastJobId();

            var duplicateGroups = jobs
                .GroupBy(job => new
                {
                    Subject = job.Subject,
                    Date = job.CreateTime.Date,
                    Bucket = NormalizeBucket(job.Bucket, job.Subject)
                })
                .Where(group => group.Count() > 1)
                .ToList();

            foreach (var group in duplicateGroups)
            {
                var orderedJobs = group
                    .OrderBy(job => job.CreateTime)
                    .ThenBy(job => job.UpdateTime)
                    .ToList();

                var target = SelectConsolidationTarget(orderedJobs);
                var sourceJobs = orderedJobs.Where(job => job.JobId != target.JobId).ToList();

                foreach (var sourceJob in sourceJobs)
                {
                    bool sourceWasLastJob = string.Equals(lastJobId, sourceJob.JobId, StringComparison.OrdinalIgnoreCase);
                    MergeExistingJobIntoTarget(target, sourceJob, sourceWasLastJob);
                    DeleteJobDirectoryOnly(sourceJob.JobId);
                    changed = true;

                    if (sourceWasLastJob)
                    {
                        lastJobId = target.JobId;
                    }
                }

                target.CreateTime = orderedJobs.Min(job => job.CreateTime);
                target.UpdateTime = orderedJobs.Max(job => job.UpdateTime);
                target.Bucket = NormalizeBucket(target.Bucket, target.Subject);
                target.Save(target.JobDirectory);
            }

            if (changed && !string.IsNullOrWhiteSpace(lastJobId))
            {
                MarkAsLastJob(lastJobId);
            }

            return changed;
        }

        private static JobSession SelectConsolidationTarget(List<JobSession> jobs)
        {
            return jobs.FirstOrDefault(job => !IsUntouchedBlankJob(job)) ?? jobs[0];
        }

        private static void MergeExistingJobIntoTarget(JobSession target, JobSession source, bool sourceWasLastJob)
        {
            if (IsUntouchedBlankJob(source))
            {
                return;
            }

            EnsureJobUsesImageSources(target);
            EnsureJobUsesImageSources(source);

            int pageOffset = Math.Max(0, target.SourceFiles.Count);
            var copiedSourceFiles = CopyExistingSourceFiles(target.SourceDirectory, source.SourceFiles);
            target.SourceFiles.AddRange(copiedSourceFiles);
            target.DocumentType = "Image";
            target.TotalPages = target.SourceFiles.Count;

            CopyInkFiles(source, target, pageOffset);
            CopyDraftInkIfNeeded(source, target);

            if (sourceWasLastJob)
            {
                target.CurrentPage = pageOffset + Math.Max(0, source.CurrentPage);
            }
        }

        private static void EnsureJobUsesImageSources(JobSession job)
        {
            if (job.SourceFiles.Count > 0 && job.SourceFiles.All(IsImageFile))
            {
                job.DocumentType = "Image";
                job.TotalPages = job.SourceFiles.Count;
                job.Save(job.JobDirectory);
                return;
            }

            if (IsTrulyBlankJob(job))
            {
                Directory.CreateDirectory(job.SourceDirectory);
                string blankImagePath = CreateBlankPageImage(job.SourceDirectory);
                job.SourceFiles = new List<string> { blankImagePath };
                job.DocumentType = "Image";
                job.TotalPages = 1;
                job.CurrentPage = Math.Min(job.CurrentPage, 0);
                job.Save(job.JobDirectory);
                return;
            }

            if (job.SourceFiles.Count == 1 && IsPdfFile(job.SourceFiles[0]))
            {
                Directory.CreateDirectory(job.SourceDirectory);
                var convertedFiles = RenderPdfToImageFiles(job.SourceFiles[0], job.SourceDirectory);
                if (convertedFiles.Count == 0)
                {
                    throw new IOException("PDF 作业转换失败，无法合并到同一天同学科作业中。");
                }

                job.SourceFiles = convertedFiles;
                job.DocumentType = "Image";
                job.TotalPages = convertedFiles.Count;
                job.CurrentPage = Math.Min(job.CurrentPage, Math.Max(0, job.TotalPages - 1));
                job.Save(job.JobDirectory);
                return;
            }

            throw new InvalidOperationException("当前作业格式无法合并，请重新导入。");
        }

        private static List<string> ImportSourceFiles(string targetDirectory, List<string> sourceFiles, bool preservePdf)
        {
            Directory.CreateDirectory(targetDirectory);

            if (preservePdf && sourceFiles.Count == 1 && IsPdfFile(sourceFiles[0]))
            {
                string destFile = Path.Combine(targetDirectory, CreateUniqueFileName(".pdf"));
                File.Copy(sourceFiles[0], destFile, true);
                return new List<string> { destFile };
            }

            var importedFiles = new List<string>();
            foreach (var file in sourceFiles)
            {
                if (IsPdfFile(file))
                {
                    importedFiles.AddRange(RenderPdfToImageFiles(file, targetDirectory));
                }
                else
                {
                    string extension = Path.GetExtension(file);
                    string destFile = Path.Combine(targetDirectory, CreateUniqueFileName(extension));
                    File.Copy(file, destFile, true);
                    importedFiles.Add(destFile);
                }
            }

            return importedFiles;
        }

        private static List<string> RenderPdfToImageFiles(string pdfPath, string targetDirectory)
        {
            Directory.CreateDirectory(targetDirectory);

            byte[] pdfBytes = File.ReadAllBytes(pdfPath);
            int pageCount = Conversion.GetPageCount(pdfBytes);
            var renderedFiles = new List<string>(pageCount);

            for (int pageIndex = 0; pageIndex < pageCount; pageIndex++)
            {
                string destFile = Path.Combine(targetDirectory, CreateUniqueFileName(".png"));
                using var output = File.Create(destFile);
                Conversion.SavePng(output, pdfBytes, pageIndex);
                renderedFiles.Add(destFile);
            }

            return renderedFiles;
        }

        private static List<string> CopyExistingSourceFiles(string targetDirectory, List<string> sourceFiles)
        {
            Directory.CreateDirectory(targetDirectory);
            var copiedFiles = new List<string>(sourceFiles.Count);

            foreach (var sourceFile in sourceFiles)
            {
                string extension = Path.GetExtension(sourceFile);
                string destFile = Path.Combine(targetDirectory, CreateUniqueFileName(extension));
                File.Copy(sourceFile, destFile, true);
                copiedFiles.Add(destFile);
            }

            return copiedFiles;
        }

        private static void CopyInkFiles(JobSession source, JobSession target, int pageOffset)
        {
            for (int pageIndex = 0; pageIndex < Math.Max(1, source.TotalPages); pageIndex++)
            {
                string sourceInkPath = source.GetInkFilePath(pageIndex);
                if (!File.Exists(sourceInkPath))
                {
                    continue;
                }

                string targetInkPath = target.GetInkFilePath(pageOffset + pageIndex);
                Directory.CreateDirectory(Path.GetDirectoryName(targetInkPath)!);
                File.Copy(sourceInkPath, targetInkPath, true);
                target.InkFilePaths[pageOffset + pageIndex] = targetInkPath;
            }
        }

        private static void CopyDraftInkIfNeeded(JobSession source, JobSession target)
        {
            if (File.Exists(target.DraftInkPath) || !File.Exists(source.DraftInkPath))
            {
                return;
            }

            Directory.CreateDirectory(Path.GetDirectoryName(target.DraftInkPath)!);
            File.Copy(source.DraftInkPath, target.DraftInkPath, true);
        }

        private static bool IsTrulyBlankJob(JobSession job)
        {
            return string.Equals(job.DocumentType, "Blank", StringComparison.OrdinalIgnoreCase)
                || job.SourceFiles.Count == 0;
        }

        private static bool IsUntouchedBlankJob(JobSession job)
        {
            if (!IsTrulyBlankJob(job))
            {
                return false;
            }

            if (File.Exists(job.DraftInkPath))
            {
                return false;
            }

            if (Directory.Exists(job.InkDirectory) && Directory.EnumerateFiles(job.InkDirectory, "*.ink", SearchOption.TopDirectoryOnly).Any())
            {
                return false;
            }

            return true;
        }

        private static string CreateBlankPageImage(string targetDirectory)
        {
            Directory.CreateDirectory(targetDirectory);
            string filePath = Path.Combine(targetDirectory, CreateUniqueFileName(".png"));
            const int width = 794;
            const int height = 1123;
            const int stride = width * 4;
            var pixels = new byte[height * stride];

            for (int index = 0; index < pixels.Length; index += 4)
            {
                pixels[index] = 255;
                pixels[index + 1] = 255;
                pixels[index + 2] = 255;
                pixels[index + 3] = 255;
            }

            var bitmap = BitmapSource.Create(width, height, 96, 96, PixelFormats.Bgra32, null, pixels, stride);
            var encoder = new PngBitmapEncoder();
            encoder.Frames.Add(BitmapFrame.Create(bitmap));
            using var stream = File.Create(filePath);
            encoder.Save(stream);
            return filePath;
        }

        private static string CreateUniqueFileName(string extension)
        {
            return $"{Guid.NewGuid():N}{extension.ToLowerInvariant()}";
        }

        private static DateTime ComposeCreateTime(DateTime targetDate)
        {
            var now = DateTime.Now;
            return targetDate.Date.Add(new TimeSpan(now.Hour, now.Minute, now.Second));
        }

        public static string NormalizeBucket(string? bucket, string? subject)
        {
            string normalized = (bucket ?? string.Empty).Trim();

            if (string.Equals(normalized, "课外", StringComparison.OrdinalIgnoreCase))
            {
                return "课外";
            }

            if (string.Equals(normalized, "课内", StringComparison.OrdinalIgnoreCase))
            {
                return "课内";
            }

            return CoreSubjects.Contains(subject ?? string.Empty, StringComparer.CurrentCultureIgnoreCase) ? "课内" : "课外";
        }

        private static List<string> LoadRecentJobIds()
        {
            try
            {
                if (!File.Exists(RecentJobsPath))
                {
                    return new List<string>();
                }

                string json = File.ReadAllText(RecentJobsPath);
                return (JsonConvert.DeserializeObject<List<string>>(json) ?? new List<string>())
                    .Where(id => !string.IsNullOrWhiteSpace(id))
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();
            }
            catch
            {
                return new List<string>();
            }
        }

        private static void SaveRecentJobIds(IEnumerable<string> jobIds)
        {
            var ids = jobIds
                .Where(id => !string.IsNullOrWhiteSpace(id))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Take(5)
                .ToList();

            File.WriteAllText(RecentJobsPath, JsonConvert.SerializeObject(ids, Formatting.Indented));
        }

        private static void ClearDirectory(string path)
        {
            if (!Directory.Exists(path))
            {
                return;
            }

            foreach (var file in Directory.GetFiles(path))
            {
                File.Delete(file);
            }
        }

        private static void DeleteJobDirectoryOnly(string jobId)
        {
            string jobDir = Path.Combine(JobsPath, jobId);
            if (!Directory.Exists(jobDir))
            {
                return;
            }

            try
            {
                Directory.Delete(jobDir, true);
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"Error deleting job during merge: {ex.Message}");
            }
        }

        private static string GetLastJobId()
        {
            return File.Exists(LastJobPath) ? File.ReadAllText(LastJobPath).Trim() : string.Empty;
        }

        private static void ReindexInkFilesAfterPageDeletion(JobSession job, int removedPageIndex)
        {
            var strokeSnapshots = new Dictionary<int, StrokeCollection?>();
            int oldPageCount = Math.Max(job.TotalPages, removedPageIndex + 1);

            for (int oldIndex = 0; oldIndex < oldPageCount; oldIndex++)
            {
                if (oldIndex == removedPageIndex)
                {
                    continue;
                }

                string oldPath = job.GetInkFilePath(oldIndex);
                var strokes = InkService.LoadInk(oldPath);
                if (strokes != null)
                {
                    int newIndex = oldIndex > removedPageIndex ? oldIndex - 1 : oldIndex;
                    strokeSnapshots[newIndex] = strokes;
                }
            }

            ClearDirectory(job.InkDirectory);
            job.InkFilePaths.Clear();

            foreach (var entry in strokeSnapshots.OrderBy(entry => entry.Key))
            {
                if (entry.Value == null)
                {
                    continue;
                }

                string newInkPath = job.GetInkFilePath(entry.Key);
                InkService.SaveInk(entry.Value, newInkPath);
            }
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
