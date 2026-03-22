using System;
using System.IO;
using Newtonsoft.Json;

namespace StudyModules.Shared;

public sealed class JsonFileStore<T> where T : new()
{
    private readonly string _filePath;

    public JsonFileStore(string filePath)
    {
        _filePath = string.IsNullOrWhiteSpace(filePath)
            ? throw new ArgumentException("文件路径不能为空。", nameof(filePath))
            : filePath;
    }

    public T Read()
    {
        if (!File.Exists(_filePath))
        {
            return new T();
        }

        string content = File.ReadAllText(_filePath);
        return JsonConvert.DeserializeObject<T>(content) ?? new T();
    }

    public void Write(T payload)
    {
        string? directoryPath = Path.GetDirectoryName(_filePath);

        if (!string.IsNullOrWhiteSpace(directoryPath))
        {
            Directory.CreateDirectory(directoryPath);
        }

        File.WriteAllText(_filePath, JsonConvert.SerializeObject(payload, Formatting.Indented));
    }
}
