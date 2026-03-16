using System.Windows;
using System.Windows.Controls;

namespace HomeworkApp.Views
{
    public partial class SubjectPage : Page
    {
        public SubjectPage()
        {
            InitializeComponent();
        }

        private void BtnBack_Click(object sender, RoutedEventArgs e)
        {
            NavigationService?.GoBack();
        }

        private void BtnChinese_Click(object sender, RoutedEventArgs e)
        {
            NavigationService?.Navigate(new ImportPage("语文"));
        }

        private void BtnMath_Click(object sender, RoutedEventArgs e)
        {
            NavigationService?.Navigate(new ImportPage("数学"));
        }

        private void BtnEnglish_Click(object sender, RoutedEventArgs e)
        {
            NavigationService?.Navigate(new ImportPage("英语"));
        }
    }
}
