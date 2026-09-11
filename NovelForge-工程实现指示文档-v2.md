# NovelForge — 工程实现指示文档 v2（完整版）

> 本文档面向 AI 编码代理（Codex / Trae / Claude Code 等），用于从零生成一个可运行的项目原型。请严格按里程碑顺序实现，每个模块完成后可独立测试。**聚焦点 A、B、C、D 是项目的技术核心，代码量应占总量的 50% 以上。前端是完整项目的正式组成部分，采用前后端分离架构，整体风格偏向二次元。**
>
> **v2 相对 v1 的增量（Agent 岗位面试导向补强）**：
> 1. **新增聚焦点 C：工具调用层**——Function Calling + ToolRegistry + 只读工具白名单 + 每回合调用预算。补齐 Agent 岗位最核心的 Tool Use 能力。
> 2. **新增聚焦点 D：可观测性**——LangFuse / 本地 JSONL 双后端 Trace，span 覆盖 llm / tool / boundary 三类调用，token 与成本核算进实验报告。
> 3. **LangGraph 增强**——SqliteSaver checkpointer 断点恢复 + 导演干预 human-in-the-loop 开关。
> 4. 相应更新：目录结构、数据模型、LLM 封装、WebSocket 协议、实验指标、里程碑、验收标准、环境变量。


## 一、项目概述

**项目名**：NovelForge

**一句话描述**：用户输入若干张角色卡（JSON），系统让这些角色在虚拟场景中自主互动（可调用只读工具感知世界），由导演 Agent 控制节奏（支持人工确认干预），最终输出一章连贯的轻小说文本。全过程留有结构化 Trace 与成本记录。

**核心流程**：

```
角色卡集 + 初始场景
        ↓
[角色Agent实例化] → [世界状态初始化]
        ↓
[自主互动循环] ←→ [工具调用(只读)] ←→ [导演Agent干预(可人工确认)]
        ↓
[互动日志] → [叙事重写] → [章节体小说]
        ↓
[全链路 Trace + Token/成本核算]
```

**技术栈**：

| 模块 | 选型 | 用途 |
|---|---|---|
| 语言 | Python 3.11+ | 后端核心 |
| Agent 编排 | LangGraph ≥0.2 | StateGraph 状态图 |
| LangGraph 持久化 | langgraph-checkpoint-sqlite | 断点恢复 / human-in-the-loop |
| 工具调用 | OpenAI Function Calling 协议 | 角色 Agent 工具循环 |
| 数据模型 | Pydantic v2 | 类型安全的数据结构 |
| 向量检索 | ChromaDB | 角色记忆的语义检索 |
| 关系图 | NetworkX | 角色关系与事件因果（含工具查询） |
| LLM | OpenAI API / Anthropic API | 文本生成与结构化抽取 |
| 可观测性 | LangFuse（可选）/ 本地 JSONL 双后端 | 全链路 Trace + 成本核算 |
| 终端输出 | Rich | 张力曲线可视化、进度展示 |
| 后端框架 | FastAPI + Uvicorn | 异步 API + WebSocket |
| 前端框架 | React 18 + Vite + TypeScript | 组件化开发，类型安全 |
| 前端状态 | Zustand | 轻量状态管理 |
| 前端样式 | Tailwind CSS + 自定义 CSS 变量 | 二次元主题 |
| 前端动画 | Framer Motion | 气泡入场、过渡 |
| 前端图表 | Recharts | 张力曲线可视化 |
| 实时通信 | WebSocket | 互动流实时推送 |
| 测试 | pytest（后端）、npm run build（前端） | 单元测试与集成测试 |
| 配置 | pydantic-settings + .env | 环境变量管理 |


## 二、目录结构

```
novelforge/
├── README.md
├── requirements.txt
├── .env.example
├── config/
│   └── settings.py              # 全局配置（pydantic-settings）
├── src/                         # 后端核心
│   ├── __init__.py
│   ├── models/                  # 数据模型
│   │   ├── __init__.py
│   │   ├── character.py         # 角色卡 + 运行时状态
│   │   ├── world.py             # 世界状态
│   │   ├── event.py             # 事件 + 记忆条目
│   │   ├── narrative.py         # 叙事输出
│   │   ├── tool.py              # 工具调用记录（聚焦点 C 用）
│   │   └── claim.py             # 声明（聚焦点 B 用）
│   ├── agents/
│   │   ├── __init__.py
│   │   ├── base.py              # Agent 基类
│   │   ├── character_agent.py   # 角色 Agent（含工具决策循环）
│   │   ├── director_agent.py    # 导演 Agent
│   │   └── narrator_agent.py    # 叙事协调器
│   ├── memory/
│   │   ├── __init__.py
│   │   ├── role_memory.py       # 角色链记忆
│   │   ├── global_memory.py     # 全局链记忆
│   │   └── importance.py        # importance 评分器
│   ├── tools/                   # ★ 聚焦点 C：工具调用层
│   │   ├── __init__.py
│   │   ├── base.py              # Tool 抽象 + ToolRegistry（白名单/预算/trace）
│   │   ├── relation_graph.py    # query_relations 关系图查询
│   │   ├── memory_search.py     # search_memory 自身记忆检索（owner 隔离）
│   │   └── world_info.py        # observe_world 世界状态观察
│   ├── strategies/              # ★ 聚焦点 A：干预策略
│   │   ├── __init__.py
│   │   ├── base.py              # InterventionStrategy 抽象基类
│   │   ├── threshold.py         # 阈值触发策略
│   │   ├── rate_based.py        # 变化率触发策略
│   │   └── periodic.py          # 周期性注入策略
│   ├── boundary/                # ★ 聚焦点 B：知识边界
│   │   ├── __init__.py
│   │   ├── claim_extractor.py   # 声明抽取
│   │   └── boundary_guard.py    # 越界检测器
│   ├── observability/           # ★ 聚焦点 D：可观测性
│   │   ├── __init__.py
│   │   ├── trace.py             # Span / TraceManager（LangFuse | 本地 jsonl 双后端）
│   │   └── cost.py              # UsageTracker：token 消耗与成本核算
│   ├── tension/                 # 张力计算
│   │   ├── __init__.py
│   │   └── calculator.py        # 可计算化张力公式
│   ├── graph/
│   │   └── workflow.py          # LangGraph 状态图（checkpointer + HITL）
│   ├── engine/
│   │   └── simulation.py        # 互动循环引擎
│   ├── rewrite/
│   │   └── coordinator.py       # 叙事重写
│   ├── api/                     # 后端 API
│   │   ├── __init__.py
│   │   ├── main.py              # FastAPI 入口
│   │   ├── routes/
│   │   │   ├── characters.py
│   │   │   ├── simulation.py
│   │   │   ├── chapter.py
│   │   │   └── experiments.py
│   │   └── websocket.py         # WebSocket 管理器
│   └── utils/
│       ├── __init__.py
│       ├── llm.py               # LLM 调用封装（含重试 + tools + trace）
│       └── logger.py            # 结构化日志
├── experiments/                 # ★ 对比实验
│   ├── run_comparison.py        # 三种策略对比实验入口
│   ├── config.yaml              # 实验配置
│   ├── metrics.py               # 评估指标计算
│   └── report_generator.py      # 报告生成（含成本对比）
├── data/
│   ├── characters/
│   │   ├── alice.json
│   │   ├── bob.json
│   │   ├── claire.json
│   │   ├── david.json
│   │   └── eve.json
│   └── scenarios/
│       └── cafe_meeting.json
├── tests/
│   ├── test_models.py
│   ├── test_character_agent.py
│   ├── test_tools.py            # 工具注册表 / 白名单 / 预算 / owner 隔离
│   ├── test_observability.py    # span 嵌套 / jsonl 落盘 / 成本合计
│   ├── test_boundary_guard.py
│   ├── test_tension.py
│   ├── test_strategies.py
│   └── test_simulation.py
├── logs/                        # 运行时产物（llm_calls.jsonl / traces.jsonl / violations.jsonl）
├── frontend/                    # 前端完整项目
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   ├── tsconfig.json
│   ├── index.html
│   ├── public/
│   │   └── fonts/
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── api/
│       │   ├── client.ts
│       │   ├── characters.ts
│       │   ├── simulation.ts
│       │   └── websocket.ts
│       ├── stores/
│       │   ├── characterStore.ts
│       │   ├── simulationStore.ts
│       │   └── chapterStore.ts
│       ├── components/
│       │   ├── layout/
│       │   │   ├── AppShell.tsx
│       │   │   ├── Sidebar.tsx
│       │   │   └── Header.tsx
│       │   ├── character/
│       │   │   ├── CharacterCard.tsx
│       │   │   ├── CharacterList.tsx
│       │   │   ├── CharacterDetail.tsx
│       │   │   └── CharacterUpload.tsx
│       │   ├── simulation/
│       │   │   ├── SimulationView.tsx
│       │   │   ├── InteractionFeed.tsx
│       │   │   ├── SpeechBubble.tsx
│       │   │   ├── ToolCallTag.tsx        # 工具调用小标签（可折叠）
│       │   │   ├── DirectorNote.tsx
│       │   │   ├── TensionChart.tsx
│       │   │   ├── TraceDrawer.tsx        # 调试模式 Trace 抽屉
│       │   │   └── ControlBar.tsx
│       │   ├── chapter/
│       │   │   ├── ChapterReader.tsx
│       │   │   └── ChapterExport.tsx
│       │   └── common/
│       │       ├── Avatar.tsx
│       │       ├── Badge.tsx
│       │       ├── Loading.tsx
│       │       └── EmptyState.tsx
│       ├── pages/
│       │   ├── CharactersPage.tsx
│       │   ├── SimulationPage.tsx
│       │   ├── ChapterPage.tsx
│       │   └── ExperimentPage.tsx
│       ├── styles/
│       │   ├── globals.css
│       │   └── theme.ts
│       └── types/
│           ├── character.ts
│           ├── simulation.ts
│           └── chapter.ts
└── main.py                      # CLI 入口
```


## 三、数据模型定义

### 3.1 角色卡（`models/character.py`）

兼容 Character Card V2 规范。V2 卡片的顶层结构为 `{"spec": "chara_card_v2", "spec_version": "2.0", "data": {...}}`。

```python
from pydantic import BaseModel, Field
from typing import Optional

class CharacterCardData(BaseModel):
    name: str
    description: str
    personality: str
    scenario: Optional[str] = None
    first_mes: Optional[str] = None
    mes_example: Optional[str] = None
    system_prompt: Optional[str] = None
    post_history_instructions: Optional[str] = None

class CharacterCard(BaseModel):
    spec: str = "chara_card_v2"
    spec_version: str = "2.0"
    data: CharacterCardData

    # 叙事引擎扩展字段
    goals: list[str] = Field(default_factory=list)
    knowledge_boundary: list[str] = Field(default_factory=list)
    unknown_facts: list[str] = Field(default_factory=list)
    speech_style: Optional[str] = None
    relations: dict[str, str] = Field(default_factory=dict)

    @property
    def name(self) -> str:
        return self.data.name

    @property
    def personality(self) -> str:
        return self.data.personality

class CharacterState(BaseModel):
    name: str
    current_location: str
    emotion: str = "neutral"
    affinity: dict[str, float] = Field(default_factory=dict)
    active_goals: list[str] = Field(default_factory=list)
    memory_ids: list[str] = Field(default_factory=list)
```

### 3.2 世界状态（`models/world.py`）

```python
from pydantic import BaseModel, Field
from .character import CharacterState

class WorldState(BaseModel):
    turn: int = 0
    location: str = "unknown"
    time_of_day: str = "morning"
    characters: dict[str, CharacterState] = Field(default_factory=dict)
    active_flags: dict[str, bool] = Field(default_factory=dict)
    tension_history: list[float] = Field(default_factory=list)
    recent_events: list[str] = Field(default_factory=list)
    intervention_log: list[dict] = Field(default_factory=list)
```

### 3.3 事件与记忆（`models/event.py`）

```python
from pydantic import BaseModel

class Event(BaseModel):
    turn: int
    actor: str
    action_type: str    # speak / move / use / observe / silence
    content: str
    target: str | None = None
    importance: float = 0.5

class MemoryEntry(BaseModel):
    id: str
    character: str
    content: str
    turn: int
    importance: float
    embedding: list[float] | None = None
```

### 3.4 声明模型（`models/claim.py`）— 聚焦点 B 专用

```python
from pydantic import BaseModel

class Claim(BaseModel):
    subject: str
    relation: str
    object: str
    raw_text: str
    confidence: float = 1.0

class BoundaryViolation(BaseModel):
    turn: int
    character: str
    claim: Claim
    violation_type: str     # "direct_match" | "semantic_match"
    matched_unknown_fact: str
```

### 3.5 工具调用记录（`models/tool.py`）— 聚焦点 C 专用

```python
from pydantic import BaseModel

class ToolCallRecord(BaseModel):
    id: str
    turn: int
    character: str          # 发起调用的角色（owner）
    tool_name: str
    arguments: dict
    result_summary: str     # 截断后的结果摘要（≤200 字符）
    latency_ms: float
    ok: bool
    error: str | None = None
```

### 3.6 叙事输出（`models/narrative.py`）

```python
from pydantic import BaseModel

class SceneLog(BaseModel):
    location: str
    participants: list[str]
    events: list[dict]
    tension_curve: list[float]

class Chapter(BaseModel):
    title: str
    content: str
    word_count: int
    scenes: list[SceneLog]
```


## 四、核心模块实现要求

### 4.1 LLM 封装（`utils/llm.py`）

```python
def call_llm(
    prompt: str,
    system: str = "",
    json_mode: bool = False,
    temperature: float = 0.8,
    max_retries: int = 3,
) -> str:
    """统一 LLM 调用入口，支持指数退避重试"""
    ...

def call_llm_json(
    prompt: str,
    schema: dict,
    system: str = "",
) -> dict:
    """JSON 模式调用，返回结构化 dict"""
    ...

def call_llm_with_tools(
    messages: list[dict],
    tools: list[dict],
    temperature: float = 0.8,
    max_retries: int = 3,
) -> "LLMResponse":
    """Function Calling 入口。
    LLMResponse 包含：content、tool_calls（name/arguments/id）、
    assistant_message（可直接 append 回 messages 的原始消息）、tokens_in/out。
    """
    ...
```

**要求**：
- 支持 OpenAI 和 Anthropic 双后端，通过配置切换
- 记录每次调用的 token 消耗，汇总到 `observability/cost.py` 的 `UsageTracker`
- 所有调用挂接 trace span（见 4.11），`logs/llm_calls.jsonl`（含 prompt 摘要、耗时、token 数）继续保留作为轻量日志
- 失败时返回 fallback 值而非崩溃

### 4.2 角色 Agent（`agents/character_agent.py`）

**核心方法**：`perceive → decide(工具循环) → act → boundary_check`

```python
class CharacterAgent:
    def __init__(self, card: CharacterCard, memory: RoleMemory,
                 tools: ToolRegistry, boundary_guard: BoundaryGuard):
        self.card = card
        self.memory = memory
        self.tools = tools          # 只读工具白名单，见 4.10
        self.boundary_guard = boundary_guard

    def perceive(self, world: WorldState, scene: dict) -> str:
        """构建感知上下文：当前场景 + 其他角色最近言行 + 自身状态"""
        ...

    def decide(self, perception: str, world: WorldState) -> dict:
        """带工具循环的决策：LLM 可先调用只读工具收集信息，再给出行动"""
        messages = self._build_messages(perception)
        budget = settings.tool_max_calls_per_turn   # 默认 3

        for _ in range(budget):
            resp = call_llm_with_tools(messages, tools=self.tools.openai_schemas())
            if not resp.tool_calls:
                return resp.parsed_action
            messages.append(resp.assistant_message)
            for tc in resp.tool_calls:
                record = self.tools.execute(tc, owner=self.card.name, turn=world.turn)
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": record.result_summary,
                })

        # 预算耗尽：强制降级为沉默，避免失控
        return {"action_type": "silence", "content": "……", "target": None}

    def act(self, world: WorldState, scene: dict) -> Event:
        perception = self.perceive(world, scene)
        action = self.decide(perception, world)

        # ★ 聚焦点 B：知识边界检查
        if action["action_type"] == "speak":
            action = self.boundary_guard.enforce(action, max_retry=2)

        return Event(
            turn=world.turn,
            actor=self.card.name,
            action_type=action["action_type"],
            content=action["content"],
            target=action.get("target"),
        )
```

**Prompt 结构**：

```
[系统] 你正在扮演角色 {name}。
性格：{personality}
说话风格：{speech_style}
当前目标：{goals}
你已知的信息：{knowledge_boundary}
你**不知道**的信息：{unknown_facts}
与其他角色的关系：{relations}

[可用工具]
你可以调用以下只读工具来回忆与观察（不要编造工具结果）：
- search_memory(query)：检索**你自己**的记忆
- query_relations(character)：查询角色关系图
- observe_world()：观察当前地点、在场角色与最近公开事件

[对话示例]
{mes_example}

[当前场景]
地点：{location} | 在场角色：{others} | 最近发生：{recent_events}

[你的状态]
情绪：{emotion} | 关系值：{affinity}

请以 {name} 的身份选择下一步行动。可先调用工具，再输出最终行动。
输出 JSON：{"action_type": "speak|move|use|observe|silence", "content": "...", "target": "..."}
```

### 4.3 ★ 聚焦点 B：知识边界硬约束（`boundary/`）

**问题**：默认实现是在 prompt 中写“你不知道 XXX”，依赖 LLM 自觉。本模块将其升级为运行时检测机制，在系统层拦截越界发言。

#### B.1 声明抽取（`claim_extractor.py`）

```python
class ClaimExtractor:
    def extract(self, utterance: str) -> list[Claim]:
        """
        输入："我听说地下组织的首领就是你。"
        输出：[Claim(subject="地下组织", relation="首领", object="鲍勃")]
        """
        prompt = f"""
        将以下发言解析为结构化声明列表。每条声明格式为：
        {{"subject": "...", "relation": "...", "object": "..."}}

        只输出 JSON 数组，不要其他内容。

        发言：{utterance}
        """
        return call_llm_json(prompt, schema={"type": "array"})
```

#### B.2 越界检测（`boundary_guard.py`）

```python
class BoundaryGuard:
    def __init__(self, semantic_threshold: float = 0.85, max_retry: int = 2):
        self.semantic_threshold = semantic_threshold
        self.max_retry = max_retry
        self.extractor = ClaimExtractor()

    def check(self, action: dict, card: CharacterCard) -> tuple[dict, list[BoundaryViolation]]:
        claims = self.extractor.extract(action["content"])
        violations = []
        for claim in claims:
            if self._direct_match(claim, card.unknown_facts):
                violations.append(BoundaryViolation(
                    violation_type="direct_match", claim=claim, ...))
            elif self._semantic_match(claim, card.unknown_facts):
                violations.append(BoundaryViolation(
                    violation_type="semantic_match", claim=claim, ...))
        return action, violations

    def enforce(self, action: dict, card: CharacterCard, max_retry: int = 2) -> dict:
        for attempt in range(max_retry + 1):
            action, violations = self.check(action, card)
            if not violations:
                return action
            self._log_violations(violations)
            if attempt < max_retry:
                action = self._regenerate(action, violations, card)
            else:
                action = {"action_type": "silence", "content": "……", "target": None}
        return action

    def _direct_match(self, claim: Claim, unknown_facts: list[str]) -> bool: ...
    def _semantic_match(self, claim: Claim, unknown_facts: list[str]) -> bool: ...
```

**与聚焦点 C 的联动**：工具是角色的“信息来源”之一。`search_memory` 强制 owner 隔离（只能查自己的记忆），因此工具结果本身不会泄漏他人私密记忆；但 LLM 仍可能把工具结果与 `unknown_facts` 混淆输出——所以边界检查覆盖**最终发言**而非工具结果，且每次 `boundary_guard.enforce` 均产生独立 trace span 便于归因。

#### B.3 评估指标

| 指标 | 计算方式 | 期望方向 |
|---|---|---|
| 违规率 | 越界发言次数 / 总发言次数 | 越低越好 |
| 重生成成功率 | 重生成后不再越界的比例 | 越高越好 |
| 误报率 | 人工抽检被判定为越界但实际合理的比例 | 越低越好 |
| 系统开销 | 边界检测增加的 token 消耗和延迟 | 越低越好 |

**对比实验**：Baseline（仅 prompt 声明）vs. 本方案（运行时检测 + 拦截重生成）。

### 4.4 张力计算（`tension/calculator.py`）

**不要**让 LLM 直接打 0-10 分。实现可解释的加权公式：

```python
class TensionCalculator:
    """
    张力 = w1 * 关系值变化幅度
         + w2 * 目标冲突程度
         + w3 * 信息不对称程度
         + w4 * 事件新颖度
    """
    def compute(self, world: WorldState, recent_events: list[Event]) -> float:
        delta_affinity = self._compute_affinity_delta(world)
        goal_conflict = self._compute_goal_conflict(world)
        info_asymmetry = self._compute_info_asymmetry(world)
        novelty = self._compute_novelty(recent_events, world)
        tension = (self.w1 * delta_affinity + self.w2 * goal_conflict
                   + self.w3 * info_asymmetry + self.w4 * novelty)
        return min(10.0, max(0.0, tension))
```

权重默认：`0.3, 0.3, 0.2, 0.2`，配置文件可调。

### 4.5 ★ 聚焦点 A：导演干预策略（`strategies/`）

**问题**：多 Agent 自主互动系统面临核心矛盾——完全自主导致叙事平淡或失控，过度干预则使角色失去自主性。

#### A.1 抽象基类

```python
from abc import ABC, abstractmethod

class InterventionStrategy(ABC):
    @abstractmethod
    def should_intervene(self, world: WorldState, history: list[float]) -> bool: ...
    @abstractmethod
    def select_intervention_type(self, world: WorldState) -> str: ...
    @property
    @abstractmethod
    def name(self) -> str: ...
```

#### A.2 三种策略实现

**策略 A：阈值触发（`threshold.py`）**
- 触发条件：连续 `N=3` 轮张力值 `< 3.0`
- 干预类型选择：根据目标对立程度从 `external_event` / `secret_reveal` / `deadline` 中选择

**策略 B：变化率触发（`rate_based.py`）**
- 触发条件：关系值变化率的滑动平均连续 `N=3` 轮 `< 0.05`
- 干预类型选择：优先 `new_character` 或 `secret_reveal`

**策略 C：周期性注入（`periodic.py`）**
- 触发条件：固定每 `K=8` 轮触发一次
- 干预类型选择：轮转四种类型

#### A.3 干预类型

| 类型 | 描述 | 适用场景 |
|---|---|---|
| `external_event` | 外部事件（信使到来、天气突变） | 场景陷入平淡 |
| `secret_reveal` | 秘密暴露 | 信息不对称度低 |
| `deadline` | 时间压力 | 目标推进缓慢 |
| `new_character` | 新角色入场 | 互动模式固化 |

#### A.4 导演 Agent

```python
class DirectorAgent:
    def __init__(self, strategy: InterventionStrategy):
        self.strategy = strategy

    def evaluate_tension(self, world, recent_events) -> float: ...
    def should_intervene(self, world) -> bool: ...
    def generate_intervention(self, world) -> dict: ...
```

**Human-in-the-loop（可选开关）**：当 `HUMAN_CONFIRM_INTERVENTION=true` 时，LangGraph 在 `intervene` 节点前 interrupt（见 4.9），前端弹出干预预览卡片，用户点击「同意 / 跳过」后通过 WebSocket `confirm_intervention` 恢复执行。默认关闭， experiments 跑批时必须关闭。

#### A.5 对比实验（`experiments/run_comparison.py`）

**测试集**：5 个角色卡（3 主 2 辅），角色间存在 2-3 组目标冲突。

**实验设计**：每种策略跑 5 次，每次 50 轮，共 15 次模拟，固定随机种子。

**评估指标**：

| 指标 | 计算方式 | 期望方向 |
|---|---|---|
| 涌现事件率 | 无干预轮次中发生关系值变化/目标推进的轮数占比 | 越高越好 |
| 张力曲线均值 | `mean(tension_history)` | 中等偏高（4-6）最佳 |
| 张力曲线方差 | `var(tension_history)` | 适中 |
| 干预次数 | 导演触发干预的总次数 | 越少越好 |
| 角色一致性得分 | LLM-as-Judge 的 1-5 分 | 越高越好 |
| 故事收敛轮次 | 达到终止条件的轮次 | 适中 |
| 工具调用率 | 发生工具调用的回合数 / 总回合数 | 记录项（分析用） |
| 每章 token 成本 | `UsageTracker` 按策略汇总的美元成本 | 记录项（分析用） |

**输出**：`results.json`、`report.md`、`tension_curves.png`。

### 4.6 记忆系统（`memory/`）

采用 MENTOR 式双链结构。

**角色链记忆**：
- 每个角色独立一个 ChromaDB collection
- 写入：每轮事件按 importance 评分（LLM 打分）
- 检索：当前决策时检索 top-k 相关记忆（k=5）
- 淘汰：collection 超过 200 条时删除 importance 最低的 20%

**全局链记忆**：
- 单一 collection，存储所有角色的公开事件
- 用于叙事重写阶段检索

```python
class RoleMemory:
    def add(self, entry: MemoryEntry) -> None: ...
    def retrieve(self, character: str, query: str, k: int = 5) -> list[MemoryEntry]: ...
    def prune(self, character: str) -> None: ...

class GlobalMemory:
    def add(self, event: Event) -> None: ...
    def retrieve(self, query: str, k: int = 10) -> list[Event]: ...
```

### 4.7 互动循环引擎（`engine/simulation.py`）

```python
async def run_simulation(
    characters: list[CharacterCard],
    initial_scene: dict,
    max_turns: int = 30,
) -> list[SceneLog]:
    world = init_world(characters, initial_scene)
    director = DirectorAgent(strategy=load_strategy())
    logs = []

    for turn in range(max_turns):
        scene = director.schedule_next_scene(world)
        for char_name in scene["participants"]:
            agent = character_agents[char_name]
            event = agent.act(world, scene)
            role_memory[char_name].add(...)
            global_memory.add(event)
            update_world_state(world, event)

        tension = director.evaluate_tension(world, recent_events)
        world.tension_history.append(tension)

        if director.should_intervene(world):
            intervention = director.generate_intervention(world)
            world.intervention_log.append(intervention)
            logs.append(SceneLog(...))

        if is_story_converged(world):
            break

    return logs
```

**终止条件**：达到 `max_turns` / 所有角色目标达成或失败 / 连续 5 轮无关系值变化且无新事件。

### 4.8 叙事重写（`rewrite/coordinator.py`）

```python
class NarrativeCoordinator:
    def rewrite(self, logs: list[SceneLog], pov_character: str) -> Chapter:
        """
        1. 过滤 importance < 0.3 的事件
        2. 以 pov_character 的第三人称有限视角重写
        3. 补全符合其性格的内心活动
        4. 按场景边界切分章节
        """
```

**Prompt 结构**：

```
[系统] 你是一个轻小说作家。请将以下多角色互动日志重写为第 {n} 章。
视角角色：{pov_character} | 性格：{personality} | 说话风格：{speech_style}

[要求]
- 以 {pov_character} 的第三人称有限视角叙述
- 保留所有 importance >= 0.3 的事件
- 为 {pov_character} 补全符合其性格的内心活动
- 对话需符合各角色的说话风格
- 输出格式：章节标题 + 正文

[互动日志]
{events}
```

### 4.9 LangGraph 编排（`graph/workflow.py`）

**v2 增强**：`SqliteSaver` checkpointer 断点恢复 + 导演干预 human-in-the-loop 开关。

```python
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.sqlite import SqliteSaver

class NovelState(TypedDict):
    world: WorldState
    turn: int
    logs: list[SceneLog]
    current_scene: dict
    tension: float
    should_intervene: bool
    done: bool

def build_graph(human_confirm: bool = False, checkpointer=None):
    graph = StateGraph(NovelState)
    graph.add_node("schedule", schedule_scene)
    graph.add_node("character_act", character_act)          # 内含工具循环 + 边界检查 subgraph
    graph.add_node("evaluate_tension", evaluate_tension)
    graph.add_node("intervene", director_intervene)
    graph.add_node("check_termination", check_termination)
    graph.add_node("rewrite", rewrite_narrative)

    graph.set_entry_point("schedule")
    graph.add_edge("schedule", "character_act")
    graph.add_edge("character_act", "evaluate_tension")
    graph.add_conditional_edges(
        "evaluate_tension",
        lambda s: "intervene" if s["should_intervene"] else "check_termination")
    graph.add_edge("intervene", "check_termination")
    graph.add_conditional_edges(
        "check_termination",
        lambda s: "schedule" if not s["done"] else "rewrite")
    graph.add_edge("rewrite", END)

    return graph.compile(
        checkpointer=checkpointer,
        interrupt_before=["intervene"] if human_confirm else None,
    )

# 会话运行：thread_id = session_id
# 恢复执行：graph.invoke(None, config={"configurable": {"thread_id": session_id}})
```

**边界检查 subgraph**（被 `character_act` 节点内调用）：

```
claim_extract → boundary_match → (violations? → regenerate / pass)
```

**要求**：
- WebSocket `pause/resume` 基于 checkpointer 实现：pause 即中断 invoke，resume 用 `graph.invoke(None, config)` 续跑，`step` 为单节点步进
- `HUMAN_CONFIRM_INTERVENTION=false`（默认）时行为与 v1 完全一致

### 4.10 ★ 聚焦点 C：工具调用层（`tools/`）

**问题**：v1 中角色 Agent 只能凭 prompt 里的静态上下文做决策，没有任何工具调用能力——这是 Agent 工程最核心的能力缺失。本模块为角色 Agent 提供一组**只读**工具，通过 OpenAI Function Calling 协议在决策循环内按需调用。

#### C.1 Tool 抽象与注册表（`tools/base.py`）

```python
from abc import ABC, abstractmethod

class Tool(ABC):
    name: str
    description: str
    parameters: dict        # JSON Schema

    @abstractmethod
    def run(self, owner: str, **kwargs) -> dict:
        """owner 为发起调用的角色名，用于权限隔离"""

class ToolRegistry:
    """只读工具白名单注册表"""
    def __init__(self, tools: list[Tool]):
        self.tools = {t.name: t for t in tools}

    def openai_schemas(self) -> list[dict]:
        return [{"type": "function", "function": {
            "name": t.name, "description": t.description,
            "parameters": t.parameters}} for t in self.tools.values()]

    def execute(self, tool_call, owner: str, turn: int) -> ToolCallRecord:
        # 1. 白名单校验（不在册工具 → 拒绝并记录）
        # 2. JSON Schema 参数校验（pydantic）
        # 3. owner 权限校验
        # 4. 计时执行 + trace span（name="tool.{tool_name}"）
        # 5. 异常捕获 → result_summary 置错误信息，ok=False，不抛出
        ...

def build_default_tools(memory: dict[str, RoleMemory],
                        relation_graph: nx.Graph,
                        world_ref) -> ToolRegistry:
    return ToolRegistry([
        SearchMemoryTool(memory),        # owner 隔离
        QueryRelationsTool(relation_graph),
        ObserveWorldTool(world_ref),
    ])
```

#### C.2 三个内置工具

| 工具 | 签名 | 数据源 | 权限约束 |
|---|---|---|---|
| `search_memory` | `(query: str, k: int = 5)` | 调用者自己的 RoleMemory（ChromaDB） | **强制 owner 隔离**：只能检索 `owner` 自己的 collection，参数中不可指定他人 |
| `query_relations` | `(character: str)` | NetworkX 关系图 | 只读；返回该角色的邻接关系与关系值 |
| `observe_world` | `()` | WorldState | 只读；返回地点、时间、在场角色、最近公开事件、当前张力 |

**关键约束**：
- 所有工具**只读**：任何写世界状态的操作（改关系值、改 flags、注入事件）只属于引擎和导演，角色永远拿不到写工具
- 每回合工具预算 `TOOL_MAX_CALLS_PER_TURN=3`，超限强制降级为 silence
- 工具结果截断为 ≤200 字符的 `result_summary` 存入 `ToolCallRecord`，完整结果只进 messages，不进持久化日志（控成本）
- 每次调用写 `logs/tool_calls.jsonl` 并产生 trace span

#### C.3 评估指标

| 指标 | 计算方式 | 期望方向 |
|---|---|---|
| 工具调用率 | 发生工具调用的回合数 / 总回合数 | 记录项 |
| 工具成功率 | `ok=True` 的调用占比 | 越高越好 |
| 工具平均延迟 | `mean(latency_ms)` | 越低越好 |
| 工具 token 开销 | 含工具循环的回合 vs 不含的回合 token 差 | 记录项 |

**对比实验**：Baseline（无工具，仅静态感知）vs. 本方案（决策内工具循环）。报告工具对「角色一致性得分」和「信息类对话合理性」的影响。

### 4.11 ★ 聚焦点 D：可观测性（`observability/`）

**问题**：多 Agent 系统的失败难以归因——一次发言背后可能有 3 次 LLM 调用、2 次工具调用、1 次边界重生成。没有结构化 Trace，实验结果无法解释。本模块提供双后端 Trace 与成本核算。

#### D.1 Span 与 TraceManager（`trace.py`）

```python
@dataclass
class Span:
    id: str
    parent_id: str | None
    name: str            # 如 "sim.s1.turn.5.alice.decide"
    start_ts: float
    end_ts: float | None = None
    tokens_in: int = 0
    tokens_out: int = 0
    cost_usd: float = 0.0
    tags: list[str] = field(default_factory=list)   # ["llm", "tool", "boundary", ...]
    meta: dict = field(default_factory=dict)

class TraceManager:
    """双后端：配置了 LangFuse 密钥 → LangFuse；否则 → 本地 logs/traces.jsonl"""

    def span(self, name: str, parent: Span | None = None,
             tags: list[str] | None = None, **meta) -> Span: ...
    def end(self, span: Span, output_summary: str = "") -> None: ...
    def flush(self) -> None: ...
```

**span 层级约定**：

```
simulation(session_id)
└── turn.{n}
    ├── agent.{name}.decide          # 一次决策（可能含多轮工具循环）
    │   ├── llm.call                 # 每次底层 LLM 调用
    │   └── tool.{tool_name}         # 每次工具调用
    ├── boundary.check               # 声明抽取 + 匹配
    ├── boundary.regenerate          # 越界重生成（含内部 llm.call）
    ├── director.evaluate_tension    # 纯计算，极快
    ├── director.intervene           # 干预生成（含内部 llm.call）
    └── rewrite.chapter              # 章节重写
```

**要求**：
- jsonl 后端每行一个 span：`{"id", "parent_id", "name", "latency_ms", "tokens_in", "tokens_out", "cost_usd", "tags", "meta"}`，meta 里放输入输出摘要（各 ≤300 字符）
- LangFuse 后端用 `langfuse.flush()` 保证实验进程结束前落盘；密钥缺失时自动降级到 jsonl 并打 warning，不崩溃
- `logs/llm_calls.jsonl`、`logs/tool_calls.jsonl`、`logs/violations.jsonl` 与 trace 并存：前者是事件流，trace 是因果树

#### D.2 成本核算（`cost.py`）

```python
class UsageTracker:
    """按 (backend, model) 记录 tokens_in/out 与估算成本；单价表可配置"""
    def add(self, model: str, tokens_in: int, tokens_out: int) -> None: ...
    def summary(self, group_by: str = "tag") -> dict:
        """支持按 span tag 分组：llm / tool / boundary / rewrite → 进实验报告"""
```

单价表放 `config/settings.py`，格式 `{"gpt-4o": {"in": 2.5, "out": 10.0}, ...}`（美元/百万 token）。实验报告输出：每策略总成本、按模块（决策/边界/重写）的成本分解。


## 五、示例数据

### 5.1 角色卡示例（`data/characters/alice.json`）

```json
{
  "spec": "chara_card_v2",
  "spec_version": "2.0",
  "data": {
    "name": "艾莉丝",
    "description": "17岁，银发红瞳，咖啡店常客，表面冷淡实则关心他人",
    "personality": "谨慎、观察力强、不轻易表露情感、对熟人会流露温柔",
    "scenario": "老城区的咖啡店，雨后的傍晚",
    "first_mes": "「……你又来了。」",
    "mes_example": "「……你又来了。」\n「我不是来聊天的。」\n「那你想知道什么？」"
  },
  "goals": ["查明哥哥失踪的真相", "保护咖啡店的秘密"],
  "knowledge_boundary": ["哥哥三年前失踪", "咖啡店老板是哥哥旧友", "镇上有个地下组织"],
  "unknown_facts": ["老板的真实身份", "地下组织的首领是谁", "哥哥是否还活着"],
  "speech_style": "简短、直接、偶尔带讽刺，句尾常用'……'",
  "relations": {"鲍勃": "警惕但逐渐信任"}
}
```

### 5.2 场景示例（`data/scenarios/cafe_meeting.json`）

```json
{
  "location": "老城区的咖啡店",
  "time_of_day": "傍晚",
  "participants": ["艾莉丝", "鲍勃"],
  "description": "雨后的傍晚，咖啡店里只有两位客人。"
}
```


## 六、前端架构与二次元风格设计

### 6.1 整体架构

```
┌─────────────────────────────────────────────────┐
│                  前端 (React + Vite)              │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐   │
│  │ 角色卡管理 │  │ 互动模拟   │  │ 章节阅读   │   │
│  └───────────┘  └───────────┘  └───────────┘   │
│         ↕ WebSocket (实时互动流)                  │
│         ↕ REST API (角色卡/章节/实验/Trace)       │
└─────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────┐
│             后端 (FastAPI + 核心引擎)             │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐   │
│  │ 模拟引擎   │  │ 导演系统   │  │ 边界守卫   │   │
│  └───────────┘  └───────────┘  └───────────┘   │
│  ┌───────────┐  ┌───────────┐                  │
│  │ 工具注册表 │  │ Trace/成本 │                  │
│  └───────────┘  └───────────┘                  │
│         ↕ LangGraph 状态图 (checkpointer)        │
└─────────────────────────────────────────────────┘
```

### 6.2 前端技术栈

| 层级 | 选型 |
|---|---|
| 框架 | React 18 + Vite + TypeScript |
| 状态管理 | Zustand |
| 样式 | Tailwind CSS + 自定义 CSS 变量 |
| 动画 | Framer Motion |
| 图表 | Recharts |
| 实时通信 | WebSocket |
| HTTP 客户端 | Axios |
| 路由 | React Router |

关键依赖版本：
```
react: ^18.3.0
react-dom: ^18.3.0
react-router-dom: ^6.26.0
zustand: ^4.5.0
axios: ^1.7.0
recharts: ^2.12.0
framer-motion: ^11.3.0
tailwindcss: ^3.4.0
typescript: ^5.5.0
vite: ^5.3.0
```

### 6.3 后端 API 设计

#### REST API

| 方法 | 路径 | 功能 |
|---|---|---|
| GET | `/api/characters` | 获取所有角色卡 |
| GET | `/api/characters/{name}` | 获取单个角色卡 |
| POST | `/api/characters` | 上传新角色卡 |
| DELETE | `/api/characters/{name}` | 删除角色卡 |
| GET | `/api/scenarios` | 获取所有场景 |
| POST | `/api/simulation/start` | 启动模拟 |
| POST | `/api/simulation/{id}/pause` | 暂停 |
| POST | `/api/simulation/{id}/resume` | 继续 |
| POST | `/api/simulation/{id}/step` | 单步 |
| POST | `/api/simulation/{id}/stop` | 停止 |
| GET | `/api/simulation/{id}/status` | 获取状态 |
| GET | `/api/simulation/{id}/tools` | 获取工具调用记录列表 |
| GET | `/api/simulation/{id}/trace` | 获取 Trace 摘要（span 树 + 成本统计） |
| POST | `/api/chapter/rewrite` | 触发章节重写 |
| GET | `/api/chapter/{id}` | 获取章节 |
| GET | `/api/experiments/results` | 获取实验结果 |
| GET | `/api/experiments/report` | 获取实验报告 |

#### WebSocket 消息协议

**连接**：`ws://localhost:8000/ws/simulation/{session_id}`

**服务端 → 客户端**：
```typescript
{ "type": "turn_start", "turn": 5, "scene": { ... } }
{ "type": "tool_call", "turn": 5, "character": "艾莉丝", "tool": "search_memory", "args": {"query": "地下组织"}, "result_summary": "命中 2 条记忆", "latency_ms": 120, "ok": true }
{ "type": "character_action", "turn": 5, "actor": "艾莉丝", "action_type": "speak", "content": "...", "target": "鲍勃", "avatar_color": "#B8A9E8" }
{ "type": "director_intervention", "turn": 5, "strategy": "rate_based", "intervention_type": "secret_reveal", "content": "...", "trigger_reason": "..." }
{ "type": "intervention_confirm_required", "turn": 5, "intervention": { ... } }
{ "type": "tension_update", "turn": 5, "tension": 4.2, "history": [3.1, 3.5, 4.2] }
{ "type": "boundary_violation", "turn": 5, "character": "艾莉丝", "claim": "...", "violation_type": "semantic_match", "action_taken": "regenerated" }
{ "type": "state_update", "world": { ... } }
{ "type": "simulation_end", "total_turns": 20, "reason": "converged" }
{ "type": "error", "message": "..." }
```

**客户端 → 服务端**：
```typescript
{ "type": "pause" }
{ "type": "resume" }
{ "type": "step" }
{ "type": "stop" }
{ "type": "set_speed", "speed": 1.5 }
{ "type": "confirm_intervention", "approved": true }
```

### 6.4 页面详细设计

#### 页面 1 · 角色卡管理（`/characters`）

- **左侧栏（320px）**：搜索框、角色列表（圆形头像 + 名字 + 简介）、上传按钮
- **右侧主区域**：选中角色详情卡，分区展示基本信息、性格标签、目标列表、知识边界（绿标签）、不知道的事实（红标签）、说话风格、对话示例（气泡样式）
- **上传弹窗**：拖拽区域 + JSON 粘贴框，实时校验，预览解析结果

#### 页面 2 · 互动模拟（`/simulation`）

- **顶部栏**：当前场景描述 + 张力曲线缩略图 + 策略标签 + 回合计数
- **中部互动流**：按回合分组，角色发言用聊天气泡（左/右交替，角色主题色），导演干预用居中系统卡片（星光图标 + 淡紫背景 + 虚线边框），边界违规用红色警示条（调试模式）
- **工具调用标签（`ToolCallTag`）**：角色气泡上方的小标签（扳手图标 + 工具名 + 参数摘要），默认折叠，点击展开显示结果摘要与延迟；同一回合多个调用纵向排列
- **Human-in-the-loop 卡片**：开启 `HUMAN_CONFIRM_INTERVENTION` 时，`intervention_confirm_required` 触发居中确认卡片（干预预览 + 同意 / 跳过按钮）
- **Trace 抽屉（`TraceDrawer`，调试模式）**：右侧滑出，按回合展示 span 树（llm / tool / boundary 三色标签）、延迟与 token 成本，数据来自 `GET /api/simulation/{id}/trace`
- **底部控制栏**：开始/暂停/单步/停止、速度滑块、策略切换、导出日志
- **张力曲线**：Recharts 折线图，干预点用星标标注

#### 页面 3 · 章节阅读（`/chapter`）

- 顶部：章节标题 + 字数 + 生成耗时
- 左侧：视角角色选择器
- 主区域：Markdown 渲染，衬线字体，行距 1.8，首行缩进，和纸纹理背景
- 右侧：目录
- 底部：导出 Markdown

#### 页面 4 · 对比实验（`/experiments`）

- 三种策略指标对比表格（含工具调用率与 token 成本列）
- 张力曲线对比图
- 涌现事件率柱状图
- 成本分解堆叠柱状图（决策 / 边界 / 重写）
- 实验报告渲染

### 6.5 二次元风格设计规范

#### 配色方案

```css
:root {
  --color-primary: #B8A9E8;        /* 薰衣草紫 */
  --color-primary-light: #D4C9F0;
  --color-primary-dark: #9B87D9;
  --color-accent: #FFB7C5;          /* 樱花粉 */
  --color-accent-light: #FFD4DC;
  --color-bg: #FDF6F0;              /* 暖奶白 */
  --color-bg-card: #FFFFFF;
  --color-bg-elevated: #FAF5FF;
  --color-text: #4A4458;            /* 深紫灰 */
  --color-text-secondary: #8B8499;
  --color-text-muted: #B5AFC0;
  --color-info: #7EC8E3;            /* 天空蓝 */
  --color-success: #A8D8B9;         /* 薄荷绿 */
  --color-warning: #FFD4A8;         /* 蜜桃橙 */
  --color-danger: #FF9B9B;          /* 珊瑚红 */
  --shadow-sm: 0 2px 8px rgba(184, 169, 232, 0.08);
  --shadow-md: 0 4px 16px rgba(184, 169, 232, 0.12);
  --shadow-lg: 0 8px 32px rgba(184, 169, 232, 0.16);
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 24px;
  --radius-full: 9999px;
}
```

#### 字体

```css
/* 标题 */
font-family: 'ZCOOL KuaiLe', 'Noto Sans SC', sans-serif;
/* 正文 */
font-family: 'Noto Sans SC', -apple-system, sans-serif;
/* 小说阅读 */
font-family: 'Noto Serif SC', 'Source Han Serif', serif;
```

#### 组件风格

- **卡片**：大圆角（16px），柔和阴影，悬停上浮
- **按钮**：胶囊形，粉色渐变（`linear-gradient(135deg, #FFB7C5, #B8A9E8)`），悬停微放大
- **聊天气泡**：大圆角（18px），带小尾巴，角色主题色浅色版，入场滑入+淡入
- **工具调用标签**：胶囊形小标签，天空蓝浅色底，等宽字体显示工具名
- **导演干预卡片**：居中，80% 宽，淡紫背景+虚线边框，星光图标，缩放+淡入
- **张力曲线**：紫色渐变线条，圆点悬停放大，干预点星标
- **装饰**：克制使用星星/月亮 SVG，加载动画用旋转星星，空状态用可爱图标

### 6.6 后端 WebSocket 实现要求

```python
class SimulationSession:
    def __init__(self, session_id: str, world: WorldState):
        self.session_id = session_id
        self.world = world
        self.clients: list[WebSocket] = []
        self.paused = False
        self.speed = 1.0
        self.task: asyncio.Task | None = None

    async def broadcast(self, message: dict):
        for client in self.clients:
            try:
                await client.send_json(message)
            except Exception:
                self.clients.remove(client)

    async def run_loop(self):
        while not self.is_done():
            if self.paused:
                await asyncio.sleep(0.1)
                continue
            await self.broadcast({"type": "turn_start", "turn": self.world.turn})
            for char_name in self.current_scene["participants"]:
                agent = self.character_agents[char_name]
                # 工具调用由 agent 内部产生，通过 callback 转发广播
                event = await agent.act_async(self.world,
                          on_tool_call=lambda r: self.broadcast_tool_call(r))
                await self.broadcast({...})
                if event.boundary_violation:
                    await self.broadcast({...})
            tension = self.director.evaluate_tension(self.world, recent_events)
            self.world.tension_history.append(tension)
            await self.broadcast({"type": "tension_update", ...})
            if self.director.should_intervene(self.world):
                if self.human_confirm:
                    await self.broadcast({"type": "intervention_confirm_required", ...})
                    self.pending_confirmation = True
                    while self.pending_confirmation:
                        await asyncio.sleep(0.1)   # 等待前端确认
                intervention = self.director.generate_intervention(self.world)
                self.world.intervention_log.append(intervention)
                await self.broadcast({"type": "director_intervention", ...})
            self.world.turn += 1
            await asyncio.sleep(1.0 / self.speed)
        await self.broadcast({"type": "simulation_end", ...})

@app.websocket("/ws/simulation/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    await websocket.accept()
    session = sessions[session_id]
    session.clients.append(websocket)
    try:
        while True:
            data = await websocket.receive_json()
            if data["type"] == "pause": session.paused = True
            elif data["type"] == "resume": session.paused = False
            elif data["type"] == "step":
                session.paused = True
                await session.step_once()
            elif data["type"] == "stop":
                session.stop(); break
            elif data["type"] == "set_speed":
                session.speed = data["speed"]
            elif data["type"] == "confirm_intervention":
                session.pending_confirmation = not data["approved"]
                session.skip_intervention = not data["approved"]
    except WebSocketDisconnect:
        session.clients.remove(websocket)
```


## 七、实现顺序（里程碑）

| 里程碑 | 内容 | 预估 |
|---|---|---|
| **M1** | 数据模型 + LLM 封装（含 call_llm_with_tools）+ Trace/成本骨架 | 1 天 |
| **M2** | 单角色 Agent + 工具调用层（3 个只读工具 + 预算 + owner 隔离） | 1.5 天 |
| **M3** | 记忆系统（双链 + ChromaDB）+ search_memory 工具接入真实检索 | 1 天 |
| **M4** | 张力计算 + 导演 Agent + 三种干预策略 | 1.5 天 |
| **M5** | 互动循环引擎 + LangGraph 编排（SqliteSaver checkpointer + HITL 开关） | 1.5 天 |
| **M6** | 叙事重写 + CLI 入口（--strategy / --trace-backend） | 1 天 |
| **M7** | FastAPI 后端 + WebSocket 服务 + trace/tools API | 1 天 |
| **M8** | 对比实验（含工具开/关消融 + 成本对比）+ 评估指标 + 报告生成 | 1 天 |
| **M9** | 前端项目初始化 + 主题系统 | 0.5 天 |
| **M10** | 角色卡管理页面 | 1 天 |
| **M11** | 互动模拟页面 + WebSocket + 工具标签 + HITL 确认卡片 | 1.5 天 |
| **M12** | 章节阅读 + 对比实验页面（含成本分解图）+ Trace 抽屉 | 1.5 天 |
| **M13** | 联调 + 样式打磨 + 测试 | 1 天 |
| **M14** | README + 演示视频录制 | 0.5 天 |

**总计约 15 天**。如果只有一个人开发，建议按 M1→M8 完成核心引擎和 API，再开始前端；如果有两个人，可以后端和前端并行，前端先用 mock 数据开发。


## 八、验收标准

**后端启动**：
```bash
uvicorn src.api.main:app --reload --port 8000
```

**前端启动**：
```bash
cd frontend
npm install
npm run dev
# 访问 http://localhost:5173
```

**CLI 运行**：
```bash
python main.py \
  --characters data/characters/alice.json data/characters/bob.json \
  --scenario data/scenarios/cafe_meeting.json \
  --max-turns 20 \
  --strategy rate_based \
  --trace-backend local \
  --output output/chapter1.md
```

**端到端验收**：
1. 在角色卡管理页面上传 3-5 张角色卡
2. 在互动模拟页面选择角色和场景，启动模拟
3. 实时看到角色发言气泡、工具调用小标签、导演干预卡片、张力曲线更新
4. 开启 `HUMAN_CONFIRM_INTERVENTION` 后，干预出现前弹出确认卡片，点击同意/跳过行为正确
5. 模拟结束后，切换到章节阅读页面，看到重写后的小说
6. 在对比实验页面查看三种策略的指标对比（含工具调用率与成本分解）
7. 打开调试模式 Trace 抽屉，能看到 span 树且层级正确（turn → agent → llm/tool）
8. 暂停模拟后重启后端进程，通过 checkpointer 能从断点恢复该会话

**测试**：`pytest tests/` 全部通过；`npm run build` 无错误。


## 九、关键实现约束

1. **不要一次性生成整个项目**。按里程碑顺序逐个模块实现，每个模块完成后先写测试。
2. **所有 LLM 调用必须有 fallback**，失败时返回默认值而非崩溃。
3. **知识边界检查是硬约束**，任何角色发言若引用 `unknown_facts`，必须拦截并重生成。
4. **记忆的 importance 评分用 LLM 打分**，Prompt：`该事件对角色{name}的目标推进/关系变化/知识获取的影响程度，0-1分，只输出数字。`
5. **导演干预必须记录理由**，输出 `{"type": "...", "reason": "...", "content": "..."}`。
6. **叙事重写必须保留原始事件**，重写是“润色+视角化”，不是“重新创作”。
7. **聚焦点 A、B、C、D 的代码量应占总代码量的 50% 以上**（其中 C ≥ 15%，D ≥ 8%），其余模块按最小可行标准实现。
8. **对比实验的随机种子固定**，确保可复现。
9. **前端 UI 不阻塞核心逻辑**：所有 UI 调用通过 API 接口，不直接操作内部状态。
10. **前端代码量不超过总代码量的 25%**，重点仍是聚焦点 A-D 的算法与工程实现。
11. **角色工具一律只读白名单**：任何修改世界状态的操作只能由引擎/导演执行；`search_memory` 强制 owner 隔离，工具参数中不允许指定他人记忆。
12. **每回合工具调用不超过 `TOOL_MAX_CALLS_PER_TURN`**，超限强制降级为 silence 决策，并记录降级事件。
13. **所有 LLM / 工具调用必须产生 trace span**，无 span 的调用视为 bug；LangFuse 密钥缺失时自动降级本地 jsonl，不允许因可观测性故障阻塞主流程。
14. **LangGraph 必须配置 checkpointer**，模拟会话可断点恢复；experiments 跑批时关闭 HITL。


## 十、环境变量（`.env.example`）

```
OPENAI_API_KEY=sk-xxx
OPENAI_BASE_URL=https://api.openai.com/v1
MODEL_NAME=gpt-4o
TEMPERATURE=0.8
MAX_TURNS=30

INTERVENTION_STRATEGY=rate_based
TENSION_THRESHOLD=3.0
RATE_THRESHOLD=0.05
PERIODIC_INTERVAL=8
HUMAN_CONFIRM_INTERVENTION=false

BOUNDARY_SEMANTIC_THRESHOLD=0.85
BOUNDARY_MAX_RETRY=2

TOOL_MAX_CALLS_PER_TURN=3

MEMORY_MAX_ENTRIES=200
MEMORY_PRUNE_RATIO=0.2

CHROMA_PERSIST_DIR=./chroma_db

TRACE_BACKEND=local
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
LANGFUSE_HOST=https://cloud.langfuse.com
LANGGRAPH_CHECKPOINT_DIR=./checkpoints

LOG_LEVEL=INFO
```


## 十一、技术深度自检

### 聚焦点 A（导演干预策略）的深度

- **张力计算的可计算化**：四维加权公式（关系值变化、目标冲突、信息不对称、事件新颖度），每个分量独立单元测试。
- **策略的可插拔设计**：`InterventionStrategy` 抽象基类支持三种具体策略的独立实现和配置切换。
- **对比实验的严谨性**：5 次重复 × 50 轮 × 3 种策略，固定随机种子，输出统计量。
- **Human-in-the-loop**：LangGraph interrupt 实现干预前人工确认，可控性从「自动策略」扩展到「人机协同」。

### 聚焦点 B（知识边界硬约束）的深度

- **声明抽取的粒度设计**：`Claim(subject, relation, object)` 三元组。
- **双重匹配机制**：直接匹配 + 语义匹配（embedding 余弦相似度）。
- **拦截与重生成的工程闭环**：违规记录持久化、重试上限、强制 fallback。
- **误报率与召回率的权衡**：语义匹配阈值 0.85 的选择是可讨论的设计决策。
- **与工具层的信息流联动**：owner 隔离保证工具不越权供数，边界检查覆盖最终发言，形成双保险。

### 聚焦点 C（工具调用层）的深度

- **决策内工具循环**：Function Calling 多轮循环 + 每回合预算控制 + 超限强制降级。
- **只读白名单与权限隔离**：角色永远无法修改世界状态；`search_memory` 的 owner 隔离从数据层面杜绝记忆越权。
- **结构化调用记录**：每次调用留 `ToolCallRecord`（参数、摘要、延迟、成败），可离线分析工具使用模式。
- **消融实验**：工具开/关对角色一致性与成本的影响可量化。

### 聚焦点 D（可观测性）的深度

- **span 分级与因果树**：simulation → turn → agent → {llm / tool / boundary}，失败归因可直接定位到具体调用。
- **双后端降级设计**：LangFuse 可选、本地 jsonl 兜底，可观测性故障不阻塞主流程。
- **成本核算进实验报告**：按模块（决策/边界/重写）分解成本，策略对比同时给出质量与成本两个维度。

### 与主流 Agent 岗位要求的对应关系

| 岗位要求 | 本项目覆盖点 |
|---|---|
| LangGraph / 多 Agent 编排 | 状态图设计 + 导演 Agent 干预机制 + checkpointer 断点恢复 |
| Tool Use / Function Calling | ToolRegistry + 决策内工具循环 + 只读白名单 + 调用预算 |
| RAG 与记忆系统 | 双链记忆 + ChromaDB 检索 + importance 淘汰 + 工具化检索 |
| Agent 行为约束 | 知识边界运行时检测 + 拦截重生成 + 工具权限隔离 |
| 评测体系 | 分层评估框架 + 对比实验设计 + 消融实验 |
| 可控性机制 | 干预策略可插拔 + human-in-the-loop + 对比验证 |
| 可观测性 | LangFuse/本地双后端 Trace + span 因果树 + 成本核算 |
| 前后端工程化 | FastAPI + WebSocket + React 完整项目 |


## 十二、README 需包含

1. 项目简介（一段话）
2. 安装步骤（后端 + 前端）
3. 快速开始（示例命令）
4. 架构图（ASCII）
5. 角色卡格式说明（含 V2 兼容性说明）
6. 深度聚焦点说明（A 干预策略 / B 知识边界 / C 工具调用 / D 可观测性）
7. 实验结果（含成本分解与工具消融）
8. 前端截图（至少 4 张：角色卡管理、互动模拟含工具标签、章节阅读、Trace 抽屉）
9. API 文档链接（FastAPI 自带 `/docs`）
10. WebSocket 消息协议说明
11. 工具调用说明（三个只读工具 + 白名单机制 + 示例 ToolCallRecord）
12. 可观测性说明（LangFuse 接入方式 / 本地 trace 查看方式 / span 层级图）
13. 二次元风格设计说明（配色、字体、组件）
14. 已知限制
15. 未来工作
16. 演示视频/GIF


**文档结束。请从 M1 开始实现。**

