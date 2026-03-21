# CloudBase 方案

这套目录是给 `微信小程序 + CloudBase` 管理端用的。

目录说明：

- `functions/scheduleAdmin`：小程序调用的计划管理云函数
- `functions/schedulePublic`：给桌面程序拉课表和保存学生计划的 HTTP 云函数
- `functions/homeworkAdmin`：作业请求的管理云函数
- `functions/homeworkPublic`：给智能体提交作业创建请求、给桌面程序拉取待创建作业的 HTTP 云函数
- `functions/agentAccessAdmin`：小程序里批准“学习助手”接入申请的管理云函数
- `functions/agentAccessPublic`：给学习助手自动申请/轮询授权 token 的 HTTP 云函数
- `functions/skillPublic`：给 OpenClaw 下载“学习助手”技能包的 HTTP 云函数
- `miniprogram`：家长自己用的小程序管理端

如果你现在就要开始部署，直接看：

- [DEPLOY.md](q:/singlewebsite/cloudbase/DEPLOY.md)

## 1. 你需要准备的东西

- 一个微信小程序 AppID
- 一个 CloudBase 环境 ID
- 一个给桌面程序读课表用的 `READ_TOKEN`
- 一个给桌面程序写学生计划用的 `STUDENT_WRITE_TOKEN`
- 一个给智能体提交计划变更的 `AGENT_WRITE_TOKEN`（可选）
- 你自己的微信 `OPENID`

两个 token 可以直接一起生成：

```powershell
npm run cloudbase:token
```

## 2. CloudBase 环境变量

计划和作业云函数都建议设置：

- `SCHEDULE_COLLECTION=study_schedule`
- `SCHEDULE_DOC_ID=main`

`scheduleAdmin` 还需要：

- `ADMIN_OPENIDS=你的openid1,你的openid2`

说明：

- 这个环境变量现在只建议用于第一次引导
- 第一次打开小程序刷新身份后，管理员名单会自动落到数据库
- 第一次进小程序后，后续管理员增删都可以直接在小程序里做
- 小程序会把管理员名单保存到 `study_admins/main`

`schedulePublic` 还需要：

- `READ_TOKEN=你给桌面程序的只读 token`
- `STUDENT_WRITE_TOKEN=你给桌面程序写学生计划的 token`
- `AGENT_WRITE_TOKEN=你给 OpenClaw 之类智能体改计划的 token`

`homeworkPublic` 还需要：

- `READ_TOKEN=你给桌面程序拉作业请求和回写完成状态的 token`
- `AGENT_WRITE_TOKEN=你给 OpenClaw 之类智能体创建作业的 token`

`agentAccessPublic` 还需要：

- `AGENT_WRITE_TOKEN=批准后要下发给学习助手的 token`

`agentAccessAdmin` 还需要：

- `ADMIN_OPENIDS=和 scheduleAdmin 一样即可`

`skillPublic` 默认不需要环境变量。

如果你不想公开下载，也可以额外配置：

- `SKILL_DOWNLOAD_TOKEN=你给 OpenClaw 下载技能包用的 token`

## 3. 小程序端

编辑：

- `miniprogram/config.js`

把 `envId` 改成你的 CloudBase 环境 ID。

`scheduleAdmin` 支持的动作：

- `whoami`：返回当前小程序用户的 `OPENID`
- `list`：读课表
- `saveAll`：整体保存课表
- `listAdmins`：读当前管理员列表
- `addAdmin`：添加管理员
- `removeAdmin`：移除管理员
- `listAgentPlanRequests`：查看智能体变更申请
- `approveAgentPlanRequest`：批准删除/覆盖类申请
- `rejectAgentPlanRequest`：驳回智能体申请

`homeworkAdmin` 支持的动作：

- `whoami`：返回当前小程序用户身份以及是否管理员
- `listAgentHomeworkRequests`：查看智能体作业创建请求
- `getAgentHomeworkRequestStatus`：按 `requestId` 查询作业创建状态

`agentAccessAdmin` 支持的动作：

- `whoami`：返回当前小程序用户身份以及是否管理员
- `listAgentAccessRequests`：查看学习助手接入申请
- `approveAgentAccessRequest`：批准学习助手接入申请
- `rejectAgentAccessRequest`：驳回学习助手接入申请

第一次可以先让小程序跑起来，点“刷新身份”，拿到自己的 `OPENID`，再把它填进 `ADMIN_OPENIDS`。等你进入小程序后，后面就直接在小程序页面里加你老婆，不用再回云函数环境变量。

## 4. 桌面程序端

给桌面程序配置：

```json
{
  "remoteSchedule": {
    "url": "https://你的计划 HTTP 地址",
    "authToken": "和 READ_TOKEN 一致",
    "refreshMinutes": 3
  },
  "remoteHomework": {
    "url": "https://你的作业 HTTP 地址",
    "authToken": "和 READ_TOKEN 一致",
    "refreshMinutes": 3
  }
}
```

`schedulePublic` 支持：

- `GET`
- `Authorization: Bearer <READ_TOKEN>` 或 `Authorization: Bearer <AGENT_WRITE_TOKEN>`
- `POST`
- `Authorization: Bearer <STUDENT_WRITE_TOKEN>`，可直接保存学生计划
- `Authorization: Bearer <READ_TOKEN>` + 桌面端自动申请并经家长批准后的设备身份，也可以保存学生计划
- `Authorization: Bearer <AGENT_WRITE_TOKEN>`，可提交智能体计划变更申请

不再接受：

- `?token=...`

返回格式：

```json
{
  "updatedAt": "2026-03-13T07:00:00.000Z",
  "items": [
    {
      "id": "english-mon",
      "title": "说课英语",
      "target": "english-course",
      "time": "18:30",
      "weekdays": [1, 3, 5],
      "message": "到说课英语时间了。"
    }
  ]
}
```

智能体变更这条链路：

- `submitAgentPlanRequest`：提交智能体计划修改
- `getAgentPlanRequestStatus`：按 `requestId` 查询处理状态
- 纯新增计划会直接生效，并在申请记录里标记为 `approved`
- 删除或覆盖现有计划会进入管理端“小程序 > 计划管理 > 智能体申请”等待人工确认

`homeworkPublic` 支持：

- `GET`
- `Authorization: Bearer <READ_TOKEN>`，桌面端读取待创建作业请求
- `POST`
- `Authorization: Bearer <AGENT_WRITE_TOKEN>`，提交或查询智能体作业创建请求
- `Authorization: Bearer <AGENT_WRITE_TOKEN>`，提交或查询智能体作业删除请求
- `Authorization: Bearer <READ_TOKEN>`，桌面端回写作业创建完成状态

智能体创建作业这条链路：

- `submitAgentHomeworkRequest`：提交单条作业创建请求
- `submitAgentHomeworkRequests`：批量提交作业创建请求
- `submitAgentHomeworkDeleteRequest`：提交单条作业删除请求
- `submitAgentHomeworkDeleteRequests`：批量提交作业删除请求
- `getAgentHomeworkRequestStatus`：按 `requestId` 查询单条状态
- `getAgentHomeworkRequestStatuses`：按 `requestIds` 批量查询状态
- 创建作业会直接进入云端队列，再由桌面端同步创建本地作业
- 删除作业会先进入 `pending_review`，要等家长在小程序“系统管理 > 智能体作业申请”里批准后，桌面端才会执行删除
- 桌面端创建或删除成功后都会把状态回写成 `completed`
- 支持四种模式：
  - 空白作业：不传任何来源字段
  - 远程文件作业：传 `sourceUrls`
  - 本地文件作业：传 `sourceFiles`
  - 直接内嵌文件：传 `inlineSources`
- 不管来源字段怎么组合，整次请求都只支持“单个 PDF”或“多张图片”，不支持 PDF 和图片混传
- 删除作业时必须传 `jobId`

`agentAccessPublic` 支持：

- `POST action=requestAgentAccess`
- `POST action=getAgentAccessRequestStatus`
- 学习助手第一次没有 token 时，会先提交接入申请
- 家长在小程序“系统管理 > 智能体接入授权”里批准后，学习助手就能自动领取 `AGENT_WRITE_TOKEN`
- 学习助手会把拿到的 token 缓存到当前机器的 `~/.openclaw/study-helper-auth.json`

`skillPublic` 支持：

- `GET`
- 默认返回技能包元信息
- `?action=download` 返回 `study-helper.zip`
- 如果配置了 `SKILL_DOWNLOAD_TOKEN`，就需要：
  `Authorization: Bearer <SKILL_DOWNLOAD_TOKEN>`

## 5. 目标字段

桌面程序当前能识别这些 `target`：

- `english-course`
- `great-chinese`
- `teacher-library`

留空表示“只提醒，不跳转”，适合：

- 看书
- 做作业
- 背单词

## 6. 备注

- 这套 CloudBase 代码是独立骨架，不会影响当前桌面程序已有的本地版和自建服务端版。
- 桌面程序本身已经支持远程拉课表和单独保存学生计划，所以 CloudBase 这边要把读写 token 都配好。
