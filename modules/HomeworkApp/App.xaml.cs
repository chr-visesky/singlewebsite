using System;
using System.IO;
using System.Windows;

namespace HomeworkApp
{
    public partial class App : Application
    {
        protected override void OnStartup(StartupEventArgs e)
        {
            base.OnStartup(e);

            // Initialize application data directory
            string appDataPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "HomeworkApp");

            if (!Directory.Exists(appDataPath))
            {
                Directory.CreateDirectory(appDataPath);
            }

            // Initialize jobs directory
            string jobsPath = Path.Combine(appDataPath, "Jobs");
            if (!Directory.Exists(jobsPath))
            {
                Directory.CreateDirectory(jobsPath);
            }
        }
    }
}
