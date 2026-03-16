using System;
using System.IO;
using Newtonsoft.Json;

namespace HomeworkApp.Services
{
    public sealed class AppSettings
    {
        [JsonProperty("defaultPrinterName")]
        public string? DefaultPrinterName { get; set; }

        [JsonProperty("paperSize")]
        public string PaperSize { get; set; } = "A4";
    }

    public static class AppSettingsStore
    {
        private static readonly string AppDataPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "HomeworkApp");

        private static readonly string SettingsPath = Path.Combine(AppDataPath, "settings.json");

        public static AppSettings Load()
        {
            try
            {
                if (!File.Exists(SettingsPath))
                {
                    return new AppSettings();
                }

                string json = File.ReadAllText(SettingsPath);
                return JsonConvert.DeserializeObject<AppSettings>(json) ?? new AppSettings();
            }
            catch
            {
                return new AppSettings();
            }
        }

        public static void Save(AppSettings settings)
        {
            Directory.CreateDirectory(AppDataPath);
            string json = JsonConvert.SerializeObject(settings, Formatting.Indented);
            File.WriteAllText(SettingsPath, json);
        }
    }
}
