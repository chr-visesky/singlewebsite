using System;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using HomeworkApp.Models;

namespace HomeworkApp.Views
{
    public partial class HistoryPage : Page
    {
        public HistoryPage()
        {
            InitializeComponent();
            LoadJobs();
        }

        private void LoadJobs()
        {
            var cutoff = DateTime.Today.AddDays(-13);
            var jobs = JobManager.GetAllJobs()
                .Where(job => job.CreateTime.Date < cutoff)
                .ToList();
            LstJobs.ItemsSource = jobs;
            EmptyState.Visibility = jobs.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        }

        private void BtnBack_Click(object sender, RoutedEventArgs e)
        {
            NavigationService?.GoBack();
        }

        private void BtnContinue_Click(object sender, RoutedEventArgs e)
        {
            if (sender is Button btn && btn.Tag is string jobId)
            {
                var job = JobManager.LoadJob(jobId);
                if (job != null)
                {
                    NavigationService?.Navigate(new EditorPage(job));
                }
                else
                {
                    MessageBox.Show("作业加载失败", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
                }
            }
        }

        private void BtnDelete_Click(object sender, RoutedEventArgs e)
        {
            if (sender is Button btn && btn.Tag is string jobId)
            {
                var result = MessageBox.Show(
                    "确定要删除这个作业吗？删除后无法恢复。",
                    "确认删除",
                    MessageBoxButton.YesNo,
                    MessageBoxImage.Warning);

                if (result == MessageBoxResult.Yes)
                {
                    JobManager.DeleteJob(jobId);
                    LoadJobs();
                }
            }
        }
    }
}
