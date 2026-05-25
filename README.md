# Electron Agent — 全栈智能体桌面应用

基于 **Electron + 智谱大模型 + Express + MySQL + PostgreSQL(pgvector)** 的通用全栈 Agent 桌面应用，集成 SQL Agent、RAG 知识库、Skill 技能系统和 Tavily 联网搜索，支持 Docker 一键启动。

## 特性

- **SQL Agent** — 自然语言驱动数据库查询：自动获取表目录 → 生成 SQfn/L → 校验 → 执行，支持多轮迭代与复杂查询拆解
- **RAG 知识库** — 文档上传 → 分块 → 智谱 Embedding → pgvector 向量检索，检索结果自动注入 Agent 上下文
- **Skill 技能系统** — 可插拔技能模块，通过 `SKILL.md` 声明元数据，Agent 按需读取并执行
- **联网搜索** — 基于 Tavily MCP，支持查询扩展（2-3 个差异化 query 并行检索）与结果去重合并
- **对话持久化** — 基于 LangGraph Checkpoint + MySQL，会话与消息完整落库，支持历史对话回溯
- **Docker 一键启动** — `pnpm dev:docker` 自动拉起 MySQL + pgvector 容器、Prisma 建表、Express 服务与 Electron 应用

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Electron 28 + electron-vite |
| 前端 | React 18 + TypeScript + Tailwind CSS v4 |
| 大模型 | 智谱 GLM（ChatGLM）— 通过 OpenAI 兼容接口接入 |
| Agent 框架 | LangChain + LangGraph（ToolNode + Checkpoint） |
| 后端服务 | Express（mysql-service / postgres-service） |
| 业务数据库 | MySQL 8.0（对话、文档元数据、示例数据） |
| 向量数据库 | PostgreSQL 16 + pgvector（Embedding 存储 & 向量检索） |
| ORM | Prisma（双数据源：MySQL schema + PostgreSQL vector schema） |
| 联网搜索 | Tavily MCP |
| 容器化 | Docker Compose |

## 快速开始

### 环境要求

- Node.js ≥ 18
- pnpm
- Docker & Docker Compose

### 1. 克隆项目

```bash
git clone https://github.com/zeng-ming-xing/Universal-Agent-ZP.git
cd electron-app
pnpm install
```

### 2. 配置环境变量

复制示例配置并填入你的密钥：

```bash
cp .env.example .env
```

编辑 `.env`，核心配置项如下：

```env
# ========== 模型配置（智谱 GLM） ==========
AGENT_MODEL_NAME=glm-4.7                        # 智谱模型名称
AGENT_MODEL_BASE_URL=https://open.bigmodel.cn/api/paas/v4  # 智谱模型地址
ZHIPU_API_KEY=your_zhipu_api_key                 # 智谱 API Key
ZHIPU_EMBEDDINGS_KEY=your_zhipu_embeddings_key   # 智谱向量模型 Key

# ========== 联网搜索（Tavily MCP） ==========
TAVILY_API_KEY=your_tavily_api_key               # Tavily API Key
TAVILY_MCP_ENDPOINT=https://mcp.tavily.com/mcp/  # Tavily MCP 地址
```

> 完整配置项说明见 [环境变量](#环境变量) 章节。

### 3. 一键启动

```bash
pnpm dev:docker
```

该命令会自动完成：

1. `docker compose up -d` — 拉起 MySQL + PostgreSQL(pgvector) 容器
2. `prisma db push` — 按 schema 在 MySQL / Postgres 中建表
3. 启动 Express 后端服务（mysql-service / postgres-service）
4. 启动 Electron + Vite 开发服务器

### 单独启动（不使用 Docker）

如果你已有本地 MySQL / PostgreSQL 实例：

```bash
# 先手动建表
pnpm prisma:push:all

# 再启动应用
pnpm dev
```

## 项目结构

```
electron-app/
├── src/
│   ├── main/                    # Electron 主进程
│   │   ├── agent/               # Agent 核心
│   │   │   ├── core/            # Prompt 构建、工具调度、类型定义
│   │   │   ├── model/           # 智谱模型封装（OpenAI 兼容接口）
│   │   │   ├── tools/           # 工具集
│   │   │   │   ├── mysql/       # MySQL 表目录/Schema 拉取
│   │   │   │   ├── sql/         # SQL 生成/校验/执行
│   │   │   │   ├── rag/         # 向量检索工具
│   │   │   │   ├── web-search/  # Tavily 联网搜索
│   │   │   │   └── workspace/   # 文件读写/命令执行
│   │   │   └── utils/           # 格式化辅助
│   │   ├── agentGraph/          # LangGraph Agent（Graph 模式）
│   │   ├── rag/                 # RAG 模块
│   │   │   ├── index.ts         # RagOperator：文档分块→Embedding→向量检索
│   │   │   ├── config.ts        # Embedding 模型/维度/超时配置
│   │   │   └── utils/           # 分块、向量校验、上下文拼接
│   │   ├── skills/              # Skill 技能系统
│   │   │   └── core/            # SKILL.md frontmatter 解析与加载
│   │   └── window/              # 窗口管理
│   ├── preload/                 # Electron Preload
│   └── renderer/                # React 前端
│       └── src/
│           ├── Agent/           # Agent 对话 UI
│           └── components/      # 通用组件
├── serve/                       # Express 后端服务
│   ├── mysql-service/           # MySQL 服务（Schema/Query/Conversation/Document）
│   ├── postgres-service/        # PostgreSQL 向量服务（Embedding CRUD & 检索）
│   └── prismaClient/            # Prisma 双客户端封装
├── prisma/
│   ├── schema.prisma            # MySQL 业务模型
│   └── vector.prisma            # PostgreSQL 向量模型
├── .agents/skills/              # 技能目录
│   ├── agent-browser/           # 浏览器自动化技能
│   └── word-document-processor/ # Word 文档处理技能
├── scripts/
│   └── dev-with-mysql.mjs       # Docker 一键启动脚本
├── docker-compose.yml           # MySQL + pgvector 容器编排
└── .env                         # 环境变量配置
```

## 核心模块

### SQL Agent

通过自然语言与数据库交互的完整 Agent 工具链：

1. **get_table_catalog** — 拉取 MySQL 全库表目录（表名 + 注释）
2. **get_table_schema** — 获取指定表的字段详情
3. **generate_sql** — 基于问题与表结构生成 SQL（支持失败重试）
4. **validate_sql** — 校验 SQL 安全性与合法性（禁止写操作）
5. **run_sql** — 执行 SQL 获取数据（内置 count + 分页）

Agent 内置迭代策略：生成 → 校验 → 执行 → 校验结果，复杂查询自动拆解为多个子查询分步执行。

### RAG 知识库

基于智谱 Embedding + pgvector 的文档检索增强生成：

- **文档入库**：上传文件 → RecursiveCharacterTextSplitter 分块 → 分段摘要 → 合并整篇摘要 → 批量 Embedding → 写入 pgvector
- **向量检索**：用户问题 → Embedding → pgvector 余弦相似度检索 → TopK 片段注入 Agent 上下文
- **支持格式**：.md / .txt

### Skill 技能系统

可插拔的技能模块，每个技能是一个包含 `SKILL.md` 的目录：

```markdown
---
name: browser-automation
description: 浏览器自动化操作技能
---
技能正文...
```

Agent 在对话中根据问题自动匹配技能，读取 `SKILL.md` 了解用法后执行。内置技能：

- **agent-browser** — 浏览器自动化（导航、截图、表单填写等）
- **word-document-processor** — Word 文档处理（创建、编辑、格式保留）

### 联网搜索

基于 Tavily MCP 的联网检索：

1. **查询扩展** — 调用轻量模型将原始 query 扩展为 2-3 个差异化搜索查询（概览型、细节型、官网限定型）
2. **并行检索** — 多个查询并行调用 Tavily MCP
3. **结果合并** — 去重合并搜索结果，返回给 Agent

## 数据模型

### MySQL（业务数据）

- `agent_conversations` — AI 对话列表
- `agent_messages` — AI 对话消息记录
- `agent_documents` — 知识文档元数据
- `student` / `user_info` / `user_daily_stats` 等 — 示例业务数据

### PostgreSQL / pgvector（向量数据）

- `agent_message_embeddings` — 对话消息向量（1024 维）
- `agent_document_chunk_embeddings` — 文档分段向量（1024 维）

## 环境变量

<details>
<summary>完整配置项</summary>

```env
# ========== MySQL 连接 ==========
MYSQL_HOST=127.0.0.1
MYSQL_PORT=5000
MYSQL_USER=root
MYSQL_PASSWORD=123456
DATABASE_URL="mysql://root:123456@127.0.0.1:5000/test?connection_limit=5"

# ========== PostgreSQL 向量库（pgvector） ==========
VECTOR_DATABASE_URL="postgresql://root:123456@localhost:5432/postgres?schema=public&connection_limit=5"

# ========== Docker 容器配置 ==========
PG_USER=root
PG_PASSWORD=123456
PG_PORT=5432

# ========== 模型配置（智谱 GLM） ==========
AGENT_MODEL_NAME=glm-4.7
AGENT_MODEL_BASE_URL=https://open.bigmodel.cn/api/paas/v4
ZHIPU_API_KEY=your_key
ZHIPU_EMBEDDINGS_KEY=your_key

# ========== RAG Embedding 参数 ==========
RAG_EMBEDDING_DIM=1024
RAG_INGEST_EMBEDDING_BATCH_SIZE=16

# ========== 联网搜索（Tavily MCP） ==========
TAVILY_API_KEY=your_key
TAVILY_MCP_ENDPOINT=https://mcp.tavily.com/mcp/

# ========== Agent 运行时参数 ==========
AGENT_RECURSION_LIMIT=80
AGENT_SKILLS_ROOT=.agents/skills
```

</details>

## 常用命令

```bash
# 一键启动（Docker + Prisma + Express + Electron）
pnpm dev:docker

# 仅启动 Electron 开发服务器
pnpm dev

# Docker 容器管理
pnpm compose:up        # 启动容器
pnpm compose:stop      # 停止容器（保留数据）
pnpm compose:down      # 停止并删除容器
pnpm compose:logs      # 查看实时日志

# Prisma
pnpm prisma:push:all          # 同步双数据库表结构
pnpm prisma:generate          # 生成 MySQL Client
pnpm prisma:generate:vector   # 生成 PostgreSQL Vector Client
pnpm prisma:studio            # MySQL 数据浏览器

# 构建
pnpm build             # 类型检查 + 构建
pnpm build:win         # 构建 Windows 安装包
```

## License

MIT
