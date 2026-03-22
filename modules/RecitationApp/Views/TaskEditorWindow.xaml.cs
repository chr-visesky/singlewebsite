using System;
using System.Windows;
using System.Windows.Controls;
using RecitationApp.Models;

namespace RecitationApp.Views;

public partial class TaskEditorWindow : Window
{
    public TaskEditorWindow(RecitationTask? task = null)
    {
        InitializeComponent();
        TargetDatePicker.SelectedDate = task?.TargetDate.Date ?? DateTime.Today;

        if (task is null)
        {
            return;
        }

        TitleTextBox.Text = task.Title;
        SourceTextBox.Text = task.SourceText;
        SelectComboItem(BucketComboBox, task.Bucket);
    }

    public RecitationTask BuildTask(string? taskId = null, DateTime? createdAt = null)
    {
        return new RecitationTask
        {
            TaskId = taskId ?? string.Empty,
            Title = TitleTextBox.Text,
            Bucket = ComboText(BucketComboBox),
            TargetDate = TargetDatePicker.SelectedDate ?? DateTime.Today,
            SourceText = SourceTextBox.Text,
            CreatedAt = createdAt ?? default
        };
    }

    private static void SelectComboItem(ComboBox comboBox, string value)
    {
        foreach (ComboBoxItem item in comboBox.Items)
        {
            if (string.Equals(item.Content?.ToString(), value, StringComparison.OrdinalIgnoreCase))
            {
                comboBox.SelectedItem = item;
                return;
            }
        }
    }

    private static string ComboText(ComboBox comboBox)
    {
        return (comboBox.SelectedItem as ComboBoxItem)?.Content?.ToString() ?? string.Empty;
    }

    private void SaveButton_OnClick(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrWhiteSpace(SourceTextBox.Text))
        {
            MessageBox.Show(this, "背诵任务必须有原文。", "无法保存", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        DialogResult = true;
    }

    private void CancelButton_OnClick(object sender, RoutedEventArgs e)
    {
        DialogResult = false;
    }
}
