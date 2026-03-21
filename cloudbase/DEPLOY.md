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

如果你还要接 OpenClaw 这类智能体，再额外准备一个 `AGENT_WRITE_TOKEN`。

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

需要部署七个云函数：

1. `scheduleAdmin`
2. `schedulePublic`
3. `homeworkAdmin`
4. `homeworkPublic`
5. `agentAccessAdmin`
6. `agentAccessPublic`
7. `skillPublic`

目录分别是：

1. [scheduleAdmin](q:/singlewebsite/cloudbase/functions/scheduleAdmin)
2. [schedulePublic](q:/singlewebsite/cloudbase/functions/schedulePublic)
3. [homeworkAdmin](q:/singlewebsite/cloudbase/functions/homeworkAdmin)
4. [homeworkPublic](q:/singlewebsite/cloudbase/functions/homeworkPublic)
5. [agentAccessAdmin](q:/singlewebsite/cloudbase/functions/agentAccessAdmin)
6. [agentAccessPublic](q:/singlewebsite/cloudbase/functions/agentAccessPublic)
7. [skillPublic](q:/singlewebsite/cloudbase/functions/skillPublic)

建议在 CloudBase 控制台里建一个集合：

1. `study_schedule`

文档 ID 统一用：

1. `main`

## 5. 配环境变量

给计划和作业云函数都配：

1. `SCHEDULE_COLLECTION=study_schedule`
2. `SCHEDULE_DOC_ID=main`

给 `schedulePublic` 再配：

1. `READ_TOKEN=你刚才生成的 token`
2. `STUDENT_WRITE_TOKEN=你刚才生成的学生写入 token`
3. `AGENT_WRITE_TOKEN=给学习助手改计划用的 token`

给 `homeworkPublic` 再配：

1. `READ_TOKEN=你刚才生成的 token`
2. `AGENT_WRITE_TOKEN=给智能体创建作业用的 token`

给 `agentAccessPublic` 再配：

1. `AGENT_WRITE_TOKEN=和上面同一个 token 即可`

给 `skillPublic`：

1. 默认不用配环境变量
2. 如果你不想公开下载，再额外配：
   `SKILL_DOWNLOAD_TOKEN=给 OpenClaw 下载技能包用的 token`

给 `scheduleAdmin` 再配：

1. `ADMIN_OPENIDS=先留空也行`

给 `homeworkAdmin` 再配：

1. `ADMIN_OPENIDS=和 scheduleAdmin 一样即可`

给 `agentAccessAdmin` 再配：

1. `ADMIN_OPENIDS=和 scheduleAdmin 一样即可`

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

如果是智能体要先读当前计划，也可以用：

```powershell
Invoke-RestMethod -Uri 'https://你的地址/api/schedule' -Headers @{ Authorization = 'Bearer 你的AGENT_WRITE_TOKEN' }
```

保存学生计划也可以测：

```powershell
Invoke-RestMethod -Method Post -Uri 'https://你的地址/api/schedule' -Headers @{ Authorization = 'Bearer 你的STUDENT_WRITE_TOKEN'; 'Content-Type' = 'application/json' } -Body '{"action":"saveStudentItems","items":[]}'
```

返回里如果有：

1. `updatedAt`
2. `items`

就说明通了。

智能体变更也可以测。建议先用 `AGENT_WRITE_TOKEN` 把当前计划读出来，再把你要新增后的完整 `parentItems` / `studentItems` 发给 `submitAgentPlanRequest`。

规则是：

1. 纯新增会直接生效
2. 删除或覆盖会进入小程序“计划管理 > 智能体申请”等待确认
3. 处理状态可以再用 `action=getAgentPlanRequestStatus` 加 `requestId` 查询

智能体创建作业时，调用的是 `homeworkPublic`：

1. `action=submitAgentHomeworkRequest`
2. `Authorization: Bearer 你的AGENT_WRITE_TOKEN`
3. 字段建议包括：
   `subject`
   `bucket`
   `targetDate`
   `sourceUrls` / `sourceFiles` / `inlineSources`

规则是：

1. 不传 `sourceUrls` 会创建空白作业
2. 传 `sourceUrls`、`sourceFiles` 或 `inlineSources` 时，只支持“单个 PDF”或“多张图片”
3. `sourceFiles` 适合学习助手拿到本地临时图片文件时直接上传，不需要公网地址
4. `inlineSources` 适合学习助手已经拿到 base64 图片内容的情况
5. 也支持批量创建：`action=submitAgentHomeworkRequests` + `requests=[...]`
6. 请求先进云端队列，再由桌面端同步创建本地作业
7. 创建完成后，可以再用 `action=getAgentHomeworkRequestStatus` + `requestId`，或者 `action=getAgentHomeworkRequestStatuses` + `requestIds` 查询是否已变成 `completed`

智能体删除作业时，同样调用 `homeworkPublic`：

1. `action=submitAgentHomeworkDeleteRequest`
2. `Authorization: Bearer 你的AGENT_WRITE_TOKEN`
3. 字段至少要带：
   `jobId`
4. 删除请求会先进入 `pending_review`，家长要在小程序“系统管理 > 智能体作业申请”里批准
5. 批量删除可用：`action=submitAgentHomeworkDeleteRequests` + `requests=[...]`
6. 审核通过后，请求会变成 `approved`，桌面端下次同步时才会真正删除
7. 删除完成后，也可以再用 `action=getAgentHomeworkRequestStatus` + `requestId`，或者 `action=getAgentHomeworkRequestStatuses` + `requestIds` 查询是否已变成 `completed`

如果你想让学习助手自己申请 token，再给 `agentAccessPublic` 开 HTTP 访问。

建议路径：

1. `/api/agent-access`

这个函数支持：

1. `POST action=requestAgentAccess`
2. `POST action=getAgentAccessRequestStatus`
3. 学习助手第一次没有 token 时，会先自动申请
4. 家长在小程序“系统管理 > 智能体接入授权”里批准后，它就能自动领取 token

你可以先测：

```powershell
Invoke-RestMethod -Method Post -Uri 'https://你的地址/api/agent-access' -Headers @{ 'Content-Type' = 'application/json' } -Body '{"action":"requestAgentAccess","requestId":"openclaw-access-test","clientId":"openclaw-test","label":"学习助手","claimSecret":"test-secret"}'
```

如果你要让 OpenClaw 直接下载技能包，再给 `skillPublic` 开 HTTP 访问。

这个函数支持：

1. 直接 `GET`：返回技能包元信息
2. `GET ?action=download`：下载 `study-helper.zip`
3. 如果你配置了 `SKILL_DOWNLOAD_TOKEN`，就加：
   `Authorization: Bearer 你的SKILL_DOWNLOAD_TOKEN`

你可以先测：

```powershell
Invoke-RestMethod -Uri 'https://你的地址/api/skill'
```

下载技能包可以测：

```powershell
Invoke-WebRequest -Uri 'https://你的地址/api/skill?action=download' -OutFile study-helper.zip
```

## 8. 配桌面程序

把桌面程序根目录的 [config.json](q:/singlewebsite/config.json) 里这两段填好：

```json
{
  "remoteSchedule": {
    "url": "https://你的计划 HTTP 地址",
    "authToken": "你的READ_TOKEN",
    "refreshMinutes": 3
  },
  "remoteHomework": {
    "url": "https://你的作业 HTTP 地址",
    "authToken": "你的READ_TOKEN",
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

如果用了智能体入口：

1. 学习助手第一次调用时会先走 `/api/agent-access` 申请 token
2. 家长在小程序系统管理里批准智能体接入
3. 学习助手自动拿到 `AGENT_WRITE_TOKEN`
4. 智能体用这个 token 读当前计划并提交变更
5. 纯新增直接生效
6. 删除或覆盖由家长在小程序里确认后再生效
7. 智能体创建作业时，改走 `homeworkPublic`
8. 桌面程序会轮询 `remoteHomework`，把待创建作业同步到本地 HomeworkApp

## 10. 出问题先查哪里

如果小程序里不能保存：

1. 第一次引导时，看 `scheduleAdmin` 的环境变量里 `ADMIN_OPENIDS` 对不对
2. 看小程序页面显示的 `OPENID`

如果桌面程序拉不到：

1. 先在浏览器或 `Invoke-RestMethod` 里测 `remoteSchedule.url`
2. 确认 `Authorization: Bearer <READ_TOKEN>` 能返回 JSON
3. 如果没配 `STUDENT_WRITE_TOKEN`，先让桌面端打开“学生计划”自动发起申请，再在小程序系统管理里批准
4. 如果配了 `STUDENT_WRITE_TOKEN`，确认 `Authorization: Bearer <STUDENT_WRITE_TOKEN>` 发 `POST` 能保存学生计划
5. 再测一次 `remoteHomework.url`，确认 `Authorization: Bearer <READ_TOKEN>` 能返回待创建作业列表
6. 再看桌面程序首页右侧的同步状态

## 11. 现在这套里最重要的 4 个值

你真正要保管好的就是这些值：

1. 小程序 `appid`
2. CloudBase `envId`
3. `READ_TOKEN`
4. `STUDENT_WRITE_TOKEN`（如果你想跳过审批，才需要）
5. 你的 `OPENID`
6. `AGENT_WRITE_TOKEN`（如果你接了智能体）
