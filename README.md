# 单网址学习壳程序

这是一个基于 Electron 的 Windows 桌面程序。它不是 Edge 浏览器窗口，启动后会先进入本地首页：

- `在线课堂模块`：进入你配置过的课堂网址
- `大语文`：读取百度网盘固定目录里的视频
- `陆老师讲义`：读取百度网盘固定目录里的视频

程序默认封锁：

- 地址栏和标签页
- 新窗口和弹窗
- 右键菜单
- 常见跳转快捷键
- 下载
- 未列入白名单的页面与资源请求

## 1. 配置

先把根目录下的 `config.example.json` 复制成 `config.json`，再编辑 `config.json`。`npm run build` 时会把它嵌进程序包，打包后的 `dist` 目录里不会再裸放一个可直接改的 `config.json`。

### 网课站

- `onlineClassrooms`：在线课堂模块列表。每项至少包含 `title` 和 `entryUrl`
- `startUrl`：旧字段，仍然兼容；没配 `onlineClassrooms` 时会自动生成一个默认课堂模块
- `allowedTopLevelUrlPrefixes`：允许主页面跳转到的 URL 前缀
- `allowedResourceHostnames` / `allowedResourceHostnameSuffixes`：允许网课站加载脚本、图片、接口、流媒体等资源的域名
- `allowedResourceUrlPrefixes`：如果只想放行某些资源前缀，可以补这里
- `resourceAccessMode`：资源放行模式。`whitelist` 表示继续按资源白名单拦截；`top-level-only` 表示顶层页面按你配置过的域名/后缀放行，脚本、图片、接口、课堂 iframe 等资源也不再逐个域名拦截

示例：

```json
{
  "onlineClassrooms": [
    {
      "id": "english-course",
      "title": "说课英语",
      "entryUrl": "https://www.talk915.com/student/login/"
    },
    {
      "id": "math-live",
      "title": "数学直播",
      "entryUrl": "https://example.com/classroom"
    }
  ]
}
```

### 百度网盘

程序现在只支持“固定目录播放器”模式，不会给孩子一个完整网盘界面。

申请入口已经迁到百度网盘开放平台新站：

- `https://pan.baidu.com/union`

需要填写：

```json
{
  "baiduNetdisk": {
    "clientId": "你的百度开放平台 clientId",
    "clientSecret": "你的百度开放平台 clientSecret",
    "scope": "netdisk"
  },
  "contentLibraries": [
    {
      "id": "great-chinese",
      "title": "大语文",
      "folderPath": "/大语文"
    },
    {
      "id": "teacher-library",
      "title": "陆老师讲义",
      "folderPath": "/陆老师讲义"
    }
  ]
}
```

说明：

- `clientId` / `clientSecret`：来自百度网盘开放平台应用的 `AppKey` / `SecretKey`
- `scope`：保持 `netdisk`
- `contentLibraries`：首页里要显示的固定网盘目录
- `folderPath`：百度网盘里的目录路径，例如 `/大语文`

当前程序走的是百度设备码授权，不再要求你额外登记浏览器 OAuth 回调地址。

第一次进入 `大语文` 或 `陆老师讲义` 时，点“连接百度网盘”，程序内会弹出二维码页；扫一次后会把授权状态保存在本机数据目录，后面自动续用。

### 课表和提醒

默认情况下，程序会优先读取本机数据目录里的 `study-schedule.json`。这个文件可以直接在手机上改，不需要回电脑手改 `config.json`。

`config.json` 里的 `studySchedule` 只是初始课表模板，第一次启动或没有手机端保存记录时会用它。

如果你不想依赖同一局域网，也可以直接启用 `remoteSchedule`，让程序从服务器拉课表。

格式示例：

```json
{
  "studySchedule": [
    {
      "id": "english-mon",
      "title": "说课英语",
      "target": "english-course",
      "time": "18:30",
      "weekdays": [1, 3, 5],
      "message": "到说课英语时间了。"
    },
    {
      "id": "reading-daily",
      "title": "晚间看书",
      "target": "",
      "time": "20:00",
      "weekdays": [1, 2, 3, 4, 5],
      "message": "到看书时间了。"
    }
  ]
}
```

说明：

- `time`：24 小时制，格式 `HH:mm`
- `weekdays`：`1-7` 分别表示 `周一` 到 `周日`
- `target`：可以填 `onlineClassrooms` 里的课堂 ID，也可以填 `contentLibraries` 里的库 ID；留空表示“只提醒，不跳转”，适合 `看书`、`做作业`
- 允许的网站登录页会自动记住并回填账号密码，凭据使用本机安全存储加密，不明文写盘
- `title` / `message`：电脑到点语音播报和弹层里显示的内容
- `reminders.leadMinutes`：提前提醒分钟数，默认是 `[5, 1]`
- 每天的完成状态会保存在本机数据目录里的 `study-tools-state.json`
- 手机端改课表后，会保存到本机数据目录里的 `study-schedule.json`

如果你想显式写进配置，也可以加：

```json
{
  "reminders": {
    "leadMinutes": [5, 1]
  }
}
```

桌面提醒会按真实计划名称做本机语音播报，例如“距离说课英语还剩 5 分钟。”，默认连播 3 次，不依赖云端 TTS。

### 服务器拉课表

如果你想让电脑直接从服务器拿课表，在 `config.json` 里填：

```json
{
  "remoteSchedule": {
    "url": "https://你的服务器/schedule.json",
    "authToken": "可选的访问 token",
    "refreshMinutes": 3
  }
}
```

说明：

- `url`：返回课表 JSON 的接口地址
- `authToken`：只读 token。程序读取课表时会自动带 `Authorization: Bearer <token>`
- `studentWriteToken`：可选。配了就直接允许桌面端保存学生计划；不配时，桌面端会自动发起写入申请，家长在手机端批准后才能保存
- `refreshMinutes`：轮询间隔，单位分钟
- 接口返回可以是数组，也可以是 `{ "items": [...] }`
- 课表项格式和 `studySchedule` 完全一样
- 程序启动时会先拉一次，之后按 `refreshMinutes` 自动刷新
- 拉取成功后会把最近一次服务器课表缓存到本机数据目录里的 `study-schedule-cache.json`
- 服务器暂时不可用时，会继续用上一次成功同步到本机的课表

### 微信小程序 + CloudBase

仓库里已经带了一套 `微信小程序 + CloudBase` 骨架，在 `cloudbase/` 目录：

- `cloudbase/functions/scheduleAdmin`：小程序管理云函数
- `cloudbase/functions/schedulePublic`：桌面程序拉课表和保存学生计划的 HTTP 接口
- `cloudbase/miniprogram`：家长管理端小程序

详细部署看：

- `cloudbase/README.md`
- `cloudbase/DEPLOY.md`

这套方案的目标是：

- 小程序只给家长自己管理课表
- CloudBase 负责存课表
- 桌面程序继续按 `remoteSchedule` 从云端拉

### 手机改课表

程序首页右侧会显示局域网配置地址。

使用方式：

- 让手机和电脑连接同一个 Wi-Fi
- 在手机浏览器里打开首页显示的网址
- 直接新增、编辑、删除课表项
- 保存后，电脑会按新课表发声提醒

如果已经启用了 `remoteSchedule`，首页也会显示最近一次服务器同步状态；这时局域网页面可以保留做本地兜底，但真正生效的课表优先来自服务器。

## 2. 运行

安装依赖：

```powershell
npm install
```

开发运行：

```powershell
npm start
```

### 课表服务器

如果你要把课表放到服务器上，直接运行：

```powershell
npm run server
```

第一次启动后会自动创建：

- `server-data/server-config.json`
- `server-data/schedule.json`

服务端会在控制台直接打印：

- 手机管理地址
- `remoteSchedule.url`
- `remoteSchedule.authToken`

你只需要把打印出来的 `url` 和 `authToken` 填到桌面程序的 [config.json](q:/singlewebsite/config.json) 里。

手机使用方式：

- 打开控制台打印的 `.../admin?token=...`
- 直接在页面里加、改、删课表
- 桌面程序会按它自己的远程同步间隔自动拉取

如果这个服务器要放到公网，建议前面再套一层你自己的 HTTPS 反向代理。

## 3. 打包

打包为可执行目录：

```powershell
npm run build
```

输出结果会有两份：

- `dist/StudyGate-win32-x64/`
- `dist/StudyGate-win32-x64.zip`

这是便携版，不需要额外安装器。把整个目录拷到孩子电脑上，直接运行 `StudyGate.exe` 就行。

打包后程序会把运行状态写到 `%AppData%/StudyGate/`，例如：

- `study-schedule.json`
- `study-tools-state.json`
- `session-state.json`
- `origin-storage-state.json`
- `baidu-netdisk-state.json`

## 4. 已实现限制

- 启动先进入本地首页，而不是直接给孩子一个浏览器页面
- 只允许白名单里的主页面导航
- 在 `resourceAccessMode = "whitelist"` 时，非白名单资源请求会被取消
- 在 `resourceAccessMode = "top-level-only"` 时，只严控主页面跳转，资源请求不再逐个域名拦截
- 阻止 `window.open`
- 禁用 `Ctrl+L`、`Ctrl+T`、`F12`、`Alt+F4` 等常见快捷键
- 屏蔽下载
- 白名单站点可使用摄像头、麦克风和音箱输出设备
- `Ctrl+Alt+Shift+Q` 可直接退出程序
- 百度网盘入口只显示你指定的目录，不暴露完整网盘界面
- 支持按课表发声提醒、弹层提醒和当日完成状态
- 默认会在开课前 `5` 分钟和 `1` 分钟各提醒一次
- 语音提醒会优先使用程序自带的离线 `Piper medium` 中文语音生成音频；如果本地离线 TTS 不可用，才回退到本机 Chromium/Windows 的 `speechSynthesis`
- 支持用手机通过局域网页面修改课表
- 支持按固定接口从服务器自动拉取课表

## 5. 调试

如果网课页面打不开或样式缺失，先查看同目录自动生成的 `blocked-requests.log`，把里面确实属于网课平台的域名补进白名单。
