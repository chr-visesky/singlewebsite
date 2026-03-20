using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using HomeworkApp.Models;

namespace HomeworkApp.Views
{
    public partial class EditorPage
    {
        private static readonly Brush HomeworkTreeDefaultForeground = CreateHomeworkTreeBrush(248, 242, 233);
        private static readonly Brush HomeworkTreeSelectedForeground = CreateHomeworkTreeBrush(74, 144, 226);
        private static readonly Brush HomeworkTreeDisabledForeground = CreateHomeworkTreeBrush(180, 180, 180);

        private void SetupHomeworkTree()
        {
            HomeworkTree.Items.Clear();
            var allJobs = JobManager.GetAllJobs();
            var recentCutoff = DateTime.Today.AddDays(-13);
            var recentJobs = allJobs
                .Where(job => job.CreateTime.Date >= recentCutoff)
                .ToList();
            var recentOpenedJobs = JobManager.GetRecentJobs(5);

            var recentRoot = CreateHomeworkRootNode("最近打开");
            var internalRoot = CreateHomeworkRootNode("课内");
            var externalRoot = CreateHomeworkRootNode("课外");

            PopulateRecentOpenedTree(recentRoot, recentOpenedJobs);
            PopulateInternalHomeworkTree(internalRoot, recentJobs.Where(job => ResolveBucket(job) == "课内").ToList());
            PopulateHomeworkTreeByDate(externalRoot, recentJobs.Where(job => ResolveBucket(job) == "课外").ToList(), true);

            HomeworkTree.Items.Add(recentRoot);
            HomeworkTree.Items.Add(internalRoot);
            HomeworkTree.Items.Add(externalRoot);

            SyncHomeworkTreeSelection();
            RefreshHomeworkTreeSelectionVisuals();
        }

        private void SyncHomeworkTreeSelection()
        {
            if (_job == null)
            {
                return;
            }

            var mainRoots = HomeworkTree.Items
                .OfType<TreeViewItem>()
                .Where(item => item.Header is string header && (header == "课内" || header == "课外"))
                .ToList();

            var selected = mainRoots
                .Select(root => FindMatchingHomeworkNode(root, preferJobId: false))
                .FirstOrDefault(item => item != null);

            if (selected == null)
            {
                selected = HomeworkTree.Items
                    .OfType<TreeViewItem>()
                    .Where(item => item.Header is string header && header == "最近打开")
                    .Select(root => FindMatchingHomeworkNode(root, preferJobId: true))
                    .FirstOrDefault(item => item != null);
            }

            if (selected == null)
            {
                return;
            }

            ExpandParents(selected);
            selected.IsSelected = true;
            selected.BringIntoView();
            HomeworkTreeScrollViewer?.ScrollToVerticalOffset(Math.Max(0, HomeworkTreeScrollViewer.VerticalOffset - 24));
        }

        private TreeViewItem? FindMatchingHomeworkNode(TreeViewItem node, bool preferJobId)
        {
            if (NodeMatchesCurrentJob(node, preferJobId))
            {
                return node;
            }

            foreach (var child in node.Items.OfType<TreeViewItem>())
            {
                var match = FindMatchingHomeworkNode(child, preferJobId);
                if (match != null)
                {
                    return match;
                }
            }

            return null;
        }

        private bool NodeMatchesCurrentJob(TreeViewItem node, bool preferJobId)
        {
            if (node.Tag is not HomeworkNodeContext context || string.IsNullOrWhiteSpace(context.Subject))
            {
                return false;
            }

            if (preferJobId && context.Job != null)
            {
                return string.Equals(context.Job.JobId, _job.JobId, StringComparison.OrdinalIgnoreCase);
            }

            return string.Equals(context.Bucket, ResolveBucket(_job), StringComparison.OrdinalIgnoreCase)
                && context.Date.Date == _job.CreateTime.Date
                && string.Equals(context.Subject, _job.Subject, StringComparison.CurrentCultureIgnoreCase);
        }

        private static void ExpandParents(TreeViewItem item)
        {
            var parent = ItemsControl.ItemsControlFromItemContainer(item) as TreeViewItem;
            while (parent != null)
            {
                parent.IsExpanded = true;
                parent = ItemsControl.ItemsControlFromItemContainer(parent) as TreeViewItem;
            }
        }

        private TreeViewItem CreateHomeworkRootNode(string label)
        {
            return new TreeViewItem
            {
                Header = label,
                IsExpanded = true,
                Foreground = HomeworkTreeDefaultForeground,
                FontWeight = FontWeights.SemiBold
            };
        }

        private void PopulateInternalHomeworkTree(TreeViewItem parent, List<JobSession> jobs)
        {
            var zhCn = new CultureInfo("zh-CN");

            for (int dayOffset = 0; dayOffset < 14; dayOffset++)
            {
                DateTime date = DateTime.Today.AddDays(-dayOffset).Date;
                var dateNode = CreateDateNode(date.ToString("MM-dd dddd", zhCn), date, "课内", dayOffset < 2);

                foreach (var subject in CoreSubjects)
                {
                    var subjectJobs = jobs
                        .Where(job => job.CreateTime.Date == date && string.Equals(job.Subject, subject, StringComparison.CurrentCultureIgnoreCase))
                        .ToList();
                    AddSubjectLeaf(dateNode, subject, date, "课内", subjectJobs);
                }

                var extraSubjects = jobs
                    .Where(job => job.CreateTime.Date == date)
                    .Select(job => job.Subject)
                    .Where(subject => !CoreSubjects.Contains(subject, StringComparer.CurrentCultureIgnoreCase))
                    .Distinct(StringComparer.CurrentCultureIgnoreCase)
                    .OrderBy(subject => subject, StringComparer.CurrentCultureIgnoreCase)
                    .ToList();

                foreach (var subject in extraSubjects)
                {
                    var subjectJobs = jobs
                        .Where(job => job.CreateTime.Date == date && string.Equals(job.Subject, subject, StringComparison.CurrentCultureIgnoreCase))
                        .ToList();
                    AddSubjectLeaf(dateNode, subject, date, "课内", subjectJobs);
                }

                parent.Items.Add(dateNode);
            }
        }

        private void PopulateRecentOpenedTree(TreeViewItem parent, List<JobSession> jobs)
        {
            if (jobs.Count == 0)
            {
                parent.Items.Add(CreateEmptyTreeNode("（最近没有打开记录）"));
                return;
            }

            foreach (var job in jobs)
            {
                var context = new HomeworkNodeContext
                {
                    Bucket = ResolveBucket(job),
                    Date = job.CreateTime.Date,
                    Subject = job.Subject,
                    Job = job
                };

                var node = new TreeViewItem
                {
                    Header = BuildRecentOpenedHeader(job),
                    Tag = context,
                    Foreground = HomeworkTreeDefaultForeground
                };

                node.Selected += SubjectNode_Selected;
                node.ContextMenu = BuildSubjectContextMenu(context);
                parent.Items.Add(node);
            }
        }

        private void PopulateHomeworkTreeByDate(TreeViewItem parent, List<JobSession> jobs, bool useCoreSubjectOrder)
        {
            var zhCn = new CultureInfo("zh-CN");

            for (int dayOffset = 0; dayOffset < 14; dayOffset++)
            {
                DateTime date = DateTime.Today.AddDays(-dayOffset).Date;
                var dateNode = CreateDateNode(date.ToString("MM-dd dddd", zhCn), date, "课外", dayOffset < 2);
                var dateJobs = jobs
                    .Where(job => job.CreateTime.Date == date)
                    .ToList();

                foreach (var subject in CoreSubjects)
                {
                    var subjectJobs = dateJobs
                        .Where(job => string.Equals(job.Subject, subject, StringComparison.CurrentCultureIgnoreCase))
                        .ToList();
                    AddSubjectLeaf(dateNode, subject, date, "课外", subjectJobs);
                }

                var extraSubjects = dateJobs
                    .Select(job => job.Subject)
                    .Where(subject => !CoreSubjects.Contains(subject, StringComparer.CurrentCultureIgnoreCase))
                    .Distinct(StringComparer.CurrentCultureIgnoreCase)
                    .OrderBy(subject => GetSubjectSortOrder(subject, useCoreSubjectOrder))
                    .ThenBy(subject => subject, StringComparer.CurrentCultureIgnoreCase)
                    .ToList();

                foreach (var subject in extraSubjects)
                {
                    var subjectJobs = dateJobs
                        .Where(job => string.Equals(job.Subject, subject, StringComparison.CurrentCultureIgnoreCase))
                        .ToList();
                    AddSubjectLeaf(dateNode, subject, date, "课外", subjectJobs);
                }

                parent.Items.Add(dateNode);
            }
        }

        private static string ResolveBucket(JobSession job)
        {
            return JobManager.NormalizeBucket(job.Bucket, job.Subject);
        }

        private static string BuildRecentOpenedHeader(JobSession job)
        {
            return $"{ResolveBucket(job)} · {job.CreateTime:MM-dd} · {job.Subject} · {Math.Max(1, job.TotalPages)}页";
        }

        private TreeViewItem CreateDateNode(string header, DateTime date, string bucket, bool isExpanded)
        {
            return new TreeViewItem
            {
                Header = header,
                IsExpanded = isExpanded,
                Foreground = HomeworkTreeDefaultForeground,
                FontWeight = FontWeights.SemiBold,
                Tag = new HomeworkNodeContext
                {
                    Bucket = bucket,
                    Date = date
                }
            };
        }

        private void AddSubjectLeaf(TreeViewItem parent, string subject, DateTime date, string bucket, List<JobSession> jobs)
        {
            var latestJob = jobs
                .OrderByDescending(job => job.UpdateTime)
                .FirstOrDefault();

            int totalPages = jobs.Sum(job => Math.Max(1, job.TotalPages));
            string header = jobs.Count switch
            {
                0 => subject,
                1 => $"{subject} · {totalPages}页",
                _ => $"{subject} · {jobs.Count}份 · {totalPages}页"
            };

            var context = new HomeworkNodeContext
            {
                Bucket = bucket,
                Date = date,
                Subject = subject,
                Job = latestJob
            };

            var subjectNode = new TreeViewItem
            {
                Header = header,
                Tag = context,
                Foreground = HomeworkTreeDefaultForeground
            };

            subjectNode.Selected += SubjectNode_Selected;
            subjectNode.ContextMenu = BuildSubjectContextMenu(context);

            parent.Items.Add(subjectNode);
        }

        private ContextMenu BuildSubjectContextMenu(HomeworkNodeContext context)
        {
            var menu = new ContextMenu();
            var imagesItem = new MenuItem
            {
                Header = "导入图片",
                Tag = Tuple.Create("images", context)
            };
            imagesItem.Click += SubjectImportMenuItem_Click;
            menu.Items.Add(imagesItem);

            var pdfItem = new MenuItem
            {
                Header = "导入 PDF",
                Tag = Tuple.Create("pdf", context)
            };
            pdfItem.Click += SubjectImportMenuItem_Click;
            menu.Items.Add(pdfItem);

            return menu;
        }

        private TreeViewItem CreateEmptyTreeNode(string text)
        {
            return new TreeViewItem
            {
                Header = text,
                IsEnabled = false,
                Foreground = HomeworkTreeDisabledForeground
            };
        }

        private void HomeworkTree_SelectedItemChanged(object sender, RoutedPropertyChangedEventArgs<object> e)
        {
            RefreshHomeworkTreeSelectionVisuals();
        }

        private void RefreshHomeworkTreeSelectionVisuals()
        {
            foreach (var root in HomeworkTree.Items.OfType<TreeViewItem>())
            {
                RefreshHomeworkTreeSelectionVisuals(root);
            }
        }

        private static void RefreshHomeworkTreeSelectionVisuals(TreeViewItem item)
        {
            item.Foreground = item.IsEnabled
                ? (item.IsSelected ? HomeworkTreeSelectedForeground : HomeworkTreeDefaultForeground)
                : HomeworkTreeDisabledForeground;

            foreach (var child in item.Items.OfType<TreeViewItem>())
            {
                RefreshHomeworkTreeSelectionVisuals(child);
            }
        }

        private static Brush CreateHomeworkTreeBrush(byte red, byte green, byte blue)
        {
            var brush = new SolidColorBrush(Color.FromRgb(red, green, blue));
            brush.Freeze();
            return brush;
        }

        private int GetSubjectSortOrder(string subject, bool useCoreSubjectOrder)
        {
            if (!useCoreSubjectOrder)
            {
                return int.MaxValue;
            }

            int index = Array.IndexOf(CoreSubjects, subject);
            return index >= 0 ? index : int.MaxValue;
        }
    }
}
