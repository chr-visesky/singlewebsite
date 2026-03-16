using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Ink;
using System.Windows.Media;
using System.Windows.Media.Imaging;
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
            Unloaded += EditorPage_Unloaded;

            LoadDocument();
            SetupInkCanvas();
            SetupDraftInkCanvas();
            UpdatePageInfo();
        }

        private void SetupHomeworkTree()
        {
            HomeworkTree.Items.Clear();
            var thisWeek = GetThisWeekJobs();
            var lastWeek = GetLastWeekJobs();

            // 校内作业
            var schoolRoot = new TreeViewItem
            {
                Header = "📚 校内作业",
                IsExpanded = true
            };
            AddSubjectNode(schoolRoot, "语文", thisWeek, lastWeek);
            AddSubjectNode(schoolRoot, "数学", thisWeek, lastWeek);
            AddSubjectNode(schoolRoot, "英语", thisWeek, lastWeek);

            // 校外作业
            var externalRoot = new TreeViewItem
            {
                Header = "🏠 校外作业",
                IsExpanded = true
            };
            var externalJobs = GetExternalJobs(thisWeek, lastWeek);
            foreach (var jobGroup in externalJobs)
            {
                var subjectNode = new TreeViewItem
                {
                    Header = jobGroup.Key,
                    Tag = jobGroup.Key
                };
                AddJobNodes(subjectNode, jobGroup.Value);
                externalRoot.Items.Add(subjectNode);
            }

            HomeworkTree.Items.Add(schoolRoot);
            HomeworkTree.Items.Add(externalRoot);
        }

        private void AddSubjectNode(TreeViewItem parent, string subject, List<JobSession> thisWeek, List<JobSession> lastWeek)
        {
            var subjectNode = new TreeViewItem
            {
                Header = subject,
                Tag = subject,
                IsExpanded = true
            };

            // 本周
            var thisWeekCount = thisWeek.Count(j => j.Subject == subject);
            var thisWeekNode = new TreeViewItem
            {
                Header = $"本周 ({thisWeekCount} 次)",
                Foreground = new SolidColorBrush(Color.FromRgb(248, 242, 233))
            };
            var thisWeekJobs = thisWeek.Where(j => j.Subject == subject).ToList();
            AddJobNodes(thisWeekNode, thisWeekJobs);
            subjectNode.Items.Add(thisWeekNode);

            // 上周
            var lastWeekCount = lastWeek.Count(j => j.Subject == subject);
            var lastWeekNode = new TreeViewItem
            {
                Header = $"上周 ({lastWeekCount} 次)",
                Foreground = new SolidColorBrush(Color.FromRgb(248, 242, 233))
            };
            var lastWeekJobs = lastWeek.Where(j => j.Subject == subject).ToList();
            AddJobNodes(lastWeekNode, lastWeekJobs);
            subjectNode.Items.Add(lastWeekNode);

            parent.Items.Add(subjectNode);
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

        private List<JobSession> GetThisWeekJobs()
        {
            var monday = StartOfWeek(DateTime.Today);
            var sunday = monday.AddDays(6);

            return JobManager.GetJobsByDateRange(monday, sunday.AddDays(1).AddTicks(-1));
        }

        private List<JobSession> GetLastWeekJobs()
        {
            var lastMonday = StartOfWeek(DateTime.Today).AddDays(-7);
            var lastSunday = lastMonday.AddDays(6);

            return JobManager.GetJobsByDateRange(lastMonday, lastSunday.AddDays(1).AddTicks(-1));
        }

        private static DateTime StartOfWeek(DateTime date)
        {
            int weekday = (int)date.DayOfWeek;
            int offset = weekday == 0 ? -6 : DayOfWeek.Monday - date.DayOfWeek;
            return date.Date.AddDays(offset);
        }

        private Dictionary<string, List<JobSession>> GetExternalJobs(List<JobSession> thisWeek, List<JobSession> lastWeek)
        {
            var allJobs = thisWeek.Concat(lastWeek)
                .Where(j => j.Subject != "语文" && j.Subject != "数学" && j.Subject != "英语")
                .ToList();
            return allJobs.GroupBy(j => j.Subject).ToDictionary(g => g.Key, g => g.ToList());
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

            const double padding = 10;
            double draftWidth = Math.Max(200, DraftHost.ActualWidth - padding * 2);
            double draftHeight = Math.Max(
                200,
                HomeworkContainer?.ActualHeight > 0
                    ? HomeworkContainer.ActualHeight * _currentScale
                    : DraftHost.ActualHeight - padding * 2);

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
            double draftWidth = Math.Max(200, DraftHost.ActualWidth > 0 ? DraftHost.ActualWidth - 20 : 500);
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
                _inkManager.SetPenColor(_currentColor);
                _inkManager.SetPenWidth(_currentPenWidth);

                UpdatePageInfo();
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
                _inkManager?.SetPenColor(_currentColor);
                _inkManager?.SetPenWidth(_currentPenWidth);
                UpdatePageInfo();
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
                _inkManager.SetPenColor(_currentColor);
                _inkManager.SetPenWidth(_currentPenWidth);
                UpdatePageInfo();
            }
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
        }

        private void DraftGrid_SizeChanged(object sender, SizeChangedEventArgs e)
        {
            UpdateDraftCanvasToViewport();
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
                SaveCurrentPageInk();
                JobManager.SaveJob(_job!);
            });
        }

        private void UpdatePageInfo()
        {
            int pageCount = EffectivePageCount();
            TxtPageInfo.Text = $"第 {_currentPageIndex + 1} / {pageCount} 页";
            BtnPrevPage.IsEnabled = _currentPageIndex > 0;
            BtnNextPage.IsEnabled = _currentPageIndex < pageCount - 1;
        }

        private void BtnBack_Click(object sender, RoutedEventArgs e)
        {
            SaveCurrentPageInk();
            JobManager.SaveJob(_job!);
            NavigationService?.GoBack();
        }

        private async void BtnPrevPage_Click(object sender, RoutedEventArgs e)
        {
            if (_currentPageIndex > 0)
            {
                await LoadPageAsync(_currentPageIndex - 1);
            }
        }

        private async void BtnNextPage_Click(object sender, RoutedEventArgs e)
        {
            if (_currentPageIndex < EffectivePageCount() - 1)
            {
                await LoadPageAsync(_currentPageIndex + 1);
            }
        }

        private void BtnPen_Click(object sender, RoutedEventArgs e)
        {
            _inkManager?.SetTool(InkManager.ToolMode.Pen);
            _inkManager?.SetPenColor(_currentColor);
            _inkManager?.SetPenWidth(_currentPenWidth);

            _draftInkManager?.SetTool(InkManager.ToolMode.Pen);
            _draftInkManager?.SetPenColor(_currentColor);
            _draftInkManager?.SetPenWidth(_currentPenWidth);

            UpdateColorSelectorVisual();
        }

        private void BtnEraser_Click(object sender, RoutedEventArgs e)
        {
            _inkManager?.SetTool(InkManager.ToolMode.Eraser);
            _draftInkManager?.SetTool(InkManager.ToolMode.Eraser);
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

        private void ApplyZoom()
        {
            // 作业区使用 Viewbox 缩放
            HomeworkViewbox.Stretch = Stretch.Uniform;
            HomeworkContainer.RenderTransform = new ScaleTransform(_currentScale, _currentScale);
            HomeworkContainer.RenderTransformOrigin = new Point(0, 0);
            UpdateDraftCanvasToViewport();

            TxtZoom.Text = $"{(int)(_currentScale * 100)}%";
        }

        private void ScrollViewer_PreviewMouseWheel(object sender, MouseWheelEventArgs e)
        {
            if (Keyboard.Modifiers.HasFlag(ModifierKeys.Control))
            {
                e.Handled = true;
                if (e.Delta > 0)
                {
                    ZoomIn_Click(sender, e);
                }
                else
                {
                    ZoomOut_Click(sender, e);
                }
            }
        }

        private void DraftScrollViewer_PreviewMouseWheel(object sender, MouseWheelEventArgs e)
        {
            if (Keyboard.Modifiers.HasFlag(ModifierKeys.Control))
            {
                e.Handled = true;
                if (e.Delta > 0)
                {
                    ZoomIn_Click(sender, e);
                }
                else
                {
                    ZoomOut_Click(sender, e);
                }
            }
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
            _isLeftPanelCollapsed = !_isLeftPanelCollapsed;

            if (_isLeftPanelCollapsed)
            {
                LeftColumn.Width = new GridLength(0);
                LeftPanel.Visibility = Visibility.Collapsed;
                BtnExpandLeft.Content = "◀";
                BtnExpandLeft.ToolTip = "展开作业助手";
            }
            else
            {
                LeftColumn.Width = new GridLength(200);
                LeftPanel.Visibility = Visibility.Visible;
                BtnExpandLeft.Content = "▶";
                BtnExpandLeft.ToolTip = "收缩作业助手";
            }
        }

        private void BtnMenu_Click(object sender, RoutedEventArgs e)
        {
            // Show context menu with additional options
            var menu = new ContextMenu();
            menu.Items.Add(new MenuItem { Header = "草稿纸", Tag = "draft" });
            menu.Items.Add(new MenuItem { Header = "历史作业", Tag = "history" });
            menu.Items.Add(new MenuItem { Header = "设置", Tag = "settings" });
            menu.Items.Add(new Separator());
            menu.Items.Add(new MenuItem { Header = "导入作业", Tag = "import" });
            menu.Items.Add(new MenuItem { Header = "导出作业", Tag = "export" });
            menu.Items.Add(new Separator());
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

        private void MenuItem_Click(object? sender, RoutedEventArgs e)
        {
            if (sender is MenuItem menuItem && menuItem.Tag is string action)
            {
                switch (action)
                {
                    case "draft":
                        MessageBox.Show("草稿纸功能已启用，显示在右侧区域。", "提示", MessageBoxButton.OK, MessageBoxImage.Information);
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
                    case "export":
                        MessageBox.Show("导出功能开发中...", "提示", MessageBoxButton.OK, MessageBoxImage.Information);
                        break;
                    case "delete":
                        var result = MessageBox.Show($"确定要删除作业《{ _job.Subject}》吗？", "确认删除", MessageBoxButton.YesNo, MessageBoxImage.Warning);
                        if (result == MessageBoxResult.Yes)
                        {
                            JobManager.DeleteJob(_job.JobId);
                            NavigationService?.Navigate(new HomePage());
                        }
                        break;
                }
            }
        }

        private async void BtnPrint_Click(object sender, RoutedEventArgs e)
        {
            // Save current state first
            SaveCurrentPageInk();
            JobManager.SaveJob(_job!);

            // Show print confirmation
            var result = MessageBox.Show(
                $"将要打印 {_job.TotalPages} 页作业，确定继续？",
                "打印确认",
                MessageBoxButton.YesNo,
                MessageBoxImage.Question);

            if (result != MessageBoxResult.Yes)
                return;

            try
            {
                await PrintJobAsync();
                _job.IsPrinted = true;
                JobManager.SaveJob(_job!);
            }
            catch (Exception ex)
            {
                MessageBox.Show($"打印失败：{ex.Message}", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private async Task PrintJobAsync()
        {
            var printDialog = new PrintDialog();
            if (printDialog.ShowDialog() != true)
                return;

            var printQueue = printDialog.PrintQueue;

            // Create print document
            var document = new HomeworkPrintDocument(_job, _documentService);

            // Print
            document.Print(printQueue);

            MessageBox.Show("已发送到打印机", "打印完成", MessageBoxButton.OK, MessageBoxImage.Information);
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
                MainInkCanvas.Strokes.StrokesChanged -= InkCanvas_StrokesChanged;
                DraftInkCanvas.Strokes.StrokesChanged -= DraftInkCanvas_StrokesChanged;
                _saveDebouncer?.Dispose();
                _documentService?.Dispose();
                _disposed = true;
            }
        }
    }
}
