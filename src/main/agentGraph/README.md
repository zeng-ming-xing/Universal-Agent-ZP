# agentGraph（LangGraph 实现）

与 `src/main/agent`（legacy）并行。

## 目录

```
agentGraph/
├── index.ts              # AgentManager
├── core/
│   ├── index.ts          # Agent（graph.stream 流式）
│   ├── types.ts / helpers.ts / prompt.ts / utils.ts
│   └── graph/
│       ├── index.ts      # 仅导出 buildMainGraph
│       ├── main/         # 主图
│       │   ├── index.ts
│       │   ├── routing.ts
│       │   └── nodes/
│       │       ├── call-model.ts      # agent 节点（model.stream）
│       │       └── sql-pipeline.ts    # sql_graph 节点
│       └── sql/          # SQL 子图（index.ts 组装 StateGraph）
│           ├── index.ts
│           ├── routing.ts
│           ├── state.ts
│           └── nodes/
│               ├── ensure-catalog.ts
│               ├── load-schema.ts
│               ├── generate-sql.ts
│               ├── validate-sql.ts
│               ├── run-sql.ts
│               ├── evaluate.ts
│               ├── fail.ts
│               └── steps.ts   # 各步骤共享逻辑
└── tools/
    └── index.ts
```

## 主图

`agent` → `sql_graph` | `tools` | END → … → `agent`

## 流式说明

- 前端 chunk 来自 [`core/index.ts`](core/index.ts) 的 `graph.stream({ streamMode: ['messages','custom'] })`
- [`main/nodes/call-model.ts`](core/graph/main/nodes/call-model.ts) 使用 **`bound.stream(..., config)`** 而非 `invoke`，才能把 token 交给 LangGraph 的 `messages` 流模式

## 切换

```bash
AGENT_IMPL=langgraph pnpm dev
```
