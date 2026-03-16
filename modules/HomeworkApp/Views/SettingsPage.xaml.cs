using System;
using System.Diagnostics;
using System.Linq;
using System.Printing;
using System.Windows;
using System.Windows.Controls;

namespace HomeworkApp.Views
{
    public partial class SettingsPage : Page
    {
        private string _storagePath;

        public SettingsPage()
        {
            InitializeComponent();
            _storagePath = System.IO.Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "HomeworkApp");
            TxtStoragePath.Text = _storagePath;
            LoadPrinters();
        }

        private void BtnBack_Click(object sender, RoutedEventArgs e)
        {
            NavigationService?.GoBack();
        }

        private void CmbPrinters_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            // Printer selection uses Windows default
        }

        private void CmbPaperSize_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            // Paper size preference saved for future print jobs
        }

        private void BtnOpenStorage_Click(object sender, RoutedEventArgs e)
        {
            try
            {
                System.IO.Directory.CreateDirectory(_storagePath);
                Process.Start("explorer.exe", _storagePath);
            }
            catch (Exception ex)
            {
                MessageBox.Show($"无法打开文件夹：{ex.Message}", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private void LoadPrinters()
        {
            try
            {
                var server = new LocalPrintServer();
                var queues = server.GetPrintQueues()
                    .Select((queue) => queue.Name)
                    .OrderBy((name) => name, StringComparer.CurrentCultureIgnoreCase)
                    .ToList();

                CmbPrinters.ItemsSource = queues;

                if (queues.Count == 0)
                {
                    CmbPrinters.IsEnabled = false;
                    return;
                }

                var defaultQueueName = server.DefaultPrintQueue?.Name;
                CmbPrinters.SelectedItem =
                    !string.IsNullOrWhiteSpace(defaultQueueName) && queues.Contains(defaultQueueName)
                        ? defaultQueueName
                        : queues[0];
            }
            catch
            {
                CmbPrinters.ItemsSource = new[] { "未能读取打印机列表" };
                CmbPrinters.SelectedIndex = 0;
                CmbPrinters.IsEnabled = false;
            }
        }
    }
}
