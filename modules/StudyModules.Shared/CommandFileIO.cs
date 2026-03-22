using System;
using System.IO;
using Newtonsoft.Json;

namespace StudyModules.Shared;

public static class CommandFileIO
{
    public static T ReadJsonFile<T>(string filePath) where T : new()
    {
        if (string.IsNullOrWhiteSpace(filePath))
        {
            throw new InvalidOperationException("缺少命令参数文件路径。");
        }

        if (!File.Exists(filePath))
        {
            throw new FileNotFoundException("找不到命令参数文件。", filePath);
        }

        string content = File.ReadAllText(filePath);
        return JsonConvert.DeserializeObject<T>(content) ?? new T();
    }

    public static void WriteJsonFile<T>(string filePath, T payload)
    {
        if (string.IsNullOrWhiteSpace(filePath))
        {
            return;
        }

        string? directoryPath = Path.GetDirectoryName(filePath);

        if (!string.IsNullOrWhiteSpace(directoryPath))
        {
            Directory.CreateDirectory(directoryPath);
        }

        File.WriteAllText(filePath, JsonConvert.SerializeObject(payload, Formatting.Indented));
    }
}
