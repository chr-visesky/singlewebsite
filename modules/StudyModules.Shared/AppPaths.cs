using System;
using System.IO;

namespace StudyModules.Shared;

public static class AppPaths
{
    private const string DataRootOverrideEnvName = "STUDYGATE_MODULES_DATA_ROOT";

    public static string ResolveDataRoot(string appFolderName)
    {
        string folderName = string.IsNullOrWhiteSpace(appFolderName) ? "StudyGate" : appFolderName.Trim();
        string overrideRoot = Environment.GetEnvironmentVariable(DataRootOverrideEnvName)?.Trim() ?? string.Empty;
        string root = string.IsNullOrWhiteSpace(overrideRoot)
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), folderName)
            : Path.Combine(overrideRoot, folderName);
        Directory.CreateDirectory(root);
        return root;
    }

    public static string ResolveDataFile(string appFolderName, string relativePath)
    {
        string root = ResolveDataRoot(appFolderName);
        string filePath = Path.Combine(root, relativePath);
        string? directoryPath = Path.GetDirectoryName(filePath);

        if (!string.IsNullOrWhiteSpace(directoryPath))
        {
            Directory.CreateDirectory(directoryPath);
        }

        return filePath;
    }
}
