---
version: "1.2.4"
name: study-helper
description: 学习助手 / Study Helper。用于让 OpenClaw 通过已部署的 schedulePublic 和 homeworkPublic 管理 StudyGate 的计划与作业，包括读取计划、创建计划、修改计划、删除计划、查询计划状态、创建作业、查询作业状态，并支持把本地图片或 PDF 直接上传成作业来源。
author: StudyGate
homepage: https://github.com/chr-visesky/singlewebsite/tree/main/skills/study-helper
source: https://github.com/chr-visesky/singlewebsite
user-invocable: true
metadata: {"openclaw":{"skillKey":"study-helper","emoji":"📚","homepage":"https://github.com/chr-visesky/singlewebsite/tree/main/skills/study-helper","primaryEnv":"STUDYGATE_SCHEDULE_PUBLIC_URL","requires":{"bins":["node"],"env":["STUDYGATE_SCHEDULE_PUBLIC_URL"]}}}
---

# 学习助手

优先使用 `{baseDir}/scripts/study-helper.js` 这个辅助命令行，不要手写原始 HTTP 请求。

## 中文触发词

下面这些中文表达都应该自然触发这个 skill：

- 学习助手
- 申请授权
- 授权状态
- 读取计划
- 创建计划
- 修改计划
- 删除计划
- 查询计划状态
- 创建作业
- 查询作业状态
- 用图片创建作业
- 批量创建作业
- 批量查询作业状态

## 所需环境

需要为这个 skill 配置以下环境变量：

- `STUDYGATE_SCHEDULE_PUBLIC_URL`

可选覆盖：

- `STUDYGATE_HOMEWORK_PUBLIC_URL`
- `STUDYGATE_AGENT_ACCESS_URL`
- `STUDYGATE_AGENT_WRITE_TOKEN`
- `STUDYGATE_SCHEDULE_AGENT_WRITE_TOKEN`
- `STUDYGATE_HOMEWORK_AGENT_WRITE_TOKEN`

默认只配 `STUDYGATE_SCHEDULE_PUBLIC_URL` 也可以。脚本会自动推导：

- `homeworkPublic` 为同域的 `/api/homework`
- `agentAccessPublic` 为同域的 `/api/agent-access`

如果你已经给 skill 手动配过 `STUDYGATE_AGENT_WRITE_TOKEN`，脚本会直接用；如果没配，脚本会自动发起“学习助手接入申请”，等家长在管理端批准后，把 token 缓存在本机。

## 命令

可以在 skill 目录里运行，也可以传完整脚本路径。

```bash
node {baseDir}/scripts/study-helper.js 申请授权
node {baseDir}/scripts/study-helper.js 授权状态
node {baseDir}/scripts/study-helper.js 清除授权
node {baseDir}/scripts/study-helper.js 读取计划
node {baseDir}/scripts/study-helper.js 创建计划 --载荷文件 /tmp/plan-create.json
node {baseDir}/scripts/study-helper.js 修改计划 --载荷文件 /tmp/plan-update.json
node {baseDir}/scripts/study-helper.js 删除计划 --载荷文件 /tmp/plan-delete.json
node {baseDir}/scripts/study-helper.js 计划状态 --请求编号 openclaw-plan-123
node {baseDir}/scripts/study-helper.js 创建作业 --载荷文件 /tmp/homework.json
node {baseDir}/scripts/study-helper.js 作业状态 --请求编号 openclaw-homework-123
```

脚本会把 JSON 输出到标准输出；如果校验失败或 HTTP 调用失败，会以非零退出码结束。

## 授权流程

第一次没 token 时，不用让用户手抄 token。脚本会这样做：

1. 自动调用 `agentAccessPublic` 提交“学习助手接入申请”
2. 等家长在小程序“系统管理 > 智能体接入授权”里批准
3. 下次执行任意学习助手命令时，脚本会自动领取 token
4. token 会缓存到当前机器的 `~/.openclaw/study-helper-auth.json`

如果你想手动看进度，可以执行“授权状态”。

## 计划流程

1. 先执行“读取计划”。
2. 新增计划时，用“创建计划”。它直接调用后端的新增接口，纯新增会直接生效。
3. 修改现有计划时，用“修改计划”。它只提交命中的那几条计划，不会整组替换，通常会进入待确认。
4. 删除计划时，用“删除计划”。它只提交命中的那几条计划，不会整组替换，通常会进入待确认。
5. 如果返回状态是 `pending`，要明确告诉用户：这次修改正在等待家长在管理端小程序里确认。
6. 用户追问进度时，再用“计划状态”查询。

注意：

- 计划接口已经禁用了整组替换；不要尝试构造 `parentItems` / `studentItems` 全量回写。
- “修改计划”“删除计划”应优先使用 `id` 精确命中；没有 `id` 时，再提供尽量精确的时间/日期/星期条件。
- 是否直接生效、还是进入待确认，最终由后端决定，不由这个 skill 决定。

“创建计划”最小请求体示例：

```json
{
  "scope": "student",
  "title": "今天12点吃饭",
  "specificDate": "2026-03-21",
  "time": "12:00",
  "message": "记得按时吃饭"
}
```

“删除计划”最小请求体示例：

```json
{
  "id": "student-schedule-abc123"
}
```

如果没填 `requestId`、`agentId`、`label`，脚本会自动补默认值。

## 作业流程

### 从对话里提取信息

处理“创建作业”时，优先从当前对话里直接提取这些信息，不要先把责任推回给用户：

- `subject`：从用户文字里提取科目，例如“数学作业”“语文卷子”“英语抄写”。
- `targetDate`：从用户文字里提取日期；如果用户说“今天”“明天”“后天”，先换算成明确的 `YYYY-MM-DD` 再提交。
- 作业图片：优先使用当前对话里已经提供的图片或本地临时图片文件，不要要求用户先把图片变成公网 URL。

如果一次对话里给了多张作业图片：

- 按用户发送顺序保留图片顺序。
- 只要这些图片属于同一次作业，就应作为同一份作业一起提交。
- 不要因为第一张已经能看懂就忽略后面的图片；默认要把这一轮对话里同一份作业的所有图片都带上。

如果以上三个字段里有缺失：

- 缺科目：再追问科目。
- 缺日期：先结合上下文判断；如果对话里没有明确日期，就默认使用这条消息发给智能体当天的本地日期作为 `targetDate`，不要先追问。
- 缺图片：明确告诉上层当前还没有可创建的作业图片。

不要把“从对话中提取科目、日期、作业图片”当成可选优化；这是默认行为。

典型场景示例：

- 老师在对话里说“这是今天的数学作业，晚上做完”，并附上一张作业图片。
  这时应提取：
  - `subject = 数学`
  - `targetDate = 对应今天的明确日期`
  - 作业图片 = 当前消息里附带的那张图片
- 老师在对话里说“明天交语文卷子，图片发你了”，并附上两张卷子图片。
  这时应提取：
  - `subject = 语文`
  - `targetDate = 明天对应的明确日期`
  - 作业图片 = 这两张按发送顺序排列的图片
- 老师只说“这是数学作业，做完发我”，没有写日期，但附了一张作业图片。
  这时应提取：
  - `subject = 数学`
  - `targetDate = 这条消息发给智能体当天的本地日期`
  - 作业图片 = 当前消息里附带的那张图片

不要把老师的聊天文字截图本身当作业图片上传；应把聊天里真正附带的作业图片作为 `sourceFiles` 或 `inlineSources` 提交。

“创建作业”支持三种来源模式：

- 空白作业：不传 `sourceUrls`
- 远程文件作业：传 `sourceUrls`
- 本地文件作业：传 `sourceFiles`
- 直接内嵌文件：传 `inlineSources`

规则：

- `sourceUrls`、`sourceFiles`、`inlineSources` 可以混合使用，但整次请求里仍然只能是“单个 PDF”或“多张图片”。
- `sourceFiles` 适合 OpenClaw 已经拿到本地临时图片文件时直接上传，不需要先做公网地址。
- `inlineSources` 适合上层已经拿到 base64 文件内容的情况。
- 对话里如果附了很多张同一份作业图片，默认要作为同一份作业的多页图片一起提交，不要拆成很多份单页作业。
- `requests` 数组可用于批量创建、批量删除和批量查询状态。

最小作业创建请求体示例：

```json
{
  "subject": "Math",
  "bucket": "课内",
  "targetDate": "2026-03-20",
  "sourceFiles": [
    "/tmp/page-1.png"
  ]
}
```

提交之后：

1. 告诉用户：请求已经进入队列。
2. 创建作业会直接进入桌面端同步队列。
3. 告诉用户：要等桌面端同步后，状态才会变成 `completed`。
4. 用户追问进度时，用“作业状态”查询。

注意：

- 智能体作业删除接口已移除，不要尝试删除作业。

## 结果解释

结果要这样理解：

- 计划提交返回 `status: "applied"`，表示后端已经直接接受并生效。
- 计划提交返回 `status: "pending"`，表示这次修改需要人工确认。
- 作业创建返回 `status: "pending"`，表示请求已经进入桌面端同步队列。
- 查询作业状态时如果 `request.status: "completed"`，表示桌面端已经完成了动作。

如果 API 返回了 `error` 字段，就直接把错误告诉上层，不要自己编造兜底逻辑。
