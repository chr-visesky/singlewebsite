using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using Microsoft.Win32;

namespace HomeworkApp.Views
{
    public partial class ImportPage : Page
    {
        private sealed class SelectedFileItem
        {
            public SelectedFileItem(string fullPath)
            {
                FullPath = fullPath;
                FileName = Path.GetFileName(fullPath);
            }

            public string FullPath { get; }
            public string FileName { get; }
        }

        private readonly string _subject;
        private readonly List<string> _selectedFiles = new();

        public ImportPage(string subject)
        {
            InitializeComponent();
            _subject = subject;
            TxtSubject.Text = $"{_subject} - 导入作业";
        }

        private void BtnBack_Click(object sender, RoutedEventArgs e)
        {
            NavigationService?.GoBack();
        }

        private void DropZone_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            SelectFiles();
        }

        private void BtnSelectFile_Click(object sender, RoutedEventArgs e)
        {
            SelectFiles();
        }

        private void BtnBlankHomework_Click(object sender, RoutedEventArgs e)
        {
            try
            {
                var job = JobManager.CreateBlankJob(_subject);
                NavigationService?.Navigate(new EditorPage(job));
            }
            catch (Exception ex)
            {
                MessageBox.Show(ex.Message, "创建失败", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private void SelectFiles()
        {
            var openFileDialog = new OpenFileDialog
            {
                Filter = "作业文件 (PDF;JPG;PNG;BMP;GIF)|*.pdf;*.jpg;*.jpeg;*.png;*.bmp;*.gif|所有文件 (*.*)|*.*",
                Multiselect = true,
                Title = "选择作业文件"
            };

            if (openFileDialog.ShowDialog() == true)
            {
                TryAddFiles(openFileDialog.FileNames);
            }
        }

        private void Page_Drop(object sender, DragEventArgs e)
        {
            if (e.Data.GetDataPresent(DataFormats.FileDrop))
            {
                var files = (string[])e.Data.GetData(DataFormats.FileDrop);
                TryAddFiles(files);
            }
        }

        private void UpdateFileList()
        {
            if (_selectedFiles.Count > 0)
            {
                DropZone.Visibility = Visibility.Collapsed;
                FileListPanel.Visibility = Visibility.Visible;
                TxtFiles.Text = $"已选择 {_selectedFiles.Count} 个文件";
                LstFiles.ItemsSource = null;
                LstFiles.ItemsSource = _selectedFiles.Select((file) => new SelectedFileItem(file)).ToList();
            }
            else
            {
                TxtFiles.Text = "已选择 0 个文件";
                LstFiles.ItemsSource = null;
            }
        }

        private void BtnRemoveFile_Click(object sender, RoutedEventArgs e)
        {
            if (sender is Button btn && btn.Tag is string fullPath)
            {
                if (_selectedFiles.Remove(fullPath))
                {
                    UpdateFileList();

                    if (_selectedFiles.Count == 0)
                    {
                        DropZone.Visibility = Visibility.Visible;
                        FileListPanel.Visibility = Visibility.Collapsed;
                    }
                }
            }
        }

        private void BtnStartHomework_Click(object sender, RoutedEventArgs e)
        {
            if (_selectedFiles.Count == 0)
            {
                MessageBox.Show("请先选择作业文件", "提示", MessageBoxButton.OK, MessageBoxImage.Information);
                return;
            }

            try
            {
                var job = JobManager.CreateJob(_subject, _selectedFiles);
                NavigationService?.Navigate(new EditorPage(job));
            }
            catch (Exception ex)
            {
                MessageBox.Show(ex.Message, "导入失败", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private void TryAddFiles(IEnumerable<string> files)
        {
            var incoming = files
                .Where(IsSupportedFile)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            if (incoming.Count == 0)
            {
                MessageBox.Show("请选择 PDF 或图片文件。", "提示", MessageBoxButton.OK, MessageBoxImage.Information);
                return;
            }

            bool currentHasPdf = _selectedFiles.Any(IsPdfFile);
            bool incomingHasPdf = incoming.Any(IsPdfFile);

            if (currentHasPdf && incoming.Any())
            {
                MessageBox.Show("当前已选择 PDF。请先清空当前选择后再添加其他文件。", "提示", MessageBoxButton.OK, MessageBoxImage.Information);
                return;
            }

            if (incomingHasPdf)
            {
                if (_selectedFiles.Count > 0 || incoming.Count != 1)
                {
                    MessageBox.Show("一次只能导入一个 PDF 作业文件，且不能与图片混选。", "提示", MessageBoxButton.OK, MessageBoxImage.Information);
                    return;
                }
            }

            if (_selectedFiles.Any(IsPdfFile) && incoming.Any(IsImageFile))
            {
                MessageBox.Show("PDF 作业和图片作业不能混合导入。", "提示", MessageBoxButton.OK, MessageBoxImage.Information);
                return;
            }

            foreach (var file in incoming)
            {
                if (!_selectedFiles.Contains(file, StringComparer.OrdinalIgnoreCase))
                {
                    _selectedFiles.Add(file);
                }
            }

            UpdateFileList();
        }

        private static bool IsSupportedFile(string path)
        {
            return IsPdfFile(path) || IsImageFile(path);
        }

        private static bool IsPdfFile(string path)
        {
            return string.Equals(Path.GetExtension(path), ".pdf", StringComparison.OrdinalIgnoreCase);
        }

        private static bool IsImageFile(string path)
        {
            string ext = Path.GetExtension(path).ToLowerInvariant();
            return ext is ".jpg" or ".jpeg" or ".png" or ".bmp" or ".gif";
        }
    }
}
