using System;
using System.IO;
using System.Threading.Tasks;
using NAudio.Wave;
using StudyModules.Shared;

namespace RecitationApp.Services;

public sealed class RecitationAudioRecorder
{
    private const string AppFolderName = "RecitationApp";
    private WaveInEvent? _waveIn;
    private WaveFileWriter? _writer;
    private TaskCompletionSource<string>? _recordingStoppedSource;
    private string _currentFilePath = string.Empty;

    public bool IsRecording => _waveIn is not null;

    public string Start(string taskId)
    {
        if (_waveIn is not null)
        {
            throw new InvalidOperationException("当前已经在录音。");
        }

        _currentFilePath = AppPaths.ResolveDataFile(
            AppFolderName,
            Path.Combine("recordings", taskId, $"{DateTime.Now:yyyyMMddHHmmss}.wav"));
        _waveIn = new WaveInEvent
        {
            WaveFormat = new WaveFormat(16000, 1)
        };
        _writer = new WaveFileWriter(_currentFilePath, _waveIn.WaveFormat);
        _recordingStoppedSource = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        _waveIn.DataAvailable += (_, eventArgs) =>
        {
            _writer?.Write(eventArgs.Buffer, 0, eventArgs.BytesRecorded);
            _writer?.Flush();
        };
        _waveIn.RecordingStopped += (_, _) =>
        {
            _writer?.Dispose();
            _writer = null;
            _waveIn?.Dispose();
            _waveIn = null;
            _recordingStoppedSource?.TrySetResult(_currentFilePath);
        };
        _waveIn.StartRecording();
        return _currentFilePath;
    }

    public async Task<string> StopAsync()
    {
        if (_waveIn is null || _recordingStoppedSource is null)
        {
            return string.Empty;
        }

        _waveIn.StopRecording();
        return await _recordingStoppedSource.Task;
    }
}
