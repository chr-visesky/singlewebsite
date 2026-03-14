# CloudBase 方案

这套目录是给 `微信小程序 + CloudBase` 管理端用的。

目录说明：

- `functions/scheduleAdmin`：小程序调用的管理云函数
- `functions/schedulePublic`：给桌面程序拉课表和保存学生计划的 HTTP 云函数
- `miniprogram`：家长自己用的小程序管理端

如果你现在就要开始部署，直接看：

- [DEPLOY.md](q:/singlewebsite/cloudbase/DEPLOY.md)

## 1. 你需要准备的东西

- 一个微信小程序 AppID
- 一个 CloudBase 环境 ID
- 一个给桌面程序读课表用的 `READ_TOKEN`
- 一个给桌面程序写学生计划用的 `STUDENT_WRITE_TOKEN`
- 你自己的微信 `OPENID`

两个 token 可以直接一起生成：

```powershell
npm run cloudbase:token
```

## 2. CloudBase 环境变量

两个云函数都建议设置：

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

第一次可以先让小程序跑起来，点“刷新身份”，拿到自己的 `OPENID`，再把它填进 `ADMIN_OPENIDS`。等你进入小程序后，后面就直接在小程序页面里加你老婆，不用再回云函数环境变量。

## 4. 桌面程序端

给桌面程序配置：

```json
{
  "remoteSchedule": {
    "url": "https://你的-http-访问地址",
    "authToken": "和 READ_TOKEN 一致",
    "refreshMinutes": 3
  }
}
```

`schedulePublic` 支持：

- `GET`
- `Authorization: Bearer <READ_TOKEN>`
- `POST`
- `Authorization: Bearer <STUDENT_WRITE_TOKEN>`，可直接保存学生计划
- `Authorization: Bearer <READ_TOKEN>` + 桌面端自动申请并经家长批准后的设备身份，也可以保存学生计划

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
