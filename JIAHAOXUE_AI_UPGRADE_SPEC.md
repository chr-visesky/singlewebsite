# 嘉好学 AI 升级方案 SPEC

版本：v0.1  
日期：2026-06-28  
项目：`chr-visesky/singlewebsite`  
目标产品：面向小升初点考的小学 AI 学习软件，重点覆盖小学奥数，同时兼顾英语、语文。

---

## 0. 一句话定位

嘉好学 AI 升级目标：

```text
把现有 StudyGate 学习入口，升级为 AI 驱动的儿童学习系统。
它要能科学出题、自动判卷、记录能力、安排复习，并用卡牌养成激励孩子持续学习。
```

核心原则：

```text
输入尽量简单。
判卷尽量准确。
学习必须科学。
游戏必须服务学习。
```

---

## 1. 产品目标

### 1.1 覆盖范围

第一优先级：小学奥数。

后续扩展：

```text
数学：小学奥数、计算、应用题、几何、数论、组合、逻辑推理
英语：单词、听写、语法、阅读、作文
语文：字词、成语、古诗文、阅读理解、作文
```

### 1.2 目标能力

系统需要具备以下核心能力：

```text
1. 知道孩子该学什么。
2. 知道孩子现在会多少。
3. 按科学记忆周期安排复习。
4. 按薄弱点、遗忘风险、考试重要度出题。
5. 对最终答案进行可靠判卷。
6. 对过程草稿进行辅助分析和错因归类。
7. 用游戏化机制提供积累感、成就感和惊喜。
8. 给家长展示学习结果、薄弱点和下一步建议。
```

### 1.3 产品边界

V1 不承诺完整看懂所有手写过程。

系统边界定为：

```text
最终答案：主判卷依据，必须尽量准。
单行算式：可识别、可辅助分析。
表格/列表：V2 通过空表格降低识别难度。
整页草稿：只做辅助分析，不承担强判责任。
几何图/线段图/乱画草稿：只辅助，不强判。
复杂证明/构造题：AI 点评 + 家长兜底。
```

这条边界必须写进产品规则。否则产品很容易被“AI 全自动看懂孩子所有草稿”的幻想拖死。

---

## 2. 总体模块

产品模块分为 8 个。

```text
嘉好学 AI 学习系统
├─ 1. 学科知识模块
├─ 2. 学生能力模块
├─ 3. 科学训练与出题模块
├─ 4. 作答与阅卷模块
├─ 5. 记忆周期调度模块
├─ 6. 卡牌养成游戏模块
├─ 7. 家长管理与报告模块
└─ 8. AI 安全与质量控制模块
```

对外汇报可简化成 5 个大模块：

```text
1. 学科知识模块
2. 学生能力模块
3. 出题模块
4. 阅卷模块
5. 养成游戏模块
```

代码实现建议按 8 个模块拆，避免后期耦合。

---

## 3. 小学奥数知识模块

### 3.1 小学奥数模块划分

小学奥数不按课本章节走，适合按专题图谱拆。

```text
小学奥数
├─ 计算与巧算
│  ├─ 凑整
│  ├─ 分组
│  ├─ 裂项
│  ├─ 等差求和
│  ├─ 分数巧算
│  └─ 定义新运算
├─ 数论
│  ├─ 奇偶性
│  ├─ 整除
│  ├─ 余数
│  ├─ 同余
│  ├─ 质数合数
│  ├─ 因数倍数
│  ├─ 最大公因数
│  └─ 最小公倍数
├─ 应用题
│  ├─ 和差倍
│  ├─ 年龄问题
│  ├─ 盈亏问题
│  ├─ 还原问题
│  ├─ 鸡兔同笼
│  ├─ 工程问题
│  ├─ 浓度问题
│  ├─ 牛吃草问题
│  └─ 消长问题
├─ 行程问题
│  ├─ 相遇
│  ├─ 追及
│  ├─ 环形跑道
│  ├─ 流水行船
│  ├─ 火车过桥
│  └─ 钟表问题
├─ 几何
│  ├─ 周长
│  ├─ 面积
│  ├─ 等积变形
│  ├─ 割补法
│  ├─ 角度
│  ├─ 圆与扇形
│  ├─ 立体图形
│  └─ 展开图/染色立方体
├─ 组合计数
│  ├─ 加法原理
│  ├─ 乘法原理
│  ├─ 排列组合
│  ├─ 分类讨论
│  ├─ 枚举
│  ├─ 容斥
│  └─ 路径计数
├─ 逻辑推理
│  ├─ 真假话
│  ├─ 对应关系
│  ├─ 排序
│  ├─ 数独类
│  └─ 推理表格
├─ 抽屉与最值
│  ├─ 抽屉原理
│  ├─ 最坏情况
│  ├─ 保证至少
│  └─ 最大最小
├─ 方格/棋盘/染色
│  ├─ 方格计数
│  ├─ 染色
│  ├─ 覆盖
│  ├─ 棋盘路径
│  └─ 格点面积
└─ 构造与操作
   ├─ 移火柴
   ├─ 称重
   ├─ 倒水
   ├─ 比赛策略
   └─ 状态转移
```

### 3.2 题目元数据

每道题必须绑定知识点、题型、难度、答案结构和阅卷策略。

```json
{
  "questionId": "math_olympiad_0001",
  "subject": "math",
  "knowledgePointIds": ["math.application.chicken_rabbit"],
  "difficulty": 3,
  "questionType": "short_answer_with_process",
  "answerSchema": {
    "type": "object",
    "fields": [
      {"name": "鸡", "type": "number"},
      {"name": "兔", "type": "number"}
    ]
  },
  "acceptedMethods": ["assumption", "equation", "enumeration"],
  "gradingPolicy": {
    "finalAnswerRequired": true,
    "processOptional": true,
    "processRewardEnabled": true
  }
}
```

前端不展示 `acceptedMethods` 和 `gradingPolicy` 的细节，避免泄露思路。

---

## 4. 学生能力模块

学生能力模块负责回答：

```text
孩子现在会什么？
哪里不稳？
哪里快忘了？
下一题应该练什么？
```

### 4.1 知识点掌握状态

每个孩子对每个知识点维护一份状态。

```json
{
  "studentId": "child_001",
  "knowledgePointId": "math.number.remainder",
  "mastery": 0.62,
  "stability": 0.35,
  "transfer": 0.18,
  "wrongCount": 4,
  "correctCount": 7,
  "lastPracticedAt": "2026-06-28T20:00:00-07:00",
  "nextReviewAt": "2026-06-29T20:00:00-07:00",
  "weakReason": "没有稳定识别余数周期"
}
```

三个核心维度：

```text
mastery：熟练度，代表当前会不会。
stability：稳定度，代表隔几天还会不会。
transfer：迁移度，代表换个题面还会不会。
```

这三个维度后续直接映射卡牌成长。

### 4.2 错因归类

错因类型：

```text
读题错误
概念不清
方法选择错误
计算失误
单位没统一
枚举遗漏
分类重复
逻辑断点
过程跳步
最终答案书写错误
```

错因用于：

```text
1. 更新学生画像。
2. 安排错题变式。
3. 触发修正符文。
4. 生成家长报告。
```

---

## 5. 科学训练与出题模块

### 5.1 出题目标

出题不能只看题库顺序，需要综合：

```text
考试重要度
薄弱程度
遗忘风险
最近错误次数
做题耗时
是否依赖提示
是否完成订正
```

出题优先级：

```text
优先级 = 考试重要度 × 薄弱程度 × 遗忘风险 × 最近错误权重
```

### 5.2 四类训练副本

每天训练由 4 类副本组成。

```text
1. 新知副本
   目标：学习新知识点。
   特点：题少，讲解多。

2. 回忆副本
   目标：主动回忆到期知识点。
   特点：不看提示，强化记忆。

3. 变式副本
   目标：同知识点换题面。
   特点：训练迁移，避免背题。

4. 混合副本
   目标：多个知识点混在一起。
   特点：训练识别题型，接近考试。
```

### 5.3 每日任务比例

普通日：

```text
新知：30%
到期复习：35%
错题变式：25%
混合挑战：10%
```

考前冲刺：

```text
新知：10%
到期复习：30%
错题变式：30%
混合挑战：30%
```

### 5.4 训练事件

系统只把高质量学习行为转成训练事件。

```text
spaced_review_passed：按时复习通过
recall_passed：主动回忆成功
correction_passed：错题订正成功
variant_passed：变式训练通过
mixed_set_passed：混合训练通过
challenge_passed：挑战题通过
```

训练事件进入：

```text
学生能力模块
记忆周期模块
游戏奖励模块
家长报告模块
```

---

## 6. 记忆周期调度模块

### 6.1 固定间隔策略

V1 采用固定间隔策略。

```text
首次答对 → 1 天后复习
1 天复习通过 → 3 天后复习
3 天复习通过 → 7 天后复习
7 天复习通过 → 14 天后复习
14 天复习通过 → 30 天后复习
30 天复习通过 → 闪光精通
```

答错处理：

```text
不直接降级。
稳定度下降。
进入今日修正任务。
下次复习间隔缩短。
```

### 6.2 复习状态

```json
{
  "studentId": "child_001",
  "knowledgePointId": "math.number.remainder",
  "reviewStage": 2,
  "nextReviewAt": "2026-07-01T20:00:00-07:00",
  "lastReviewResult": "passed",
  "stability": 0.48
}
```

### 6.3 与游戏结合

记忆周期不是后台孤立算法，需要直接影响游戏成长。

```text
按时复习通过 → 时序符文
主动回忆成功 → 回忆符文
错题订正成功 → 修正符文
变式训练通过 → 迁移符文
混合训练通过 → 融合符文
```

---

## 7. 作答与阅卷模块

这是最大难点。设计原则：

```text
孩子输入尽量简单。
系统后台尽量结构化。
最终答案强判。
过程分析异步。
识别不确定时不惩罚孩子。
```

### 7.1 输入交互原则

孩子侧只面对：

```text
题目
草稿区
最终答案
提交
```

V1 页面：

```text
┌────────────────────────────┐
│ 题目                         │
├────────────────────────────┤
│ 草稿区                       │
│ 可以随便写、画、列式           │
├────────────────────────────┤
│ 最终答案：[              ]    │
├────────────────────────────┤
│ [提交]                       │
└────────────────────────────┘
```

输入交互禁忌：

```text
不让孩子选择一堆区块。
不实时整理过程。
不让孩子确认过程区块。
不把识别能力前置到作答过程。
不把复杂工具栏暴露给孩子。
```

### 7.2 Passive Block-Flow 架构

采用被动区块流架构。

```text
前台像纸。
后台像 Notion。
```

孩子自然书写，系统提交后被动抽取结构化过程。

```text
作答中：只采集，不理解。
提交时：识别/确认最终答案，程序秒判。
提交后：后台 OCR、抽取算式/文字/表格、AI 分析过程。
```

### 7.3 最终答案强约束

最终答案是主判卷依据。

支持类型：

```text
数字
分数
小数
百分数
多个答案
带单位答案
简短文字答案
集合/列表答案
```

最终答案流程：

```text
孩子输入最终答案
→ 系统识别
→ 低置信度时让孩子确认或修改
→ 答案归一化
→ 程序判卷
→ 立刻反馈
```

### 7.4 草稿区

草稿区基于 Windows Ink。

保存内容：

```text
stroke 轨迹
渲染图片
书写时间
区域尺寸
设备信息
```

草稿区用途：

```text
AI 辅助点评
错因猜测
过程奖励
家长复看
训练数据沉淀
```

草稿区不承担基础判卷责任。

### 7.5 自动识别能力边界

自动识别分级：

```text
最终答案：可用，必须重点做。
单行算式：较可用，可做过程分析。
表格/列表：有条件可用，V2 通过空表格提高稳定性。
整页草稿：很难，只能辅助。
几何图/线段图/乱画草稿：只辅助，不强判。
```

产品内部可以使用识别能力，但不能承诺“完整看懂孩子所有草稿”。

### 7.6 V1 阅卷流程

```text
1. 孩子提交。
2. 系统读取 finalAnswer。
3. finalAnswer 归一化。
4. 程序与标准答案比较。
5. 立刻返回基础判卷结果。
6. 后台异步分析 rawWork。
7. AI 生成过程点评、错因、学习事件。
8. 根据可信学习事件追加符文/卡牌奖励。
```

基础奖励来自最终答案。

过程奖励来自可信过程分析。

识别低置信度时：

```text
不扣分。
不发高级奖励。
保留原始草稿。
必要时进入家长复核。
```

### 7.7 阅卷结果结构

```json
{
  "submissionId": "sub_10932",
  "questionId": "q_math_055",
  "finalAnswerVerdict": {
    "isCorrect": true,
    "score": 10,
    "maxScore": 10,
    "confidence": 0.98
  },
  "processVerdict": {
    "status": "valid",
    "confidence": 0.82,
    "methodDetected": "假设法",
    "firstError": null,
    "strengths": ["能先假设全是鸡，再用脚数差求兔子数量"],
    "issues": []
  },
  "learningEvents": [
    {
      "type": "method_mastered",
      "knowledgePointId": "math.application.chicken_rabbit",
      "cardId": "math.method.assumption",
      "confidence": 0.92
    }
  ],
  "rewardEvents": [
    {
      "type": "rune_fragment",
      "rune": "recall",
      "amount": 2,
      "reason": "过程完整且未使用提示"
    }
  ]
}
```

---

## 8. 作答数据契约

### 8.1 Submission Payload

```json
{
  "submissionId": "sub_10932",
  "questionId": "q_math_olympiad_055",
  "studentId": "child_001",
  "createdAt": "2026-06-28T20:15:00-07:00",
  "clientVersion": "studygate-ai-0.1.0",
  "finalAnswer": {
    "raw": "鸡23只，兔12只",
    "normalized": {
      "鸡": 23,
      "兔": 12
    },
    "source": "typed_or_confirmed",
    "confidence": 1.0
  },
  "rawWork": {
    "inkStrokeRef": "ink/sub_10932/work.isf",
    "previewImageRef": "ink/sub_10932/work.png",
    "width": 1200,
    "height": 800
  },
  "extractedProcessFlow": [
    {
      "type": "formula",
      "confidence": 0.88,
      "steps": [
        "94 - 35 × 2 = 24",
        "24 ÷ 2 = 12"
      ]
    },
    {
      "type": "text",
      "confidence": 0.72,
      "content": "假设全是鸡"
    }
  ],
  "behavior": {
    "usedHint": false,
    "durationSeconds": 421,
    "revisedAnswer": false
  }
}
```

### 8.2 大文件处理

JSON 中不直接塞大 base64。

```text
墨迹文件、预览图片、过程截图统一用 assetRef 引用。
```

原因：

```text
便于缓存
便于增量同步
便于离线保存
便于后续复盘
```

---

## 9. Windows Ink 接入原则

现有手写板能力继续优先使用 Windows Ink。

### 9.1 职责划分

```text
Windows Ink：负责低延迟书写、stroke 采集、压感、防误触、橡皮、图片导出。
Web UI：负责题目、最终答案、提交、游戏反馈。
AI/OCR：负责识别最终答案、单行算式和辅助过程。
程序判卷：负责最终答案等价比较。
```

### 9.2 原生手写嵌入策略

如果采用 Native Overlay：

```text
编辑态：原生 InkCanvas 覆盖在草稿区域。
浏览态：Web 显示固化后的预览图。
提交态：保存 stroke 数据和 preview image。
```

工程约束：

```text
同一时间只允许一个活跃 Ink 区域。
滚动时不要高频同步所有区域。
坐标同步使用 requestAnimationFrame 合并。
只同步可见区。
必须处理 DPI 缩放。
必须处理多显示器坐标。
```

V1 可以先做单草稿区，避免多 Ink Block 的复杂度。

---

## 10. 游戏模块

游戏模块采用卡牌 + 符文 + 宝箱 + Boss 结算，不做实时战斗。

### 10.1 核心循环

```text
做题
→ 产生可信学习事件
→ 获得卡牌进度/符文碎片
→ 合成知识卡牌
→ 凑出符文之语
→ 解锁地图、称号、卡面、Boss 图鉴
```

### 10.2 卡牌三维成长

每张知识卡有三条进度。

```text
熟练度：来自有效刷题。
稳定度：来自记忆周期复习。
迁移度：来自变式和混合训练。
```

示例：

```json
{
  "cardId": "math.remainder.cycle",
  "name": "余数周期",
  "proficiency": 70,
  "stability": 40,
  "transfer": 25,
  "reviewStage": 2,
  "nextReviewAt": "2026-07-01T20:00:00-07:00"
}
```

### 10.3 符文类型

```text
时序符文：按时复习通过。
回忆符文：不看提示主动答对。
修正符文：错题订正成功。
迁移符文：变式训练通过。
融合符文：混合训练通过。
```

### 10.4 符文之语

符文之语要求学习条件 + 材料。

示例：

```text
符文之语：循环洞察

学习条件：
- 余数周期卡熟练度 ≥ 70%
- 稳定度 ≥ 40%
- 完成 1 次变式副本
- 完成 1 次到期复习

材料：
- 回忆符文 x2
- 时序符文 x1
- 迁移符文 x1

解锁：
- 余数 Boss 弱点识别
- 卡面：蓝焰周期
- 称号：循环观察者
```

### 10.5 宝箱与惊喜

宝箱只能由学习触发。

```text
每日小宝箱：完成今日任务。
周 Boss 宝箱：完成一周训练并通过 Boss。
章节宝箱：掌握一个专题。
```

禁用：

```text
付费抽卡
无限刷宝
排行榜
错过惩罚
限时抢奖励
广告式红点
强连续登录压迫
```

### 10.6 奖励分层

```text
最终答案正确
→ 基础 XP / 怪物掉血

最终答案正确 + 过程识别清楚
→ 回忆符文 / 迁移符文

最终答案错误 + 过程有正确开头
→ 修正符文碎片

过程无法识别
→ 不发过程奖励，但不惩罚
```

---

## 11. 家长管理与报告模块

家长端关注三件事：

```text
今天完成了什么。
哪里还薄弱。
明天建议练什么。
```

报告内容：

```text
学习时长
完成题数
正确率
订正率
薄弱知识点
即将遗忘知识点
错因分布
卡牌成长
AI 建议
```

报告示例：

```text
今天数学完成 18 题，正确 14 题。
余数周期题变式通过率低，建议明天安排 5 道变式训练。
孩子在鸡兔同笼中能使用假设法，但过程表达还不稳定。
```

---

## 12. AI 安全与质量控制模块

### 12.1 AI 使用边界

AI 负责：

```text
过程点评
错因归类
讲解生成
变式题生成
家长报告建议
低置信度复核
```

程序负责：

```text
最终答案判定
数值等价判断
单位归一化
奖励基础结算
记忆周期调度
```

### 12.2 出题质量控制

AI 生成题必须经过：

```text
题目生成
→ AI 自检
→ 程序规则校验
→ 答案校验
→ 入临时题库
→ 使用后根据表现决定是否沉淀
```

数学题要校验：

```text
是否有唯一答案
答案是否可计算
解析是否自洽
难度是否匹配
是否属于目标知识点
```

### 12.3 阅卷质量控制

阅卷输出必须带置信度。

低置信度策略：

```text
不直接判过程错误。
不发高级奖励。
保留原始草稿。
必要时家长确认。
```

---

## 13. 推荐技术组合

### 13.1 V1 技术组合

```text
Windows Ink：手写输入和 stroke 采集。
Mathpix：手写数学/公式/OCR 识别，可作为外部服务。
MathLive：最终答案公式输入与修正。
自研 grading-runtime：最终答案归一化和判定。
AI 大模型：过程点评、错因归类、讲解。
```

### 13.2 V2 可选增强

```text
Numbas：题目随机化和数学自动判题底座。
Excalidraw：草稿/图形表达辅助。
JSXGraph：几何、数轴、坐标互动图形。
```

### 13.3 暂缓

```text
STACK：数学判题强，但系统较重，许可和集成复杂度需要单独评估。
GeoGebra：能力强，但产品形态较重，授权需要确认。
```

---

## 14. 代码模块建议

在现有 Electron 项目中新增 runtime。

```text
src/learning-knowledge-runtime.js
src/student-model-runtime.js
src/training-scheduler-runtime.js
src/question-bank-runtime.js
src/answer-runtime.js
src/native-ink-runtime.js
src/grading-runtime.js
src/learning-event-runtime.js
src/game-reward-runtime.js
src/parent-report-runtime.js
```

建议 IPC：

```text
learning:get-daily-plan
learning:start-session
answer:create-submission
answer:save-draft
answer:submit
ink:export-strokes
ink:export-preview
grading:get-final-result
grading:get-ai-feedback
game:get-state
game:claim-reward
parent:get-report
```

本地数据目录建议：

```text
%AppData%/StudyGate/ai-learning/
├─ knowledge-points.json
├─ questions.json
├─ attempts.json
├─ mastery.json
├─ review-queue.json
├─ submissions/
├─ ink-assets/
├─ game-state.json
└─ reports/
```

---

## 15. MVP 分期

### V1：极简闭环

目标：能出题、能答题、能判最终答案、能记录能力、能给基础游戏奖励。

范围：

```text
小学奥数基础专题
最终答案框
Windows Ink 草稿区
程序判最终答案
AI 异步点评
卡牌熟练度
基础 XP / 怪物掉血
固定记忆周期
```

不做：

```text
完整过程强判
实时草稿识别
复杂图形自动阅卷
自由手绘表格识别
完整游戏大厅
```

### V2：表格与科学训练增强

范围：

```text
插入空表格
每格输入/识别
错题变式
回忆副本
修正符文
时序符文
家长周报
```

### V3：图形辅助与卡牌系统完善

范围：

```text
线段/数轴辅助
图形标注辅助
卡牌稳定度/迁移度
符文之语
周 Boss 结算
章节宝箱
```

### V4：多学科扩展

范围：

```text
英语单词/听写/阅读
语文字词/古诗/阅读理解
作文 AI 点评
跨学科学习报告
```

---

## 16. 验收标准

### 16.1 输入体验

```text
孩子默认只看到题目、草稿、最终答案、提交。
最终答案低置信度时能快速确认或修改。
草稿书写不能卡顿。
不出现复杂工具栏干扰孩子思考。
```

### 16.2 判卷准确性

```text
短答案题最终答案判定准确率达到可用水平。
低置信度不误判。
过程分析只影响额外奖励，不影响基础对错。
家长能查看原始草稿和 AI 点评。
```

### 16.3 科学训练

```text
系统能生成每日任务。
系统能安排到期复习。
系统能生成错题变式。
系统能更新熟练度、稳定度、迁移度。
```

### 16.4 游戏激励

```text
每天完成任务都有可见进度。
每周有 Boss 或宝箱结算。
奖励全部来自学习事件。
没有无限刷、排行榜、抽卡付费、错过惩罚。
```

---

## 17. 关键风险

### 风险 1：自动识别能力被高估

处理：

```text
最终答案强判。
过程只做辅助。
低置信度兜底。
不承诺完整看懂草稿。
```

### 风险 2：输入交互过复杂

处理：

```text
V1 只保留草稿 + 答案 + 提交。
表格等辅助工具放到 V2。
答错后再逐步提示辅助工具。
```

### 风险 3：游戏喧宾夺主

处理：

```text
没有纯游戏入口。
奖励必须由有效学习事件触发。
宝箱和符文服务知识掌握。
```

### 风险 4：AI 出题质量不稳定

处理：

```text
先用固定题库。
AI 先做讲解和变式。
AI 生成题必须经过校验。
```

### 风险 5：Windows Ink 与 Electron 混合复杂

处理：

```text
V1 只做一个草稿区。
原生 Ink 编辑态显示，非编辑态固化预览。
多 Ink Block 后置。
```

---

## 18. 参考资料

以下资料用于技术边界判断和选型参考。

```text
Microsoft Learn - Pen interactions and Windows Ink in Windows apps
https://learn.microsoft.com/en-us/windows/apps/design/input/pen-and-stylus-interactions

Microsoft Learn - Recognize Windows Ink strokes as text and shapes
https://learn.microsoft.com/en-us/windows/uwp/ui-input/convert-ink-to-text

Mathpix Docs - OCR API / Process Stroke Data
https://docs.mathpix.com/
https://docs.mathpix.com/guides/strokes

MathLive GitHub
https://github.com/arnog/mathlive

Numbas 官网
https://www.numbas.org.uk/

Excalidraw GitHub
https://github.com/excalidraw/excalidraw

JSXGraph GitHub
https://github.com/jsxgraph/jsxgraph
```

---

## 19. 最终定稿原则

```text
前台输入像纸一样简单。
后台数据像文档一样结构化。
最终答案像考试一样强判。
过程草稿像老师一样辅助看。
游戏奖励像学习资产一样沉淀。
```

V1 优先级：

```text
1. 最终答案判准。
2. 学习事件可信。
3. 记忆周期跑通。
4. 游戏奖励闭环。
5. 过程分析能用多少用多少。
```

这就是嘉好学 AI 升级的主路线。
