using System;
using System.Collections.Generic;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Media;

namespace HomeworkApp.Views
{
    public sealed class NewHomeworkDialog : Window
    {
        private readonly ComboBox _subjectBox;
        private readonly TextBox _titleBox;
        private readonly DateTime _date;

        public NewHomeworkDialog(string initialSubject, DateTime date)
        {
            _date = date.Date;
            Title = "新建作业";
            Width = 420;
            Height = 330;
            WindowStartupLocation = WindowStartupLocation.CenterOwner;
            ResizeMode = ResizeMode.NoResize;
            Background = new SolidColorBrush(Color.FromRgb(17, 24, 32));
            Foreground = Brushes.White;

            var root = new StackPanel { Margin = new Thickness(24) };
            root.Children.Add(new TextBlock
            {
                Text = "新建作业页面",
                FontSize = 22,
                FontWeight = FontWeights.SemiBold,
                Margin = new Thickness(0, 0, 0, 18)
            });
            root.Children.Add(CreateLabel("科目"));

            _subjectBox = new ComboBox
            {
                IsEditable = true,
                ItemsSource = new List<string> { "语文", "数学", "英语", "物理", "化学", "生物", "历史", "地理", "政治" },
                Text = string.IsNullOrWhiteSpace(initialSubject) || initialSubject == "作业" ? "语文" : initialSubject.Trim(),
                Margin = new Thickness(0, 6, 0, 14),
                Padding = new Thickness(8, 6, 8, 6)
            };
            AutomationProperties.SetAutomationId(_subjectBox, "NewHomeworkSubject");
            root.Children.Add(_subjectBox);

            root.Children.Add(CreateLabel("名称（可不填）"));
            _titleBox = new TextBox
            {
                Margin = new Thickness(0, 6, 0, 4),
                Padding = new Thickness(8, 7, 8, 7)
            };
            AutomationProperties.SetAutomationId(_titleBox, "NewHomeworkTitle");
            root.Children.Add(_titleBox);
            root.Children.Add(new TextBlock
            {
                Text = $"留空时自动命名为：{_date:yyyy-MM-dd} + 科目",
                Foreground = new SolidColorBrush(Color.FromRgb(166, 192, 207)),
                FontSize = 12,
                Margin = new Thickness(0, 0, 0, 18)
            });

            var footer = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                HorizontalAlignment = HorizontalAlignment.Right
            };
            footer.Children.Add(new Button
            {
                Content = "取消",
                IsCancel = true,
                MinWidth = 88,
                Padding = new Thickness(14, 8, 14, 8),
                Margin = new Thickness(0, 0, 8, 0)
            });
            var createButton = new Button
            {
                Content = "创建页面",
                IsDefault = true,
                MinWidth = 108,
                Padding = new Thickness(14, 8, 14, 8)
            };
            createButton.Click += CreateButton_Click;
            AutomationProperties.SetAutomationId(createButton, "ConfirmNewHomework");
            footer.Children.Add(createButton);
            root.Children.Add(footer);

            Content = root;
        }

        public string SelectedSubject => (_subjectBox.Text ?? string.Empty).Trim();

        public string EnteredTitle => (_titleBox.Text ?? string.Empty).Trim();

        public string HomeworkTitle => JobManager.NormalizeJobTitle(_titleBox.Text, _date, SelectedSubject);

        private static TextBlock CreateLabel(string text)
        {
            return new TextBlock { Text = text, FontSize = 14, FontWeight = FontWeights.SemiBold };
        }

        private void CreateButton_Click(object sender, RoutedEventArgs e)
        {
            if (string.IsNullOrWhiteSpace(SelectedSubject))
            {
                MessageBox.Show("请选择或输入科目。", "无法创建", MessageBoxButton.OK, MessageBoxImage.Information);
                _subjectBox.Focus();
                return;
            }

            DialogResult = true;
            Close();
        }
    }
}
