using System;
using System.Diagnostics;
using System.Linq;
using System.Printing;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using HomeworkApp.Services;

namespace HomeworkApp.Views
{
    public partial class SettingsPage : Page
    {
        private const string LoadingPrintersText = "正在读取打印机...";
        private const string PrinterLoadFailedText = "未能读取打印机列表";
        private string _storagePath;
        private readonly AppSettings _settings = AppSettingsStore.Load();
        private bool _isInitializing = true;
        private bool _isLoadingPrinters;

        public SettingsPage()
        {
            InitializeComponent();
            _storagePath = System.IO.Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "HomeworkApp");
            TxtStoragePath.Text = _storagePath;
            CmbPrinters.ItemsSource = new[] { LoadingPrintersText };
            CmbPrinters.SelectedIndex = 0;
            ApplySavedPaperSize();
            Loaded += SettingsPage_Loaded;
            _isInitializing = false;
        }

        private void BtnBack_Click(object sender, RoutedEventArgs e)
        {
            NavigationService?.GoBack();
        }

        private void CmbPrinters_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (_isInitializing || _isLoadingPrinters)
            {
                return;
            }

            if (CmbPrinters.SelectedItem is string printerName && printerName != LoadingPrintersText && printerName != PrinterLoadFailedText)
            {
                _settings.DefaultPrinterName = printerName;
                AppSettingsStore.Save(_settings);
            }
        }

        private void CmbPaperSize_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (_isInitializing)
            {
                return;
            }

            if (CmbPaperSize.SelectedItem is ComboBoxItem item && item.Content is string paperSize)
            {
                _settings.PaperSize = paperSize;
                AppSettingsStore.Save(_settings);
            }
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

        private async void SettingsPage_Loaded(object sender, RoutedEventArgs e)
        {
            Loaded -= SettingsPage_Loaded;
            await LoadPrintersAsync();
        }

        private async Task LoadPrintersAsync()
        {
            try
            {
                _isLoadingPrinters = true;
                var printerState = await Task.Run(() =>
                {
                    var server = new LocalPrintServer();
                    var queues = server.GetPrintQueues()
                        .Select((queue) => queue.Name)
                        .OrderBy((name) => name, StringComparer.CurrentCultureIgnoreCase)
                        .ToList();
                    var defaultQueueName = server.DefaultPrintQueue?.Name;
                    return (queues, defaultQueueName);
                });

                CmbPrinters.ItemsSource = printerState.queues;

                if (printerState.queues.Count == 0)
                {
                    CmbPrinters.IsEnabled = false;
                    return;
                }

                CmbPrinters.SelectedItem =
                    !string.IsNullOrWhiteSpace(_settings.DefaultPrinterName) && printerState.queues.Contains(_settings.DefaultPrinterName)
                        ? _settings.DefaultPrinterName
                        : !string.IsNullOrWhiteSpace(printerState.defaultQueueName) && printerState.queues.Contains(printerState.defaultQueueName)
                            ? printerState.defaultQueueName
                            : printerState.queues[0];
            }
            catch
            {
                CmbPrinters.ItemsSource = new[] { PrinterLoadFailedText };
                CmbPrinters.SelectedIndex = 0;
                CmbPrinters.IsEnabled = false;
            }
            finally
            {
                _isLoadingPrinters = false;
            }
        }

        private void ApplySavedPaperSize()
        {
            foreach (var item in CmbPaperSize.Items.OfType<ComboBoxItem>())
            {
                if (string.Equals(item.Content as string, _settings.PaperSize, StringComparison.OrdinalIgnoreCase))
                {
                    CmbPaperSize.SelectedItem = item;
                    return;
                }
            }

            if (CmbPaperSize.Items.Count > 0)
            {
                CmbPaperSize.SelectedIndex = 0;
            }
        }
    }
}
