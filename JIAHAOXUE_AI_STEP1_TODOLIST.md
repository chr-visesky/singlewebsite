# 嘉好学 AI 升级 Step 1 TODO List

版本：v0.4  
日期：2026-06-28  
对应 SPEC：`JIAHAOXUE_AI_UPGRADE_SPEC.md`  
Step 1 目标：先做一个本地可运行、可测试、可持续扩展，并且第一版就接入大模型的“通用 AI 学习底座”。小学奥数每日题集只是第一个落地 profile。

---

## 0. Step 1 一句话

Step 1 不做完整 AI 产品，也不做完整手写识别。

这一阶段只完成：

```text
内容库能读。
学习任务能生成。
孩子能一次提交当天任务答案。
系统能批量评价作答。
学生能力能更新。
复习队列能推进。
学习事件能产生。
基础奖励能按任务结算。
大模型能参与讲解、错因归类、能力分析和受控内容生成候选。
```

换句话说，Step 1 先把“Assignment -> Attempt -> Evaluation -> LearningEvent -> Mastery/Review/Reward”的骨架跑通。数学每日题集只是这个骨架上的第一个配置。

---

## 1. Step 1 范围

### 1.1 必须做

```text
1. 新增 AI learning 本地数据目录。
2. 新增通用 SkillNode 能力图谱种子数据。
3. 新增通用 ContentItem 内容库种子数据。
4. 新增 Assignment 任务生成 runtime。
5. 新增 Attempt 作答提交 runtime。
6. 新增 Evaluation 评价 runtime 和 grader 插件机制。
7. 新增 StudentModel 学生能力状态 runtime。
8. 新增 ReviewScheduler 固定间隔复习 runtime。
9. 新增 LearningEvent 可信学习事件 runtime。
10. 新增 Reward runtime，但只消费事件，不耦合具体学科。
11. 新增 AI provider、模型路由、AI task runtime。
12. 新增受控 AI 内容生成候选 runtime。
13. 新增小学奥数 daily_set profile，作为第一个 profile。
14. 新增最小 IPC，方便后续 UI 调用。
15. 新增单元级 smoke 脚本，验证完整闭环。
```

### 1.2 暂时不做

```text
1. 不做 Mathpix 接入。
2. 不让 AI 决定基础对错和基础奖励。
3. 不做 Windows Ink 新界面。
4. 不做复杂游戏大厅。
5. 不做家长周报。
6. 不做表格题和几何图自动判卷。
7. 不做云端同步。
8. 不做多学生账号系统。
```

这些不是不要，而是后置。Step 1 的判断标准是：底座不被“数学题集”锁死；没有大模型时 mock provider 也能跑通数据流；配置真实 API key 后，大模型能进入讲解、错因、能力分析和内容生成候选链路。

边界约束：

```text
Step 1 是 V1 底座 Sprint，不代表完整 V1；完整 V1 仍必须接入 Windows Ink 单草稿区。
通用底座不得替代小学奥数优先级；第一个必须跑通的 profile 是 math_olympiad_daily_set_v1。
```

---

## 2. 建议新增文件

### 2.1 Runtime 文件

```text
src/ai-learning-paths-runtime.js
src/ai-learning-json-store-runtime.js
src/skill-graph-runtime.js
src/content-bank-runtime.js
src/assignment-runtime.js
src/attempt-runtime.js
src/evaluation-runtime.js
src/graders/final-answer-grader.js
src/student-model-runtime.js
src/review-scheduler-runtime.js
src/training-policy-runtime.js
src/ai-provider-runtime.js
src/ai-model-routing-runtime.js
src/ai-task-runtime.js
src/content-generation-runtime.js
src/learning-event-runtime.js
src/game-reward-runtime.js
src/ai-learning-runtime.js
```

### 2.2 种子数据

```text
data/ai-learning/skill-nodes.seed.json
data/ai-learning/content-items.seed.json
data/ai-learning/profiles/math-olympiad-daily-set.profile.json
```

### 2.3 本地运行数据

运行时数据建议落在：

```text
%AppData%/StudyGate/ai-learning/
├─ skill-nodes.json
├─ content-items.json
├─ assignments.json
├─ attempts.json
├─ evaluations.json
├─ mastery.json
├─ review-queue.json
├─ learning-events.json
├─ ai-tasks.json
├─ ai-results.json
├─ generated-content-candidates.json
├─ game-state.json
└─ assets/
```

说明：现有 Electron 主程序已经把 `userData` 固定到 `%AppData%/StudyGate`，Step 1 优先沿用这个根目录。

### 2.4 测试/验证脚本

```text
scripts/ai-learning-step1-smoke.js
```

---

## 3. Step 1 数据模型

### 3.0 底座核心实体

Step 1 底座只认这些通用实体：

```text
SkillNode：能力点。数学知识点、英语词汇能力、语文阅读能力、作文结构能力都属于 SkillNode。
ContentItem：学习内容。题目、听写词、阅读材料、作文题、视频片段都属于 ContentItem。
Assignment：一次学习任务。每日题集、听写任务、作文任务、复习包都属于 Assignment。
Attempt：一次作答记录。学生对某个 ContentItem 的一次输入。
Evaluation：一次评价结果。程序判分、AI 点评、人工复核都属于 Evaluation。
LearningEvent：可信学习事件。mastery、review、reward、report 都只消费事件。
AiTask：一次大模型任务。讲解、错因、出题候选、能力分析、多模态识别都属于 AiTask。
```

V1 小学奥数每日题集只是一个 profile：

```text
SkillNode = 小学奥数知识点
ContentItem = 可程序判分的短答案数学题
Assignment = daily_set
Attempt = 每题最终答案
Evaluation = final_answer_grading + ai_feedback
LearningEvent = final_answer_correct/final_answer_wrong/spaced_review_passed
AiTask = explanation/diagnosis/daily_summary/content_generation
```

后续扩展不新增底座概念，只新增 profile、grader、contentType、assignmentType、aiTaskType。

术语映射：

```text
旧 KnowledgePoint -> SkillNode
旧 Question -> ContentItem(type=question)
旧 DailyPlan/DailySet -> Assignment(type=daily_set)
旧 Submission -> AttemptBatch
旧 GradingResult -> EvaluationBatch
旧 grading-runtime -> evaluation-runtime + grader plugin
旧 question-bank-runtime -> content-bank-runtime
旧 daily-set-runtime -> assignment-runtime + attempt-runtime
旧 ai-analysis-runtime -> ai-task-runtime
旧 ai-question-generation-runtime -> content-generation-runtime
```

### 3.1 SkillNode

```json
{
  "id": "math.application.chicken_rabbit",
  "subject": "math",
  "track": "olympiad",
  "title": "鸡兔同笼",
  "parentId": "math.application",
  "examImportance": 0.8,
  "defaultDifficulty": 2,
  "enabled": true
}
```

字段要求：

```text
id：稳定 ID，后续不要随便改。
subject：学科，V1 profile 先用 math，后续可以是 english/chinese。
track：学习轨道，V1 profile 先用 olympiad。
examImportance：0 到 1，用于出题优先级。
enabled：是否进入训练计划。
```

### 3.2 ContentItem

```json
{
  "id": "q_math_chicken_rabbit_001",
  "type": "question",
  "subject": "math",
  "skillNodeIds": ["math.application.chicken_rabbit"],
  "difficulty": 2,
  "contentType": "math_short_answer",
  "prompt": "鸡兔同笼，共有 35 个头，94 只脚。鸡和兔各有多少只？",
  "answerSchema": {
    "type": "object",
    "fields": [
      { "name": "鸡", "type": "number", "required": true },
      { "name": "兔", "type": "number", "required": true }
    ]
  },
  "standardAnswer": {
    "鸡": 23,
    "兔": 12
  },
  "evaluationPolicy": {
    "finalAnswerRequired": true,
    "processOptional": true
  },
  "enabled": true
}
```

V1 math profile 只支持这些 contentType：

```text
math_short_answer：单个数字/文本答案。
math_object_answer：多个命名答案，例如鸡兔同笼。
math_fraction_answer：分数答案，例如 3/4。
math_list_answer：顺序不敏感的短列表。
```

后续可扩展：

```text
english_dictation_item
english_reading_item
chinese_reading_item
chinese_writing_prompt
video_lesson_segment
```

### 3.3 Assignment

```json
{
  "id": "plan_default_child_2026-06-28",
  "studentId": "default_child",
  "type": "daily_set",
  "profileId": "math_olympiad_daily_set_v1",
  "dateKey": "2026-06-28",
  "createdAt": "2026-06-28T08:00:00+08:00",
  "status": "assigned",
  "sections": [
    {
      "type": "review",
      "title": "到期复习",
      "contentItemIds": ["q_math_remainder_001"]
    },
    {
      "type": "weakness",
      "title": "薄弱巩固",
      "contentItemIds": ["q_math_chicken_rabbit_001"]
    },
    {
      "type": "new",
      "title": "今日练习",
      "contentItemIds": ["q_math_sum_difference_001"]
    }
  ],
  "contentItemIds": [
    "q_math_remainder_001",
    "q_math_chicken_rabbit_001",
    "q_math_sum_difference_001"
  ]
}
```

### 3.4 Attempt Batch

```json
{
  "id": "set_sub_default_child_2026-06-28_001",
  "studentId": "default_child",
  "assignmentId": "plan_default_child_2026-06-28",
  "dateKey": "2026-06-28",
  "createdAt": "2026-06-28T20:15:00+08:00",
  "attempts": [
    {
      "id": "attempt_20260628_001",
      "contentItemId": "q_math_chicken_rabbit_001",
      "response": {
        "type": "final_answer",
        "raw": "鸡23只，兔12只",
        "source": "typed",
        "confidence": 1
      }
    }
  ],
  "behavior": {
    "durationSeconds": 1800,
    "revisedAnswer": false
  }
}
```

Step 1 暂不存草稿区，只给 Attempt 预留字段：

```json
{
  "rawWork": null
}
```

### 3.5 Evaluation Batch

```json
{
  "submissionId": "set_sub_default_child_2026-06-28_001",
  "assignmentId": "plan_default_child_2026-06-28",
  "studentId": "default_child",
  "dateKey": "2026-06-28",
  "summary": {
    "total": 10,
    "answered": 10,
    "correct": 7,
    "wrong": 3,
    "score": 70,
    "maxScore": 100
  },
  "evaluations": [
    {
      "id": "eval_20260628_001",
      "attemptId": "attempt_20260628_001",
      "contentItemId": "q_math_chicken_rabbit_001",
      "skillNodeIds": ["math.application.chicken_rabbit"],
      "type": "programmatic_final_answer",
      "verdict": {
        "isCorrect": true,
        "score": 10,
        "maxScore": 10,
        "confidence": 1,
        "normalizedAnswer": {
          "鸡": 23,
          "兔": 12
        }
      },
      "aiVerdict": {
        "status": "not_analyzed",
        "confidence": 0
      }
    }
  ]
}
```

### 3.6 MasteryState

```json
{
  "studentId": "default_child",
  "knowledgePointId": "math.application.chicken_rabbit",
  "mastery": 0.35,
  "stability": 0.1,
  "transfer": 0,
  "wrongCount": 0,
  "correctCount": 1,
  "lastPracticedAt": "2026-06-28T20:15:00+08:00",
  "nextReviewAt": "2026-06-29T20:15:00+08:00",
  "weakReason": ""
}
```

### 3.7 ReviewQueueItem

```json
{
  "studentId": "default_child",
  "knowledgePointId": "math.application.chicken_rabbit",
  "reviewStage": 1,
  "nextReviewAt": "2026-06-29T20:15:00+08:00",
  "lastReviewResult": "passed",
  "stability": 0.18
}
```

### 3.8 LearningEvent

```json
{
  "id": "evt_20260628_001",
  "studentId": "default_child",
  "type": "final_answer_correct",
  "knowledgePointId": "math.application.chicken_rabbit",
  "questionId": "q_math_chicken_rabbit_001",
  "submissionId": "set_sub_default_child_2026-06-28_001",
  "confidence": 1,
  "createdAt": "2026-06-28T20:15:00+08:00"
}
```

Step 1 事件类型：

```text
final_answer_correct
final_answer_wrong
spaced_review_passed
spaced_review_failed
daily_plan_completed
```

### 3.9 GameState

```json
{
  "studentId": "default_child",
  "xp": 20,
  "cards": {
    "math.application.chicken_rabbit": {
      "cardId": "math.application.chicken_rabbit",
      "name": "鸡兔同笼",
      "proficiency": 10,
      "stability": 0,
      "transfer": 0,
      "reviewStage": 1
    }
  },
  "rewardLog": []
}
```

---

## 4. Runtime 职责拆分

### 4.1 `ai-learning-paths-runtime.js`

职责：

```text
1. 根据 app.getPath('userData') 解析 ai-learning 目录。
2. 提供所有数据文件路径。
3. 确保目录存在。
4. 提供 submissions 子目录路径。
```

验收：

```text
可以在 smoke 脚本中创建临时目录并注入 path resolver。
不会把数据写进源码目录。
```

### 4.2 `skill-graph-runtime.js`

职责：

```text
1. 加载 SkillNode 能力图谱。
2. 如果本地不存在，复制 seed 数据。
3. 按 subject/track/enabled 过滤能力点。
4. 根据 skillNodeId 查询标题、父节点、考试重要度。
5. 支持后续英语、语文、作文能力点，不写死 math。
```

V1 math profile 初始 SkillNode 建议只放 8 到 12 个：

```text
鸡兔同笼
和差倍
年龄问题
余数
整除
等差求和
周长面积
枚举
```

### 4.3 `content-bank-runtime.js`

职责：

```text
1. 加载 ContentItem 内容库。
2. 如果本地不存在，复制 seed 数据。
3. 按 skillNodeIds、difficulty、contentType 筛内容。
4. 排除最近练过的内容。
5. 根据 contentItemId 查询内容。
6. 不假设所有内容都是题目。
```

V1 math profile 题量建议：

```text
每个知识点 3 到 5 题。
总数先控制在 30 到 50 题。
全部必须是程序可判的最终答案题。
```

### 4.4 `evaluation-runtime.js` + `graders/*`

职责：

```text
1. 选择合适 grader。
2. 批量评价 Attempt。
3. 返回稳定的 Evaluation。
4. 支持程序评价、AI 评价、人工复核评价三类来源。
5. V1 先实现 `graders/final-answer-grader.js`。
```

V1 `final-answer-grader` 支持：

```text
中文数字暂不做，只支持阿拉伯数字。
支持空格、逗号、中文标点清洗。
支持“鸡23只，兔12只”解析为 object。
支持 1/2 和 2/4 分数等价。
支持简单单位忽略，例如 “23只” -> 23。
```

不支持：

```text
复杂表达式求值。
手写 OCR 结果纠错。
自然语言长答案。
几何证明。
```

### 4.5 `student-model-runtime.js`

职责：

```text
1. 读取/写入 mastery.json。
2. 根据判卷结果更新 mastery/stability/transfer。
3. 更新 correctCount/wrongCount/lastPracticedAt。
4. 输出薄弱知识点列表。
```

Step 1 先用简单规则：

```text
答对：mastery +0.12，最高 1。
答错：mastery -0.08，最低 0。
到期复习通过：stability +0.12，最高 1。
到期复习失败：stability -0.1，最低 0。
transfer 暂时只预留，Step 1 不主动增长。
```

### 4.6 `review-scheduler-runtime.js`

职责：

```text
1. 读取/写入 review-queue.json。
2. 首次答对后创建复习任务。
3. 复习通过后推进 reviewStage。
4. 复习失败后保持或缩短间隔。
5. 查询今天到期的复习知识点。
```

固定间隔：

```text
stage 0 -> 1 天
stage 1 -> 3 天
stage 2 -> 7 天
stage 3 -> 14 天
stage 4 -> 30 天
stage 5 -> mastered
```

### 4.7 `training-policy-runtime.js`

职责：

```text
1. 根据 profile 生成 Assignment。
2. 优先安排到期复习。
3. 再安排薄弱 SkillNode。
4. 最后补充新内容。
5. 返回适合 UI 展示的 session payload。
6. 不写死“10 道题”，由 profile 配置决定数量和 section。
```

V1 math profile 每日计划先配置为 10 题：

```text
到期复习：最多 4 题。
薄弱巩固：最多 4 题。
新知/普通题：补足到 10 题。
```

### 4.8 `assignment-runtime.js` + `attempt-runtime.js`

职责：

```text
1. 创建和读取 Assignment。
2. 接收 Assignment 的 AttemptBatch。
3. 调用 evaluation-runtime 批量评价 Attempt。
4. 保存 attempts 和 evaluations。
5. 触发学生能力、复习队列、学习事件、游戏奖励统一结算。
6. 创建 AI task，允许异步完成。
```

重要约束：

```text
Step 1 不做每题即时提交。
Step 1 不做每题即时奖励。
V1 math profile 可以在前端本地暂存草稿答案，但主进程只认整套 Assignment 提交。
Step 1 的程序判卷结果先返回，大模型分析可以异步补齐。
```

### 4.9 `ai-provider-runtime.js`

职责：

```text
1. 封装低成本模型 provider 调用。
2. 统一模型名、reasoning effort、temperature、JSON schema。
3. 统一超时、重试、错误格式。
4. 统一脱敏和日志记录。
5. 支持测试环境 mock provider。
```

V1 必须有 mock provider：

```text
没有 API key 时 smoke 脚本仍然能跑。
mock provider 返回固定结构，验证数据流。
真实 provider 优先读取 DEEPSEEK_API_KEY。
多模态 provider 可读取 QWEN_API_KEY 或 SILICONFLOW_API_KEY。
```

### 4.10 `ai-model-routing-runtime.js`

职责：

```text
1. 根据任务类型选择模型。
2. 根据题目难度和风险级别选择 reasoning effort。
3. 记录每次 AI 调用使用的 model、tokens、latency、status。
4. 为后续成本控制和质量评估留数据。
```

V1 推荐模型路由：

```text
默认文本模型：deepseek-v4-flash
强文本模型：deepseek-v4-pro
默认多模态模型：qwen-vl-plus 或 Qwen3-VL 系列低成本版本
GPT 系列：只作为可选备援，不进入默认链路
```

选型依据：

```text
DeepSeek 官方文档显示 deepseek-v4-flash 是快速、经济版本，适合高频文本任务。
DeepSeek 官方文档显示 deepseek-v4-pro 是更强版本，适合复杂推理和质量审查。
DeepSeek 旧模型名 deepseek-chat/deepseek-reasoner 将在 2026-07-24 废弃，V1 不应使用旧别名。
DeepSeek 当前主要解决文本推理，不作为草稿图像/多模态识别默认方案。
多模态题图、草稿图、截图分析需要单独走 Qwen-VL/Qwen3-VL 或同类低成本视觉模型。
GPT 系列能力强，但不符合本项目第一版低成本优先策略。
```

任务路由：

```text
错因归类：deepseek-v4-flash，non-thinking 或 low thinking。
单题讲解：deepseek-v4-flash，non-thinking 或 low thinking。
每日能力总结：deepseek-v4-flash，low/medium thinking。
家长可读建议：deepseek-v4-flash，low/medium thinking。
受控变式题生成：deepseek-v4-pro，medium thinking。
复杂题解析/争议复核：deepseek-v4-pro，high thinking。
题库批量质量审查：deepseek-v4-pro，high thinking。
题图/草稿图辅助分析：Qwen-VL/Qwen3-VL 低成本多模态模型。
```

原则：

```text
高频任务优先成本和速度。
影响学习路径的任务优先质量。
大模型输出必须结构化。
大模型不能直接改 mastery/review/game，只能产出 AI 建议或候选事件。
```

### 4.11 `ai-task-runtime.js`

职责：

```text
1. 创建和执行 AiTask。
2. 支持 explanation、diagnosis、daily_summary、content_generation、vision_analysis 等任务类型。
3. 基于 ContentItem、Attempt、Evaluation、SkillNode 生成结构化输出。
4. 把结果写入 ai-results.json。
5. 允许 mock provider 和真实 provider 共用同一任务协议。
```

输入只包含必要信息：

```text
ContentItem prompt/body。
answerSchema。
standardAnswer。
Attempt response raw。
Evaluation verdict。
SkillNode 标题。
不传真实姓名。
不传无关本地文件。
```

输出结构：

```json
{
  "id": "ai_task_20260628_001",
  "assignmentId": "plan_default_child_2026-06-28",
  "attemptBatchId": "set_sub_default_child_2026-06-28_001",
  "type": "daily_summary",
  "status": "completed",
  "model": "deepseek-v4-flash",
  "itemFeedback": [
    {
      "contentItemId": "q_math_chicken_rabbit_001",
      "errorReasons": ["方法选择错误"],
      "explanation": "这题可以先假设全是鸡，再用脚数差求兔子的数量。",
      "nextPracticeHint": "再练 2 道鸡兔同笼的变式题。"
    }
  ],
  "dailySummary": {
    "strengths": ["鸡兔同笼基础方法已经掌握"],
    "weaknesses": ["余数周期还不稳定"],
    "nextPlanSuggestion": ["明天优先复习余数周期"]
  }
}
```

重要边界：

```text
AI 分析不改变基础分数。
AI 分析不直接发奖励。
AI 分析可以生成 candidateLearningEvents，但 Step 1 默认不进入正式 learning-events。
```

### 4.12 `content-generation-runtime.js`

职责：

```text
1. 生成受控 ContentItem 候选。
2. V1 math profile 先生成变式题候选和解析候选。
3. 调用 evaluation-runtime 或规则校验器验证答案。
4. 合格后写入 generated-content-candidates.json。
5. 默认不直接进入正式 content-items.json。
```

V1 只让 AI 生成候选题，不直接投喂给孩子。

流程：

```text
AI 生成候选题
-> 程序校验字段
-> 程序校验标准答案能被 evaluation-runtime 判
-> AI 自检解析
-> 标记为 candidate
-> 后续人工/家长/开发者确认后再进入正式内容库
```

### 4.13 `learning-event-runtime.js`

职责：

```text
1. 从 Evaluation 生成学习事件。
2. 写入 learning-events.json。
3. 为学生模型、复习队列、游戏奖励提供统一事件输入。
```

重要约束：

```text
只有程序可确认的最终答案结果才能产生正式可信事件。
AI 过程点评可以生成候选分析，但 Step 1 不直接写入正式 learning-events。
```

### 4.14 `game-reward-runtime.js`

职责：

```text
1. 根据学习事件发放 XP。
2. 更新知识卡 proficiency/stability。
3. 记录 rewardLog。
4. 返回本次奖励摘要。
```

V1 math profile 奖励规则按 Assignment 统一结算：

```text
final_answer_correct：+10 XP，卡牌 proficiency +5。
spaced_review_passed：+15 XP，卡牌 stability +5。
final_answer_wrong：+0 XP，不惩罚。
assignment_completed：整套任务提交后 +20 XP。
assignment_accuracy_bonus：正确率 >= 80% 时 +20 XP。
```

### 4.15 `ai-learning-runtime.js`

职责：

```text
1. 组合以上 runtime。
2. 暴露高层 API。
3. 隔离 main.js 对细节模块的依赖。
```

建议 API：

```text
getAssignment({ studentId, date, profileId })
getContentItem({ contentItemId })
submitAttemptBatch({ studentId, assignmentId, attempts, behavior })
getEvaluationBatch({ studentId, attemptBatchId })
getAiResult({ studentId, aiTaskId })
generateContentCandidates({ skillNodeId, contentType, count, difficulty })
getStudentMastery({ studentId })
getGameState({ studentId })
```

---

## 5. IPC 设计

Step 1 建议先注册 8 个通用 IPC：

```text
learning:get-assignment
learning:get-content-item
answer:submit-attempt-batch
evaluation:get-batch
ai:get-result
ai:generate-content-candidates
learning:get-mastery
game:get-state
```

V1 math profile 可以在 renderer 层包装出语义别名：

```text
getDailyPlan -> learning:get-assignment(profileId=math_olympiad_daily_set_v1)
submitDailySet -> answer:submit-attempt-batch
```

返回约束：

```text
IPC 返回对象必须可 JSON 序列化。
错误统一 throw Error，由 renderer 负责展示。
不要在 IPC 中返回文件句柄、Buffer、class 实例。
```

---

## 6. 开发 TODO

### A. 数据底座

- [ ] A1. 新增 `src/ai-learning-paths-runtime.js`。
- [ ] A2. 新增 `src/ai-learning-json-store-runtime.js`。
- [ ] A3. 新增 `data/ai-learning/skill-nodes.seed.json`。
- [ ] A4. 新增 `data/ai-learning/content-items.seed.json`。
- [ ] A5. 新增 `data/ai-learning/profiles/math-olympiad-daily-set.profile.json`。
- [ ] A6. 实现 seed 首次复制到 `%AppData%/StudyGate/ai-learning/`。
- [ ] A7. 实现通用 JSON 读写 helper，损坏文件要能安全 fallback。

验收：

```text
删除本地 ai-learning 目录后，启动或 smoke 脚本可自动生成基础数据。
```

### B. 能力图谱与内容库

- [ ] B1. 实现 `skill-graph-runtime.js`。
- [ ] B2. 实现 `content-bank-runtime.js`。
- [ ] B3. SkillNode 查询支持 id、subject、track。
- [ ] B4. ContentItem 查询支持 skillNodeIds、difficulty、contentType、excludeRecentContentItemIds。
- [ ] B5. 为每个 seed content item 校验必填字段。

验收：

```text
能查出鸡兔同笼知识点。
能按鸡兔同笼筛出至少 3 道题。
V1 math_short_answer 内容必须都有 standardAnswer 和 answerSchema。
```

### C. Evaluation 与最终答案 grader

- [ ] C1. 实现 `evaluation-runtime.js`。
- [ ] C2. 实现 `graders/final-answer-grader.js`。
- [ ] C3. 支持数字答案归一化。
- [ ] C4. 支持 object 答案归一化。
- [ ] C5. 支持分数约分和等价比较。
- [ ] C6. 支持 list 答案比较。
- [ ] C7. 为低质量输入返回 `confidence < 1`，但 Step 1 暂不接 OCR。

验收样例：

```text
"23" == 23
"23只" == 23
"鸡23只，兔12只" == { "鸡": 23, "兔": 12 }
"1/2" == "2/4"
"3,5,7" == [3,5,7]
```

### D. Assignment/Attempt 提交闭环

- [ ] D1. 实现 `assignment-runtime.js`。
- [ ] D2. 实现 `attempt-runtime.js`。
- [ ] D3. 实现 `submitAttemptBatch` 高层方法。
- [ ] D4. 校验提交的 assignmentId 属于 studentId。
- [ ] D5. 校验 attempts 中的 contentItemId 必须属于该 assignment。
- [ ] D6. 保存 AttemptBatch 到 `attempts.json`。
- [ ] D7. 保存 EvaluationBatch 到 `evaluations.json`。
- [ ] D8. 只以 programmatic Evaluation 作为基础对错依据。

验收：

```text
提交整套 Assignment 后，本地能看到 Attempt 和 Evaluation。
同一次提交能返回整套任务评价结果。
答对/答错不会依赖 AI 或手写草稿。
```

### E. 学生能力模型

- [ ] E1. 实现 `student-model-runtime.js`。
- [ ] E2. 首次遇到 SkillNode 时创建默认 mastery state。
- [ ] E3. 答对更新 mastery/correctCount。
- [ ] E4. 答错更新 mastery/wrongCount/weakReason。
- [ ] E5. 支持查询薄弱知识点排序。

验收：

```text
连续答对同一知识点，mastery 上升。
答错后 wrongCount 上升，mastery 不会小于 0。
```

### F. 复习队列

- [ ] F1. 实现 `review-scheduler-runtime.js`。
- [ ] F2. 首次答对创建 review queue item。
- [ ] F3. 到期复习通过推进 stage。
- [ ] F4. 到期复习失败缩短 nextReviewAt。
- [ ] F5. 支持查询今日到期复习。

验收：

```text
首次答对后 nextReviewAt 约等于 1 天后。
复习通过后 stage 增加。
复习失败后不直接清除队列。
```

### G. Assignment 生成策略

- [ ] G1. 实现 `training-policy-runtime.js`。
- [ ] G2. 按 profile 生成 Assignment。
- [ ] G3. 优先放入到期复习内容。
- [ ] G4. 放入薄弱 SkillNode 对应内容。
- [ ] G5. 不足时从 enabled content item 补齐。
- [ ] G6. 输出 assignmentId、sections、contentItems。

验收：

```text
新用户也能拿到 math profile 的 10 题 Assignment。
有到期复习时，复习内容优先出现。
同一 Assignment 内尽量不重复 ContentItem。
```

### H. 大模型接入

- [ ] H1. 实现 `ai-provider-runtime.js`。
- [ ] H2. 实现 mock AI provider，smoke 脚本默认使用 mock。
- [ ] H3. 实现真实 DeepSeek provider，读取 `DEEPSEEK_API_KEY`。
- [ ] H4. 实现 `ai-model-routing-runtime.js`。
- [ ] H5. 默认把错因归类、讲解、每日总结路由到 `deepseek-v4-flash`。
- [ ] H6. 把受控变式题生成、复杂解析复核路由到 `deepseek-v4-pro`。
- [ ] H7. 实现 `ai-task-runtime.js`，整套 Assignment 提交后创建 AI task。
- [ ] H8. 实现 `content-generation-runtime.js`，只生成候选 ContentItem。
- [ ] H9. AI 输出必须使用结构化 JSON schema。
- [ ] H10. AI 结果写入 `ai-results.json` 和 `generated-content-candidates.json`。

验收：

```text
没有 API key 时，mock provider 能返回稳定 AI result。
有 API key 时，真实 provider 能生成错因、讲解、每日总结。
AI result 不改变基础分数。
AI result 不直接发奖励。
AI 生成内容默认只进入 generated-content-candidates.json，不进入正式 content-items.json。
```

### I. 学习事件

- [ ] I1. 实现 `learning-event-runtime.js`。
- [ ] I2. 整套 Assignment 评价后，为每个 Attempt 生成 final_answer_correct/final_answer_wrong。
- [ ] I3. 到期复习内容生成 spaced_review_passed/spaced_review_failed。
- [ ] I4. 事件写入 learning-events.json。
- [ ] I5. 事件对象带 confidence。

验收：

```text
每次提交至少生成一个学习事件。
事件能追溯到 studentId、contentItemId、attemptBatchId。
```

### J. 游戏奖励

- [ ] J1. 实现 `game-reward-runtime.js`。
- [ ] J2. 新学生创建默认 game-state。
- [ ] J3. 整套 Assignment 提交后统一处理 final_answer_correct，发 XP 和 proficiency。
- [ ] J4. spaced_review_passed 发 XP 和 stability。
- [ ] J5. final_answer_wrong 不扣分。
- [ ] J6. rewardLog 记录每次奖励原因。

验收：

```text
答对题目后 XP 上升。
对应知识卡 proficiency 上升。
答错不会扣 XP。
```

### K. 主进程接入

- [ ] K1. 在 `main.js` 创建 `aiLearningRuntime`。
- [ ] K2. 在 `ipc-runtime.js` 或独立 IPC 文件注册 Step 1 IPC。
- [ ] K3. 保持和现有 runtime 依赖注入风格一致。
- [ ] K4. 不破坏现有首页、课堂、听写、作业、背诵模块。

验收：

```text
npm start 能正常启动。
现有 IPC 不报错。
新增 IPC 可被 smoke 脚本或 renderer 调用。
```

### L. Smoke 验证

- [ ] L1. 新增 `scripts/ai-learning-step1-smoke.js`。
- [ ] L2. 使用临时数据目录，不污染真实用户数据。
- [ ] L3. 验证 seed 初始化。
- [ ] L4. 验证 Assignment 生成。
- [ ] L5. 验证提交 AttemptBatch。
- [ ] L6. 验证 mock AI result 生成。
- [ ] L7. 验证 mastery 更新。
- [ ] L8. 验证 review queue 创建。
- [ ] L9. 验证 learning event 写入。
- [ ] L10. 验证 game state 奖励。

验收：

```text
node scripts/ai-learning-step1-smoke.js
```

输出类似：

```text
PASS seed initialized
PASS assignment generated
PASS attempt batch evaluated
PASS mock ai result generated
PASS mastery updated
PASS review queued
PASS learning event recorded
PASS game reward applied
```

---

## 7. 推荐实施顺序

```text
第 1 小步：paths + json store + seeds
第 2 小步：skill graph + content bank
第 3 小步：evaluation-runtime + final-answer-grader
第 4 小步：assignment-runtime + attempt-runtime
第 5 小步：student model + review queue
第 6 小步：training policy + math daily_set profile
第 7 小步：ai provider + mock task result
第 8 小步：真实 DeepSeek provider + model routing
第 9 小步：ai task + content candidates
第 10 小步：learning event + reward
第 11 小步：IPC 接入
第 12 小步：smoke 脚本
```

不要先做 UI。先用 smoke 脚本把闭环跑通，UI 才有稳定接口可以接。

---

## 8. Step 1 验收标准

Step 1 完成时，必须能演示以下流程：

```text
1. 系统初始化 AI learning 数据。
2. 为 default_child 通过 math daily_set profile 生成今日 Assignment。
3. 前端或 smoke 脚本一次性提交 AttemptBatch。
4. 其中鸡兔同笼题答案为“鸡23只，兔12只”。
5. 程序返回 EvaluationBatch。
6. AI provider 创建 AiTask。
7. mock provider 或真实 provider 生成 AI result。
8. mastery 中相关 SkillNode 熟练度批量更新。
9. review-queue 中为答对 SkillNode 创建或推进复习任务。
10. learning-events 中按 Attempt 记录 final_answer_correct/final_answer_wrong。
11. game-state 中按 Assignment 统一增加 XP 和卡牌进度。
```

如果这 11 步可以稳定通过，Step 1 就算完成。

---

## 9. Step 1 后续衔接

Step 1 做完后，Step 2 再考虑：

```text
1. 最小答题 UI。
2. Windows Ink 单草稿区接入。
3. 错题变式进入正式训练。
4. 家长端日报。
5. 草稿区 OCR/手写过程分析。
```

Step 1 的关键不是炫，而是把数据流打牢。后面所有 AI、Ink、卡牌、报告，都应该长在这条数据流上。

---

## 10. v0.3 落地补充：每日题集批量提交 + AI 分析

这一节是对前面 TODO 的实现级补充。

注意：本章以 `math_olympiad_daily_set_v1` profile 举例，因此会出现 plan/question/finalAnswer 等业务词。实现底座时仍然使用 `Assignment/ContentItem/Attempt/Evaluation` 命名；plan/question 只允许作为 profile 层别名。

核心调整：

```text
旧方案：每做一题 -> 提交 -> 判卷 -> 更新能力 -> 发奖励。
新方案：每天生成一套题 -> 孩子做完 -> 一次提交 -> 批量判卷 -> 创建 AI 分析 -> 批量更新能力 -> 统一发奖励。
```

这样做的好处：

```text
1. 前端交互简单，不需要维护每题提交状态。
2. 主进程数据一致性更好，一次提交就是一次事务。
3. 激励更克制，不会做一题弹一次奖励。
4. 家长报告更自然，按“今天这套题”展示结果。
5. 后续接手写草稿时，可以按整套题保存 rawWork 包。
```

### 10.0 低成本模型策略

默认不使用 GPT。

V1 模型策略：

```text
文本高频任务：DeepSeek V4 Flash。
文本高风险任务：DeepSeek V4 Pro。
图像/题图/草稿图任务：Qwen-VL/Qwen3-VL 或同类低成本多模态模型。
GPT：只作为可配置备援，不写入默认配置，不作为第一版依赖。
```

Provider 抽象：

```text
ai-provider-runtime 不应绑定某一家厂商。
provider 名称建议：mock、deepseek、qwen-vl、openai-compatible。
DeepSeek 和很多国产模型服务通常兼容 OpenAI 风格 API，但代码命名不要写成 openaiProvider。
```

环境变量：

```text
DEEPSEEK_API_KEY：文本主力 provider。
DEEPSEEK_BASE_URL：DeepSeek 或兼容网关地址，可选。
QWEN_API_KEY：多模态 provider，可选。
QWEN_BASE_URL：多模态兼容网关地址，可选。
AI_PROVIDER：mock/deepseek/qwen-vl/openai-compatible。
AI_TEXT_FAST_MODEL：默认 deepseek-v4-flash。
AI_TEXT_STRONG_MODEL：默认 deepseek-v4-pro。
AI_VISION_MODEL：默认按实际接入服务配置。
```

模型选择不能写死在业务代码里，必须集中在 `ai-model-routing-runtime.js`。

### 10.1 Step 1 用户故事

```text
作为孩子：
我打开今日练习，看到 10 道题。
我可以按顺序做，也可以跳题。
我在每道题下面填最终答案。
我全部做完后点一次提交。
系统告诉我今天做对几道、哪些知识点进步了。

作为家长：
我不需要看到每题实时动画。
我只需要知道今天完成没有、正确率多少、薄弱点是什么。

作为系统：
我只在整套题提交时写入核心学习状态。
我保证题集提交要么完整结算，要么失败后可以重试。
```

### 10.2 Assignment 生成规则，以 math daily_set profile 为例

输入：

```json
{
  "studentId": "default_child",
  "dateKey": "2026-06-28",
  "targetQuestionCount": 10
}
```

输出：

```json
{
  "id": "plan_default_child_2026-06-28",
  "studentId": "default_child",
  "dateKey": "2026-06-28",
  "status": "assigned",
  "questionIds": [],
  "sections": []
}
```

生成顺序：

```text
1. 如果当天已有 assigned/submitted plan，直接返回旧 plan。
2. 查询今日到期 reviewQueue。
3. 为每个到期知识点选 1 道题，放入 review section，最多 4 题。
4. 查询 mastery 最低且 enabled 的知识点，放入 weakness section，最多 4 题。
5. 从未练或少练知识点中补 new section，直到总数 10。
6. 如果题库不足 10 题，允许少于 10 题，但必须返回 warning。
7. 同一个 plan 内 questionId 不重复。
8. 写入 daily-plans.json。
```

伪代码：

```js
function getDailyPlan({ studentId, dateKey, targetQuestionCount = 10 }) {
  const existingPlan = findPlan(studentId, dateKey);
  if (existingPlan) return hydratePlan(existingPlan);

  const selected = [];
  const sections = [];

  const dueReviewItems = reviewScheduler.getDueItems({ studentId, dateKey });
  const reviewQuestions = pickQuestionsForKnowledgePoints(dueReviewItems, {
    limit: 4,
    excludeQuestionIds: selected
  });
  appendSection(sections, selected, 'review', '到期复习', reviewQuestions);

  const weakPoints = studentModel.getWeakKnowledgePoints({ studentId, limit: 8 });
  const weakQuestions = pickQuestionsForKnowledgePoints(weakPoints, {
    limit: 4,
    excludeQuestionIds: selected
  });
  appendSection(sections, selected, 'weakness', '薄弱巩固', weakQuestions);

  const fillerQuestions = questionBank.pickEnabledQuestions({
    limit: targetQuestionCount - selected.length,
    excludeQuestionIds: selected
  });
  appendSection(sections, selected, 'new', '今日练习', fillerQuestions);

  return savePlan({ studentId, dateKey, sections, questionIds: selected });
}
```

### 10.3 Assignment 状态机

```text
assigned：已生成，未提交。
submitted：已提交并完成结算。
abandoned：预留，Step 1 不主动使用。
```

状态规则：

```text
assigned -> submitted：submitDailySet 成功后发生。
submitted -> submitted：重复提交时默认拒绝。
submitted -> assigned：Step 1 不支持回滚。
assigned -> abandoned：Step 1 暂不开放。
```

重复提交策略：

```text
默认不允许重复提交同一个 plan。
如果后续 UI 需要“老师/家长重判”，另做 admin regrade，不放 Step 1。
```

### 10.4 AttemptBatch 校验规则，以 daily_set 提交为例

提交 payload：

```json
{
  "studentId": "default_child",
  "planId": "plan_default_child_2026-06-28",
  "answers": [
    {
      "questionId": "q_math_chicken_rabbit_001",
      "finalAnswer": {
        "raw": "鸡23只，兔12只"
      }
    }
  ],
  "behavior": {
    "durationSeconds": 1800
  }
}
```

校验顺序：

```text
1. studentId 非空，否则报错。
2. planId 非空，否则报错。
3. plan 存在，否则报错。
4. plan.studentId 必须等于 payload.studentId。
5. plan.status 必须是 assigned。
6. answers 必须是数组。
7. answers 中的 questionId 必须属于 plan.questionIds。
8. answers 中重复 questionId 时，保留最后一个，并记录 warning。
9. plan 中没有提交答案的题，按 unanswered 处理。
10. 不允许提交 plan 外的题，直接报错。
```

未作答规则：

```text
未作答题目：
- finalAnswerVerdict.isCorrect = false
- score = 0
- confidence = 1
- status = unanswered
- 计入 total
- 计入 wrong
- 生成 final_answer_wrong 事件
- 不惩罚 XP
```

### 10.5 批量判卷流程

```text
1. submitDailySet 收到整套答案。
2. assignment-runtime 读取 Assignment。
3. content-bank-runtime 读取 Assignment 内所有 ContentItem。
4. evaluation-runtime 调用 final-answer-grader 逐项评价 Attempt。
5. 汇总 EvaluationBatch。
6. 保存 daily set submission。
7. 写入 attempts。
8. 创建 AI analysis job。
9. 使用 mock provider 或真实 provider 生成 AI result。
10. 生成 learning events。
11. student-model-runtime 批量更新 mastery。
12. review-scheduler-runtime 批量更新 review queue。
13. game-reward-runtime 统一结算奖励。
14. plan.status 改为 submitted。
15. 返回 result + settlement + aiFeedbackStatus。
```

高层返回：

```json
{
  "submission": {},
  "gradingResult": {},
  "aiFeedbackStatus": "completed",
  "learningEvents": [],
  "settlement": {
    "xpGained": 90,
    "accuracyBonus": 0,
    "cardUpdates": []
  },
  "masterySnapshot": [],
  "gameState": {}
}
```

### 10.6 `submitDailySet` 伪代码

说明：

```text
smoke 脚本可以同步等待 mock AI feedback。
真实 DeepSeek provider 建议异步执行；submitDailySet 可以先返回 aiFeedbackStatus = "pending"。
如果真实 AI 调用失败，不回滚程序评价、attempts、mastery、review、game，只把 AI result 标记为 failed。
```

```js
function submitDailySet(payload) {
  const now = new Date();
  const plan = dailyPlans.getRequired(payload.planId);

  assertPlanCanBeSubmitted(plan, payload);

  const questions = questionBank.getQuestionsByIds(plan.questionIds);
  const answerMap = normalizeAnswerList(payload.answers);
  const questionResults = [];

  for (const questionId of plan.questionIds) {
    const question = questions.get(questionId);
    const answer = answerMap.get(questionId);
    const result = answer
      ? gradingRuntime.gradeFinalAnswer({ question, finalAnswer: answer.finalAnswer })
      : gradingRuntime.unansweredResult({ question });

    questionResults.push(result);
  }

  const gradingResult = buildDailySetGradingResult({
    plan,
    questionResults,
    submittedAt: now
  });

  const submission = saveDailySetSubmission({
    plan,
    payload,
    gradingResult,
    submittedAt: now
  });

  appendAttempts({ plan, submission, questionResults });

  const aiFeedback = aiAnalysisRuntime.createFeedbackForDailySet({
    plan,
    submission,
    gradingResult,
    providerMode: process.env.DEEPSEEK_API_KEY ? 'deepseek' : 'mock',
    createdAt: now
  });

  const learningEvents = learningEventRuntime.createEventsFromDailySetResult({
    plan,
    submission,
    gradingResult,
    createdAt: now
  });

  const masterySnapshot = studentModelRuntime.applyLearningEvents({
    studentId: plan.studentId,
    events: learningEvents,
    createdAt: now
  });

  reviewSchedulerRuntime.applyLearningEvents({
    studentId: plan.studentId,
    events: learningEvents,
    createdAt: now
  });

  const settlement = gameRewardRuntime.applyLearningEvents({
    studentId: plan.studentId,
    events: learningEvents,
    gradingSummary: gradingResult.summary,
    createdAt: now
  });

  dailyPlans.markSubmitted(plan.id, {
    submissionId: submission.id,
    submittedAt: now.toISOString()
  });

  return {
    submission,
    gradingResult,
    aiFeedbackStatus: aiFeedback.status,
    learningEvents,
    masterySnapshot,
    settlement,
    gameState: gameRewardRuntime.getGameState(plan.studentId)
  };
}
```

### 10.7 事务与落盘策略

Step 1 不引入数据库，继续使用 JSON 文件。

为了避免写一半坏掉，采用简单“先写临时文件，再 rename”的原子写策略。

JSON 写入 helper 要提供：

```text
readJsonFile(filePath, fallback)
writeJsonFileAtomic(filePath, payload)
appendJsonArrayItem(filePath, item)
updateJsonFile(filePath, updater, fallback)
```

`writeJsonFileAtomic` 规则：

```text
1. 确保目录存在。
2. 写入 `${filePath}.tmp-${process.pid}`。
3. fs.renameSync(tmpPath, filePath)。
4. 失败时删除 tmp。
```

损坏文件策略：

```text
seed 文件损坏：直接 throw，因为这是开发错误。
运行时 JSON 损坏：重命名为 `.broken-{timestamp}.json`，然后使用 fallback。
```

### 10.8 attempts.json 结构

建议用数组，Step 1 数据量小，足够。

```json
[
  {
    "id": "attempt_20260628_001",
    "studentId": "default_child",
    "planId": "plan_default_child_2026-06-28",
    "submissionId": "set_sub_default_child_2026-06-28_001",
    "questionId": "q_math_chicken_rabbit_001",
    "knowledgePointIds": ["math.application.chicken_rabbit"],
    "answered": true,
    "isCorrect": true,
    "score": 10,
    "maxScore": 10,
    "finalAnswerRaw": "鸡23只，兔12只",
    "normalizedAnswer": {
      "鸡": 23,
      "兔": 12
    },
    "createdAt": "2026-06-28T20:15:00+08:00"
  }
]
```

attempt 用途：

```text
1. 题库排除最近做过的题。
2. 家长日报统计。
3. 学生能力模型复盘。
4. 后续错题本和变式题入口。
```

### 10.9 learning event 生成细则

每个 questionResult 至少生成一个事件。

答对：

```json
{
  "type": "final_answer_correct",
  "confidence": 1
}
```

答错或未作答：

```json
{
  "type": "final_answer_wrong",
  "confidence": 1
}
```

如果题目来自 review section：

```text
答对额外生成 spaced_review_passed。
答错额外生成 spaced_review_failed。
```

如果整套题全部提交：

```text
额外生成 daily_plan_completed。
```

daily_plan_completed 的条件：

```text
plan.status 原本是 assigned。
提交动作成功。
不要求全对。
不要求每题都有答案。
```

### 10.10 mastery 更新细则

对每个 learning event 做增量更新。

基础状态：

```json
{
  "mastery": 0,
  "stability": 0,
  "transfer": 0,
  "wrongCount": 0,
  "correctCount": 0
}
```

事件到更新：

```text
final_answer_correct：
- mastery +0.10
- correctCount +1
- weakReason 清空或保留最近非空原因，Step 1 建议清空

final_answer_wrong：
- mastery -0.06
- wrongCount +1
- weakReason = "最终答案错误"

spaced_review_passed：
- stability +0.12

spaced_review_failed：
- stability -0.10
- weakReason = "到期复习未通过"

daily_plan_completed：
- 不直接影响单个知识点 mastery
```

数值裁剪：

```text
mastery/stability/transfer 永远保持在 0 到 1。
写入时保留两位小数。
```

批量更新注意：

```text
同一道题可能绑定多个知识点。
每个知识点都更新。
同一知识点一天内多题命中，可以多次增量。
```

### 10.11 review queue 更新细则

首次答对：

```text
如果某 knowledgePoint 没有 review item：
- reviewStage = 0
- nextReviewAt = now + 1 day
- lastReviewResult = "passed"
```

非复习题答对：

```text
如果已有 review item：
- 不推进 stage
- 可更新 lastPracticedAt
```

复习题答对：

```text
reviewStage +1
nextReviewAt 根据新 stage 间隔计算
lastReviewResult = "passed"
```

复习题答错：

```text
reviewStage 不增加
nextReviewAt = now + 1 day
lastReviewResult = "failed"
```

stage 间隔表：

```text
0: 1 day
1: 3 days
2: 7 days
3: 14 days
4: 30 days
5: mastered
```

mastered 规则：

```text
Step 1 先不移除 mastered item。
reviewStage >= 5 时 nextReviewAt 置空，status = "mastered"。
```

### 10.12 reward 统一结算细则

奖励只在 submitDailySet 成功后发一次。

事件奖励：

```text
final_answer_correct：+10 XP
spaced_review_passed：额外 +5 XP
daily_plan_completed：+20 XP
```

正确率奖励：

```text
accuracy >= 0.8：+20 XP
accuracy >= 1.0：额外 +20 XP
```

Step 1 不做：

```text
不做随机掉落。
不做宝箱动画。
不做连续登录。
不做排行榜。
不做错题惩罚。
```

卡牌更新：

```text
final_answer_correct：
- card.proficiency +5

spaced_review_passed：
- card.stability +5

spaced_review_failed：
- 不扣卡牌数值

variant_passed：
- Step 1 不产生
```

rewardLog 示例：

```json
{
  "id": "reward_20260628_001",
  "source": "daily_set",
  "planId": "plan_default_child_2026-06-28",
  "submissionId": "set_sub_default_child_2026-06-28_001",
  "xpGained": 110,
  "reasons": [
    "完成今日题集 +20 XP",
    "答对 7 题 +70 XP",
    "正确率达到 80% +20 XP"
  ],
  "createdAt": "2026-06-28T20:15:00+08:00"
}
```

### 10.13 final-answer-grader 详细规则

入口：

```js
gradeFinalAnswer({ question, finalAnswer })
```

返回：

```js
{
  questionId,
  knowledgePointIds,
  finalAnswerVerdict,
  processVerdict
}
```

#### 数字答案

支持：

```text
"23"
"23只"
" 23 "
"23.0"
```

不支持：

```text
"二十三"
"二十 三"
"23 或 24"
```

规则：

```text
1. 去掉空格。
2. 去掉常见单位后缀。
3. 提取第一个有效数字。
4. 和标准答案做 Number 比较。
```

#### 分数答案

支持：

```text
"1/2"
"2/4"
" 1 / 2 "
```

规则：

```text
1. 解析 numerator/denominator。
2. denominator 不能为 0。
3. 用 gcd 约分。
4. 比较约分后的 numerator/denominator。
```

#### object 答案

支持：

```text
"鸡23只，兔12只"
"兔12 鸡23"
"鸡：23，兔：12"
```

规则：

```text
1. 根据 answerSchema.fields 中的 name 查找字段。
2. 对每个字段在 raw 中找字段名附近的数字。
3. 全字段命中才正常比较。
4. 缺字段时 confidence = 0.6，isCorrect = false。
```

简化实现建议：

```js
function parseObjectAnswer(raw, fields) {
  const result = {};
  for (const field of fields) {
    const pattern = new RegExp(`${escapeRegExp(field.name)}[^0-9\\-]*(-?\\d+(?:\\.\\d+)?)`);
    const match = raw.match(pattern);
    if (match) result[field.name] = Number(match[1]);
  }
  return result;
}
```

#### list 答案

支持：

```text
"3,5,7"
"3，5，7"
"7 5 3"
```

规则：

```text
Step 1 默认顺序不敏感。
解析全部数字。
排序后比较。
```

### 10.14 question seed 最小内容要求

Step 1 种子题库至少覆盖 8 个知识点。

每个知识点至少 3 题。

总题量最低 24 题，推荐 40 题。

第一批知识点：

```text
math.application.chicken_rabbit
math.application.sum_difference_multiple
math.application.age
math.number.remainder
math.number.divisibility
math.calculation.arithmetic_series
math.geometry.area
math.combinatorics.enumeration
```

题目难度分布：

```text
difficulty 1：入门题，占 30%
difficulty 2：常规题，占 50%
difficulty 3：提高题，占 20%
```

题目必须满足：

```text
1. prompt 清楚。
2. standardAnswer 唯一。
3. answerSchema 可被 final-answer-grader 判。
4. skillNodeIds 不为空。
5. enabled = true。
```

### 10.15 seed 校验脚本逻辑

可以放进 smoke 脚本，也可以后续独立。

校验项：

```text
skill-nodes.seed.json：
- 必须是数组。
- id 唯一。
- title 非空。
- examImportance 是 0 到 1。

content-items.seed.json：
- 必须是数组。
- id 唯一。
- prompt 非空。
- skillNodeIds 中的 id 必须存在。
- answerSchema.type 必须受支持。
- standardAnswer 必须存在。
```

### 10.16 IPC 详细契约

#### `learning:get-daily-plan`

请求：

```json
{
  "studentId": "default_child",
  "dateKey": "2026-06-28"
}
```

响应：

```json
{
  "plan": {},
  "questions": [],
  "warnings": []
}
```

注意：

```text
返回给前端的 questions 不包含 standardAnswer。
可以包含 answerSchema，因为前端需要知道答案输入形态。
不返回 acceptedMethods。
```

#### `answer:submit-daily-set`

请求：

```json
{
  "studentId": "default_child",
  "planId": "plan_default_child_2026-06-28",
  "answers": [],
  "behavior": {}
}
```

响应：

```json
{
  "gradingResult": {},
  "settlement": {},
  "gameState": {},
  "masterySnapshot": []
}
```

#### `answer:get-daily-set-result`

请求：

```json
{
  "studentId": "default_child",
  "submissionId": "set_sub_default_child_2026-06-28_001"
}
```

响应：

```json
{
  "submission": {},
  "gradingResult": {}
}
```

### 10.17 前端 Step 1 最小页面假设

虽然 Step 1 先不做 UI，但接口按这个页面准备：

```text
页面加载：
- 调 learning:get-daily-plan
- 渲染 10 道题
- 每题一个最终答案输入框

孩子作答：
- 前端只在内存或 localStorage 暂存答案
- 不调主进程判卷

提交：
- 调 answer:submit-daily-set
- 展示总分、正确题数、XP
- 每题展示对错
```

前端不需要：

```text
不需要每题保存。
不需要实时判卷。
不需要奖励弹窗队列。
不需要草稿识别状态。
```

### 10.18 smoke 脚本详细用例

脚本路径：

```text
scripts/ai-learning-step1-smoke.js
```

要求：

```text
1. 使用 os.tmpdir() 下的独立目录。
2. 每次运行前删除该临时目录。
3. 不依赖 Electron app。
4. 直接 require runtime 模块。
5. 失败时 process.exit(1)。
```

用例 1：初始化

```text
输入：空目录。
动作：createAiLearningRuntime。
期望：
- skill-nodes.json 存在。
- content-items.json 存在。
- 至少 8 个知识点。
- 至少 24 道题。
```

用例 2：生成每日题集

```text
输入：default_child, 2026-06-28。
动作：getDailyPlan。
期望：
- plan.status = assigned。
- questionIds.length > 0。
- questions 不包含 standardAnswer。
```

用例 3：提交整套题

```text
输入：为 plan 中每题构造答案。
动作：submitDailySet。
期望：
- 返回 gradingResult。
- summary.total = plan.questionIds.length。
- summary.correct >= 1。
- plan.status = submitted。
```

用例 4：重复提交拒绝

```text
输入：同一个 plan 再 submitDailySet。
期望：抛出错误，错误信息包含 already submitted 或中文等价表达。
```

用例 5：能力更新

```text
动作：读取 mastery。
期望：
- 至少一个 knowledgePoint mastery > 0。
- correctCount > 0。
```

用例 6：复习队列

```text
动作：读取 review-queue。
期望：
- 至少一个 item。
- nextReviewAt 非空。
```

用例 7：学习事件

```text
动作：读取 learning-events。
期望：
- 包含 daily_plan_completed。
- 包含 final_answer_correct 或 final_answer_wrong。
```

用例 8：奖励

```text
动作：读取 game-state。
期望：
- xp > 0。
- cards 至少有一个 key。
- rewardLog 至少 1 条。
```

### 10.19 具体开发切片

#### Slice 1：通用数据底座

完成文件：

```text
src/ai-learning-paths-runtime.js
src/ai-learning-json-store-runtime.js
src/skill-graph-runtime.js
src/content-bank-runtime.js
data/ai-learning/skill-nodes.seed.json
data/ai-learning/content-items.seed.json
data/ai-learning/profiles/math-olympiad-daily-set.profile.json
```

完成标准：

```text
node scripts/ai-learning-step1-smoke.js --slice=content-bank
```

能输出：

```text
PASS paths
PASS seed
PASS skill nodes
PASS content items
PASS math profile
```

#### Slice 2：Evaluation 与最终答案 grader

完成文件：

```text
src/evaluation-runtime.js
src/graders/final-answer-grader.js
```

完成标准：

```text
数字、分数、object、list 四类答案都有内置断言。
```

#### Slice 3：Assignment 生成

完成文件：

```text
src/review-scheduler-runtime.js
src/student-model-runtime.js
src/training-policy-runtime.js
src/assignment-runtime.js
```

完成标准：

```text
新用户能生成题集。
已有复习队列时能优先生成复习 section。
```

#### Slice 4：AttemptBatch 提交

完成文件：

```text
src/attempt-runtime.js
src/learning-event-runtime.js
```

完成标准：

```text
submitAttemptBatch 能生成 evaluations、attempts、learningEvents。
```

#### Slice 5：统一结算

完成文件：

```text
src/game-reward-runtime.js
src/ai-learning-runtime.js
```

完成标准：

```text
submitAttemptBatch 后 mastery/review/game 三个状态都变化。
```

#### Slice 6：主进程 IPC

完成文件：

```text
src/ai-learning-ipc-runtime.js
src/main.js
```

完成标准：

```text
npm start 不报错。
renderer 可调用 learning:get-daily-plan 和 answer:submit-daily-set。
```

### 10.20 Step 1 完成定义

只有同时满足以下条件，才算真正完成：

```text
1. smoke 脚本全绿。
2. 删除临时数据目录后可重新初始化。
3. 删除真实 ai-learning 数据目录后，应用可重新初始化。
4. 每日 plan 不重复生成。
5. 已提交 plan 不允许重复提交。
6. 提交整套题后 attempts、events、mastery、review、game 全部落盘。
7. 前端拿不到 standardAnswer。
8. 判卷不依赖 AI。
9. 奖励不按单题弹出，只按整套题结算。
10. 现有 StudyGate 首页、计划、听写、作业、背诵不受影响。
```
