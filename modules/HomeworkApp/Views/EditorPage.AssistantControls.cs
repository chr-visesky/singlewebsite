using System;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using HomeworkApp.Services;

namespace HomeworkApp.Views
{
    public partial class EditorPage
    {
        private const double AssistantPanelExpandedWidth = 200;
        private const double MinimumPaperScale = 1.0;
        private const double PaperScaleStep = 0.05;

        private readonly StudyGateHomeworkSyncService _homeworkSyncService = new();
        private bool _assistantPanelCollapsed;
        private bool _homeworkSyncInProgress;

        private void ZoomIn_Click(object sender, RoutedEventArgs e)
        {
            AdjustPaperZoom(1);
        }

        private void ZoomOut_Click(object sender, RoutedEventArgs e)
        {
            AdjustPaperZoom(-1);
        }

        private void BtnExpandLeft_Click(object sender, RoutedEventArgs e)
        {
            SetAssistantPanelCollapsed(!_assistantPanelCollapsed);
        }

        private void BtnMenu_Click(object sender, RoutedEventArgs e)
        {
            var menu = new ContextMenu();
            menu.Items.Add(CreateMenuItem("同步云端作业", "sync"));
            menu.Items.Add(CreateMenuItem("历史作业", "history"));
            menu.Items.Add(CreateMenuItem("设置", "settings"));

            foreach (var item in menu.Items)
            {
                if (item is MenuItem menuItem)
                {
                    menuItem.Click += MenuItem_Click;
                }
            }

            menu.PlacementTarget = BtnMenu;
            menu.IsOpen = true;
        }

        private async void MenuItem_Click(object? sender, RoutedEventArgs e)
        {
            if (sender is not MenuItem menuItem || menuItem.Tag is not string action)
            {
                return;
            }

            switch (action)
            {
                case "sync":
                    await SyncHomeworkFromCloudAsync();
                    break;
                case "history":
                    FlushPendingChanges();
                    NavigationService?.Navigate(new HistoryPage());
                    break;
                case "settings":
                    FlushPendingChanges();
                    NavigationService?.Navigate(new SettingsPage());
                    break;
            }
        }

        private static MenuItem CreateMenuItem(string header, string action)
        {
            var item = new MenuItem
            {
                Header = header,
                Tag = action
            };
            return item;
        }

        private async Task SyncHomeworkFromCloudAsync()
        {
            if (_homeworkSyncInProgress)
            {
                return;
            }

            _homeworkSyncInProgress = true;

            try
            {
                FlushPendingChanges();
                var result = await _homeworkSyncService.SyncAsync();
                SetupHomeworkTree();
                LoadDocument(skipSaveCurrentPage: true);
                MessageBox.Show(
                    string.IsNullOrWhiteSpace(result.Message)
                        ? "云端作业同步完成。"
                        : result.Message,
                    "作业同步",
                    MessageBoxButton.OK,
                    MessageBoxImage.Information);
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    $"作业同步失败：{ex.Message}",
                    "作业同步",
                    MessageBoxButton.OK,
                    MessageBoxImage.Warning);
            }
            finally
            {
                _homeworkSyncInProgress = false;
            }
        }

        private void AdjustPaperZoom(int step, ScrollViewer? anchorViewer = null, Point? anchorPoint = null)
        {
            if (step == 0)
            {
                return;
            }

            _currentScale = NormalizePaperScale(_currentScale + (step * PaperScaleStep), GetMaximumScale());
            ApplyZoom(anchorViewer, anchorPoint);
        }

        private static double NormalizePaperScale(double scale, double maximumScale)
        {
            double clamped = Math.Max(MinimumPaperScale, Math.Min(scale, Math.Max(MinimumPaperScale, maximumScale)));
            double stepped = Math.Round(clamped / PaperScaleStep, MidpointRounding.AwayFromZero) * PaperScaleStep;
            return Math.Max(MinimumPaperScale, Math.Min(stepped, Math.Max(MinimumPaperScale, maximumScale)));
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
                - AssistantPanelExpandedWidth
                - 8;

            if (availableWidth <= 0 || baseWidth <= 0)
            {
                return 1.0;
            }

            return Math.Max(1.0, availableWidth / baseWidth);
        }

        private void SetAssistantPanelCollapsed(bool collapsed)
        {
            _assistantPanelCollapsed = collapsed;
            LeftColumn.Width = collapsed ? new GridLength(0) : new GridLength(AssistantPanelExpandedWidth);
            LeftPanel.Visibility = collapsed ? Visibility.Collapsed : Visibility.Visible;
            BtnExpandLeft.Visibility = Visibility.Visible;
            BtnExpandLeft.Content = collapsed ? "▶" : "◀";
            BtnExpandLeft.ToolTip = collapsed ? "展开作业助手" : "收起作业助手";
            ApplyZoom();
        }
    }
}
