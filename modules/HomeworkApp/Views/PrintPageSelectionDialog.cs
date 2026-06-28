using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Media;

namespace HomeworkApp.Views
{
    public sealed class PrintPageSelectionDialog : Window
    {
        private readonly List<CheckBox> _pageCheckBoxes = new();
        private readonly Button _printButton;

        public PrintPageSelectionDialog(int pageCount, int currentPageIndex)
        {
            Title = "选择打印页面";
            Width = 420;
            Height = 560;
            MinWidth = 360;
            MinHeight = 420;
            WindowStartupLocation = WindowStartupLocation.CenterOwner;
            ResizeMode = ResizeMode.CanResize;
            Background = new SolidColorBrush(Color.FromRgb(17, 24, 32));
            Foreground = Brushes.White;

            var root = new Grid { Margin = new Thickness(20) };
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

            var title = new TextBlock
            {
                Text = "选择要打印的页面",
                FontSize = 22,
                FontWeight = FontWeights.SemiBold,
                Margin = new Thickness(0, 0, 0, 14)
            };
            root.Children.Add(title);

            var quickActions = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Margin = new Thickness(0, 0, 0, 12)
            };
            Grid.SetRow(quickActions, 1);
            quickActions.Children.Add(CreateActionButton("全选", true));
            quickActions.Children.Add(CreateActionButton("取消全选", false));
            root.Children.Add(quickActions);

            var pageList = new StackPanel { Margin = new Thickness(4) };
            int normalizedPageCount = Math.Max(1, pageCount);
            for (int pageIndex = 0; pageIndex < normalizedPageCount; pageIndex++)
            {
                var checkBox = new CheckBox
                {
                    Content = pageIndex == currentPageIndex
                        ? $"第 {pageIndex + 1} 页（当前页）"
                        : $"第 {pageIndex + 1} 页",
                    Tag = pageIndex,
                    IsChecked = true,
                    FontSize = 15,
                    Padding = new Thickness(8),
                    Margin = new Thickness(0, 0, 0, 4),
                    Foreground = Brushes.White
                };
                checkBox.Checked += (_, _) => UpdatePrintButton();
                checkBox.Unchecked += (_, _) => UpdatePrintButton();
                AutomationProperties.SetAutomationId(checkBox, $"PrintPage{pageIndex + 1}");
                _pageCheckBoxes.Add(checkBox);
                pageList.Children.Add(checkBox);
            }

            var scrollViewer = new ScrollViewer
            {
                Content = pageList,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled
            };
            Grid.SetRow(scrollViewer, 2);
            root.Children.Add(scrollViewer);

            var footer = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                HorizontalAlignment = HorizontalAlignment.Right,
                Margin = new Thickness(0, 16, 0, 0)
            };
            Grid.SetRow(footer, 3);

            var cancelButton = new Button
            {
                Content = "取消",
                MinWidth = 88,
                Padding = new Thickness(14, 8, 14, 8),
                Margin = new Thickness(0, 0, 8, 0),
                IsCancel = true
            };
            _printButton = new Button
            {
                Content = "继续打印",
                MinWidth = 108,
                Padding = new Thickness(14, 8, 14, 8),
                IsDefault = true
            };
            AutomationProperties.SetAutomationId(_printButton, "ConfirmPrintPages");
            _printButton.Click += (_, _) =>
            {
                DialogResult = true;
                Close();
            };
            footer.Children.Add(cancelButton);
            footer.Children.Add(_printButton);
            root.Children.Add(footer);

            Content = root;
            UpdatePrintButton();
        }

        public IReadOnlyList<int> SelectedPageIndexes => _pageCheckBoxes
            .Where(checkBox => checkBox.IsChecked == true)
            .Select(checkBox => (int)checkBox.Tag)
            .ToList();

        private Button CreateActionButton(string text, bool isChecked)
        {
            var button = new Button
            {
                Content = text,
                Padding = new Thickness(12, 6, 12, 6),
                Margin = new Thickness(0, 0, 8, 0)
            };
            button.Click += (_, _) =>
            {
                foreach (var checkBox in _pageCheckBoxes)
                {
                    checkBox.IsChecked = isChecked;
                }
            };
            return button;
        }

        private void UpdatePrintButton()
        {
            if (_printButton != null)
            {
                _printButton.IsEnabled = _pageCheckBoxes.Any(checkBox => checkBox.IsChecked == true);
            }
        }
    }
}
