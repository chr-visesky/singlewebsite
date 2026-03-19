# StudyGate

**StudyGate** 是一个专为孩子设计的 Windows 学习入口程序。

它不是浏览器，也不是桌面环境。启动后只显示家长配置好的学习模块，孩子无法随意浏览网页或运行其他程序。

![StudyGate 首页](./截图/Snipaste_2026-03-13_16-21-41.png)

---

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置文件

复制配置模板：

```bash
copy config.example.json config.json
```

然后按实际情况修改 `config.json`（详见 [配置说明](#配置说明)）。

### 3. 运行

```bash
npm start
```

### 4. 打包

```bash
npm run build
```

打包完成后，可执行文件位于 `dist/StudyGate-win32-x64/StudyGate.exe`

---

## 核心功能

### 1. 首页学习模块

首页卡片式布局，支持四种模块类型：

| 模块类型 | 图标颜色 | 说明 |
|---------|---------|------|
| 在线课堂 | 琥珀色 | 打开配置的网课网站，支持多个课堂入口 |
| 百度网盘视频 | 青绿色/珊瑚色 | 显示指定目录的学习视频 |
| 学习工具 | 青绿色 | 启动本机学习程序（词典、口算软件等） |
| 作业模块 | 珊瑚色 | 内置的 C# 作业批注打印工具 |

### 2. 课表与提醒系统

#### 当日计划
- 显示今天的课程安排
- 支持打卡标记完成
- 灰色 = 未到时间，亮色 = 可打卡，亮绿 = 已完成

#### 日历视图
- 月视图展示学习计划
- 点击日期查看详情
- 显示未来 60 天内的计划

#### 智能提醒
- 默认提前 **5 分钟** 和 **1 分钟** 提醒
- 系统通知 + 弹窗提示
- 语音播报（使用 Piper TTS 引擎）
- 闹铃播放
- 窗口闪烁提醒

### 3. 学生计划模式

支持两种计划类型：

| 类型 | 说明 |
|------|------|
| 家长计划 | 由家长配置，到点可进入指定学习模块 |
| 学生计划 | 学生可自行添加周期计划，需家长审批 |

支持两种数据同步方式：

| 方式 | 说明 |
|------|------|
| 本机模式 | 课表数据保存在 `%AppData%\StudyGate\` |
| 远程模式 | 从云端 API 同步，支持手机小程序管理 |

---

## 模块详解

### 在线课堂模块

不是简单打开浏览器，而是**受控的学习环境**：

**安全特性：**
- 拦截跳转到站外的链接
- 屏蔽地址栏、右键菜单、开发者工具
- 禁止自由下载
- 限制快捷键（Alt+F4、Ctrl+R、F12 等）

**权限管理：**
- 允许课堂站点使用摄像头、麦克风
- 资源加载白名单模式
- 支持配置同生态域名范围

**配置示例：**
```json
{
  "onlineClassrooms": [
    {
      "id": "english-course",
      "title": "说课英语",
      "entryUrl": "https://www.talk915.com/student/login/"
    }
  ],
  "allowedTopLevelUrlPrefixes": [
    "https://www.talk915.com/",
    "https://class.csslcloud.net/"
  ],
  "allowedResourceHostnameSuffixes": [
    ".talk915.com",
    ".alicdn.com",
    ".csslcloud.net"
  ],
  "resourceAccessMode": "top-level-only"
}
```

### 百度网盘视频模块

不是完整网盘界面，**只显示配置目录下的视频**。

**支持的视频格式：** `.mp4`, `.webm`, `.m4v`, `.mov`, `.mp3`, `.m4a`

**首次使用：**
1. 点击"连接百度网盘"授权
2. 授权状态保存在本机
3. 后续自动续用

**配置示例：**
```json
{
  "baiduNetdisk": {
    "clientId": "your-client-id",
    "clientSecret": "your-client-secret"
  },
  "contentLibraries": [
    {
      "id": "great-chinese",
      "title": "大语文",
      "folderPath": "/大语文"
    }
  ]
}
```

需要在 [百度网盘开放平台](https://pan.baidu.com/union) 申请 API 凭证。

### 学习工具模块

启动本机指定程序，适合：
- 词典软件
- 练字软件
- 口算软件
- 单词软件

**支持的程序类型：** `.exe`, `.cmd`, `.bat`, `.lnk` 或简单命令名

```json
{
  "learningTools": [
    {
      "id": "dictionary-tool",
      "title": "词典",
      "appPath": "C:\\Program Files\\Dictionary\\dict.exe"
    }
  ]
}
```

### 作业模块（内置 C# 程序）

独立的 Windows 原生应用，使用 .NET 10 + WPF + InkCanvas 实现。

**核心功能：**
- 导入图片（JPG/PNG/BMP）和 PDF
- 手写批注（支持压感）
- 橡皮擦除
- 多页作业管理
- 自动保存到本地
- 一键打印
- 历史作业恢复

**作业树结构：**
```
课内 / 课外
├── 2026-03-18（最近两周在主树）
│   ├── 语文
│   ├── 数学
│   └── 英语
└── 历史（更早的作业）
```

**额外功能：**
- `最近打开` 快速入口
- 缩略图预览
- 新增空白页
- 删除单页
- 拖拽导入

---

## 配置说明

### 完整配置示例

```json
{
  "appTitle": "学习入口",
  "startUrl": "https://www.talk915.com/student/login/",
  "onlineClassrooms": [...],
  "contentLibraries": [...],
  "learningTools": [...],
  "studySchedule": [...],
  "baiduNetdisk": {...},
  "remoteSchedule": {...},
  "kiosk": false,
  "alwaysOnTop": false,
  "exitShortcut": "Ctrl+Alt+Shift+Q",
  "blockedShortcuts": [...],
  "logBlockedRequests": true
}
```

### 学习计划配置

```json
{
  "studySchedule": [
    {
      "id": "english-class",
      "title": "说课英语",
      "target": "english-course",
      "time": "18:30",
      "weekdays": [1, 3, 5],
      "message": "到说课英语时间了，先进入课堂。"
    },
    {
      "id": "homework-time",
      "title": "作业整理",
      "target": "homework-module",
      "time": "19:30",
      "weekdays": [1, 2, 3, 4, 5]
    },
    {
      "id": "reading-time",
      "title": "晚间看书",
      "target": "",
      "time": "20:30",
      "weekdays": [1, 2, 3, 4, 5],
      "message": "到看书时间了。"
    }
  ]
}
```

**字段说明：**
- `target`: 对应学习模块 ID，空值表示只提醒不跳转
- `weekdays`: 1=周一，7=周日
- `message`: 提醒时的语音播报内容

### 远程课表配置

```json
{
  "remoteSchedule": {
    "url": "https://your-domain/api/schedule",
    "authToken": "read-token",
    "studentWriteToken": "write-token",
    "refreshMinutes": 3
  }
}
```

程序会每 3 分钟从服务器拉取一次课表，自动同步到本机。

### 退出密码配置

```json
{
  "controlSettings": {
    "exitPasswordHash": "sha256-hash",
    "exitPasswordSalt": "random-salt",
    "exitPasswordUpdatedAt": "2026-03-18T10:00:00.000Z"
  }
}
```

配置后，退出程序需要输入密码验证。

---

## 手机端管理

### 局域网配置页面

程序启动后，会生成一个局域网可访问的配置页面：

```
http://192.168.1.100:32147/__studygate/mobile?token=xxx
```

用手机浏览器打开该地址，可以：
- 添加/编辑/删除学习计划
- 管理周期计划
- 设置提醒内容

### 微信小程序

支持通过微信小程序 + CloudBase 管理课表。

相关代码位于 `cloudbase/` 目录：
- `cloudbase/miniprogram/` - 小程序代码
- `cloudbase/functions/` - 云函数

部署说明见：
- `cloudbase/README.md`
- `cloudbase/DEPLOY.md`

---

## 安全与限制

### 快捷键屏蔽

默认屏蔽的快捷键：
```
Alt+F4      - 关闭窗口
Ctrl+L      - 地址栏
Ctrl+N      - 新窗口
Ctrl+O      - 打开文件
Ctrl+P      - 打印
Ctrl+R      - 刷新
Ctrl+Shift+I - 开发者工具
Ctrl+Shift+J - 开发者工具
Ctrl+Shift+N - 无痕模式
Ctrl+T      - 新标签页
Ctrl+U      - 查看源码
Ctrl+W      - 关闭标签页
F5          - 刷新
F11         - 全屏
F12         - 开发者工具
```

### 退出快捷键

默认 `Ctrl+Alt+Shift+Q` 退出程序，可在配置中修改。

### URL 访问控制

两种资源访问模式：

| 模式 | 说明 |
|------|------|
| `whitelist` | 顶层页面和子资源都按白名单严格限制 |
| `top-level-only` | 只控制顶层页面跳转，子资源放宽（推荐） |

---

## 数据存储

### 数据目录

程序数据保存在 `%AppData%\StudyGate\`：

| 文件 | 说明 |
|------|------|
| `config.json` | 配置文件（如使用嵌入式配置） |
| `study-schedule.json` | 本机课表数据 |
| `study-schedule-cache.json` | 远程课表缓存 |
| `baidu-netdisk-state.json` | 百度网盘授权令牌 |
| `session-state.json` | 会话状态（登录态等） |
| `origin-storage-state.json` | 网站本地存储快照 |
| `site-credentials.bin` | 网站账号密码（加密存储） |
| `study-tools-state.json` | 学习工具状态、打卡记录 |
| `navigation-debug.log` | 页面跳转调试日志 |
| `reminder-debug.log` | 提醒系统调试日志 |
| `blocked-requests.log` | 被拦截的请求日志 |

### 凭证存储

- 网站账号密码使用 Electron `safeStorage` API 加密存储
- 百度网盘令牌加密存储
- 退出密码使用 SHA-256+Salt 哈希存储

---

## 开发与调试

### 启动开发服务器

```bash
npm run server
```

### 生成 CloudBase 令牌

```bash
npm run cloudbase:token
```

### 日志文件

遇到问题时查看以下日志：
- `blocked-requests.log` - 被拦截的请求
- `navigation-debug.log` - 页面跳转调试
- `reminder-debug.log` - 提醒调试

### 作业模块开发

作业模块是独立的 .NET 项目：

```bash
# 开发模式运行作业模块
cd modules/HomeworkApp
dotnet run

# 发布作业模块
dotnet publish -c Release -o publish
```

---

## 系统要求

- **操作系统**: Windows 10 或更高版本
- **Node.js**: 18+
- **.NET**: 10（作业模块需要）

---

## 技术架构

### 桌面主程序
- **框架**: Electron 41
- **语言**: 原生 JavaScript (无框架)
- **样式**: 原生 CSS
- **构建**: 自定义打包脚本

### 作业模块
- **框架**: .NET 10 + WPF
- **语言**: C#
- **手写**: InkCanvas (Windows Ink)
- **PDF**: PDFium (SkiaSharp)

### 语音提醒
- **TTS 引擎**: Piper (本地运行)
- **语音合成**: 中文女声 (huayan-medium)
- **音频播放**: Windows Media Player / PowerShell

### 云端同步
- **服务端**: CloudBase / 自定义 API
- **小程序**: 微信小程序

---

## 项目结构

```
singlewebsite/
├── src/                    # Electron 主程序
│   ├── main.js            # 主进程
│   ├── preload.js         # 预加载脚本
│   ├── home.js/html/css   # 首页
│   ├── library.js/html/css # 媒体库页面
│   ├── student-plan.js/html/css # 学生计划页面
│   ├── mobile-config.html # 手机配置页面
│   ├── native-modules.js  # 原生模块管理
│   └── learning-tools.js  # 学习工具管理
├── modules/
│   └── HomeworkApp/       # 作业模块 (.NET 10)
├── cloudbase/             # 云端代码
│   ├── miniprogram/       # 微信小程序
│   └── functions/         # 云函数
├── vendor/
│   └── piper/             # Piper TTS 运行时
├── videos/                # 提醒音频素材
├── config.example.json    # 配置模板
└── package.json
```

---

## 常见问题

### 网课网站无法加载
检查 `allowedTopLevelUrlPrefixes` 是否包含该网站的域名前缀。

### 百度网盘无法连接
1. 确认 `clientId` 和 `clientSecret` 配置正确
2. 点击"连接百度网盘"重新授权
3. 检查网络连接

### 提醒没有声音
1. 检查系统音量
2. 确认 `videos/` 目录下有音频文件
3. 查看 `reminder-debug.log`

### 作业模块打不开
确认 `modules/HomeworkApp/` 目录下有编译好的程序。

---

## 许可证

UNLICENSED

---

## 截图

更多截图见 `截图/` 目录。
