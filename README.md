# NovelForge — 多 Agent 轻小说生成系统

用户输入若干张角色卡（JSON），系统让这些角色在虚拟场景中**自主互动**，由**导演 Agent** 控制节奏，最终输出一章连贯的轻小说文本。

```
角色卡集 + 初始场景
        ↓
[角色Agent实例化] → [世界状态初始化]
        ↓
[自主互动循环] ←→ [导演Agent干预]
        ↓
[互动日志] → [叙事重写] → [章节体小说]
```

## 核心特性

| 聚焦点 | 说明 |
|---|---|
| **A · 可插拔干预策略** | 阈值触发 / 变化率触发 / 周期性注入三种策略，统一 `InterventionStrategy` 接口，支持对比实验评估 |
| **B · 知识边界硬约束** | 声明抽取（LLM 结构化）→ 直接匹配 + 语义匹配双重检测 → 拦截并重生成，防止角色"说漏"未知信息 |
| **C · 工具调用层** | Function Calling 协议、只读工具白名单（世界信息 / 关系图 / 记忆检索）、每回合调用预算控制、全量调用记录 |
| **D · 可观测性** | 双后端 Trace（LangFuse / 本地 JSONL，span 嵌套）、成本核算、结构化日志落盘 |

其他：四维加权张力公式（关系变化 / 目标冲突 / 信息不对称 / 事件新颖度）、角色链记忆（ChromaDB 语义检索 + 重要性评分淘汰）、LangGraph 编排（checkpointer 断点恢复）、WebSocket 交互模式支持暂停 / 单步 / 人工确认（HITL）。

## 技术栈

- **后端**：Python 3.11+ · LangGraph · Pydantic v2 · FastAPI + Uvicorn · ChromaDB · NetworkX
- **前端**：React 18 + Vite + TypeScript · Zustand · Tailwind CSS · Framer Motion · Recharts
- **LLM**：OpenAI / Anthropic API（内置 `mock` 后端，无 Key 也能跑通全流程）
- **测试**：pytest（后端 43 用例）· `npm run build`（前端）

## 快速开始

### 1. 后端

```bash
python -m venv .venv
.venv\Scripts\activate            # Windows（Linux/macOS: source .venv/bin/activate）
pip install -r requirements.txt
copy .env.example .env            # Linux/macOS: cp .env.example .env
```

无 API Key 时设置 `LLM_BACKEND=mock` 即可体验全流程；真实调用填入 `OPENAI_API_KEY`。

### 2. CLI 运行（批量路径）

```bash
python main.py \
  --characters data/characters/alice.json data/characters/bob.json \
  --scenario data/scenarios/cafe_meeting.json \
  --max-turns 20 \
  --strategy rate_based \
  --trace-backend local \
  --output output/chapter1.md
```

### 3. API 服务

```bash
uvicorn src.api.main:app --reload --port 8000
# Swagger 文档：http://localhost:8000/docs
```

### 4. 前端

```bash
cd frontend
npm install
npm run dev
# 访问 http://localhost:5173
```

页面：角色卡管理、互动模拟（WebSocket 实时气泡 + 工具调用标签 + 导演干预卡片 + 张力曲线 + HITL 确认）、章节阅读、对比实验（指标对比 + 成本分解）。

## 对比实验

```bash
python experiments/run_comparison.py --turns 3 --repeats 1   # 冒烟
python experiments/run_comparison.py --turns 20 --repeats 3  # 完整
```

产出：`output/report.md`（指标对比表）、`output/results.json`（原始数据）、`output/tension_curves.png`（张力曲线）。

评估指标：涌现事件率、张力均值/方差、干预次数、工具调用率、LLM judge 评分、成本。

## 目录结构

```
novelforge/
├── main.py                  # CLI 入口（LangGraph 批量路径）
├── config/settings.py       # 全局配置（pydantic-settings + .env）
├── src/
│   ├── models/              # 角色卡 / 世界 / 事件 / 声明 / 叙事 / 工具
│   ├── agents/              # 角色 Agent / 导演 Agent / 叙事协调器
│   ├── memory/              # 角色链记忆 / 全局记忆 / 重要性评分
│   ├── strategies/          # ★A 干预策略（threshold / rate_based / periodic）
│   ├── boundary/            # ★B 声明抽取 + 越界检测
│   ├── tools/               # ★C 工具注册表 + 只读工具白名单
│   ├── tension/             # 可计算化张力公式
│   ├── engine/simulation.py # 互动循环引擎（交互模式：暂停/单步/HITL）
│   ├── graph/workflow.py    # LangGraph 状态图（批量模式：checkpointer）
│   ├── rewrite/             # 叙事重写 → 章节体小说
│   ├── api/                 # FastAPI 路由 + WebSocket
│   ├── observability/       # ★D Trace / 成本核算
│   └── utils/               # LLM 封装（重试 + mock）/ 日志
├── experiments/             # 对比实验（metrics / report_generator）
├── frontend/                # 前端完整项目（React 18 + Vite）
├── data/                    # 示例角色卡（alice/bob/claire/david/eve）+ 场景
├── tests/                   # pytest 测试套件
└── output/                  # 实验报告 / 章节产物
```

## 架构说明：两条运行路径

| | 批量路径（CLI / 实验） | 交互路径（API / WebSocket） |
|---|---|---|
| 编排 | LangGraph StateGraph + SqliteSaver checkpointer | 引擎自管异步循环 |
| 断点恢复 | 支持（`checkpoints/`） | 会话内暂停 / 单步 |
| HITL | 无 | 干预确认卡片 |
| 组件复用 | 同一套 Agent / 导演 / 工具 / 边界组件 | 同左 |

## 测试

```bash
pytest -v          # 43 passed（含 mock LLM 后端，无需真实 API）
cd frontend && npm run build
```

## 已知限制

- mock 后端下三种策略指标一致（确定性输出），对比实验需真实 LLM 后端才体现差异
- LLM judge 为简化实现（1-5 分制单次评分），未做多评委投票
- 叙事重写按 POV 角色单一视角，未支持多视角章节切换
