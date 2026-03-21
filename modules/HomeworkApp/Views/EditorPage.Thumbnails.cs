using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using HomeworkApp.Models;
using Microsoft.Win32;

namespace HomeworkApp.Views
{
    public partial class EditorPage
    {
        private bool CanDeleteCurrentThumbnailPage()
        {
            return EffectivePageCount() > 1;
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
            if (CanDeleteCurrentThumbnailPage())
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

            if (FindAncestor<Button>(e.OriginalSource as DependencyObject) != null)
            {
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

        private async void ThumbnailDeleteButton_Click(object sender, RoutedEventArgs e)
        {
            if (sender is not Button button || button.Tag is not int pageIndex || !CanDeleteCurrentThumbnailPage())
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
                StopPendingSaveDebounce();
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

        private static T? FindAncestor<T>(DependencyObject? source)
            where T : DependencyObject
        {
            var current = source;
            while (current != null)
            {
                if (current is T match)
                {
                    return match;
                }

                current = VisualTreeHelper.GetParent(current);
            }

            return null;
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
    }
}
