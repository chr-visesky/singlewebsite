using System.Windows;
using DictationApp.Services;

namespace DictationApp;

public partial class App : Application
{
    private readonly DictationTaskStore _taskStore = new();
    private readonly DictationSessionSettingsStore _sessionSettingsStore = new();
    private readonly DictationModuleOptions _moduleOptions = DictationModuleOptions.LoadFromEnvironment();
    private readonly DictationHandwritingRecognitionService _recognitionService = new();
    private readonly DictationSpeechService _speechService;

    public App()
    {
        _speechService = new DictationSpeechService(_moduleOptions);
    }

    protected override void OnStartup(StartupEventArgs e)
    {
        if (AgentDictationCommand.TryHandle(e.Args, _taskStore))
        {
            Shutdown(Environment.ExitCode);
            return;
        }

        base.OnStartup(e);
        MainWindow = new MainWindow(_taskStore, _sessionSettingsStore, _speechService, _recognitionService);
        MainWindow.Show();
    }
}
