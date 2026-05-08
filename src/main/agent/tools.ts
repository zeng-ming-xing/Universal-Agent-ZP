import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { tool, type ToolRuntime } from 'langchain';
import { z } from 'zod';

type PlannerModelLike = {
  invoke: (
    messages: unknown,
    options?: unknown
  ) => Promise<{ content?: unknown }>;
};

/**
 * Agent 工具集：
 * - web_search：联网检索实时信息
 * - get_table_schema：获取数据库表结构
 * - generate_sql：根据需求和上下文生成 SQL（支持失败后重试）
 * - validate_sql：校验 SQL 安全性与合法性
 * - run_sql：执行 SQL 获取数据（内置 count + 分页/直接查询）
 */

// ---- 配置 ----

const TAVILY_API_KEY =
  process.env.TAVILY_API_KEY ??
  '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';
const TAVILY_MCP_ENDPOINT = 'https://mcp.tavily.com/mcp/';
/** 联网搜索请求超时（ms） */
const WEB_SEARCH_REQUEST_TIMEOUT_MS = Number(
  process.env.AGENT_WEB_SEARCH_TIMEOUT_MS ?? '20000'
);
/** 搜索返回的最大条目数 */
const SEARCH_MAX_RESULTS = Number(
  process.env.AGENT_WEB_SEARCH_MAX_RESULTS ?? '5'
);
/** mysql-service HTTP 服务基础地址 */
const MYSQL_SERVICE_BASE = `http://127.0.0.1:${
  process.env.AGENT_MYSQL_SERVICE_PORT ?? '37123'
}`;
/** 数据库分页阈值 */
const PAGE_SIZE_THRESHOLD = 200;
/** 分页每批最多获取的行数 */
const QUERY_PAGE_SIZE = 200;

// ---- Tavily 远程 MCP 实现 ----

/**
 * 从 MCP SSE 流文本中提取第一个含有 result/error 的 JSON-RPC 消息。
 *
 * SSE 格式：
 *   event: message
 *   data: {"jsonrpc":"2.0","id":2,"result":{...}}
 */
function extractMcpSseResult(sseText: string): unknown {
  for (const line of sseText.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    try {
      const msg = JSON.parse(line.slice(6)) as Record<string, unknown>;
      if ('result' in msg || 'error' in msg) return msg;
    } catch {
      // 忽略非 JSON 行
    }
  }
  return null;
}

function unwrapJsonText(raw: string): string {
  const text = raw.trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) return fenced[1].trim();
  return text;
}

/**
 * 解析 Tavily MCP tools/call 的 JSON-RPC 响应，格式化为可读文本。
 *
 * result.content 是 MCP ContentBlock 数组，Tavily 固定返回一个 type:"text" 块，
 * 其 text 字段是 JSON 字符串：{ answer?: string; results: [...] }
 */
function formatTavilyResult(rpcMsg: unknown): string {
  if (!rpcMsg || typeof rpcMsg !== 'object') return '未找到相关搜索结果';

  const msg = rpcMsg as {
    result?: { content?: Array<{ type: string; text?: string }> };
    error?: { message?: string };
  };

  if (msg.error) {
    throw new Error(
      `Tavily MCP 工具错误: ${msg.error.message ?? JSON.stringify(msg.error)}`
    );
  }

  const textBlock = msg.result?.content?.find((c) => c.type === 'text');
  if (!textBlock?.text) return '未找到相关搜索结果';

  // text 字段可能是 JSON 也可能是纯文本
  try {
    const data = JSON.parse(textBlock.text) as {
      answer?: string;
      results?: Array<{ title?: string; content?: string; url?: string }>;
    };
    const parts: string[] = [];
    if (data.answer) parts.push(`AI摘要：${data.answer}`);
    if (Array.isArray(data.results) && data.results.length > 0) {
      parts.push(
        ...data.results
          .slice(0, SEARCH_MAX_RESULTS)
          .map(
            (item, i) =>
              `[${i + 1}] ${item.title ?? ''}\n${item.content ?? ''}\n来源：${
                item.url ?? ''
              }`
          )
      );
    }
    return parts.join('\n\n') || '未找到相关搜索结果';
  } catch {
    return textBlock.text;
  }
}

/**
 * Tavily 远程 MCP 搜索。
 *
 * 协议：MCP Streamable HTTP（JSON-RPC 2.0 over HTTP POST）
 *   步骤 1：POST initialize   → 获取 Mcp-Session-Id
 *   步骤 2：POST notifications/initialized（通知，无需等待响应体）
 *   步骤 3：POST tools/call   → 获取搜索结果（JSON 或 SSE 流）
 *
 * 文档：https://docs.tavily.com/guides/mcp
 */
async function callTavilyMcpSearch(query: string): Promise<string> {
  const url = new URL(TAVILY_MCP_ENDPOINT);
  url.searchParams.set('tavilyApiKey', TAVILY_API_KEY);
  const endpoint = url.toString();

  const baseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };

  // 步骤 1：initialize
  const initRes = await fetch(endpoint, {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'initialize',
      id: 1,
      params: {
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'matrix-agent', version: '1.0.0' },
        capabilities: {},
      },
    }),
    signal: AbortSignal.timeout(WEB_SEARCH_REQUEST_TIMEOUT_MS),
  });

  if (!initRes.ok) {
    throw new Error(
      `Tavily MCP initialize 失败: ${initRes.status} ${initRes.statusText}`
    );
  }

  const sessionId = initRes.headers.get('mcp-session-id');
  const sessionHeaders: Record<string, string> = { ...baseHeaders };
  if (sessionId) sessionHeaders['Mcp-Session-Id'] = sessionId;

  // 步骤 2：notifications/initialized（通知，无 id，fire-and-forget）
  fetch(endpoint, {
    method: 'POST',
    headers: sessionHeaders,
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }),
    signal: AbortSignal.timeout(WEB_SEARCH_REQUEST_TIMEOUT_MS),
  }).catch(() => undefined);

  // 步骤 3：tools/call tavily-search
  const searchRes = await fetch(endpoint, {
    method: 'POST',
    headers: sessionHeaders,
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      id: 2,
      params: {
        name: 'tavily_search',
        arguments: {
          query,
          max_results: SEARCH_MAX_RESULTS,
          search_depth: 'basic',
        },
      },
    }),
    signal: AbortSignal.timeout(WEB_SEARCH_REQUEST_TIMEOUT_MS),
  });

  if (!searchRes.ok) {
    throw new Error(
      `Tavily MCP tools/call 失败: ${searchRes.status} ${searchRes.statusText}`
    );
  }

  const responseText = await searchRes.text();
  const contentType = searchRes.headers.get('content-type') ?? '';

  let rpcMsg: unknown;
  if (contentType.includes('text/event-stream')) {
    rpcMsg = extractMcpSseResult(responseText);
  } else {
    try {
      rpcMsg = JSON.parse(responseText);
    } catch {
      return responseText;
    }
  }

  return formatTavilyResult(rpcMsg);
}

async function postToMysqlService<T extends { ok: boolean; error?: string }>(
  path: string,
  payload: unknown
): Promise<T> {
  const response = await fetch(`${MYSQL_SERVICE_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = (await response.json()) as T;
  if (!body.ok) {
    throw new Error(body.error ?? `请求 ${path} 失败`);
  }
  return body;
}

async function fetchDbSchema(options?: {
  includeColumns?: boolean;
  tables?: string[];
  database?: string;
}) {
  const body = await postToMysqlService<{
    ok: boolean;
    includeColumns?: boolean;
    databases?: Array<{ database: string; tables: unknown[] }>;
    error?: string;
  }>('/schema', {
    includeColumns: options?.includeColumns ?? true,
    tables: options?.tables ?? [],
    database: options?.database ?? '',
  });
  return {
    includeColumns: body.includeColumns ?? true,
    databases: body.databases ?? [],
  };
}

async function fetchTableCatalog() {
  const schema = await fetchDbSchema({ includeColumns: false });
  return {
    databases: schema.databases.map((db) => ({
      database: db.database,
      tables: Array.isArray(db.tables)
        ? (db.tables as Array<{ name?: string; comment?: string }>).map(
            (t) => ({
              name: t.name ?? '',
              comment: t.comment ?? '',
            })
          )
        : [],
    })),
  };
}

async function countQueryRows(sql: string): Promise<number> {
  const body = await postToMysqlService<{
    ok: boolean;
    count?: number;
    error?: string;
  }>('/count', { sql });
  return Number(body.count ?? 0);
}

async function fetchPagedRows(
  sql: string,
  totalCount: number
): Promise<unknown[]> {
  const allRows: unknown[] = [];
  const totalPages = Math.ceil(totalCount / QUERY_PAGE_SIZE);
  let page = 1;

  while (page <= totalPages) {
    const body = await postToMysqlService<{
      ok: boolean;
      rows?: unknown[];
      hasMore?: boolean;
      error?: string;
    }>('/query', {
      sql,
      page,
      pageSize: QUERY_PAGE_SIZE,
      paginationMode: 'always',
    });

    allRows.push(...(body.rows ?? []));
    if (!body.hasMore) break;
    page += 1;
  }
  return allRows;
}

async function fetchDirectRows(sql: string): Promise<unknown[]> {
  const body = await postToMysqlService<{
    ok: boolean;
    rows?: unknown[];
    error?: string;
  }>('/query', {
    sql,
    paginationMode: 'never',
  });
  return body.rows ?? [];
}

// ---- 工具定义 ----

/** 向工具前端推送进度/结果事件 */
function emitToolEvent(
  runtime: ToolRuntime,
  event: {
    kind: 'tool_progress' | 'tool_result';
    tool: string;
    message: string;
  }
) {
  runtime.writer?.(JSON.stringify(event));
}

const webSearchSchema = z.object({
  query: z.string().min(1, '搜索词不能为空'),
});

const getTableCatalogSchema = z.object({});
const getTableSchemaSchema = z.object({
  tables: z.array(z.string().min(1)).min(1).optional(),
  database: z.string().min(1).optional(),
});

const generateSqlSchema = z.object({
  requirement: z.string().min(1, '需求不能为空'),
  schemaJson: z.string().optional(),
  previousSql: z.string().optional(),
  feedback: z.string().optional(),
});

const validateSqlSchema = z.object({
  sql: z.string().min(1, 'SQL 不能为空'),
  schemaJson: z.string().optional(),
});

const runSqlSchema = z.object({
  sql: z.string().min(1, 'SQL 不能为空'),
});

/** 工具：通过 Tavily 远程 MCP 联网搜索实时信息（用于 direct_answer 路径） */
const webSearchTool = tool(
  async (input: unknown, runtime: ToolRuntime) => {
    const parsed = webSearchSchema.parse(input);

    emitToolEvent(runtime, {
      kind: 'tool_progress',
      tool: 'web_search',
      message: `正在通过 Tavily MCP 联网检索：${parsed.query}`,
    });

    const result = await callTavilyMcpSearch(parsed.query);

    emitToolEvent(runtime, {
      kind: 'tool_result',
      tool: 'web_search',
      message: '联网检索完成',
    });

    return result;
  },
  {
    name: 'web_search',
    description: '通过 Tavily MCP 联网搜索实时信息，返回 AI 摘要与相关网页内容',
    schema: webSearchSchema,
  }
);

/** 导出 Agent 所需工具列表 */
export function createAgentTools(options?: {
  plannerModel?: PlannerModelLike;
}) {
  const plannerModel = options?.plannerModel;

  const getTableCatalogTool = tool(
    async (_input: unknown, runtime: ToolRuntime) => {
      getTableCatalogSchema.parse(_input);
      emitToolEvent(runtime, {
        kind: 'tool_progress',
        tool: 'get_table_catalog',
        message: '正在加载表目录（仅表名和描述）...',
      });
      const catalog = await fetchTableCatalog();
      const tableCount = catalog.databases.reduce(
        (sum, db) => sum + (Array.isArray(db.tables) ? db.tables.length : 0),
        0
      );
      emitToolEvent(runtime, {
        kind: 'tool_result',
        tool: 'get_table_catalog',
        message: `已加载 ${catalog.databases.length} 个数据库、${tableCount} 张表的目录信息`,
      });
      return JSON.stringify(catalog);
    },
    {
      name: 'get_table_catalog',
      description: '获取数据库表目录（仅库名、表名、表描述，不含字段）',
      schema: getTableCatalogSchema,
    }
  );

  const getTableSchemaTool = tool(
    async (_input: unknown, runtime: ToolRuntime) => {
      const parsed = getTableSchemaSchema.parse(_input);
      emitToolEvent(runtime, {
        kind: 'tool_progress',
        tool: 'get_table_schema',
        message: parsed.tables?.length
          ? `正在加载 ${parsed.tables.length} 张候选表的字段结构...`
          : '正在加载数据库表结构...',
      });
      const schema = await fetchDbSchema({
        includeColumns: true,
        tables: parsed.tables,
        database: parsed.database,
      });
      const tableCount = schema.databases.reduce(
        (sum, db) => sum + (Array.isArray(db.tables) ? db.tables.length : 0),
        0
      );
      emitToolEvent(runtime, {
        kind: 'tool_result',
        tool: 'get_table_schema',
        message: `已加载 ${schema.databases.length} 个数据库、${tableCount} 张表的字段结构`,
      });
      return JSON.stringify(schema);
    },
    {
      name: 'get_table_schema',
      description: '获取当前数据库的结构元数据（库/表/字段）',
      schema: getTableSchemaSchema,
    }
  );

  const generateSqlTool = tool(
    async (input: unknown, runtime: ToolRuntime) => {
      if (!plannerModel) {
        throw new Error('plannerModel 未配置，无法生成 SQL');
      }
      const parsed = generateSqlSchema.parse(input);
      const schemaJson =
        parsed.schemaJson ??
        JSON.stringify(await fetchDbSchema({ includeColumns: true }));

      emitToolEvent(runtime, {
        kind: 'tool_progress',
        tool: 'generate_sql',
        message: '正在生成 SQL...',
      });

      const response = await plannerModel.invoke([
        new SystemMessage(
          [
            '你是资深 MySQL 查询规划器。',
            '目标：基于用户需求和表结构生成可执行、可解释、只读的 SELECT SQL。',
            '硬性约束：',
            '1) 只能输出一条 SQL；只允许 SELECT / WITH ... SELECT。',
            '2) 严禁 INSERT/UPDATE/DELETE/REPLACE/ALTER/DROP/TRUNCATE/CREATE/GRANT 等写操作。',
            '3) 严格依赖给定 schema，禁止虚构库/表/字段。',
            '4) 默认优先返回“能回答问题的最小结果集”：先聚合、后明细；除非用户要求明细，不要 SELECT *。',
            '5) 如果上一次 SQL 不满足需求，请根据反馈修正，明确修复点（筛选条件、分组、时间范围、口径）。',
            '输出要求：只输出纯 SQL，不要 markdown，不要解释。',
          ].join('\n')
        ),
        new HumanMessage(
          [
            `用户需求：${parsed.requirement}`,
            parsed.previousSql ? `上一次 SQL：${parsed.previousSql}` : '',
            parsed.feedback ? `上一次结果反馈：${parsed.feedback}` : '',
            `表结构（JSON）：\n${schemaJson}`,
          ]
            .filter(Boolean)
            .join('\n\n')
        ),
      ]);

      const sql = String(response.content ?? '')
        .trim()
        .replace(/^```sql\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();

      emitToolEvent(runtime, {
        kind: 'tool_result',
        tool: 'generate_sql',
        message: 'SQL 生成完成',
      });
      return sql;
    },
    {
      name: 'generate_sql',
      description: '根据用户需求、schema 与上轮反馈生成或改写只读 SQL',
      schema: generateSqlSchema,
    }
  );

  const validateSqlTool = tool(
    async (input: unknown, runtime: ToolRuntime) => {
      if (!plannerModel) {
        throw new Error('plannerModel 未配置，无法校验 SQL');
      }
      const parsed = validateSqlSchema.parse(input);
      const schemaJson =
        parsed.schemaJson ??
        JSON.stringify(await fetchDbSchema({ includeColumns: true }));

      emitToolEvent(runtime, {
        kind: 'tool_progress',
        tool: 'validate_sql',
        message: '正在校验 SQL...',
      });

      const response = await plannerModel.invoke([
        new SystemMessage(
          [
            '你是 SQL 审核器，只输出 JSON。',
            '输出格式：{"valid":boolean,"reason":"...","suggestion":"..."}',
            '判定 valid=false 的唯一场景：',
            '1) 存在写操作/危险语句；',
            '2) 引用了不存在的表或字段；',
            '3) 明显语法错误导致不可执行。',
            '不要因为性能风险（如可能慢查询）判 invalid；这类仅放入 suggestion。',
          ].join('\n')
        ),
        new HumanMessage(
          `待校验 SQL：\n${parsed.sql}\n\n表结构（JSON）：\n${schemaJson}`
        ),
      ]);

      const raw = unwrapJsonText(String(response.content ?? ''));
      let result: { valid: boolean; reason: string; suggestion?: string };
      try {
        const parsedResult = JSON.parse(raw) as {
          valid?: unknown;
          reason?: unknown;
          suggestion?: unknown;
        };
        result = {
          valid: parsedResult.valid === true,
          reason:
            typeof parsedResult.reason === 'string'
              ? parsedResult.reason
              : '校验结果格式异常',
          suggestion:
            typeof parsedResult.suggestion === 'string'
              ? parsedResult.suggestion
              : undefined,
        };
      } catch {
        result = { valid: false, reason: 'SQL 校验结果解析失败' };
      }

      emitToolEvent(runtime, {
        kind: 'tool_result',
        tool: 'validate_sql',
        message: result.valid
          ? 'SQL 校验通过'
          : `SQL 校验未通过：${result.reason}`,
      });
      return JSON.stringify(result);
    },
    {
      name: 'validate_sql',
      description: '校验 SQL 安全性与合法性，返回 valid/reason/suggestion',
      schema: validateSqlSchema,
    }
  );

  const runSqlTool = tool(
    async (input: unknown, runtime: ToolRuntime) => {
      const parsed = runSqlSchema.parse(input);
      emitToolEvent(runtime, {
        kind: 'tool_progress',
        tool: 'run_sql',
        message: '正在执行 SQL...',
      });

      const totalCount = await countQueryRows(parsed.sql);
      const rows =
        totalCount > PAGE_SIZE_THRESHOLD
          ? await fetchPagedRows(parsed.sql, totalCount)
          : await fetchDirectRows(parsed.sql);

      const result = {
        totalCount,
        returnedRows: rows.length,
        rows,
      };

      emitToolEvent(runtime, {
        kind: 'tool_result',
        tool: 'run_sql',
        message: `SQL 执行完成，共 ${totalCount} 条，返回 ${rows.length} 条`,
      });
      return JSON.stringify(result);
    },
    {
      name: 'run_sql',
      description: '执行只读 SQL，返回 totalCount/returnedRows/rows',
      schema: runSqlSchema,
    }
  );

  return [
    webSearchTool,
    getTableCatalogTool,
    getTableSchemaTool,
    generateSqlTool,
    validateSqlTool,
    runSqlTool,
  ];
}
