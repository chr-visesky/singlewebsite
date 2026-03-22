using System.Windows;
using RecitationApp.Services;

namespace RecitationApp;

public partial class App : Application
{
    private readonly RecitationTaskStore _taskStore = new();
    private readonly RecitationAudioRecorder _audioRecorder = new();
    private readonly RecitationTranscriptionService _transcriptionService = new();
    private readonly RecitationDiffService _diffService = new();

    protected override void OnStartup(StartupEventArgs e)
    {
        if (AgentRecitationCommand.TryHandle(e.Args, _taskStore))
        {
            Shutdown(Environment.ExitCode);
            return;
        }

        base.OnStartup(e);
        MainWindow = new MainWindow(_taskStore, _audioRecorder, _transcriptionService, _diffService);
        MainWindow.Show();
    }
}
