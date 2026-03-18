using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Printing;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Ink;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using HomeworkApp.Models;
using HomeworkApp.Services;
using Microsoft.Win32;

namespace HomeworkApp.Views
{
    public partial class EditorPage : Page, IDisposable
    {
        private readonly JobSession _job;
        private readonly DocumentService _documentService;
        private InkManager? _inkManager;
        private InkManager? _draftInkManager;
        private int _currentPageIndex;
        private readonly System.Threading.Timer? _saveDebouncer;
        private bool _disposed;
        private readonly Border[] _colorBorders;
        private Color _currentColor = Colors.Black;
        private double _currentPenWidth = 1.0;
        private double _currentScale = 1.0;
        private bool _isPortrait = true;
        private bool _hasDocument = false;
        private int _pageLoadVersion;
        private bool _isHandMode;
        private ScrollViewer? _activePanScrollViewer;
        private Point _panStartPoint;
        private Point _panStartOffset;
        private int _thumbnailLoadVersion;
        private bool _thumbnailMutationInProgress;
        private InkManager.ToolMode _activeToolMode = InkManager.ToolMode.Pen;
        private static readonly string[] CoreSubjects = { "语文", "数学", "英语" };
        private sealed class HomeworkNodeContext
        {
            public string Bucket { get; init; } = string.Empty;
            public DateTime Date { get; init; }
            public string? Subject { get; init; }
            public JobSession? Job { get; set; }
        }
        private readonly DispatcherTimer _homeworkScrollIndicatorTimer = new() { Interval = TimeSpan.FromMilliseconds(450) };
        private readonly DispatcherTimer _draftScrollIndicatorTimer = new() { Interval = TimeSpan.FromMilliseconds(450) };

        public EditorPage(JobSession job)
        {
            InitializeComponent();
            _job = job;
            _currentPageIndex = job.CurrentPage;
            _documentService = new DocumentService();

            // Setup save debouncer (auto-save after 2 seconds of inactivity)
            _saveDebouncer = new System.Threading.Timer(DebouncedSave, null, System.Threading.Timeout.Infinite, System.Threading.Timeout.Infinite);

            // Initialize color borders array
            _colorBorders = new[] { ColorBlack, ColorRed, ColorBlue, ColorGreen, ColorYellow };

            // Setup homework tree
            TxtToday.Text = DateTime.Today.ToString("yyyy 年 MM 月 dd 日 dddd", new System.Globalization.CultureInfo("zh-CN"));
            SetupHomeworkTree();
            JobManager.MarkAsLastJob(_job.JobId);
            ApplyPageCanvasSize();
            UpdateColorSelectorVisual();
            UpdateWidthSelectorVisual();
            _homeworkScrollIndicatorTimer.Tick += (_, _) => ResetIndicatorColor(HomeworkScrollIndicator, _homeworkScrollIndicatorTimer);
            _draftScrollIndicatorTimer.Tick += (_, _) => ResetIndicatorColor(DraftScrollIndicator, _draftScrollIndicatorTimer);
            Unloaded += EditorPage_Unloaded;
            SetAssistantPanelCollapsed();

            LoadDocument();
            SetupInkCanvas();
            SetupDraftInkCanvas();
            SetActiveTool(InkManager.ToolMode.Pen);
            ApplyZoom();
        }

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
        }

        private TreeViewItem CreateHomeworkRootNode(string label)
        {
            return new TreeViewItem
            {
                Header = label,
                IsExpanded = true,
                Foreground = new SolidColorBrush(Color.FromRgb(248, 242, 233)),
                FontWeight = FontWeights.SemiBold
            };
        }

        private void PopulateInternalHomeworkTree(TreeViewItem parent, List<JobSession> jobs)
        {
            var zhCn = new System.Globalization.CultureInfo("zh-CN");

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
                    Foreground = new SolidColorBrush(Color.FromRgb(248, 242, 233))
                };

                node.Selected += SubjectNode_Selected;
                node.ContextMenu = BuildSubjectContextMenu(context);
                parent.Items.Add(node);
            }
        }

        private void PopulateHomeworkTreeByDate(TreeViewItem parent, List<JobSession> jobs, bool useCoreSubjectOrder)
        {
            var zhCn = new System.Globalization.CultureInfo("zh-CN");

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
                Foreground = new SolidColorBrush(Color.FromRgb(248, 242, 233)),
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
                Foreground = new SolidColorBrush(Color.FromRgb(248, 242, 233))
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
                Foreground = new SolidColorBrush(Color.FromRgb(180, 180, 180))
            };
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

        private int EffectivePageCount()
        {
            if (_hasDocument)
            {
                return Math.Max(1, _documentService.PageCount);
            }

            return Math.Max(1, _job.TotalPages);
        }

        private void UpdateDraftCanvasToViewport()
        {
            if (DraftHost == null || DraftContainer == null || DraftA4Background == null || DraftInkCanvas == null)
            {
                return;
            }

            const double indicatorWidth = 1;
            double draftWidth = Math.Max(200, DraftHost.ActualWidth - indicatorWidth);
            double draftHeight = Math.Max(
                200,
                MainInkCanvas.Height > 0
                    ? MainInkCanvas.Height
                    : DraftHost.ActualHeight);

            DraftContainer.Width = draftWidth;
            DraftContainer.Height = draftHeight;
            DraftA4Background.Width = draftWidth;
            DraftA4Background.Height = draftHeight;
            DraftInkCanvas.Width = draftWidth;
            DraftInkCanvas.Height = draftHeight;

            if (_draftInkManager != null)
            {
                _draftInkManager.UpdateCanvasSize(draftWidth, draftHeight, draftWidth, draftHeight);
                _draftInkManager.SetPenColor(_currentColor);
                _draftInkManager.SetPenWidth(_currentPenWidth);
            }
        }

        private void LoadSelectedJob(JobSession job)
        {
            SaveCurrentPageInk();
            JobManager.SaveJob(_job);

            // Navigate to new EditorPage with selected job
            NavigationService?.Navigate(new EditorPage(job));
        }

        private async void LoadDocument(bool skipSaveCurrentPage = false)
        {
            try
            {
                // Load document
                if (_job!.SourceFiles.Count > 0)
                {
                    _hasDocument = true;

                    if (_job.SourceFiles.Count == 1)
                    {
                        _documentService.LoadDocument(_job.SourceFiles[0]);
                    }
                    else
                    {
                        _documentService.LoadMultipleImages(_job.SourceFiles);
                    }

                    // Update total pages
                    _job.TotalPages = _documentService.PageCount;
                }
                else
                {
                    // No document - show A4 paper
                    _hasDocument = false;
                    _job.TotalPages = 1;
                }

                _currentPageIndex = Math.Max(0, Math.Min(_currentPageIndex, EffectivePageCount() - 1));

                // Load current page
                await LoadPageAsync(_currentPageIndex, skipSaveCurrentPage);
                await RefreshThumbnailStripAsync();
            }
            catch (Exception ex)
            {
                MessageBox.Show($"加载作业失败：{ex.Message}", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
                NavigationService?.GoBack();
            }
        }

        private async Task LoadPageAsync(int pageIndex, bool skipSaveCurrentPage = false)
        {
            if (pageIndex < 0 || pageIndex >= EffectivePageCount())
                return;

            int loadVersion = Interlocked.Increment(ref _pageLoadVersion);

            if (!skipSaveCurrentPage)
            {
                SaveCurrentPageInk();
            }

            _currentPageIndex = pageIndex;
            _job!.CurrentPage = pageIndex;

            ApplyPageCanvasSize();
            double logicalWidth = MainInkCanvas.Width;
            double logicalHeight = MainInkCanvas.Height;

            // 草稿纸尺寸由 SizeChanged 事件动态处理
            // 初始化一个临时尺寸，等待 SizeChanged 事件更新
            double draftWidth = Math.Max(200, DraftHost.ActualWidth > 0 ? DraftHost.ActualWidth - 1 : 500);
            double draftHeight = Math.Max(200, HomeworkContainer.ActualHeight > 0 ? HomeworkContainer.ActualHeight : 700);
            DraftInkCanvas.Width = draftWidth;
            DraftInkCanvas.Height = draftHeight;
            DraftA4Background.Width = draftWidth;
            DraftA4Background.Height = draftHeight;

            // Initialize draft ink manager
            _draftInkManager = new InkManager(
                DraftInkCanvas,
                draftWidth,
                draftHeight,
                draftWidth,
                draftHeight);

            // Load draft ink
            LoadDraftInk();
            _draftInkManager.SetPenColor(_currentColor);
            _draftInkManager.SetPenWidth(_currentPenWidth);
            UpdateDraftCanvasToViewport();

            // Get document page - render at high resolution for quality
            var docPage = await _documentService.GetPageAsync(pageIndex, logicalWidth, logicalHeight);

            if (_disposed || loadVersion != _pageLoadVersion)
            {
                return;
            }

            if (docPage != null && docPage.Image != null)
            {
                // Set image source - Uniform stretch will scale to fit A4 bounds
                DocumentImage.Source = docPage.Image;
                DocumentImage.Visibility = Visibility.Visible;
                A4Background.Visibility = Visibility.Visible;

                // Initialize ink manager with A4 logical coordinates
                _inkManager = new InkManager(
                    MainInkCanvas,
                    logicalWidth,
                    logicalHeight,
                    logicalWidth,
                    logicalHeight);

                // Load saved ink for this page
                LoadPageInk(pageIndex);

                // Set current pen color and width
                ApplyToolSelectionToManagers();

            }
            else if (!_hasDocument)
            {
                // A4 paper mode only
                DocumentImage.Visibility = Visibility.Collapsed;
                A4Background.Visibility = Visibility.Visible;

                _inkManager = new InkManager(
                    MainInkCanvas,
                    logicalWidth,
                    logicalHeight,
                    logicalWidth,
                    logicalHeight);

                LoadPageInk(pageIndex);
                ApplyToolSelectionToManagers();
            }
            else
            {
                DocumentImage.Source = null;
                DocumentImage.Visibility = Visibility.Collapsed;
                A4Background.Visibility = Visibility.Visible;

                _inkManager = new InkManager(
                    MainInkCanvas,
                    logicalWidth,
                    logicalHeight,
                    logicalWidth,
                    logicalHeight);

                LoadPageInk(pageIndex);
                ApplyToolSelectionToManagers();
            }

            _ = Dispatcher.BeginInvoke(new Action(() =>
            {
                UpdateScrollIndicator(HomeworkScrollViewer, HomeworkScrollIndicator, _homeworkScrollIndicatorTimer);
                UpdateScrollIndicator(DraftScrollViewer, DraftScrollIndicator, _draftScrollIndicatorTimer);
                UpdateThumbnailSelection();
            }), DispatcherPriority.Loaded);
        }

        private void SetupInkCanvas()
        {
            MainInkCanvas.Strokes.StrokesChanged += InkCanvas_StrokesChanged;
        }

        private void SetupDraftInkCanvas()
        {
            DraftInkCanvas.Strokes.StrokesChanged += DraftInkCanvas_StrokesChanged;
        }

        private void ApplyPageCanvasSize()
        {
            double a4Width = _isPortrait ? 210 : 297;
            double a4Height = _isPortrait ? 297 : 210;
            double scaleFactor = 3.78;
            double logicalWidth = a4Width * scaleFactor;
            double logicalHeight = a4Height * scaleFactor;

            MainInkCanvas.Width = logicalWidth;
            MainInkCanvas.Height = logicalHeight;
            A4Background.Width = logicalWidth;
            A4Background.Height = logicalHeight;
            DocumentImage.Width = logicalWidth;
            DocumentImage.Height = logicalHeight;
        }

        private void HomeworkGrid_SizeChanged(object sender, SizeChangedEventArgs e)
        {
            UpdateDraftCanvasToViewport();
            UpdateScrollIndicator(HomeworkScrollViewer, HomeworkScrollIndicator, _homeworkScrollIndicatorTimer);
            UpdateScrollIndicator(DraftScrollViewer, DraftScrollIndicator, _draftScrollIndicatorTimer);
        }

        private void DraftGrid_SizeChanged(object sender, SizeChangedEventArgs e)
        {
            UpdateDraftCanvasToViewport();
            UpdateScrollIndicator(DraftScrollViewer, DraftScrollIndicator, _draftScrollIndicatorTimer);
        }

        private async Task RefreshThumbnailStripAsync()
        {
            int pageCount = EffectivePageCount();
            bool shouldShow = pageCount > 0;

            ThumbnailColumn.Width = new GridLength(72);
            ThumbnailHost.Visibility = Visibility.Visible;
            ApplyZoom();

            if (!shouldShow)
            {
                ThumbnailPanel.Children.Clear();
                return;
            }

            int loadVersion = Interlocked.Increment(ref _thumbnailLoadVersion);
            ThumbnailPanel.Children.Clear();

            for (int pageIndex = 0; pageIndex < pageCount; pageIndex++)
            {
                var item = await CreateThumbnailItemAsync(pageIndex, loadVersion);
                if (_disposed || loadVersion != _thumbnailLoadVersion)
                {
                    return;
                }

                ThumbnailPanel.Children.Add(item);
            }

            ThumbnailPanel.Children.Add(CreateAddThumbnailItem());

            UpdateThumbnailSelection();
        }

        private Border CreateAddThumbnailItem()
        {
            var itemBorder = new Border
            {
                Width = 58,
                Height = 82,
                Margin = new Thickness(0, 0, 0, 8),
                Padding = new Thickness(0),
                BorderThickness = new Thickness(1),
                BorderBrush = new SolidColorBrush(Color.FromRgb(196, 190, 180)),
                Background = new SolidColorBrush(Color.FromArgb(72, 255, 255, 255)),
                Cursor = Cursors.Hand,
                Tag = "add-page"
            };

            var label = new TextBlock
            {
                Text = "+",
                FontSize = 22,
                FontWeight = FontWeights.SemiBold,
                Foreground = new SolidColorBrush(Color.FromRgb(72, 72, 72)),
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center
            };

            itemBorder.Child = label;
            itemBorder.MouseLeftButtonDown += AddThumbnailItem_MouseLeftButtonDown;
            return itemBorder;
        }

        private async Task<Border> CreateThumbnailItemAsync(int pageIndex, int loadVersion)
        {
            var itemBorder = new Border
            {
                Width = 58,
                Margin = new Thickness(0, 0, 0, 8),
                Padding = new Thickness(2),
                BorderThickness = new Thickness(1),
                BorderBrush = new SolidColorBrush(Color.FromRgb(196, 190, 180)),
                Background = new SolidColorBrush(Color.FromArgb(72, 255, 255, 255)),
                Cursor = Cursors.Hand,
                Tag = pageIndex
            };

            var pageSurface = new Border
            {
                Background = Brushes.White,
                BorderBrush = new SolidColorBrush(Color.FromRgb(223, 221, 216)),
                BorderThickness = new Thickness(0.5),
                Width = 54,
                Height = 76
            };

            var pageGrid = new Grid();
            var thumbnailImage = new Image
            {
                Stretch = Stretch.Uniform,
                HorizontalAlignment = HorizontalAlignment.Stretch,
                VerticalAlignment = VerticalAlignment.Stretch,
                Margin = new Thickness(2)
            };

            if (_hasDocument)
            {
                var thumbnail = await _documentService.GetThumbnailAsync(pageIndex, 120);
                if (!_disposed && loadVersion == _thumbnailLoadVersion)
                {
                    thumbnailImage.Source = thumbnail;
                }
            }

            pageGrid.Children.Add(thumbnailImage);
            if (EffectivePageCount() > 1)
            {
                var deleteButton = new Button
                {
                    Content = "×",
                    Width = 14,
                    Height = 14,
                    FontSize = 10,
                    Padding = new Thickness(0),
                    HorizontalAlignment = HorizontalAlignment.Right,
                    VerticalAlignment = VerticalAlignment.Top,
                    Margin = new Thickness(0, 2, 2, 0),
                    Background = new SolidColorBrush(Color.FromArgb(180, 255, 255, 255)),
                    BorderBrush = new SolidColorBrush(Color.FromRgb(180, 180, 180)),
                    BorderThickness = new Thickness(0.5),
                    Cursor = Cursors.Hand,
                    Tag = pageIndex
                };
                deleteButton.Click += ThumbnailDeleteButton_Click;
                deleteButton.PreviewMouseLeftButtonDown += ThumbnailDeleteButton_PreviewMouseLeftButtonDown;
                pageGrid.Children.Add(deleteButton);
            }
            pageGrid.Children.Add(new Border
            {
                VerticalAlignment = VerticalAlignment.Bottom,
                Background = new SolidColorBrush(Color.FromArgb(200, 255, 255, 255)),
                Padding = new Thickness(0, 2, 0, 2),
                Child = new TextBlock
                {
                    Text = (pageIndex + 1).ToString(),
                    FontSize = 10,
                    Foreground = Brushes.Black,
                    HorizontalAlignment = HorizontalAlignment.Center,
                    TextAlignment = TextAlignment.Center
                }
            });

            pageSurface.Child = pageGrid;
            itemBorder.Child = pageSurface;
            itemBorder.MouseLeftButtonDown += ThumbnailItem_MouseLeftButtonDown;
            return itemBorder;
        }

        private void UpdateThumbnailSelection()
        {
            foreach (var child in ThumbnailPanel.Children.OfType<Border>())
            {
                bool isCurrent = child.Tag is int pageIndex && pageIndex == _currentPageIndex;
                child.BorderBrush = isCurrent
                    ? new SolidColorBrush(Color.FromRgb(12, 12, 12))
                    : new SolidColorBrush(Color.FromRgb(196, 190, 180));
                child.BorderThickness = isCurrent ? new Thickness(2) : new Thickness(1);
                child.Background = isCurrent
                    ? new SolidColorBrush(Color.FromRgb(239, 236, 231))
                    : Brushes.Transparent;
            }
        }

        private async void ThumbnailItem_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            if (_thumbnailMutationInProgress)
            {
                e.Handled = true;
                return;
            }

            if (sender is Border border && border.Tag is int pageIndex && pageIndex != _currentPageIndex)
            {
                e.Handled = true;
                await LoadPageAsync(pageIndex);
            }
        }

        private void SubjectNode_Selected(object sender, RoutedEventArgs e)
        {
            if (sender is not TreeViewItem treeItem ||
                treeItem.Tag is not HomeworkNodeContext context ||
                string.IsNullOrWhiteSpace(context.Subject))
            {
                return;
            }

            e.Handled = true;

            if (context.Job == null)
            {
                try
                {
                    SaveCurrentPageInk();
                    JobManager.SaveJob(_job);
                    var blankJob = JobManager.CreateBlankJob(context.Subject, context.Date, context.Bucket);
                    LoadSelectedJob(blankJob);
                }
                catch (Exception ex)
                {
                    MessageBox.Show($"创建空白作业失败：{ex.Message}", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
                }

                return;
            }

            if (string.Equals(context.Job.JobId, _job.JobId, StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            LoadSelectedJob(context.Job);
        }

        private async void AddThumbnailItem_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            e.Handled = true;

            try
            {
                _thumbnailMutationInProgress = true;
                SaveCurrentPageInk();
                var job = JobManager.AddBlankPage(_job);
                _currentPageIndex = job.CurrentPage;
                LoadDocument(skipSaveCurrentPage: true);
                await Task.CompletedTask;
            }
            catch (Exception ex)
            {
                MessageBox.Show($"添加空白页失败：{ex.Message}", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
            }
            finally
            {
                _thumbnailMutationInProgress = false;
            }
        }

        private void ThumbnailDeleteButton_PreviewMouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            e.Handled = true;
        }

        private async void ThumbnailDeleteButton_Click(object sender, RoutedEventArgs e)
        {
            if (sender is not Button button || button.Tag is not int pageIndex || EffectivePageCount() <= 1)
            {
                return;
            }

            var result = MessageBox.Show(
                $"确定要删除第 {pageIndex + 1} 页吗？",
                "删除页",
                MessageBoxButton.YesNo,
                MessageBoxImage.Warning);

            if (result != MessageBoxResult.Yes)
            {
                return;
            }

            try
            {
                _thumbnailMutationInProgress = true;
                SaveCurrentPageInk();
                JobManager.DeletePage(_job, pageIndex);
                _currentPageIndex = _job.CurrentPage;
                SetupHomeworkTree();
                LoadDocument(skipSaveCurrentPage: true);
                await Task.CompletedTask;
            }
            catch (Exception ex)
            {
                MessageBox.Show($"删除页失败：{ex.Message}", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
            }
            finally
            {
                _thumbnailMutationInProgress = false;
            }
        }

        private void SubjectImportMenuItem_Click(object? sender, RoutedEventArgs e)
        {
            if (sender is not MenuItem menuItem || menuItem.Tag is not Tuple<string, HomeworkNodeContext> action)
            {
                return;
            }

            if (action.Item1 == "images")
            {
                ImportFilesForSubject(action.Item2, false);
            }
            else if (action.Item1 == "pdf")
            {
                ImportFilesForSubject(action.Item2, true);
            }
        }

        private void ImportFilesForSubject(HomeworkNodeContext context, bool pdfOnly)
        {
            if (string.IsNullOrWhiteSpace(context.Subject))
            {
                return;
            }

            var dialog = new OpenFileDialog
            {
                Multiselect = true,
                Title = pdfOnly ? "选择 PDF 作业" : "选择图片作业",
                Filter = pdfOnly
                    ? "PDF 文件 (*.pdf)|*.pdf"
                    : "图片文件 (*.jpg;*.jpeg;*.png;*.bmp;*.gif)|*.jpg;*.jpeg;*.png;*.bmp;*.gif"
            };

            if (dialog.ShowDialog() != true || dialog.FileNames.Length == 0)
            {
                return;
            }

            try
            {
                SaveCurrentPageInk();
                JobManager.SaveJob(_job);
                var job = JobManager.CreateJob(context.Subject, dialog.FileNames.ToList(), context.Date, context.Bucket);
                NavigationService?.Navigate(new EditorPage(job));
            }
            catch (Exception ex)
            {
                MessageBox.Show(ex.Message, "导入失败", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private void Page_DragOver(object sender, DragEventArgs e)
        {
            if (TryGetSupportedDroppedFiles(e, out _))
            {
                e.Effects = DragDropEffects.Copy;
            }
            else
            {
                e.Effects = DragDropEffects.None;
            }

            e.Handled = true;
        }

        private void Page_Drop(object sender, DragEventArgs e)
        {
            if (!TryGetSupportedDroppedFiles(e, out var files))
            {
                return;
            }

            try
            {
                SaveCurrentPageInk();
                JobManager.SaveJob(_job);
                var job = JobManager.CreateJob(_job.Subject, files, _job.CreateTime.Date, _job.Bucket);
                LoadSelectedJob(job);
            }
            catch (Exception ex)
            {
                MessageBox.Show($"导入作业失败：{ex.Message}", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private static bool TryGetSupportedDroppedFiles(DragEventArgs e, out List<string> files)
        {
            files = new List<string>();
            if (!e.Data.GetDataPresent(DataFormats.FileDrop))
            {
                return false;
            }

            if (e.Data.GetData(DataFormats.FileDrop) is not string[] droppedFiles || droppedFiles.Length == 0)
            {
                return false;
            }

            files = droppedFiles
                .Where(File.Exists)
                .Where(IsSupportedImportFile)
                .ToList();

            return files.Count > 0;
        }

        private static bool IsSupportedImportFile(string path)
        {
            string extension = Path.GetExtension(path);
            return extension.Equals(".pdf", StringComparison.OrdinalIgnoreCase)
                || extension.Equals(".jpg", StringComparison.OrdinalIgnoreCase)
                || extension.Equals(".jpeg", StringComparison.OrdinalIgnoreCase)
                || extension.Equals(".png", StringComparison.OrdinalIgnoreCase)
                || extension.Equals(".bmp", StringComparison.OrdinalIgnoreCase)
                || extension.Equals(".gif", StringComparison.OrdinalIgnoreCase);
        }

        private void InkCanvas_StrokesChanged(object? sender, StrokeCollectionChangedEventArgs e)
        {
            if (e.Added.Count > 0 || e.Removed.Count > 0)
            {
                // Schedule auto-save
                _saveDebouncer?.Change(2000, System.Threading.Timeout.Infinite);
            }
        }

        private void DraftInkCanvas_StrokesChanged(object? sender, StrokeCollectionChangedEventArgs e)
        {
            if (e.Added.Count > 0 || e.Removed.Count > 0)
            {
                // Schedule auto-save
                _saveDebouncer?.Change(2000, System.Threading.Timeout.Infinite);
            }
        }

        private void LoadPageInk(int pageIndex)
        {
            string inkPath = _job!.GetInkFilePath(pageIndex);
            var strokes = InkService.LoadInk(inkPath);

            if (_inkManager != null)
            {
                _inkManager.SetStrokes(strokes ?? new StrokeCollection());
            }
        }

        private void LoadDraftInk()
        {
            string draftInkPath = _job!.GetDraftInkFilePath();
            var strokes = InkService.LoadInk(draftInkPath);

            if (_draftInkManager != null)
            {
                _draftInkManager.SetStrokes(strokes ?? new StrokeCollection());
            }
        }

        private void SaveCurrentPageInk()
        {
            // Save homework ink
            if (_inkManager != null)
            {
                var strokes = _inkManager.GetStrokes();
                if (strokes != null && strokes.Count > 0)
                {
                    string inkPath = _job!.GetInkFilePath(_currentPageIndex);
                    InkService.SaveInk(strokes, inkPath);
                }
                else
                {
                    string inkPath = _job!.GetInkFilePath(_currentPageIndex);
                    if (File.Exists(inkPath))
                    {
                        try { File.Delete(inkPath); } catch { }
                    }
                }
            }

            // Save draft ink
            if (_draftInkManager != null)
            {
                var draftStrokes = _draftInkManager.GetStrokes();
                if (draftStrokes != null && draftStrokes.Count > 0)
                {
                    string draftInkPath = _job!.GetDraftInkFilePath();
                    InkService.SaveInk(draftStrokes, draftInkPath);
                }
                else
                {
                    string draftInkPath = _job!.GetDraftInkFilePath();
                    if (File.Exists(draftInkPath))
                    {
                        try { File.Delete(draftInkPath); } catch { }
                    }
                }
            }
        }

        private void DebouncedSave(object? state)
        {
            Dispatcher.Invoke(() =>
            {
                if (_disposed)
                {
                    return;
                }

                SaveCurrentPageInk();
                JobManager.SaveJob(_job!);
            });
        }

        private void UpdateScrollIndicator(ScrollViewer viewer, Border indicator, DispatcherTimer timer)
        {
            if (viewer.ExtentHeight <= viewer.ViewportHeight || viewer.ViewportHeight <= 0 || viewer.ActualHeight <= 0)
            {
                indicator.Visibility = Visibility.Collapsed;
                return;
            }

            double trackHeight = viewer.ActualHeight;
            double thumbHeight = Math.Max(18, trackHeight * (viewer.ViewportHeight / viewer.ExtentHeight));
            double maxOffset = Math.Max(1, viewer.ExtentHeight - viewer.ViewportHeight);
            double top = (viewer.VerticalOffset / maxOffset) * Math.Max(0, trackHeight - thumbHeight);

            indicator.Height = thumbHeight;
            indicator.Margin = new Thickness(0, top, 0, 0);
            indicator.Visibility = Visibility.Visible;
            indicator.Background = new SolidColorBrush(Color.FromRgb(0, 0, 0));
            timer.Stop();
            timer.Start();
        }

        private static void ResetIndicatorColor(Border indicator, DispatcherTimer timer)
        {
            indicator.Background = new SolidColorBrush(Color.FromRgb(110, 110, 110));
            timer.Stop();
        }

        private void BtnBack_Click(object sender, RoutedEventArgs e)
        {
            SaveCurrentPageInk();
            JobManager.SaveJob(_job!);
            NavigationService?.GoBack();
        }

        private void BtnPen_Click(object sender, RoutedEventArgs e)
        {
            SetActiveTool(InkManager.ToolMode.Pen);
        }

        private void BtnEraser_Click(object sender, RoutedEventArgs e)
        {
            SetActiveTool(InkManager.ToolMode.Eraser);
        }

        private void BtnSelect_Click(object sender, RoutedEventArgs e)
        {
            SetActiveTool(InkManager.ToolMode.Select);
        }

        private void BtnHand_Click(object sender, RoutedEventArgs e)
        {
            SetActiveTool(InkManager.ToolMode.None, handMode: true);
        }

        private void Color_Click(object sender, MouseButtonEventArgs e)
        {
            if (sender is Border border && border.Tag is string colorName)
            {
                _currentColor = colorName switch
                {
                    "Black" => Colors.Black,
                    "Red" => Colors.Red,
                    "Blue" => Colors.Blue,
                    "Green" => Colors.Green,
                    "Yellow" => Colors.Yellow,
                    _ => Colors.Black
                };

                _inkManager?.SetPenColor(_currentColor);
                _draftInkManager?.SetPenColor(_currentColor);
                UpdateColorSelectorVisual();
            }
        }

        private void Width1_Click(object sender, MouseButtonEventArgs e)
        {
            _currentPenWidth = 1;
            _inkManager?.SetPenWidth(1);
            _draftInkManager?.SetPenWidth(1);
            UpdateWidthSelectorVisual();
        }

        private void Width2_Click(object sender, MouseButtonEventArgs e)
        {
            _currentPenWidth = 3;
            _inkManager?.SetPenWidth(3);
            _draftInkManager?.SetPenWidth(3);
            UpdateWidthSelectorVisual();
        }

        private void Width3_Click(object sender, MouseButtonEventArgs e)
        {
            _currentPenWidth = 6;
            _inkManager?.SetPenWidth(6);
            _draftInkManager?.SetPenWidth(6);
            UpdateWidthSelectorVisual();
        }

        private void UpdateWidthSelectorVisual()
        {
            if (WidthBarThin == null || WidthBarMedium == null || WidthBarBold == null)
            {
                return;
            }

            ResetWidthBar(WidthBarThin);
            ResetWidthBar(WidthBarMedium);
            ResetWidthBar(WidthBarBold);

            var selected = _currentPenWidth switch
            {
                <= 1.5 => WidthBarThin,
                <= 4.0 => WidthBarMedium,
                _ => WidthBarBold
            };

            selected.Background = new SolidColorBrush(Color.FromRgb(116, 229, 203));
        }

        private static void ResetWidthBar(Border border)
        {
            border.Background = new SolidColorBrush(Color.FromRgb(122, 122, 122));
            border.BorderBrush = Brushes.Transparent;
            border.BorderThickness = new Thickness(0);
        }

        private void ZoomIn_Click(object sender, RoutedEventArgs e)
        {
            _currentScale = Math.Min(_currentScale * 1.2, GetMaximumScale());
            ApplyZoom();
        }

        private void ZoomOut_Click(object sender, RoutedEventArgs e)
        {
            _currentScale = Math.Max(_currentScale / 1.2, 1.0);
            ApplyZoom();
        }

        private void ApplyZoom(ScrollViewer? anchorViewer = null, Point? anchorPoint = null)
        {
            _currentScale = Math.Max(1.0, Math.Min(_currentScale, GetMaximumScale()));
            double horizontalRatio = 0;
            double verticalRatio = 0;
            bool hasAnchor = anchorViewer != null && anchorPoint.HasValue;

            if (hasAnchor && anchorViewer != null)
            {
                var anchor = anchorPoint.GetValueOrDefault();

                if (anchorViewer.ExtentWidth > 0)
                {
                    horizontalRatio = (anchorViewer.HorizontalOffset + anchor.X) / anchorViewer.ExtentWidth;
                }

                if (anchorViewer.ExtentHeight > 0)
                {
                    verticalRatio = (anchorViewer.VerticalOffset + anchor.Y) / anchorViewer.ExtentHeight;
                }
            }

            HomeworkContainer.LayoutTransform = new ScaleTransform(_currentScale, _currentScale);
            DraftContainer.LayoutTransform = new ScaleTransform(_currentScale, _currentScale);
            UpdateDraftCanvasToViewport();

            TxtZoom.Text = $"{(int)(_currentScale * 100)}%";

            if (hasAnchor && anchorViewer != null && anchorPoint.HasValue)
            {
                anchorViewer.Dispatcher.BeginInvoke(new Action(() =>
                {
                    double targetHorizontal = Math.Max(0, horizontalRatio * anchorViewer.ExtentWidth - anchorPoint.Value.X);
                    double targetVertical = Math.Max(0, verticalRatio * anchorViewer.ExtentHeight - anchorPoint.Value.Y);
                    anchorViewer.ScrollToHorizontalOffset(targetHorizontal);
                    anchorViewer.ScrollToVerticalOffset(targetVertical);
                    UpdateScrollIndicator(HomeworkScrollViewer, HomeworkScrollIndicator, _homeworkScrollIndicatorTimer);
                    UpdateScrollIndicator(DraftScrollViewer, DraftScrollIndicator, _draftScrollIndicatorTimer);
                }), DispatcherPriority.Loaded);
            }
            else
            {
                UpdateScrollIndicator(HomeworkScrollViewer, HomeworkScrollIndicator, _homeworkScrollIndicatorTimer);
                UpdateScrollIndicator(DraftScrollViewer, DraftScrollIndicator, _draftScrollIndicatorTimer);
            }
        }

        private void ScrollViewer_PreviewMouseWheel(object sender, MouseWheelEventArgs e)
        {
            if (Keyboard.Modifiers.HasFlag(ModifierKeys.Control))
            {
                e.Handled = true;
                if (e.Delta > 0)
                {
                    _currentScale = Math.Min(_currentScale * 1.2, GetMaximumScale());
                }
                else
                {
                    _currentScale = Math.Max(_currentScale / 1.2, 1.0);
                }

                if (sender is ScrollViewer scrollViewer)
                {
                    ApplyZoom(scrollViewer, e.GetPosition(scrollViewer));
                }
                else
                {
                    ApplyZoom();
                }
            }
        }

        private void DraftScrollViewer_PreviewMouseWheel(object sender, MouseWheelEventArgs e)
        {
            ScrollViewer_PreviewMouseWheel(sender, e);
        }

        private void HomeworkTreeScrollViewer_PreviewMouseWheel(object sender, MouseWheelEventArgs e)
        {
            if (Keyboard.Modifiers.HasFlag(ModifierKeys.Control))
            {
                return;
            }

            if (sender is ScrollViewer scrollViewer)
            {
                e.Handled = true;
                scrollViewer.ScrollToVerticalOffset(scrollViewer.VerticalOffset - (e.Delta / 3.0));
            }
        }

        private void HomeworkScrollViewer_ScrollChanged(object sender, ScrollChangedEventArgs e)
        {
            UpdateScrollIndicator(HomeworkScrollViewer, HomeworkScrollIndicator, _homeworkScrollIndicatorTimer);
        }

        private void DraftScrollViewer_ScrollChanged(object sender, ScrollChangedEventArgs e)
        {
            UpdateScrollIndicator(DraftScrollViewer, DraftScrollIndicator, _draftScrollIndicatorTimer);
        }

        private double GetMaximumScale()
        {
            if (EditorLayoutRoot == null)
            {
                return 5.0;
            }

            double baseWidth = A4Background.Width > 0 ? A4Background.Width : 794;
            double availableWidth = EditorLayoutRoot.ActualWidth
                - ThumbnailColumn.ActualWidth
                - LeftColumn.ActualWidth
                - 8;

            if (availableWidth <= 0 || baseWidth <= 0)
            {
                return 1.0;
            }

            return Math.Max(1.0, availableWidth / baseWidth);
        }

        private async void BtnPageRatio_Click(object sender, RoutedEventArgs e)
        {
            // Save current ink before switching
            SaveCurrentPageInk();

            // Toggle orientation
            _isPortrait = !_isPortrait;
            BtnPageRatio.Content = _isPortrait ? "A4 竖" : "A4 横";
            await LoadPageAsync(_currentPageIndex, skipSaveCurrentPage: true);
            ApplyZoom();
        }

        private void UpdateColorSelectorVisual()
        {
            foreach (var border in _colorBorders)
            {
                border.BorderBrush = new SolidColorBrush(Colors.Transparent);
                border.BorderThickness = new Thickness(2);
            }

            var currentBorder = _currentColor switch
            {
                Color c when c == Colors.Black => ColorBlack,
                Color c when c == Colors.Red => ColorRed,
                Color c when c == Colors.Blue => ColorBlue,
                Color c when c == Colors.Green => ColorGreen,
                Color c when c == Colors.Yellow => ColorYellow,
                _ => ColorBlack
            };

            currentBorder.BorderBrush = new SolidColorBrush(Color.FromRgb(74, 144, 217));
            currentBorder.BorderThickness = new Thickness(3);
        }

        private void BtnClearPage_Click(object sender, RoutedEventArgs e)
        {
            var result = MessageBox.Show("确定要清空当前页的所有笔迹吗？", "确认", MessageBoxButton.YesNo, MessageBoxImage.Question);
            if (result == MessageBoxResult.Yes)
            {
                _inkManager?.Clear();
                SaveCurrentPageInk();
            }
        }

        private void BtnClearDraft_Click(object sender, RoutedEventArgs e)
        {
            var result = MessageBox.Show("确定要清空草稿纸的所有笔迹吗？", "确认", MessageBoxButton.YesNo, MessageBoxImage.Question);
            if (result == MessageBoxResult.Yes)
            {
                _draftInkManager?.Clear();
                SaveCurrentPageInk();
            }
        }

        private void BtnTools_Click(object sender, RoutedEventArgs e)
        {
            ToolPanel.Visibility = ToolPanel.Visibility == Visibility.Visible
                ? Visibility.Collapsed
                : Visibility.Visible;
        }

        private void BtnExpandLeft_Click(object sender, RoutedEventArgs e)
        {
            SetAssistantPanelCollapsed();
        }

        private void BtnMenu_Click(object sender, RoutedEventArgs e)
        {
            var menu = new ContextMenu();
            menu.Items.Add(new MenuItem { Header = "历史作业", Tag = "history" });
            menu.Items.Add(new MenuItem { Header = "设置", Tag = "settings" });

            foreach (var item in menu.Items)
            {
                if (item is MenuItem menuItem && menuItem.Tag != null)
                {
                    menuItem.Click += MenuItem_Click;
                }
            }

            menu.PlacementTarget = BtnMenu;
            menu.IsOpen = true;
        }

        private async void MenuItem_Click(object? sender, RoutedEventArgs e)
        {
            if (sender is MenuItem menuItem && menuItem.Tag is string action)
            {
                switch (action)
                {
                    case "history":
                        NavigationService?.Navigate(new HistoryPage());
                        break;
                    case "settings":
                        NavigationService?.Navigate(new SettingsPage());
                        break;
                }
            }
        }

        private async void BtnPrint_Click(object sender, RoutedEventArgs e)
        {
            SaveCurrentPageInk();
            JobManager.SaveJob(_job!);

            try
            {
                await PrintJobAsync();
                _job.IsPrinted = true;
                JobManager.SaveJob(_job!);
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (Exception ex)
            {
                MessageBox.Show($"打印失败：{ex.Message}", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private async Task PrintJobAsync()
        {
            var (printQueue, printTicket) = ResolvePrintDestination();
            var document = new HomeworkPrintDocument(_job, _documentService);
            document.Print(printQueue, printTicket);
            MessageBox.Show($"已发送到打印机：{printQueue.Name}", "打印完成", MessageBoxButton.OK, MessageBoxImage.Information);
        }

        private (PrintQueue queue, PrintTicket? ticket) ResolvePrintDestination()
        {
            var settings = AppSettingsStore.Load();
            var server = new LocalPrintServer();

            if (!string.IsNullOrWhiteSpace(settings.DefaultPrinterName))
            {
                try
                {
                    var queue = server.GetPrintQueues()
                        .FirstOrDefault(item => string.Equals(item.Name, settings.DefaultPrinterName, StringComparison.CurrentCultureIgnoreCase));

                    if (queue != null)
                    {
                        return (queue, BuildPrintTicket(queue, settings.PaperSize));
                    }
                }
                catch
                {
                }
            }

            var printDialog = new PrintDialog();
            if (printDialog.ShowDialog() != true || printDialog.PrintQueue == null)
            {
                throw new OperationCanceledException("已取消打印。");
            }

            settings.DefaultPrinterName = printDialog.PrintQueue.Name;
            if (TryMapPaperSize(printDialog.PrintTicket?.PageMediaSize?.PageMediaSizeName, out var dialogPaperSize))
            {
                settings.PaperSize = dialogPaperSize;
            }

            AppSettingsStore.Save(settings);
            return (printDialog.PrintQueue, BuildPrintTicket(printDialog.PrintQueue, settings.PaperSize));
        }

        private static PrintTicket BuildPrintTicket(PrintQueue queue, string? paperSize)
        {
            var ticket = queue.UserPrintTicket ?? queue.DefaultPrintTicket ?? new PrintTicket();
            var pageMediaSize = paperSize switch
            {
                "A3" => new PageMediaSize(PageMediaSizeName.ISOA3),
                "Letter" => new PageMediaSize(PageMediaSizeName.NorthAmericaLetter),
                "B5" => new PageMediaSize(MmToDip(176), MmToDip(250)),
                _ => new PageMediaSize(PageMediaSizeName.ISOA4)
            };

            ticket.PageMediaSize = pageMediaSize;
            return ticket;
        }

        private static bool TryMapPaperSize(PageMediaSizeName? mediaSizeName, out string paperSize)
        {
            switch (mediaSizeName)
            {
                case PageMediaSizeName.ISOA3:
                    paperSize = "A3";
                    return true;
                case PageMediaSizeName.NorthAmericaLetter:
                    paperSize = "Letter";
                    return true;
                case PageMediaSizeName.ISOA4:
                    paperSize = "A4";
                    return true;
                default:
                    paperSize = string.Empty;
                    return false;
            }
        }

        private static double MmToDip(double millimeter)
        {
            return millimeter / 25.4 * 96.0;
        }

        private void ScrollViewer_PreviewMouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            if (!_isHandMode || sender is not ScrollViewer scrollViewer)
            {
                return;
            }

            _activePanScrollViewer = scrollViewer;
            _panStartPoint = e.GetPosition(scrollViewer);
            _panStartOffset = new Point(scrollViewer.HorizontalOffset, scrollViewer.VerticalOffset);
            scrollViewer.CaptureMouse();
            e.Handled = true;
        }

        private void ScrollViewer_PreviewMouseMove(object sender, MouseEventArgs e)
        {
            if (!_isHandMode || _activePanScrollViewer == null || !_activePanScrollViewer.IsMouseCaptured)
            {
                return;
            }

            var currentPoint = e.GetPosition(_activePanScrollViewer);
            var delta = currentPoint - _panStartPoint;

            _activePanScrollViewer.ScrollToHorizontalOffset(Math.Max(0, _panStartOffset.X - delta.X));
            _activePanScrollViewer.ScrollToVerticalOffset(Math.Max(0, _panStartOffset.Y - delta.Y));
            e.Handled = true;
        }

        private void ScrollViewer_PreviewMouseLeftButtonUp(object sender, MouseButtonEventArgs e)
        {
            EndPan();
        }

        private void EditorPage_Unloaded(object sender, RoutedEventArgs e)
        {
            Dispose();
        }

        public void Dispose()
        {
            if (!_disposed)
            {
                Unloaded -= EditorPage_Unloaded;
                EndPan();
                MainInkCanvas.Strokes.StrokesChanged -= InkCanvas_StrokesChanged;
                DraftInkCanvas.Strokes.StrokesChanged -= DraftInkCanvas_StrokesChanged;
                _saveDebouncer?.Dispose();
                _homeworkScrollIndicatorTimer.Stop();
                _draftScrollIndicatorTimer.Stop();
                _documentService?.Dispose();
                _disposed = true;
            }
        }

        private void SetAssistantPanelCollapsed()
        {
            LeftColumn.Width = new GridLength(200);
            LeftPanel.Visibility = Visibility.Visible;
            BtnExpandLeft.Visibility = Visibility.Collapsed;

            ApplyZoom();
        }

        private void SetActiveTool(InkManager.ToolMode tool, bool handMode = false)
        {
            _activeToolMode = tool;
            _isHandMode = handMode;
            ApplyToolSelectionToManagers();

            var cursor = handMode ? Cursors.Hand : Cursors.Arrow;
            HomeworkScrollViewer.Cursor = cursor;
            DraftScrollViewer.Cursor = cursor;
            MainInkCanvas.Cursor = cursor;
            DraftInkCanvas.Cursor = cursor;
        }

        private void EndPan()
        {
            if (_activePanScrollViewer != null && _activePanScrollViewer.IsMouseCaptured)
            {
                _activePanScrollViewer.ReleaseMouseCapture();
            }

            _activePanScrollViewer = null;
        }

        private void ApplyToolSelectionToManagers()
        {
            _inkManager?.SetTool(_activeToolMode);
            _draftInkManager?.SetTool(_activeToolMode);

            if (_activeToolMode == InkManager.ToolMode.Pen)
            {
                _inkManager?.SetPenColor(_currentColor);
                _inkManager?.SetPenWidth(_currentPenWidth);
                _draftInkManager?.SetPenColor(_currentColor);
                _draftInkManager?.SetPenWidth(_currentPenWidth);
                UpdateColorSelectorVisual();
            }
        }
    }
}
