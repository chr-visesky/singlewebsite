using System;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using DictationApp.Models;

namespace DictationApp.Views;

public partial class TaskEditorWindow : Window
{
    public TaskEditorWindow(DictationTask? task = null)
    {
        InitializeComponent();
        TargetDatePicker.SelectedDate = task?.TargetDate.Date ?? DateTime.Today;

        if (task is null)
        {
            return;
        }

        TitleTextBox.Text = task.Title;
        SelectComboItem(SubjectComboBox, task.Subject);
        SelectComboItem(BucketComboBox, task.Bucket);
        SelectComboItem(LanguageComboBox, task.Language);
        ItemsTextBox.Text = string.Join(Environment.NewLine, task.Items.Select(item => item.Text));
    }

    public DictationTask BuildTask(string? taskId = null, DateTime? createdAt = null)
    {
        return new DictationTask
        {
            TaskId = taskId ?? string.Empty,
            Title = TitleTextBox.Text,
            Subject = ComboText(SubjectComboBox),
            Bucket = ComboText(BucketComboBox),
            TargetDate = TargetDatePicker.SelectedDate ?? DateTime.Today,
            Language = ComboText(LanguageComboBox),
            CreatedAt = createdAt ?? default,
            Items = ItemsTextBox.Text
                .Split(new[] { "\r\n", "\n" }, StringSplitOptions.RemoveEmptyEntries)
                .Select(item => new DictationTaskItem
                {
                    Text = item.Trim()
                })
                .Where(item => !string.IsNullOrWhiteSpace(item.Text))
                .ToList()
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
        if (string.IsNullOrWhiteSpace(ItemsTextBox.Text))
        {
            MessageBox.Show(this, "至少要有 1 条听写内容。", "无法保存", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        DialogResult = true;
    }

    private void CancelButton_OnClick(object sender, RoutedEventArgs e)
    {
        DialogResult = false;
    }
}
