using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Automation;

internal static partial class HomeworkAppUiSmoke
{
    private static IntPtr WaitForSaveDialogHandle(TimeSpan timeout)
    {
        DateTime deadline = DateTime.UtcNow.Add(timeout);

        while (DateTime.UtcNow < deadline)
        {
            foreach (IntPtr handle in EnumerateTopLevelWindows())
            {
                string title = GetWindowText(handle);
                if (title.Contains("将打印输出另存为", StringComparison.OrdinalIgnoreCase) ||
                    title.Contains("Save Print Output", StringComparison.OrdinalIgnoreCase))
                {
                    return handle;
                }

                if (title.Contains("打印", StringComparison.OrdinalIgnoreCase) ||
                    title.Contains("Print", StringComparison.OrdinalIgnoreCase))
                {
                    TryConfirmPrintDialog(handle);
                }
            }

            Thread.Sleep(250);
        }

        string titles = string.Join(
            " | ",
            EnumerateTopLevelWindows()
                .Select(GetWindowText)
                .Where((title) => !string.IsNullOrWhiteSpace(title))
                .Distinct(StringComparer.OrdinalIgnoreCase));
        IntPtr printDialogHandle = EnumerateTopLevelWindows()
            .FirstOrDefault((handle) =>
            {
                string title = GetWindowText(handle);
                return title.Contains("打印", StringComparison.OrdinalIgnoreCase) ||
                    title.Contains("Print", StringComparison.OrdinalIgnoreCase);
            });
        string printDialogDump = printDialogHandle == IntPtr.Zero ? string.Empty : DumpAutomationTree(printDialogHandle);
        throw new TimeoutException($"打印保存对话框没有出现。当前顶层窗口: {titles}{(string.IsNullOrWhiteSpace(printDialogDump) ? string.Empty : $"。打印窗口控件: {printDialogDump}")}");
    }

    private static void TryConfirmPrintDialog(IntPtr dialogHandle)
    {
        try
        {
            var dialogElement = AutomationElement.FromHandle(dialogHandle);
            var printerItem = dialogElement.FindAll(
                TreeScope.Descendants,
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.ListItem))
                .Cast<AutomationElement>()
                .FirstOrDefault((element) =>
                    string.Equals(element.Current.Name, "Microsoft Print to PDF", StringComparison.OrdinalIgnoreCase));

            if (printerItem != null &&
                printerItem.TryGetCurrentPattern(SelectionItemPattern.Pattern, out object? selectionPattern))
            {
                ((SelectionItemPattern)selectionPattern).Select();
            }

            var printButton = dialogElement.FindAll(
                TreeScope.Descendants,
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button))
                .Cast<AutomationElement>()
                .FirstOrDefault((element) =>
                {
                    string name = element.Current.Name ?? string.Empty;
                    return name.Contains("打印", StringComparison.OrdinalIgnoreCase) ||
                        string.Equals(name, "Print", StringComparison.OrdinalIgnoreCase);
                });

            if (printButton != null)
            {
                InvokeElement(printButton, "PrintDialogConfirm");
            }
        }
        catch
        {
            // Ignore transient print dialog automation failures and keep polling.
        }
    }

    private static string DumpAutomationTree(IntPtr dialogHandle)
    {
        try
        {
            var dialogElement = AutomationElement.FromHandle(dialogHandle);
            var descendants = dialogElement.FindAll(TreeScope.Descendants, Condition.TrueCondition);

            return string.Join(
                " | ",
                descendants.Cast<AutomationElement>()
                    .Take(40)
                    .Select((element) =>
                    {
                        string controlType = element.Current.ControlType?.ProgrammaticName ?? "unknown";
                        return $"{controlType}:{element.Current.AutomationId}:{element.Current.Name}";
                    }));
        }
        catch
        {
            return string.Empty;
        }
    }

    private static IntPtr WaitForDialogHandle(IEnumerable<string> titleHints, TimeSpan timeout)
    {
        string[] hints = titleHints.Where((item) => !string.IsNullOrWhiteSpace(item)).ToArray();
        DateTime deadline = DateTime.UtcNow.Add(timeout);

        while (DateTime.UtcNow < deadline)
        {
            foreach (IntPtr handle in EnumerateTopLevelWindows())
            {
                string title = GetWindowText(handle);
                if (hints.Any((hint) => title.Contains(hint, StringComparison.OrdinalIgnoreCase)))
                {
                    return handle;
                }
            }

            Thread.Sleep(200);
        }

        throw new TimeoutException("确认对话框没有出现。");
    }

    private static bool TryDismissDialog(IEnumerable<string> titleHints, IEnumerable<string> buttonTitles, TimeSpan timeout)
    {
        try
        {
            IntPtr dialogHandle = WaitForDialogHandle(titleHints, timeout);
            if (!TryClickDialogButton(dialogHandle, buttonTitles))
            {
                ClickDialogConfirmFallback(dialogHandle);
            }
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static bool TryDismissPrintCompleteDialog()
    {
        IntPtr dialogHandle = FindDialogHandle(["打印完成", "Print Complete", "已发送到打印机"]);
        if (dialogHandle == IntPtr.Zero)
        {
            return false;
        }

        ClickDialogConfirmFallback(dialogHandle);
        return true;
    }

    private static void SetSaveDialogFileName(IntPtr dialogHandle, string filePath)
    {
        NativeMethods.SetForegroundWindow(dialogHandle);
        Thread.Sleep(250);

        IntPtr editHandle = EnumerateChildWindows(dialogHandle)
            .Where((handle) => NativeMethods.IsWindowVisible(handle))
            .Where((handle) => string.Equals(GetClassName(handle), "Edit", StringComparison.OrdinalIgnoreCase))
            .OrderByDescending((handle) => GetWindowRect(handle).Top)
            .ThenByDescending((handle) => GetWindowRect(handle).Right - GetWindowRect(handle).Left)
            .FirstOrDefault();

        if (editHandle == IntPtr.Zero)
        {
            throw new InvalidOperationException($"没有找到“文件名”输入框。现有窗口标题: {GetWindowText(dialogHandle)}");
        }

        if (NativeMethods.SendMessage(editHandle, NativeMethods.WmSetText, IntPtr.Zero, filePath) == IntPtr.Zero)
        {
            throw new InvalidOperationException("无法给保存框写入文件名。");
        }
    }

    private static void ClickSaveDialogButton(IntPtr dialogHandle)
    {
        IntPtr buttonHandle = EnumerateChildWindows(dialogHandle)
            .Where((handle) => NativeMethods.IsWindowVisible(handle))
            .Where((handle) => string.Equals(GetClassName(handle), "Button", StringComparison.OrdinalIgnoreCase))
            .FirstOrDefault((handle) =>
            {
                string title = GetWindowText(handle);
                return title.Contains("保存", StringComparison.OrdinalIgnoreCase) ||
                    title.Contains("Save", StringComparison.OrdinalIgnoreCase);
            });

        if (buttonHandle == IntPtr.Zero)
        {
            throw new InvalidOperationException($"没有找到保存按钮。现有窗口标题: {GetWindowText(dialogHandle)}");
        }

        _ = NativeMethods.SendMessage(buttonHandle, NativeMethods.BmClick, IntPtr.Zero, IntPtr.Zero);
    }

    private static void ClickDialogButton(IntPtr dialogHandle, IEnumerable<string> buttonTitles)
    {
        if (TryClickDialogButton(dialogHandle, buttonTitles))
        {
            return;
        }

        throw new InvalidOperationException($"没有找到确认按钮。现有窗口标题: {GetWindowText(dialogHandle)}");
    }

    private static bool TryClickDialogButton(IntPtr dialogHandle, IEnumerable<string> buttonTitles)
    {
        string[] titles = buttonTitles.Where((item) => !string.IsNullOrWhiteSpace(item)).ToArray();
        IntPtr buttonHandle = EnumerateChildWindows(dialogHandle)
            .Where((handle) => NativeMethods.IsWindowVisible(handle))
            .Where((handle) => string.Equals(GetClassName(handle), "Button", StringComparison.OrdinalIgnoreCase))
            .FirstOrDefault((handle) =>
            {
                string title = GetWindowText(handle);
                return titles.Any((candidate) => title.Contains(candidate, StringComparison.OrdinalIgnoreCase));
            });

        if (buttonHandle == IntPtr.Zero)
        {
            return false;
        }

        _ = NativeMethods.SendMessage(buttonHandle, NativeMethods.BmClick, IntPtr.Zero, IntPtr.Zero);
        return true;
    }

    private static void ClickDialogConfirmFallback(IntPtr dialogHandle)
    {
        NativeMethods.Rect rect = GetWindowRect(dialogHandle);
        int width = rect.Right - rect.Left;
        int height = rect.Bottom - rect.Top;
        int targetX = rect.Left + (int)(width * 0.80);
        int targetY = rect.Top + (int)(height * 0.80);

        NativeMethods.SetCursorPos(targetX, targetY);
        NativeMethods.mouse_event(NativeMethods.MouseEventLeftDown, 0, 0, 0, UIntPtr.Zero);
        NativeMethods.mouse_event(NativeMethods.MouseEventLeftUp, 0, 0, 0, UIntPtr.Zero);
        Thread.Sleep(150);
        PressEnterOnDialog(dialogHandle);
    }

    private static IntPtr FindDialogHandle(IEnumerable<string> titleHints)
    {
        string[] hints = titleHints.Where((item) => !string.IsNullOrWhiteSpace(item)).ToArray();
        return EnumerateTopLevelWindows().FirstOrDefault((handle) =>
        {
            string title = GetWindowText(handle);
            return hints.Any((hint) => title.Contains(hint, StringComparison.OrdinalIgnoreCase));
        });
    }

    private static void PressEnterOnDialog(IntPtr dialogHandle)
    {
        NativeMethods.SetForegroundWindow(dialogHandle);
        Thread.Sleep(120);
        NativeMethods.keybd_event((byte)NativeMethods.VirtualKeyReturn, 0, 0, UIntPtr.Zero);
        Thread.Sleep(40);
        NativeMethods.keybd_event((byte)NativeMethods.VirtualKeyReturn, 0, NativeMethods.KeyEventKeyUp, UIntPtr.Zero);
    }

    private static IEnumerable<IntPtr> EnumerateTopLevelWindows()
    {
        var handles = new List<IntPtr>();
        NativeMethods.EnumWindows((handle, _) =>
        {
            if (NativeMethods.IsWindowVisible(handle))
            {
                handles.Add(handle);
            }

            return true;
        }, IntPtr.Zero);
        return handles;
    }

    private static IEnumerable<IntPtr> EnumerateChildWindows(IntPtr parentHandle)
    {
        var handles = new List<IntPtr>();
        NativeMethods.EnumChildWindows(parentHandle, (handle, _) =>
        {
            handles.Add(handle);
            return true;
        }, IntPtr.Zero);
        return handles;
    }

    private static string GetWindowText(IntPtr handle)
    {
        var builder = new StringBuilder(256);
        _ = NativeMethods.GetWindowText(handle, builder, builder.Capacity);
        return builder.ToString();
    }

    private static string GetClassName(IntPtr handle)
    {
        var builder = new StringBuilder(256);
        _ = NativeMethods.GetClassName(handle, builder, builder.Capacity);
        return builder.ToString();
    }

    private static NativeMethods.Rect GetWindowRect(IntPtr handle)
    {
        _ = NativeMethods.GetWindowRect(handle, out NativeMethods.Rect rect);
        return rect;
    }

    private static class NativeMethods
    {
        public const uint WmSetText = 0x000C;
        public const uint BmClick = 0x00F5;
        public const uint MouseEventLeftDown = 0x0002;
        public const uint MouseEventLeftUp = 0x0004;
        public const uint KeyEventKeyUp = 0x0002;
        public const int VirtualKeyReturn = 0x0D;

        public delegate bool EnumWindowProc(IntPtr handle, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential)]
        public struct Rect
        {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
        }

        [DllImport("user32.dll")]
        public static extern bool EnumWindows(EnumWindowProc callback, IntPtr lParam);

        [DllImport("user32.dll")]
        public static extern bool EnumChildWindows(IntPtr parentHandle, EnumWindowProc callback, IntPtr lParam);

        [DllImport("user32.dll")]
        public static extern bool IsWindowVisible(IntPtr handle);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern int GetWindowText(IntPtr handle, StringBuilder builder, int maxCount);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern int GetClassName(IntPtr handle, StringBuilder builder, int maxCount);

        [DllImport("user32.dll")]
        public static extern bool GetWindowRect(IntPtr handle, out Rect rect);

        [DllImport("user32.dll")]
        public static extern bool SetForegroundWindow(IntPtr handle);

        [DllImport("user32.dll")]
        public static extern bool SetCursorPos(int x, int y);

        [DllImport("user32.dll")]
        public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

        [DllImport("user32.dll")]
        public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern IntPtr SendMessage(IntPtr handle, uint message, IntPtr wParam, string lParam);

        [DllImport("user32.dll")]
        public static extern IntPtr SendMessage(IntPtr handle, uint message, IntPtr wParam, IntPtr lParam);
    }
}
