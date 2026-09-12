# NovelForge — 二次元轻小说创作工作台（设计文档 v3）

> 参考项目：[AI-Novel-Writer](https://github.com/EthanYoQ/AI-Novel-Writer)（Electron 桌面创作工作台）。
> 本项目在其「创作编排层」理念之上**完全重建**为**二次元轻小说特化版本**。旧 Python 后端与 Web 前端全部废弃删除（git 历史保留）。

## 一、产品定位

**NovelForge**：面向长篇**轻小说**创作的本地优先桌面工作台。把「作品设定 → 角色卡 → 章节蓝图 → 草稿 → 审稿 → 修稿 → 定稿」组织为一条可追溯的创作流水线；模型由用户自行配置（OpenAI-compatible / 内置 mock），项目数据全部留在本机 SQLite。

与参考项目的差异 = **二次元轻小说特化升级**：

| # | 特化点 | 说明 |
|---|---|---|
| 1 | **文风预设系统** | 吐槽系 / 中二热血 / 治愈日常 / 王道冒险四种轻小说文风预设 + 自定义；提示词模板层内置「内心独白」「插旗与回收」「吐槽节奏」等轻小说技法指导 |
| 2 | **二次元角色卡** | 萌属性标签（傲娇/天然呆/腹黑…）+ 属性面板（发色/瞳色/声线）+ 口头禅 + 目标 + **秘密**（其他角色不可知，模拟与生成中不泄露）+ 关系表 + 头像色板 |
| 3 | **互动模拟生成模式**（特色） | 章节草稿可由「角色 Agent 在场景中互动（导演 Agent 控制节奏与张力）→ 叙事重写」涌现式生成，与常规蓝图式生成并列可选 |
| 4 | **轻小说感审稿** | 逐项目标核验（已完成/未完成/待核实 + 正文证据）+ 轻小说指标（台词占比、独白占比、吐槽密度、段落节奏）+ 设定一致性（秘密泄露检查） |
| 5 | **二次元 UI** | 樱粉×浅紫渐变主题、圆角卡片、气泡组件、角色立绘位、张力/节奏曲线可视化 |

## 二、技术栈

| 模块 | 选型 | 用途 |
|---|---|---|
| 桌面壳 | Electron 33 | 主进程（Node）：DB / LLM / 流水线 / 模拟引擎 |
| 构建 | Vite 5 + electron-builder | 开发热更新 + 桌面打包 |
| 渲染层 | React 18 + TypeScript | 组件化 UI，类型安全 |
| 状态 | Zustand | 轻量状态管理 |
| 样式 | Tailwind CSS 3.4 + 自定义主题 | 二次元视觉 |
| 动画 | Framer Motion | 气泡入场、页面过渡 |
| 图表 | Recharts | 张力曲线、节奏分析 |
| 存储 | better-sqlite3 | 本地项目数据库（主进程内） |
| LLM | OpenAI-compatible Chat Completions | OpenAI / DeepSeek / Ollama / 任意兼容端点；内置 mock |
| 测试 | Vitest | 主进程服务层单元测试 |

**进程架构**：

```
┌─ renderer（React）──────── 只做 UI，不碰 DB/网络 ────┐
│            ↕ window.novelforge.*（contextBridge IPC）
├─ preload ─────────── 安全桥：白名单 API ─────────────┤
│            ↕ ipcMain.handle
└─ main（Node）───── SQLite · LLM 客户端 · 流水线 · 模拟引擎 ────┘
```

## 三、目录结构

```
novelforge/
├── package.json                 # Electron + React 全栈
├── electron.vite.config.ts      # main/preload/renderer 三段构建
├── electron/                    # ── 主进程 ──
│   ├── main.ts                  # 窗口 + IPC 注册
│   ├── preload.ts               # contextBridge 白名单
│   ├── db/
│   │   ├── database.ts          # better-sqlite3 初始化 + 迁移
│   │   └── repo/                # project / character / world / blueprint / draft / review / simulation
│   ├── llm/
│   │   ├── client.ts            # OpenAI-compatible（重试/超时/流式开关）
│   │   ├── mock.ts              # mock 后端（无 Key 跑通全流程）
│   │   └── prompts/             # 蓝图/草稿/审稿/修稿/摘要 提示词模板（含文风预设）
│   ├── pipeline/                # ★ 创作流水线
│   │   ├── context.ts           # 上下文组装器（蓝图+角色+世界观+滚动摘要+文风）
│   │   ├── blueprint.ts         # 蓝图生成（章节目标清单/名场面/伏笔）
│   │   ├── draft.ts             # 草稿生成（蓝图式）
│   │   ├── review.ts            # 审稿（逐项目标核验 + 轻小说指标 + 一致性）
│   │   ├── revise.ts            # 修稿（按采纳的审稿项修订）
│   │   ├── summary.ts           # 定稿后滚动摘要更新
│   │   └── batch.ts             # 批量章节任务（1-10 章，暂停/取消）
│   ├── simulation/              # ★ 特色：互动模拟生成
│   │   ├── engine.ts            # 互动引擎（回合制，导演调度）
│   │   ├── character-agent.ts   # 角色 Agent（决策 + 台词，工具：查关系/查记忆）
│   │   ├── director.ts          # 导演 Agent（张力评估 + 干预注入）
│   │   └── narrator.ts          # 互动日志 → 轻小说章节草稿重写
│   └── export/                  # Markdown / TXT 导出
├── src/                         # ── 渲染进程 ──
│   ├── pages/
│   │   ├── LibraryPage.tsx      # 作品库（新建/打开/删除）
│   │   ├── ProjectLayout.tsx    # 作品内布局（左侧导航 + 顶栏）
│   │   ├── SettingPage.tsx      # 前提 / 世界观 / 文风预设 / 视角
│   │   ├── CharactersPage.tsx   # 二次元角色卡管理
│   │   ├── BlueprintPage.tsx    # 章节蓝图（列表 + 轨道视图）
│   │   ├── WritingPage.tsx      # 写作台（生成/编辑/版本对比）
│   │   ├── ReviewPage.tsx       # 审稿报告 + 修稿决策
│   │   ├── SimulationPage.tsx   # 互动模拟（特色模式）
│   │   └── ModelPage.tsx        # 模型配置（端点/Key/测试连接）
│   ├── store/                   # zustand（项目态 / 生成任务态 / 模拟实时态）
│   ├── components/              # 二次元主题通用组件
│   └── types/                   # IPC 契约类型（与主进程共享）
├── tests/                       # Vitest（pipeline / simulation / repo）
└── resources/                   # 图标 / 默认立绘占位
```

## 四、数据模型（SQLite）

```sql
-- 作品
projects(id TEXT PK, title, premise, genre, style_preset, point_of_view,
         summary TEXT,            -- 滚动前情摘要（定稿后更新）
         created_at, updated_at)
-- 世界观（多条目）
world_entries(id TEXT PK, project_id, title, content, sort)
-- 角色卡
characters(id TEXT PK, project_id, name, avatar_color, appearance,  -- 属性面板：发色瞳色声线
           personality, traits_json,     -- 萌属性标签[]
           speech_style, catchphrase,    -- 口头禅
           goals_json, secrets_json,     -- 秘密：他人不可知
           relations_json,               -- {角色名: 关系描述}
           sort)
-- 章节蓝图
blueprints(id TEXT PK, project_id, chapter_no, title, chapter_type,  -- 主线/日常/高潮/支线
           goals_json,          -- 本章关键事件清单[]（审稿逐项核验依据）
           scenes_json,         -- 场景序列
           foreshadowing_json,  -- 伏笔：埋设/回收
           notes, status)       -- planned/confirmed/written
-- 草稿（多版本）
drafts(id TEXT PK, blueprint_id, version, mode,   -- blueprint/simulation
       content, word_count, status,               -- draft/revised/final
       created_at)
-- 审稿报告
reviews(id TEXT PK, draft_id, goals_check_json,   -- [{goal, status, evidence}]
        style_metrics_json,                        -- 台词占比/独白占比/吐槽密度/节奏
        consistency_issues_json,                   -- 秘密泄露等
        overall_score, created_at)
-- 互动模拟记录
simulation_runs(id TEXT PK, project_id, character_ids_json, scenario,
                turns, log_json, tension_json, result_draft_id, created_at)
-- 应用级设置
app_settings(key TEXT PK, value)   -- 模型端点/Key/mock开关 等
```

## 五、创作流水线

```
作品设定(前提/世界观/文风) → 角色卡 → 章节蓝图(作者确认)
        ↓                                        ↓
  [模式A 蓝图式生成]                [模式B 互动模拟(特色)]
  上下文组装 → 章节草稿             角色×场景互动 → 叙事重写 → 章节草稿
        └──────────────┬───────────────────────────┘
                       ↓
              审稿报告(逐项目标核验+轻小说指标+一致性)
                       ↓
              作者决策 → 修稿(新版本) → 定稿
                       ↓
              滚动摘要更新 → 下一章
```

- **上下文组装**：本章蓝图 + 出场角色卡（含秘密隔离）+ 相关世界观条目 + 滚动摘要 + 文风指导——不是把整本书塞进对话。
- **逐项目标审稿**：蓝图中的关键事件清单逐项给出「已完成/未完成/待核实」+ 正文证据；待核实不算通过，须作者确认后才进入修稿。
- **批量任务**：1-10 章连续「蓝图→草稿→审稿」，可暂停/取消，失败停止后续。

## 六、互动模拟生成模式（特色，理念复用）

- **角色 Agent**：以角色卡（性格/目标/口头禅/关系）驱动决策，可选用两个只读工具：查关系、查自己记忆；**秘密**构成知识边界——决策与台词不得泄露未知的他人秘密。
- **导演 Agent**：张力评估（关系变化/目标冲突/秘密施压/事件新颖度四维加权）+ 干预注入（新事件/新角色/节奏调整），控制模拟不发散、不冷场。
- **叙事重写**：互动日志 → 按文风预设重写为章节草稿（POV 可选），自动标注可并入蓝图的「涌现事件」供作者采纳。
- 渲染层实时呈现：气泡对话流 + 工具调用徽章 + 张力曲线（Recharts）+ 干预卡片。

## 七、模型接入

| 项 | 说明 |
|---|---|
| 协议 | OpenAI-compatible Chat Completions（自定义 baseURL/model/apiKey） |
| 预设 | OpenAI / DeepSeek / Ollama(`http://127.0.0.1:11434/v1`) / 自定义 |
| mock | 内置确定性 mock 后端：无 Key 跑通全流程（测试与演示） |
| 配置存储 | 本地 `app_settings` 表；「测试连接」按钮验证端点 |

## 八、里程碑

| 里程碑 | 内容 | 验证 |
|---|---|---|
| M1 | Electron 三段骨架 + IPC 桥 + SQLite 迁移 | `npm run dev` 打开窗口 |
| M2 | 数据层：作品/世界观/角色 CRUD + 作品库/设定/角色页 | UI 增删改查 |
| M3 | LLM 层：client + mock + 提示词模板 + 模型配置页 | 测试连接（mock） |
| M4 | 蓝图：AI 生成 + 编辑 + 章节轨道视图 | mock 生成蓝图 |
| M5 | 草稿：上下文组装 + 蓝图式生成 + 写作台（版本管理） | mock 生成章节 |
| M6 | 审稿 + 修稿 + 定稿 + 滚动摘要（闭环） | 全流程 mock 走通 |
| M7 | 互动模拟特色模式（引擎 + 导演 + 重写 + 实时 UI） | mock 模拟生成草稿 |
| M8 | 批量任务 + 导出（Markdown/TXT） | 批量 3 章 + 导出 |
| M9 | 打磨 + Vitest + electron-builder 配置 | `npm run build` 零错误 + 测试通过 |

## 九、验收标准

```bash
npm install
npm run dev        # 打开桌面应用
npm run build      # 三段构建零错误
npx vitest run     # 服务层测试通过
```

1. 新建作品 → 填前提/世界观 → 建 3 张角色卡 → AI 生成章节蓝图并确认
2. 模式 A 生成第 1 章草稿 → 审稿报告逐项核验 → 选择采纳 → 修稿 → 定稿
3. 模式 B：选 2-3 角色 + 场景跑互动模拟 → 重写为第 2 章草稿
4. 批量生成 2-3 章 → 导出 Markdown
5. 全程使用 mock 后端（无网络依赖）

## 十、明确不做（范围控制）

- 不做在线发布/阅读社区/云端账号体系
- 不做多语言界面（中文优先，文案中文）
- 不做 EPUB 导出（Markdown/TXT 足够）
- 不做 embedding 知识库（世界观条目 + FTS 全文检索即可，SQLite FTS5）
- 立绘使用占位色板 + 用户本地上传，不做 AI 绘图
