using System.Windows;
using System.Windows.Controls;

namespace HomeworkApp.Views
{
    public partial class HomePage : Page
    {
        public HomePage()
        {
            InitializeComponent();
            CheckForLastJob();
        }

        private void CheckForLastJob()
        {
            var lastJob = JobManager.GetLastJob();
            if (lastJob == null)
            {
                BtnContinueHomework.IsEnabled = false;
                BtnContinueHomework.Opacity = 0.5;
            }
        }

        private void BtnNewHomework_Click(object sender, RoutedEventArgs e)
        {
            NavigationService?.Navigate(new SubjectPage());
        }

        private void BtnContinueHomework_Click(object sender, RoutedEventArgs e)
        {
            var lastJob = JobManager.GetLastJob();
            if (lastJob != null)
            {
                NavigationService?.Navigate(new EditorPage(lastJob));
            }
        }

        private void BtnHistory_Click(object sender, RoutedEventArgs e)
        {
            NavigationService?.Navigate(new HistoryPage());
        }

        private void BtnSettings_Click(object sender, RoutedEventArgs e)
        {
            NavigationService?.Navigate(new SettingsPage());
        }
    }
}
