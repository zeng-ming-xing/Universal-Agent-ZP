import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { tool, type ToolRuntime } from 'langchain';
import { PAGE_SIZE_THRESHOLD } from './config';
import { emitToolEvent } from './event';
import {
  countQueryRows,
  fetchDbSchema,
  fetchDirectRows,
  fetchMysqlTableCatalog,
  fetchPagedRows,
} from './mysql/client';
import { createModel } from '../model';
import { unwrapJsonText } from './utils/unwrap-json';
import { okToolMessage, failToolMessage } from './utils/tool-result';
import { createWebSearchTool } from './web-search/web-search.tool';
import { createWorkspaceTools } from './workspace';
import {
  generateSqlSchema,
  getTableCatalogSchema,
  getTableSchemaSchema,
  runSqlSchema,
  validateSqlSchema,
} from './sql/schemas';
import { searchUploadedDocumentsSchema } from './rag/schemas';
import { ragOperator } from '../../rag';

/**
 * Agent 工具集：
 * - web_search：联网检索实时信息
 * - search_uploaded_documents：对用户上传知识文档做向量相似度检索，返回相关片段
 * - get_table_schema：获取数据库表结构
 * - generate_sql：根据需求和上下文生成 SQL（支持失败后重试）
 * - validate_sql：校验 SQL 安全性与合法性
 * - run_sql：执行 SQL 获取数据（内置 count + 分页/直接查询）
 * - read_file / write_file / execute_command：工作区内读写文件与执行命令
 */

export type CreateAgentToolsOptions = {
  /** get_table_catalog 成功后回写父级 AgentManager 等 */
  onMysqlCatalogSynced?: (
    catalog: Awaited<ReturnType<typeof fetchMysqlTableCatalog>>
  ) => void;
};

/** 导出 Agent 所需工具列表 */
export function createAgentTools(options?: CreateAgentToolsOptions) {
  const onMysqlCatalogSynced = options?.onMysqlCatalogSynced;
  const getTableCatalogTool = tool(
    async (_input: unknown, runtime: ToolRuntime) => {
      getTableCatalogSchema.parse(_input);
      emitToolEvent(runtime, {
        kind: 'tool_progress',
        tool: 'get_table_catalog',
        message: '正在加载表目录（仅表名和描述）...',
      });
      const catalog = await fetchMysqlTableCatalog();
      const tableCount = catalog.databases.reduce(
        (sum, db) => sum + (Array.isArray(db.tables) ? db.tables.length : 0),
        0
      );
      emitToolEvent(runtime, {
        kind: 'tool_result',
        tool: 'get_table_catalog',
        message: `已加载 ${catalog.databases.length} 个数据库、${tableCount} 张表的目录信息`,
      });
      onMysqlCatalogSynced?.(catalog);
      return okToolMessage(
        runtime.toolCallId,
        'get_table_catalog',
        `已加载 ${catalog.databases.length} 个数据库、${tableCount} 张表的目录信息`,
        catalog,
      );
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
      return okToolMessage(
        runtime.toolCallId,
        'get_table_schema',
        `已加载 ${schema.databases.length} 个数据库、${tableCount} 张表的字段结构`,
        schema,
      );
    },
    {
      name: 'get_table_schema',
      description: '获取当前数据库的结构元数据（库/表/字段）',
      schema: getTableSchemaSchema,
    }
  );

  const generateSqlTool = tool(
    async (input: unknown, runtime: ToolRuntime) => {
      const parsed = generateSqlSchema.parse(input);
      const schemaJson =
        parsed.schemaJson ??
        JSON.stringify(await fetchDbSchema({ includeColumns: true }));

      emitToolEvent(runtime, {
        kind: 'tool_progress',
        tool: 'generate_sql',
        message: '正在生成 SQL...',
      });

      const plannerModel = createModel({
        temperature: 0.2,
        maxTokens: 8192,
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
      return okToolMessage(
        runtime.toolCallId,
        'generate_sql',
        'SQL 生成完成',
        { sql },
      );
    },
    {
      name: 'generate_sql',
      description: '根据用户需求、schema 与上轮反馈生成或改写只读 SQL',
      schema: generateSqlSchema,
    }
  );

  const validateSqlTool = tool(
    async (input: unknown, runtime: ToolRuntime) => {
      const parsed = validateSqlSchema.parse(input);
      const schemaJson =
        parsed.schemaJson ??
        JSON.stringify(await fetchDbSchema({ includeColumns: true }));

      emitToolEvent(runtime, {
        kind: 'tool_progress',
        tool: 'validate_sql',
        message: '正在校验 SQL...',
      });

      const plannerModel = createModel({
        temperature: 0.2,
        maxTokens: 8192,
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

      const validateSummary = result.valid
        ? 'SQL 校验通过'
        : `SQL 校验未通过：${result.reason}`;
      emitToolEvent(runtime, {
        kind: 'tool_result',
        tool: 'validate_sql',
        message: validateSummary,
      });
      // 校验失败时返回 failToolMessage，让 Agent 明确感知到 ok:false，
      // 避免 Agent 误以为校验通过而继续执行，减少无意义的重试循环。
      if (!result.valid) {
        return failToolMessage(
          runtime.toolCallId,
          'validate_sql',
          validateSummary,
          result,
        );
      }
      return okToolMessage(
        runtime.toolCallId,
        'validate_sql',
        validateSummary,
        result,
      );
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
      return okToolMessage(
        runtime.toolCallId,
        'run_sql',
        `SQL 执行完成，共 ${totalCount} 条，返回 ${rows.length} 条`,
        result,
      );
    },
    {
      name: 'run_sql',
      description: '执行只读 SQL，返回 totalCount/returnedRows/rows',
      schema: runSqlSchema,
    }
  );

  const webSearchTool = createWebSearchTool();

  const searchUploadedDocumentsTool = tool(
    async (input: unknown, runtime: ToolRuntime) => {
      const parsed = searchUploadedDocumentsSchema.parse(input);
      emitToolEvent(runtime, {
        kind: 'tool_progress',
        tool: 'search_uploaded_documents',
        message: '正在检索已上传文档向量库…',
      });
      const r = await ragOperator.retrieve(parsed.query, {
        limit: parsed.limit,
        minSimilarity: parsed.minSimilarity,
        source: 'documents',
      });
      if (!r.ok) {
        emitToolEvent(runtime, {
          kind: 'tool_result',
          tool: 'search_uploaded_documents',
          message: `检索失败：${r.error}`,
        });
        return failToolMessage(
          runtime.toolCallId,
          'search_uploaded_documents',
          `检索失败：${r.error}`,
          { error: r.error },
        );
      }
      const hits = r.hits.map((h) => {
        const meta =
          h.record.metadata && typeof h.record.metadata === 'object'
            ? (h.record.metadata as { document_id?: string; chunk_index?: number })
            : undefined;
        const documentId =
          (meta?.document_id && String(meta.document_id)) ||
          String(h.record.conversation_id ?? '');
        return {
          chunk_id: h.record.id,
          document_id: documentId,
          chunk_index: meta?.chunk_index,
          similarity: h.similarity,
          text: String(h.record.content ?? '').slice(0, 6000),
        };
      });
      emitToolEvent(runtime, {
        kind: 'tool_result',
        tool: 'search_uploaded_documents',
        message: `检索完成，命中 ${hits.length} 条片段`,
      });
      return okToolMessage(
        runtime.toolCallId,
        'search_uploaded_documents',
        `检索完成，命中 ${hits.length} 条片段`,
        { hits },
      );
    },
    {
      name: 'search_uploaded_documents',
      description:
        '在用户已上传的知识文档（向量库）中按语义检索相关段落；query 用当前用户问题的自然语言表述。正文细节须用本工具，勿凭摘要臆造。',
      schema: searchUploadedDocumentsSchema,
    }
  );

  return [
    webSearchTool,
    searchUploadedDocumentsTool,
    ...createWorkspaceTools(),
    getTableCatalogTool,
    getTableSchemaTool,
    generateSqlTool,
    validateSqlTool,
    runSqlTool,
  ];
}
