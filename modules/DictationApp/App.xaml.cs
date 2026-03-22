using System.Windows;
using DictationApp.Services;

namespace DictationApp;

public partial class App : Application
{
    private readonly DictationTaskStore _taskStore = new();
    private readonly DictationSpeechService _speechService = new();

    protected override void OnStartup(StartupEventArgs e)
    {
        if (AgentDictationCommand.TryHandle(e.Args, _taskStore))
        {
            Shutdown(Environment.ExitCode);
            return;
        }

        base.OnStartup(e);
        MainWindow = new MainWindow(_taskStore, _speechService);
        MainWindow.Show();
    }
}
