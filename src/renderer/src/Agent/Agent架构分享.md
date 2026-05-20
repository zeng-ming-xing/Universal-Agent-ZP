# Electron AI Agent 架构分享

> 一个基于 **LangChain + LangGraph** 的 Electron 桌面 AI 助手，深度融合 **SQL 工具链**、**RAG 知识库**和 **Skills 插件系统**。

---

## 一、整体架构概览

```
┌────────────────────────────────────────────────────────────────────┐
│                         Renderer (React)                           │
│  index.tsx                                                        │
│   ├── ConversationHistoryList (侧栏对话列表)                        │
│   ├── AgentChatPanel (消息展示区)                                   │
│   ├── AgentComposerPanel (输入发送区)                               │
│   └── useAgentConversations (核心状态管理 Hook)                     │
│        │                                                           │
│        ▼ IPC (contextBridge → preload → ipcMain)                   │
├────────────────────────────────────────────────────────────────────┤
│                        Main Process (Node.js)                      │
│  AgentManager                                                      │
│   ├── Agent (LangGraph ReactAgent)                                 │
│   │    ├── model: ChatOpenAI (智谱 GLM)                            │
│   │    ├── MemorySaver (checkpointer)                              │
│   │    ├── systemPrompt (动态拼接 catalog/rag/skills)              │
│   │    └── tools: 9 个工具                                         │
│   ├── SkillsManager (.agents/skills/*/SKILL.md)                   │
│   └── RagOperator (文档 → embedding → pgvector)                    │
└────────────────────────────────────────────────────────────────────┘
```

### 进程通信流

```
React 组件                    preload 桥接                 主进程
─────────────────────────────────────────────────────────────────
agentChatStream(input, id) → ipcRenderer.send ──────────→ agent.agentRequest()
  ↕ onChunk/onEvent/done  ←─ ipcRenderer.on  ←────────    stream → chunk/event/done
agentCreateSession(id,msgs)→ ipcRenderer.invoke ───────→ agentManager.createAgent()
ragUploadDocument(path)   → ipcRenderer.invoke ───────→ ragOperator.ingestLocalDocument()
```

---

## 二、入口流程详解（`index.tsx`）

### 2.1 组件树

```
Message (memo)
 ├── SidebarActions          ← 新建对话 / 上传文档按钮
 ├── ConversationHistoryList ← 历史对话列表，支持选中/删除
 ├── AgentChatPanel          ← 聊天消息展示
 └── AgentComposerPanel      ← 输入框 + 发送/中断按钮
```

### 2.2 核心 Hook：`useAgentConversations`

这是整个前端 Agent 交互的核心状态机，管理：

| 能力 | 实现方式 |
|---|---|
| **会话列表** | `useState<AgentConversation[]>`，启动时从 API 加载历史 |
| **当前会话** | `activeSessionId` + `useMemo` 派生 `activeConversation` |
| **发送消息** | `sendMessage → sendWithPrompt → agentChatStream` |
| **流式接收** | `onChunk` 拼装 assistant_text 事件；`onEvent` 接收工具调用事件 |
| **中断回答** | `abortAnswer → agentChatAbort` |
| **会话摘要** | 首条用户消息自动调用 `agentSummarize` 生成标题 |
| **持久化** | 每次对话结束时 `saveConversationToDb` |

### 2.3 消息发送核心流程

```
sendMessage()
  → sendWithPrompt(prompt)
      ① appendUserMessage(sessionId, content)      // 立即追加用户消息到 UI
      ② generateSummaryByFirstMessage(sessionId)   // 首条消息 → 异步生成会话标题
      ③ appendAssistantMessage(sessionId, '')      // 追加空的助手占位消息
      ④ window.ipc.agentChatStream(text, id, {
           onChunk: (chunk) => appendAssistantChunk(...)   // 增量文本拼装
           onEvent: (event) => {
             if (kind === 'thinking_chunk') → appendThinkingChunk  // 深度思考
             else → appendAssistantEvent(...)                     // 工具事件
           }
         })
      finally: saveConversationToDb(updatedConv)   // 保存完整对话到数据库
```

---

## 三、LangChain 核心集成

### 3.1 模型层 (`model/index.ts`)

```typescript
// 统一模型工厂，基于 ChatOpenAI（兼容智谱 GLM API）
export function createModel(params: CreateModelParams): ChatOpenAI {
  return new ChatOpenAI({
    model: MODEL_NAME,                    // 从环境变量 AGENT_MODEL_NAME
    apiKey: API_KEY,                      // ZHIPU_API_KEY
    configuration: { baseURL: BASE_URL }, // AGENT_MODEL_BASE_URL
    ...params,                            // temperature / maxTokens 等
  });
}
```

**特点**：参数化工厂模式，Agent 核心和各个工具（generate_sql、validate_sql、web_search、摘要）共享同一个工厂，但可以根据场景设置不同的 `temperature` 和 `maxTokens`。

### 3.2 消息系统

LangChain 的消息类型贯穿整个管线：

| 消息类型 | 用途 | 方向 |
|---|---|---|
| `HumanMessage` | 用户输入的文本消息 | 前端 → Agent |
| `AIMessage` / `AIMessageChunk` | 模型生成的文本 / 流式增量 | Agent → 前端 |
| `SystemMessage` | 系统提示词（动态拼接） | 构造时注入 |
| `ToolMessage` | 工具调用结果 | 工具 → Agent |

**历史消息注入**：[`conversationRowsToBaseMessages`](file:///d:/learn/electron-app/src/main/agent/utils/conversation-rows-to-messages.ts) 负责将数据库中持久化的 `{role, content}` 行转为 LangChain 消息对象，再通过 `graph.updateState` 写入 MemorySaver。

---

## 四、LangGraph 核心集成

### 4.1 图谱创建 ([`core/index.ts`](file:///d:/learn/electron-app/src/main/agent/core/index.ts))

```typescript
// 1. 定义 State Schema
const AgentState = new StateSchema({
  messages: MessagesValue,  // LangGraph 内置的消息列表通道
});

// 2. 使用 LangChain 的 createAgent 创建 ReactAgent
const compiled = createAgent({
  model: agentModel,        // ChatOpenAI 实例
  tools: createAgentTools({...}),  // 9 个工具
  systemPrompt: buildMainAgentSystemPrompt(...),  // 动态系统提示
  stateSchema: AgentState,
});

// 3. 安装 MemorySaver 作为 checkpointer
compiled.checkpointer = new MemorySaver();
```

### 4.2 MemorySaver — 会话记忆管理

`MemorySaver` 是 LangGraph 的内置内存 checkpointer，以 `thread_id` 为 key 持久化对话状态：

```typescript
// 恢复历史对话：将数据库消息写入 MemorySaver
await this.agent.graph.updateState(
  { configurable: { thread_id: sessionId } },
  { messages: [HumanMessage, AIMessage, ...] },
  START  // 写入到 START 节点
);

// 每次调用时 thread_id 自动关联上下文
const response = await this.agent.invoke({
  messages: [new HumanMessage(message)],
}, {
  configurable: { thread_id: sessionId },  // ← 同一个 thread_id 自动继承历史
  recursionLimit: this.recursionLimit,
});
```

**设计要点**：
- 前端 `sessionId` 直接映射为 LangGraph `thread_id`，天然隔离多会话
- 历史消息先存入 MySQL，切换会话时通过 `updateState` 注入，而非每次查库
- `addPriorThreadMessages` 仅在已有历史记录的会话首次激活时调用一次

### 4.3 流式输出 — 三模式 stream

```typescript
const stream = await this.agent.stream(
  { messages: [new HumanMessage(message)] },
  {
    configurable: { thread_id: threadId },
    streamMode: ['updates', 'messages', 'custom'],  // ← 三种流模式
  }
);

for await (const [mode, payload] of stream) {
  if (mode === 'messages') {
    // 处理 AIMessageChunk → 提取 thinking_chunk 和普通文本 delta
    // → onChunk(delta) 发给前端
  }
  if (mode === 'custom') {
    // 工具通过 runtime.writer() 发送的自定义事件
    // → 解析 tool_call / tool_result / tool_progress → onEvent(event)
  }
}
```

| streamMode | 数据内容 | 前端处理 |
|---|---|---|
| `messages` | 模型生成 token 流（AIMessageChunk） | `onChunk` → 实时文本渲染 |
| `custom` | 工具发出的进度/结果事件 JSON | `onEvent` → 工具状态卡片 |
| `updates` | 图节点状态更新（内部使用） | 当前未显式处理 |

### 4.4 深度思考 (Thinking)

支持智谱 GLM 的 `reasoning_content`（即 `additional_kwargs.reasoning_content`），在 `messages` 模式中提取：

```typescript
// helpers.ts
export function extractThinkingFromToken(token) {
  // ZhipuAI: additional_kwargs.reasoning_content
  if (typeof token.additional_kwargs?.reasoning_content === 'string') {
    return token.additional_kwargs.reasoning_content;
  }
  return '';
}
```

前端收到 `thinking_chunk` 事件后在独立的"思考过程"区块中渲染。

### 4.5 中断控制 (Abort)

```typescript
// 每个 session 绑定独立的 AbortController
this.sessionAbortMap.set(sessionId, new AbortController());

// 流式循环中检查
for await (const chunk of stream) {
  if (streamCtx.controller?.signal.aborted) break;
  // ...
}

// 外部调用
abortSession(sessionId) {
  this.sessionAbortMap.get(sessionId)?.abort();
}
```

---

## 五、SQL 工具链实现

这是项目的核心亮点：**通过 LangChain tool + 专用模型实例，将自然语言 → SQL 查询的全流程自动化为 6 个工具**。

### 5.1 工具链全景

```
用户问题
  ↓
① get_table_catalog   →  获取所有库 + 表名 + 表注释（轻量目录）
  ↓
② get_table_schema    →  拉取候选表的字段结构（含类型、注释）
  ↓
③ generate_sql        →  PlannerModel 生成只读 SELECT
  ↓  (失败则带 previousSql + feedback 重试)
④ validate_sql        →  ValidatorModel 校验安全性
  ↓  (invalid → 回到③重试，最多 2 次)
⑤ run_sql             →  执行 SQL，超阈值自动分页
  ↓  (结果不满足则回到③迭代，最多 2 轮)
⑥ 基于结果推理 → 自然语言结论
```

### 5.2 各工具实现要点

#### ① `get_table_catalog`
```typescript
// tools/createTool.ts
const getTableCatalogTool = tool(async (_input, runtime) => {
  emitToolEvent(runtime, { kind: 'tool_progress', tool: 'get_table_catalog', ... });
  const catalog = await fetchMysqlTableCatalog();
  // 回写 AgentManager，下次提示词自动包含
  onMysqlCatalogSynced?.(catalog);
  return okToolMessage(toolCallId, 'get_table_catalog', summary, catalog);
}, {
  name: 'get_table_catalog',
  schema: z.object({}),  // 无参数
});
```

#### ③ `generate_sql` — 使用独立 PlannerModel
```typescript
const plannerModel = createModel({ temperature: 0.2, maxTokens: 8192 });

const response = await plannerModel.invoke([
  new SystemMessage('你是资深 MySQL 查询规划器...硬性约束：只能 SELECT...'),
  new HumanMessage(`
    用户需求：${requirement}
    上一次 SQL：${previousSql}
    反馈：${feedback}
    表结构：${schemaJson}
  `)
]);
// 输出纯 SQL，去除 markdown 包裹
```

#### ④ `validate_sql` — 使用独立 ValidatorModel
```typescript
const response = await plannerModel.invoke([
  new SystemMessage('你是 SQL 审核器，只输出 JSON: {"valid":boolean,...}'),
  new HumanMessage(`待校验 SQL：${sql}\n表结构：${schemaJson}`)
]);
// 校验失败返回 failToolMessage（ok:false），Agent 明确感知
```

#### ⑤ `run_sql` — 智能分页
```typescript
const totalCount = await countQueryRows(sql);
const rows = totalCount > PAGE_SIZE_THRESHOLD  // 默认阈值
  ? await fetchPagedRows(sql, totalCount)      // 分页获取（QUERY_PAGE_SIZE 每批）
  : await fetchDirectRows(sql);                // 直接全量
```

### 5.3 工具事件推送机制

所有工具通过 `emitToolEvent(runtime, event)` 推送进度事件到前端：

```typescript
// event.ts
export function emitToolEvent(runtime: ToolRuntime, event) {
  runtime.writer?.(JSON.stringify(event));  // LangGraph 的 custom stream
}
```

事件流式传输到前端后被解析为 `tool_progress | tool_result`，实时展示工具调用状态。

### 5.4 统一返回格式

```typescript
// tool-result.ts
// 所有工具统一返回 ToolMessage，content 为 JSON:
// { "ok": true|false, "summary": "一句话中文摘要", "data": {...} }
//
// model 根据 summary 理解结果，根据 data 推理，但禁止直接输出 data 给用户
```

---

## 六、RAG 知识库实现

### 6.1 整体流程

```
用户选择 .md/.txt 文件
  ↓
① 读取文件内容 (readFile)
  ↓
② 文档切分 (chunkDocument) — 按段落 + 最大字符数滑动切分
  ↓
③ 分段摘要 (summarizeDocumentSegment × N) — 每段生成一句话摘要
  ↓
④ 整篇摘要 (mergeDocumentSegmentSummaries) — 合并段摘要
  ↓
⑤ 批量向量嵌入 (getTextEmbedding) — 调用智谱 GLM text_embedding API
  ↓
⑥ 写入 pgvector (POST /document-chunks/batch)
  ↓
⑦ 写入 MySQL 文档元数据 (POST /documents)
  ↓
⑧ 刷新 AgentManager.ragDocumentsPromptText → 下次系统提示自动包含
```

### 6.2 核心代码

```typescript
// rag/index.ts — RagOperator 单例
export class RagOperator extends EventEmitter {
  async ingestLocalDocument(filePath: string) {
    // 1. 读取
    const raw = await readFile(filePath, 'utf8');
    // 2. 切分
    const chunks = this.chunkDocument(text);  // 段落优先 + maxChunkChars
    // 3-4. 摘要（每段 + 整篇）
    const segmentSummaries = [];
    for (const chunk of chunks) {
      segmentSummaries.push(await summarizeDocumentSegment(chunk));
    }
    const summary = await mergeDocumentSegmentSummaries(segmentSummaries);
    // 5. 批量 embedding（batchSize）
    const vectors = await this.getTextEmbedding(chunks);
    // 6. 写入 pgvector
    await this.postServeJson('/document-chunks/batch', { chunks: chunkPayloads });
    // 7. 写入 MySQL 元数据
    await this.postServeJson('/documents', { id, title, summary, chunk_count });
  }

  // 检索：query → embedding → pgvector 余弦相似度搜索
  async retrieve(query: string, options?: RagRetrieveOptions) {
    const embedding = await this.getTextEmbedding(query);
    return this.vectorSearch(embedding, options);  // POST /embeddings/search
  }
}
```

### 6.3 Agent 工具集成

```typescript
// tools/createTool.ts
const searchUploadedDocumentsTool = tool(async (input, runtime) => {
  const parsed = searchUploadedDocumentsSchema.parse(input);
  // input: { query, limit?, minSimilarity? }
  const r = await ragOperator.retrieve(parsed.query, {
    limit: parsed.limit,
    minSimilarity: parsed.minSimilarity,
    source: 'documents',
  });
  // 返回 hits: [{ chunk_id, document_id, similarity, text }]
  return okToolMessage(toolCallId, 'search_uploaded_documents', summary, { hits });
}, {
  name: 'search_uploaded_documents',
  description: '在用户已上传的知识文档中按语义检索相关段落...',
  schema: searchUploadedDocumentsSchema,
});
```

### 6.4 系统提示中的 RAG 上下文

```typescript
// prompt.ts
if (ragDocumentsPromptText) {
  blocks.push(
    `【已上传知识文档摘要列表】\n${ragDocumentsPromptText}`
  );
}
```

Agent 在回答前先看文档摘要判断是否相关，需要细节时调用 `search_uploaded_documents` 做向量检索。

---

## 七、Skills 技能模块

### 7.1 设计思想

Skills 是**可扩展的 Agent 能力插件**，每个 Skill 是一个包含 `SKILL.md` 文件的目录。Agent 按需读取技能文档，获取用法说明和命令格式，然后调用 workspace 工具执行。

### 7.2 SkillsManager

```typescript
// skills/index.ts
export class SkillsManager {
  private readonly skillsRoot: string;     // 默认 .agents/skills/
  private readonly skills = new Map<string, Skill>();

  async initialize() {
    // 递归扫描 skillsRoot 下所有 SKILL.md 文件
    const skillFiles = await this.findSkillFiles(this.skillsRoot);
    for (const skillFile of skillFiles) {
      const skill = await Skill.fromSkillFile(skillFile);  // 解析 frontmatter
      nextSkills.set(skill.name, skill);
    }
  }
}
```

### 7.3 Skill 解析

```typescript
// skills/core/index.ts
class Skill {
  readonly name: string;         // frontmatter 中的 name
  readonly description: string;  // frontmatter 中的 description
  readonly path: string;         // 技能目录绝对路径

  static async fromSkillFile(skillFilePath: string): Promise<Skill | null> {
    const content = await readFile(skillFilePath, 'utf8');
    const parsed = parseSkillFrontmatter(content);  // 支持 --- YAML --- / **---** 格式
    return new Skill({ name: parsed.name, description: parsed.description, path: skillDir });
  }
}
```

### 7.4 Agent 如何使用 Skills

1. **启动时**：`SkillsManager.initialize()` → 扫描并加载所有 SKILL.md
2. **系统提示注入**：
```typescript
// AgentManager
this.skillsPromptText = skills.map(s =>
  `${s.name}: ${s.description}（文档路径：${s.path}/SKILL.md）`
).join('\n');
```
3. **提示词规则**：
```
技能使用规则：
- 先据描述判断是否与问题相关
- 决定使用某技能后，必须先用 read_file 读取该技能的 SKILL.md 文档
- SKILL.md 中若引用了其他文档文件，必须逐一完整读取后才能执行
- 禁止在未阅读技能文档的情况下凭猜测调用技能命令
```

4. **执行**：Agent 用 `read_file` 读取 SKILL.md → 理解用法 → 用 `execute_command` / `write_file` 执行

### 7.5 项目已有 Skills

```
.agents/skills/
├── agent-browser/       ← 浏览器自动化技能
│   └── SKILL.md
├── find-skills/         ← 技能发现与安装技能
│   └── SKILL.md
└── word-document-processor/  ← Word 文档处理技能
    ├── SKILL.md
    ├── ooxml/           ← OOXML schema 和脚本
    └── scripts/         ← Python 处理脚本
```

---

## 八、Workspace 工具集

提供 Agent 在工作区内**读写文件**和**执行命令**的能力，是 Skills 模块的执行基础。

| 工具 | 功能 | 安全措施 |
|---|---|---|
| `read_file` | 读取文本文件，支持 offset/limit | 路径沙箱化（resolveWorkspacePath），大小限制 |
| `write_file` | 写入/覆盖文本文件 | 路径沙箱化，自动创建父目录 |
| `execute_command` | 执行 shell 命令 | 超时限制，输出截断，使用 execa 库 |

```typescript
// workspace/execute-command.tool.ts
async function runShellCommand(command, options) {
  const result = await execa(command, [], {
    shell: true,
    cwd: options.cwd,    // 限制在工作区
    timeout: options.timeout,
    all: true,           // 合并 stdout + stderr
    reject: false,       // 非零退出不抛异常
    stdin: 'ignore',
  });
  return { exitCode, timedOut, all: result.all };
}
```

---

## 九、联网搜索工具

```typescript
// web-search/web-search.tool.ts
async (input, runtime) => {
  // ① 扩展查询：用模型将用户 query 扩展为 2-3 个差异化查询
  const queries = await expandSearchQueries(parsed.query);
  // ② 并行搜索：Promise.allSettled 并发调用 Tavily MCP
  const settled = await Promise.allSettled(
    queries.map(q => callTavilyMcpSearch(q))
  );
  // ③ 合并结果、去重
  const result = formatMergedSearchResults(okQueries, okDataList);
  return okToolMessage(toolCallId, 'web_search', summary, { queries, results: result });
}
```

查询扩展示例：
- 用户输入："React 19 新特性"
- 模型扩展为：`["React 19 new features overview 2025", "React 19 release notes official", "React 19 compiler API breaking changes"]`

---

## 十、系统提示词设计

系统提示词在 Agent 构造时动态拼接三部分：

```typescript
// prompt.ts
export function buildMainAgentSystemPrompt(
  mysqlSchemaCatalogText,   // MySQL 表目录（表名 + 注释）
  ragDocumentsPromptText,   // 已上传知识文档摘要列表
  skillsPromptText,         // 可用技能列表
): SystemMessage {
  const blocks = [MAIN_AGENT_PROMPT_BASE];
  if (mysql) blocks.push(`【当前 MySQL 表目录】\n${mysql}`);
  if (rag) blocks.push(`【已上传知识文档摘要列表】\n${rag}`);
  if (skills) blocks.push(`【可用技能列表】\n${skills}`);
  return new SystemMessage(blocks.join('\n\n'));
}
```

核心指令摘要：
- **数据库优先**：数据问题走 ①目录→②schema→③生成SQL→④校验→⑤执行 的严格流程
- **联网降级**：只有数据库不相关时才调 `web_search`
- **知识库**：摘要初判 → `search_uploaded_documents` 向量检索 → 提炼结论
- **技能**：先 `read_file` 读文档 → 再执行命令
- **输出规则**：禁 JSON 原文，禁工具细节，只输出自然语言结论

---

## 十一、关键设计决策总结

| 设计点 | 方案 | 原因 |
|---|---|---|
| 会话隔离 | `thread_id` = `sessionId` | LangGraph 原生支持，无需自建 session map |
| 记忆管理 | `MemorySaver` (InMemory) | 轻量，进程重启后由 MySQL 恢复 |
| 历史恢复 | `graph.updateState` | 仅首次激活时注入，避免每次查库 |
| SQL 生成 | 独立 PlannerModel (temp 0.2) | 低温度保证 SQL 稳定性，独立模型不影响主对话 |
| SQL 校验 | 独立 ValidatorModel | 角色分离，校验逻辑独立 |
| 工具返回 | 统一 `{ok, summary, data}` JSON | model 通过 summary 理解，通过 data 推理，不泄露给用户 |
| 前端事件 | `custom` stream + JSON | 实时展示工具调用状态，支持 tool_call/tool_result/tool_progress |
| 流式中断 | AbortController per session | 精确控制，不误杀其他会话 |
| 文档入库 | 先 pgvector 后 MySQL | 向量失败不留孤儿元数据记录 |
| Skills 扩展 | SKILL.md frontmatter 解析 | 标准化，Agent 可自助阅读理解 |

---

## 十二、目录结构速查

```
src/main/agent/
├── core/
│   ├── index.ts        ← Agent 类：LangGraph ReactAgent + MemorySaver + stream
│   ├── types.ts        ← StreamHandlers / AgentFrontendEvent / RunAgentParams
│   ├── prompt.ts       ← 动态拼接系统提示词
│   ├── helpers.ts      ← 事件解析、thinking 提取、去重
│   └── utils.ts        ← extractLastAiText
├── model/
│   └── index.ts        ← createModel 工厂（ChatOpenAI）
├── tools/
│   ├── index.ts        ← 工具集导出
│   ├── createTool.ts   ← 6个SQL+2个RAG+web_search 工具定义
│   ├── event.ts        ← emitToolEvent (runtime.writer)
│   ├── config.ts       ← 超时/分页/threshold 配置
│   ├── web-search/     ← Tavily MCP 联网搜索
│   ├── workspace/      ← read_file / write_file / execute_command
│   ├── sql/schemas.ts  ← Zod schemas
│   ├── rag/schemas.ts
│   └── utils/tool-result.ts  ← okToolMessage / failToolMessage
├── utils/
│   ├── conversation-rows-to-messages.ts
│   ├── format-mysql-catalog.ts
│   └── format-rag-documents.ts
└── index.ts            ← AgentManager

src/main/rag/
├── index.ts            ← RagOperator 单例
├── config.ts
├── types.ts
└── utils/              ← document-chunk / embedding-vector / rag-context

src/main/skills/
├── index.ts            ← SkillsManager
└── core/index.ts       ← Skill 类 + SKILL.md 解析

src/preload/index.ts    ← IPC 桥接（agentChatStream / agentCreateSession / ragUploadDocument）

src/renderer/src/Agent/
├── index.tsx           ← Message 主组件
├── hooks/useAgentConversations.ts  ← 前端核心状态管理（516行）
├── types.ts            ← ChatMessage / AgentConversation / AgentEvent
└── components/         ← chat-panel / composer-panel / conversation-history / sidebar-actions
```
