using System;
using System.IO;
using System.Windows;
using HomeworkApp.Services;

namespace HomeworkApp
{
    public partial class App : Application
    {
        protected override void OnStartup(StartupEventArgs e)
        {
            EnsureAppDirectories();

            if (AgentHomeworkCommand.TryHandle(e.Args))
            {
                Shutdown(Environment.ExitCode);
                return;
            }

            base.OnStartup(e);
        }

        private static void EnsureAppDirectories()
        {
            string appDataPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "HomeworkApp");

            if (!Directory.Exists(appDataPath))
            {
                Directory.CreateDirectory(appDataPath);
            }

            string jobsPath = Path.Combine(appDataPath, "Jobs");
            if (!Directory.Exists(jobsPath))
            {
                Directory.CreateDirectory(jobsPath);
            }
        }
    }
}
