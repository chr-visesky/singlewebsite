# StudyGate

`StudyGate` 是一个给孩子用的 Windows 学习入口。

它不是普通浏览器，也不是完整桌面。启动后只有家长预先配置好的学习模块，孩子只能从这些模块进入在线课堂、百度网盘视频、作业模块或本机学习工具。

## 当前效果

- 首页固定显示学习模块卡片
- 支持在线课堂模块
- 支持百度网盘固定目录视频模块
- 支持本机学习工具模块
- 内置作业模块，支持图片、PDF、空白作业
- 支持课表、提醒、打卡
- 支持手机端管理课表、模块和退出密码
- 支持开机自启动、单实例、最小化后继续提醒
- 支持退出密码

## 首页包含什么

首页卡片由配置和手机端管理页共同决定。

常见模块有：

- `作业模块`
- `在线课堂`
- `百度网盘视频`
- `学习工具`

其中：

- `作业模块` 固定排在左上角第一个
- `在线课堂` 用来打开指定网课网站
- `百度网盘视频` 只显示你指定目录里的视频
- `学习工具` 用来打开本机指定程序

## 作业模块

作业模块是内置的 Windows 子程序，默认直接进入编辑界面，不再先过中间页。

当前规则：

- 左到右布局：`作业助手 -> 缩略图 -> 作业纸 -> 草稿纸`
- 同一天、同一学科，只保留一份作业
- 再次导入图片或 PDF，会追加到这份作业里
- 空学科节点点击后会自动创建一份空白作业
- 支持把图片或 PDF 直接拖进编辑页，追加成新页
- 缩略图里可以新增空白页、删除单页

作业树规则：

- 主树顺序：`课内 / 课外 -> 日期 -> 学科`
- 每个日期下默认先有 `语文 / 数学 / 英语`
- 最近两周显示在主树
- 更早的作业放进历史
- 额外有一组 `最近打开`，解决打开老作业时树上看不见的问题

## 课表、提醒、打卡

程序支持“家长计划”和“学生计划”。

当前行为：

- 计划到点前不能打卡
- 到点后可以打卡
- 打卡后标记完成
- 首页只显示一个对钩按钮
- 未到时间是灰色
- 可打卡是亮色
- 已完成是亮绿色

提醒行为：

- 默认提前 `5` 分钟和 `1` 分钟提醒
- 到点检查按整分钟执行
- 提醒会发系统通知
- 提醒会播放闹铃和语音
- 语音按本地音频片段顺序播放，不依赖云端 TTS

## 在线课堂

在线课堂模块是通用模块，不是写死一个网址。

家长可以配置多个课堂入口，每个入口至少需要：

- 名称
- 网址

程序会：

- 拦截不允许的顶层跳转
- 屏蔽地址栏、标签页、右键菜单、下载
- 允许课堂站点使用摄像头、麦克风和音频输出

如果网课站本身有多个同生态域名，建议把它们加入允许范围。

## 百度网盘视频

百度网盘模块不是完整网盘界面，只展示你指定目录里的视频。

每个模块只需要配置：

- 名称
- 网盘目录

第一次在电脑上进入百度网盘模块时，需要授权一次百度账号。授权状态会保存在本机，后续自动续用。

## 学习工具

学习工具模块用来打开本机指定程序。

适合这类场景：

- 词典
- 练字软件
- 口算软件
- 单词软件

每个模块只需要配置：

- 名称
- 本机程序路径

支持：

- `.exe`
- `.cmd`
- `.bat`
- `.lnk`
- 简单命令名

## 手机端管理

手机端主要用来做这些事：

- 管理课表
- 管理在线课堂模块
- 管理百度网盘视频模块
- 管理学习工具模块
- 设置退出密码
- 审批桌面端学生计划写入

当前推荐方案是：

- 微信小程序 + CloudBase

相关目录：

- `cloudbase/functions/scheduleAdmin`
- `cloudbase/functions/schedulePublic`
- `cloudbase/miniprogram`

部署细节看：

- `cloudbase/README.md`
- `cloudbase/DEPLOY.md`

## 配置文件

先把：

- `config.example.json`

复制成：

- `config.json`

再按你的实际情况修改。

最常用的配置项有：

- `onlineClassrooms`
- `contentLibraries`
- `learningTools`
- `studySchedule`
- `remoteSchedule`
- `baiduNetdisk`

一个最小示例：

```json
{
  "appTitle": "学习入口",
  "onlineClassrooms": [
    {
      "id": "english-course",
      "title": "说课英语",
      "entryUrl": "https://www.talk915.com/student/login/"
    }
  ],
  "contentLibraries": [
    {
      "id": "great-chinese",
      "title": "大语文",
      "folderPath": "/大语文"
    }
  ],
  "learningTools": [
    {
      "id": "dictionary-tool",
      "title": "词典",
      "appPath": "C:\\Windows\\System32\\notepad.exe"
    }
  ],
  "studySchedule": [
    {
      "id": "english-example",
      "title": "说课英语",
      "target": "english-course",
      "time": "18:30",
      "weekdays": [1, 3, 5],
      "message": "到说课英语时间了。"
    }
  ]
}
```

### 在线课堂相关

- `onlineClassrooms`：在线课堂卡片
- `allowedTopLevelUrlPrefixes`：允许的顶层页面范围
- `allowedResourceHostnames`
- `allowedResourceHostnameSuffixes`
- `allowedResourceUrlPrefixes`
- `resourceAccessMode`

`resourceAccessMode` 常用值：

- `whitelist`：资源也按白名单拦
- `top-level-only`：重点只控顶层页面，资源放宽

### 百度网盘相关

需要在百度网盘开放平台申请：

- `clientId`
- `clientSecret`

平台入口：

- <https://pan.baidu.com/union>

### 远程课表相关

如果你用 CloudBase 或自己的服务端，桌面端读取：

```json
{
  "remoteSchedule": {
    "url": "https://your-domain/api/schedule",
    "authToken": "read-token",
    "refreshMinutes": 3
  }
}
```

## 本机保存的数据

打包后程序运行数据会写到：

- `%AppData%\\StudyGate\\`

常见文件有：

- `study-schedule.json`
- `study-schedule-cache.json`
- `study-tools-state.json`
- `session-state.json`
- `origin-storage-state.json`
- `baidu-netdisk-state.json`
- `navigation-debug.log`
- `reminder-debug.log`

## 开发和打包

安装依赖：

```powershell
npm install
```

开发运行：

```powershell
npm start
```

打包：

```powershell
npm run build
```

输出目录：

- `dist/StudyGate-win32-x64/`
- `dist/StudyGate-win32-x64.zip`

这是便携版，直接解压后运行：

- `StudyGate.exe`

## 现在这版的限制

- 不是完整浏览器
- 没有地址栏、标签页、扩展、开发者工具
- 不提供完整百度网盘界面
- 右键菜单和常见跳转快捷键被限制
- 不允许自由下载

## 出问题先看哪里

如果遇到问题，先看这些日志：

- `blocked-requests.log`
- `navigation-debug.log`
- `reminder-debug.log`

最常见的问题是：

- 网课站跳转范围没放够
- 百度网盘授权状态失效
- 远程课表地址或 token 配错
