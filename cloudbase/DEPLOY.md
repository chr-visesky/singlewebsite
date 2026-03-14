# 部署步骤

这份是按“你照着点就行”的顺序写的。

目标：

1. 小程序里改课表
2. CloudBase 存课表
3. 桌面程序从 CloudBase HTTP 接口拉课表，并单独保存学生计划

## 1. 先生成读写 token

在项目根目录运行：

```powershell
npm run cloudbase:token
```

把输出里的 `READ_TOKEN` 和 `STUDENT_WRITE_TOKEN` 都先留着，后面要用。

## 2. 准备小程序和 CloudBase

你需要：

1. 一个微信小程序 AppID
2. 一个 CloudBase 环境 ID

先改这两个文件：

1. [project.config.json](q:/singlewebsite/cloudbase/project.config.json)
2. [config.js](q:/singlewebsite/cloudbase/miniprogram/config.js)

要改的值：

1. `appid`
2. `envId`

## 3. 导入小程序工程

在微信开发者工具里：

1. 打开 [cloudbase](q:/singlewebsite/cloudbase)
2. 让开发者工具自动识别 `project.config.json`
3. 项目类型一定要是 `小程序`，不是 `小游戏`
4. 确认已经绑定到同一个 CloudBase 环境

如果你之前导入过 [miniprogram](q:/singlewebsite/cloudbase/miniprogram) 子目录，先把微信开发者工具里那条旧项目删掉，再重新导入 [cloudbase](q:/singlewebsite/cloudbase) 根目录。不然旧缓存可能会继续把它按错误方式启动。

## 4. 部署云函数

需要部署两个云函数：

1. `scheduleAdmin`
2. `schedulePublic`

目录分别是：

1. [scheduleAdmin](q:/singlewebsite/cloudbase/functions/scheduleAdmin)
2. [schedulePublic](q:/singlewebsite/cloudbase/functions/schedulePublic)

建议在 CloudBase 控制台里建一个集合：

1. `study_schedule`

文档 ID 统一用：

1. `main`

## 5. 配环境变量

给两个云函数都配：

1. `SCHEDULE_COLLECTION=study_schedule`
2. `SCHEDULE_DOC_ID=main`

给 `schedulePublic` 再配：

1. `READ_TOKEN=你刚才生成的 token`
2. `STUDENT_WRITE_TOKEN=你刚才生成的学生写入 token`

给 `scheduleAdmin` 再配：

1. `ADMIN_OPENIDS=先留空也行`

说明：

1. 这个值现在只用来做第一次管理员引导
2. 第一次进入小程序后，管理员名单会自动写进数据库
3. 后面都在小程序里直接加减管理员

## 6. 先拿自己的 OPENID

现在先不要急着配 `ADMIN_OPENIDS`。

先在微信开发者工具里运行小程序，然后在页面里点：

1. `刷新身份`

当前小程序会调用 `scheduleAdmin` 的 `whoami`，把你当前微信身份对应的 `OPENID` 显示出来。

拿到之后，把它填回 `scheduleAdmin` 的环境变量：

1. `ADMIN_OPENIDS=你的openid`

然后重新部署 `scheduleAdmin`。

后面如果你要加你老婆：

1. 让她用自己的微信打开小程序
2. 点一次 `刷新身份`
3. 把她页面里显示的 `OPENID` 发给你
4. 你在小程序的“管理员”区域直接把她加进去

这一步之后，就不需要再回环境变量维护 `ADMIN_OPENIDS` 了。

## 7. 给 `schedulePublic` 开 HTTP 访问

在 CloudBase 控制台里，给 `schedulePublic` 开 HTTP 访问。

你最终需要拿到一个可公开访问的 HTTPS 地址，类似：

```text
https://xxxxxx.service.tcloudbase.com/api/schedule
```

如果 CloudBase 控制台给你的不是这个完整路径，就把它映射到你自己想要的路径，但最终桌面程序里填的是能直接 `GET` 到 JSON 的地址。

你可以先测：

```powershell
Invoke-RestMethod -Uri 'https://你的地址/api/schedule' -Headers @{ Authorization = 'Bearer 你的READ_TOKEN' }
```

保存学生计划也可以测：

```powershell
Invoke-RestMethod -Method Post -Uri 'https://你的地址/api/schedule' -Headers @{ Authorization = 'Bearer 你的STUDENT_WRITE_TOKEN'; 'Content-Type' = 'application/json' } -Body '{"action":"saveStudentItems","items":[]}'
```

返回里如果有：

1. `updatedAt`
2. `items`

就说明通了。

## 8. 配桌面程序

把桌面程序根目录的 [config.json](q:/singlewebsite/config.json) 里这段填好：

```json
{
  "remoteSchedule": {
    "url": "https://你的HTTP地址/api/schedule",
    "authToken": "你的READ_TOKEN",
    "studentWriteToken": "你的STUDENT_WRITE_TOKEN",
    "refreshMinutes": 3
  }
}
```

然后重新打开桌面程序。

## 9. 正常使用

以后流程就是：

1. 家长在微信小程序里改课表
2. `scheduleAdmin` 写数据库
3. 桌面程序每隔几分钟拉一次 `schedulePublic`
4. 到时间后电脑发声提醒

## 10. 出问题先查哪里

如果小程序里不能保存：

1. 第一次引导时，看 `scheduleAdmin` 的环境变量里 `ADMIN_OPENIDS` 对不对
2. 看小程序页面显示的 `OPENID`

如果桌面程序拉不到：

1. 先在浏览器或 `Invoke-RestMethod` 里测 `remoteSchedule.url`
2. 确认 `Authorization: Bearer <READ_TOKEN>` 能返回 JSON
3. 确认 `Authorization: Bearer <STUDENT_WRITE_TOKEN>` 发 `POST` 能保存学生计划
3. 再看桌面程序首页右侧的同步状态

## 11. 现在这套里最重要的 4 个值

你真正要保管好的就是这 4 个：

1. 小程序 `appid`
2. CloudBase `envId`
3. `READ_TOKEN`
4. `STUDENT_WRITE_TOKEN`
5. 你的 `OPENID`
