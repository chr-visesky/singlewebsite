using System.Linq;
using System.Windows;
using DictationApp.Models;

namespace DictationApp.Views;

public partial class SessionSettingsWindow : Window
{
    public SessionSettingsWindow(DictationSessionSettings settings)
    {
        InitializeComponent();
        RepeatCountComboBox.ItemsSource = new[] { 1, 2, 3, 4 };
        WriteSecondsComboBox.ItemsSource = Enumerable.Range(2, 19).ToArray();
        RepeatCountComboBox.SelectedItem = settings.RepeatCount;
        WriteSecondsComboBox.SelectedItem = settings.WriteSeconds;
    }

    public DictationSessionSettings BuildSettings()
    {
        return new DictationSessionSettings
        {
            RepeatCount = RepeatCountComboBox.SelectedItem is int repeatCount ? repeatCount : 2,
            WriteSeconds = WriteSecondsComboBox.SelectedItem is int writeSeconds ? writeSeconds : 6
        };
    }

    private void SaveButton_OnClick(object sender, RoutedEventArgs e)
    {
        DialogResult = true;
    }

    private void CancelButton_OnClick(object sender, RoutedEventArgs e)
    {
        DialogResult = false;
    }
}
