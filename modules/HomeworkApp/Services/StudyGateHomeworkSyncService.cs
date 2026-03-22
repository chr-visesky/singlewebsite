using System;
using System.IO;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;

namespace HomeworkApp.Services
{
    internal sealed class StudyGateHomeworkSyncService
    {
        private const string StudyGateStateDirectoryName = "StudyGate";
        private const string StudyGateStateFileName = "study-tools-state.json";
        private const string HomeworkSyncEndpoint = "http://127.0.0.1:32147/__studygate/homework/sync";
        private static readonly HttpClient HttpClient = new()
        {
            Timeout = TimeSpan.FromSeconds(20)
        };

        public async Task<StudyGateHomeworkSyncResult> SyncAsync(CancellationToken cancellationToken = default)
        {
            string mobileToken = LoadMobileToken();
            string requestUrl = $"{HomeworkSyncEndpoint}?token={Uri.EscapeDataString(mobileToken)}";
            using var request = new HttpRequestMessage(HttpMethod.Post, requestUrl);
            using var response = await HttpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
            string payload = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
            var result = string.IsNullOrWhiteSpace(payload)
                ? new StudyGateHomeworkSyncResult()
                : JsonConvert.DeserializeObject<StudyGateHomeworkSyncResult>(payload) ?? new StudyGateHomeworkSyncResult();

            if (!response.IsSuccessStatusCode || !result.Success)
            {
                throw new InvalidOperationException(string.IsNullOrWhiteSpace(result.Message)
                    ? "云端作业同步失败。"
                    : result.Message);
            }

            return result;
        }

        private static string LoadMobileToken()
        {
            string appDataPath = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            string stateFilePath = Path.Combine(appDataPath, StudyGateStateDirectoryName, StudyGateStateFileName);

            if (!File.Exists(stateFilePath))
            {
                throw new FileNotFoundException("找不到 StudyGate 的本地状态文件，无法执行云端作业同步。", stateFilePath);
            }

            string json = File.ReadAllText(stateFilePath);
            var state = JsonConvert.DeserializeObject<StudyGateState>(json) ?? new StudyGateState();

            if (string.IsNullOrWhiteSpace(state.MobileToken))
            {
                throw new InvalidOperationException("StudyGate 本地状态里没有 mobileToken，无法执行云端作业同步。");
            }

            return state.MobileToken.Trim();
        }

        private sealed class StudyGateState
        {
            [JsonProperty("mobileToken")]
            public string MobileToken { get; set; } = string.Empty;
        }
    }

    internal sealed class StudyGateHomeworkSyncResult
    {
        [JsonProperty("success")]
        public bool Success { get; set; }

        [JsonProperty("enabled")]
        public bool Enabled { get; set; }

        [JsonProperty("requestCount")]
        public int RequestCount { get; set; }

        [JsonProperty("processedCount")]
        public int ProcessedCount { get; set; }

        [JsonProperty("message")]
        public string Message { get; set; } = string.Empty;
    }
}
