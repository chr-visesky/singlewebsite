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
        private double _currentPenWidth = 3.0;
        private double _currentScale = 1.0;
        private bool _isPortrait = true;
        private bool _hasDocument = false;
        private int _pageLoadVersion;
        private bool _isHandMode;
        private ScrollViewer? _activePanScrollViewer;
        private Point _panStartPoint;
        private Point _panStartOffset;
        private InkManager.ToolMode _activeToolMode = InkManager.ToolMode.Pen;
        private static readonly string[] CoreSubjects = { "语文", "数学", "英语" };
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
            _homeworkScrollIndicatorTimer.Tick += (_, _) => ResetIndicatorColor(HomeworkScrollIndicator, _homeworkScrollIndicatorTimer);
            _draftScrollIndicatorTimer.Tick += (_, _) => ResetIndicatorColor(DraftScrollIndicator, _draftScrollIndicatorTimer);
            Unloaded += EditorPage_Unloaded;
            SetAssistantPanelCollapsed(false);

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

            // 校内作业
            var schoolRoot = new TreeViewItem
            {
                Header = "📚 校内作业",
                IsExpanded = true,
                Foreground = new SolidColorBrush(Color.FromRgb(248, 242, 233)),
                FontWeight = FontWeights.SemiBold
            };
            foreach (var subject in CoreSubjects)
            {
                AddSubjectNode(schoolRoot, subject, allJobs.Where(j => j.Subject == subject).ToList());
            }

            // 校外作业
            var externalRoot = new TreeViewItem
            {
                Header = "🏠 校外作业",
                IsExpanded = true,
                Foreground = new SolidColorBrush(Color.FromRgb(248, 242, 233)),
                FontWeight = FontWeights.SemiBold
            };
            var externalJobs = allJobs
                .Where(j => !CoreSubjects.Contains(j.Subject))
                .GroupBy(j => j.Subject)
                .OrderBy(group => group.Key, StringComparer.CurrentCultureIgnoreCase);

            foreach (var jobGroup in externalJobs)
            {
                AddSubjectNode(externalRoot, jobGroup.Key, jobGroup.ToList());
            }

            if (externalRoot.Items.Count == 0)
            {
                AddJobNodes(externalRoot, new List<JobSession>());
            }

            HomeworkTree.Items.Add(schoolRoot);
            HomeworkTree.Items.Add(externalRoot);
        }

        private void AddSubjectNode(TreeViewItem parent, string subject, List<JobSession> jobs)
        {
            var subjectNode = new TreeViewItem
            {
                Header = subject,
                Tag = subject,
                IsExpanded = true,
                Foreground = new SolidColorBrush(Color.FromRgb(248, 242, 233)),
                FontWeight = FontWeights.SemiBold
            };

            AddPeriodNode(subjectNode, "本周", jobs.Where(job => IsInThisWeek(job.UpdateTime)).ToList());
            AddPeriodNode(subjectNode, "上周", jobs.Where(job => IsInLastWeek(job.UpdateTime)).ToList());
            AddPeriodNode(subjectNode, "更早", jobs.Where(job => !IsInThisWeek(job.UpdateTime) && !IsInLastWeek(job.UpdateTime)).ToList());

            parent.Items.Add(subjectNode);
        }

        private void AddPeriodNode(TreeViewItem parent, string label, List<JobSession> jobs)
        {
            var node = new TreeViewItem
            {
                Header = $"{label} ({jobs.Count} 次)",
                Foreground = new SolidColorBrush(Color.FromRgb(248, 242, 233)),
                IsExpanded = label != "更早"
            };

            AddJobNodes(node, jobs);
            parent.Items.Add(node);
        }

        private void AddJobNodes(TreeViewItem parent, List<JobSession> jobs)
        {
            if (jobs.Count == 0)
            {
                parent.Items.Add(new TreeViewItem
                {
                    Header = "（无作业）",
                    IsEnabled = false,
                    Foreground = new SolidColorBrush(Color.FromRgb(180, 180, 180))
                });
                return;
            }

            foreach (var job in jobs.OrderByDescending(j => j.UpdateTime))
            {
                var jobNode = new TreeViewItem
                {
                    Header = $"{job.UpdateTime:MM-dd HH:mm} ({job.TotalPages}页)",
                    Tag = job,
                    Foreground = new SolidColorBrush(Color.FromRgb(248, 242, 233))
                };
                jobNode.MouseLeftButtonDown += (s, e) =>
                {
                    LoadSelectedJob(job);
                };
                parent.Items.Add(jobNode);
            }
        }

        private bool IsInThisWeek(DateTime date)
        {
            var monday = StartOfWeek(DateTime.Today);
            var sunday = monday.AddDays(6);

            return date >= monday && date <= sunday.AddDays(1).AddTicks(-1);
        }

        private bool IsInLastWeek(DateTime date)
        {
            var lastMonday = StartOfWeek(DateTime.Today).AddDays(-7);
            var lastSunday = lastMonday.AddDays(6);

            return date >= lastMonday && date <= lastSunday.AddDays(1).AddTicks(-1);
        }

        private static DateTime StartOfWeek(DateTime date)
        {
            int weekday = (int)date.DayOfWeek;
            int offset = weekday == 0 ? -6 : DayOfWeek.Monday - date.DayOfWeek;
            return date.Date.AddDays(offset);
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

        private async void LoadDocument()
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
                await LoadPageAsync(_currentPageIndex);
            }
            catch (Exception ex)
            {
                MessageBox.Show($"加载作业失败：{ex.Message}", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
                NavigationService?.GoBack();
            }
        }

        private async Task LoadPageAsync(int pageIndex)
        {
            if (pageIndex < 0 || pageIndex >= EffectivePageCount())
                return;

            int loadVersion = Interlocked.Increment(ref _pageLoadVersion);

            // Save current page ink before switching
            SaveCurrentPageInk();

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
                _inkManager.SetStrokes(strokes);
            }
        }

        private void LoadDraftInk()
        {
            string draftInkPath = _job!.GetDraftInkFilePath();
            var strokes = InkService.LoadInk(draftInkPath);

            if (_draftInkManager != null)
            {
                _draftInkManager.SetStrokes(strokes);
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
        }

        private void Width2_Click(object sender, MouseButtonEventArgs e)
        {
            _currentPenWidth = 3;
            _inkManager?.SetPenWidth(3);
            _draftInkManager?.SetPenWidth(3);
        }

        private void Width3_Click(object sender, MouseButtonEventArgs e)
        {
            _currentPenWidth = 6;
            _inkManager?.SetPenWidth(6);
            _draftInkManager?.SetPenWidth(6);
        }

        private void UpdateWidthSelectorVisual()
        {
            // Simplified for new UI
        }

        private void ZoomIn_Click(object sender, RoutedEventArgs e)
        {
            _currentScale = Math.Min(_currentScale * 1.2, 5.0);
            ApplyZoom();
        }

        private void ZoomOut_Click(object sender, RoutedEventArgs e)
        {
            _currentScale = Math.Max(_currentScale / 1.2, 0.2);
            ApplyZoom();
        }

        private void ApplyZoom(ScrollViewer? anchorViewer = null, Point? anchorPoint = null)
        {
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
                    _currentScale = Math.Min(_currentScale * 1.2, 5.0);
                }
                else
                {
                    _currentScale = Math.Max(_currentScale / 1.2, 0.2);
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

        private void HomeworkScrollViewer_ScrollChanged(object sender, ScrollChangedEventArgs e)
        {
            UpdateScrollIndicator(HomeworkScrollViewer, HomeworkScrollIndicator, _homeworkScrollIndicatorTimer);
        }

        private void DraftScrollViewer_ScrollChanged(object sender, ScrollChangedEventArgs e)
        {
            UpdateScrollIndicator(DraftScrollViewer, DraftScrollIndicator, _draftScrollIndicatorTimer);
        }

        private async void BtnPageRatio_Click(object sender, RoutedEventArgs e)
        {
            // Save current ink before switching
            SaveCurrentPageInk();

            // Toggle orientation
            _isPortrait = !_isPortrait;
            BtnPageRatio.Content = _isPortrait ? "A4 竖" : "A4 横";
            await LoadPageAsync(_currentPageIndex);
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

        private bool _isLeftPanelCollapsed = false;

        private void BtnExpandLeft_Click(object sender, RoutedEventArgs e)
        {
            SetAssistantPanelCollapsed(!_isLeftPanelCollapsed);
        }

        private void BtnMenu_Click(object sender, RoutedEventArgs e)
        {
            var menu = new ContextMenu();
            int pageCount = EffectivePageCount();

            if (pageCount > 1)
            {
                menu.Items.Add(new MenuItem
                {
                    Header = $"当前页：{_currentPageIndex + 1} / {pageCount}",
                    IsEnabled = false
                });
                menu.Items.Add(new MenuItem
                {
                    Header = "上一页",
                    Tag = "prev-page",
                    IsEnabled = _currentPageIndex > 0
                });
                menu.Items.Add(new MenuItem
                {
                    Header = "下一页",
                    Tag = "next-page",
                    IsEnabled = _currentPageIndex < pageCount - 1
                });
                menu.Items.Add(new Separator());
            }

            menu.Items.Add(new MenuItem { Header = "历史作业", Tag = "history" });
            menu.Items.Add(new MenuItem { Header = "设置", Tag = "settings" });
            menu.Items.Add(new Separator());
            menu.Items.Add(new MenuItem { Header = "导入作业", Tag = "import" });
            menu.Items.Add(new MenuItem { Header = "删除作业", Tag = "delete" });

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
                    case "prev-page":
                        if (_currentPageIndex > 0)
                        {
                            await LoadPageAsync(_currentPageIndex - 1);
                        }
                        break;
                    case "next-page":
                        if (_currentPageIndex < EffectivePageCount() - 1)
                        {
                            await LoadPageAsync(_currentPageIndex + 1);
                        }
                        break;
                    case "history":
                        NavigationService?.Navigate(new HistoryPage());
                        break;
                    case "settings":
                        NavigationService?.Navigate(new SettingsPage());
                        break;
                    case "import":
                        NavigationService?.Navigate(new ImportPage(_job.Subject));
                        break;
                    case "delete":
                        var result = MessageBox.Show($"确定要删除作业《{ _job.Subject}》吗？", "确认删除", MessageBoxButton.YesNo, MessageBoxImage.Warning);
                        if (result == MessageBoxResult.Yes)
                        {
                            JobManager.DeleteJob(_job.JobId);
                            NavigationService?.Navigate(new EditorPage(JobManager.GetPreferredStartupJob()));
                        }
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

        private void SetAssistantPanelCollapsed(bool collapsed)
        {
            _isLeftPanelCollapsed = collapsed;

            if (collapsed)
            {
                LeftColumn.Width = new GridLength(0);
                LeftPanel.Visibility = Visibility.Collapsed;
                BtnExpandLeft.Content = "◀";
                BtnExpandLeft.ToolTip = "展开作业助手";
                BtnExpandLeft.Margin = new Thickness(-5, 0, 0, 0);
            }
            else
            {
                LeftColumn.Width = new GridLength(200);
                LeftPanel.Visibility = Visibility.Visible;
                BtnExpandLeft.Content = "▶";
                BtnExpandLeft.ToolTip = "收起作业助手";
                BtnExpandLeft.Margin = new Thickness(-5, 0, 0, 0);
            }
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
