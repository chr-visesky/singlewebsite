using System;
using System.Windows;

namespace HomeworkApp.Views
{
    public partial class EditorPage
    {
        private void ShowNewHomeworkDialog(
            string subject,
            DateTime date,
            string? bucket,
            bool appendPageIfExisting)
        {
            var dialog = new NewHomeworkDialog(subject, date)
            {
                Owner = Window.GetWindow(this)
            };
            if (dialog.ShowDialog() != true)
            {
                return;
            }

            try
            {
                SaveCurrentPageInk();
                JobManager.SaveJob(_job);
                var job = JobManager.CreateBlankJob(
                    dialog.SelectedSubject,
                    date,
                    bucket,
                    string.IsNullOrWhiteSpace(dialog.EnteredTitle) ? null : dialog.HomeworkTitle,
                    appendPageIfExisting);
                LoadSelectedJob(job);
            }
            catch (Exception ex)
            {
                MessageBox.Show($"创建作业失败：{ex.Message}", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }
    }
}
