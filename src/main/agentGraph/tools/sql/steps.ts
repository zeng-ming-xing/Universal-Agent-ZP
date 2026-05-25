/**
 * SQL 流水线各步骤实现——纯函数，与 LangGraph/ToolRuntime 解耦。
 *
 * 每个步骤仅通过 emit 回调上报进度。供 index.ts 编排调用。
 */
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { unwrapJsonText, extractThinkingFromToken } from '../../../agent/core/helpers';
import { getIncrementalText } from '../../core/helpers';
import { createModel } from '../../../agent/model';
import { PAGE_SIZE_THRESHOLD } from '../../../agent/tools/config';
import {
  countQueryRows,
  fetchDbSchema,
  fetchDirectRows,
  fetchMysqlTableCatalog,
  fetchPagedRows,
} from '../../../agent/tools/mysql/client';
import { formatMysqlCatalogForPrompt } from '../../../agent/utils/format-mysql-catalog';
import type { AgentManager } from '../../index';

// ── 类型 ──────────────────────────────────────────

/** 步骤内的事件发射回调 */
export type PipelineEmitFn = (event: {
  kind: 'tool_progress' | 'tool_result' | 'thinking_chunk';
  tool: string;
  message: string;
}) => void;

export type SqlValidation = {
  valid: boolean;
  reason: string;
  suggestion?: string;
};

export type SqlQueryResult = {
  totalCount: number;
  returnedRows: number;
  rows: unknown[];
};

// ── 步骤实现 ──────────────────────────────────────

/** 加载库表目录；优先用 AgentManager 内存缓存 */
export async function loadCatalog(
  manager: AgentManager,
  emit: PipelineEmitFn,
): Promise<string> {
  emit({
    kind: 'tool_progress',
    tool: 'get_table_catalog',
    message: '正在加载表目录（仅表名和描述）...',
  });

  const cached = manager.mysqlSchemaCatalogText?.trim();
  if (cached) {
    emit({
      kind: 'tool_result',
      tool: 'get_table_catalog',
      message: '已使用应用内存中的表目录缓存',
    });
    return cached;
  }

  const catalog = await fetchMysqlTableCatalog();
  const catalogText = formatMysqlCatalogForPrompt(catalog);
  manager.mysqlSchemaCatalogText = catalogText;

  const tableCount = catalog.databases.reduce(
    (sum, db) => sum + (Array.isArray(db.tables) ? db.tables.length : 0),
    0,
  );
  emit({
    kind: 'tool_result',
    tool: 'get_table_catalog',
    message: `已加载 ${catalog.databases.length} 个数据库、${tableCount} 张表的目录信息`,
  });
  return catalogText;
}

/** 按 tables/database 拉取字段级 schema JSON */
export async function loadSchema(
  emit: PipelineEmitFn,
  tables?: string[],
  database?: string,
): Promise<string> {
  emit({
    kind: 'tool_progress',
    tool: 'get_table_schema',
    message: tables?.length
      ? `正在加载 ${tables.length} 张候选表的字段结构...`
      : '正在加载数据库表结构...',
  });

  const schema = await fetchDbSchema({ includeColumns: true, tables, database });
  const schemaJson = JSON.stringify(schema);
  const tableCount = schema.databases.reduce(
    (sum, db) => sum + (Array.isArray(db.tables) ? db.tables.length : 0),
    0,
  );

  emit({
    kind: 'tool_result',
    tool: 'get_table_schema',
    message: `已加载 ${schema.databases.length} 个数据库、${tableCount} 张表的字段结构`,
  });
  return schemaJson;
}

/** LLM 生成只读 SELECT；流式调用以捕获思考过程 */
export async function generateSql(
  emit: PipelineEmitFn,
  params: {
    requirement: string;
    schemaJson: string;
    previousSql?: string;
    feedback?: string;
  },
): Promise<string> {
  emit({ kind: 'tool_progress', tool: 'generate_sql', message: '正在生成 SQL...' });

  const plannerModel = createModel({ temperature: 0.2, maxTokens: 8192 });
  const messages = [
    new SystemMessage(
      [
        '你是资深 MySQL 查询规划器。',
        '目标：基于用户需求和表结构生成可执行、可解释、只读的 SELECT SQL。',
        '硬性约束：',
        '1) 只能输出一条 SQL；只允许 SELECT / WITH ... SELECT。',
        '2) 严禁 INSERT/UPDATE/DELETE/REPLACE/ALTER/DROP/TRUNCATE/CREATE/GRANT 等写操作。',
        '3) 严格依赖给定 schema，禁止虚构库/表/字段。',
        '4) 默认优先返回"能回答问题的最小结果集"：先聚合、后明细；除非用户要求明细，不要 SELECT *。',
        '5) 如果上一次 SQL 不满足需求，请根据反馈修正，明确修复点。',
        '输出要求：只输出纯 SQL，不要 markdown，不要解释。',
      ].join('\n'),
    ),
    new HumanMessage(
      [
        `用户需求：${params.requirement}`,
        params.previousSql ? `上一次 SQL：${params.previousSql}` : '',
        params.feedback ? `上一次结果反馈：${params.feedback}` : '',
        `表结构（JSON）：\n${params.schemaJson}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
    ),
  ];

  let fullContent = '';
  let lastThinkingText = '';

  const stream = await plannerModel.stream(messages);
  for await (const token of stream) {
    // 提取思考过程并增量 emit
    const rawThinking = extractThinkingFromToken(token);
    if (rawThinking) {
      const thinkingDelta = getIncrementalText(lastThinkingText, rawThinking);
      lastThinkingText = rawThinking;
      if (thinkingDelta) {
        emit({ kind: 'thinking_chunk', tool: 'generate_sql', message: thinkingDelta });
      }
    }

    // 累积正文内容
    const tokenContent = (token as { content?: unknown })?.content;
    const text =
      typeof tokenContent === 'string'
        ? tokenContent
        : Array.isArray(tokenContent)
          ? tokenContent
              .map((item) =>
                typeof item === 'string'
                  ? item
                  : ((item as { text?: unknown })?.text ?? ''),
              )
              .join('')
          : '';
    if (text) fullContent += text;
  }

  const sql = fullContent
    .trim()
    .replace(/^```sql\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  emit({ kind: 'tool_result', tool: 'generate_sql', message: 'SQL 生成完成' });
  return sql;
}

/** LLM 审核 SQL 安全性与 schema 一致性 */
export async function validateSql(
  emit: PipelineEmitFn,
  sql: string,
  schemaJson: string,
): Promise<SqlValidation> {
  emit({ kind: 'tool_progress', tool: 'validate_sql', message: '正在校验 SQL...' });

  const plannerModel = createModel({ temperature: 0.2, maxTokens: 8192 });
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
      ].join('\n'),
    ),
    new HumanMessage(`待校验 SQL：\n${sql}\n\n表结构（JSON）：\n${schemaJson}`),
  ]);

  const raw = unwrapJsonText(String(response.content ?? ''));
  let result: SqlValidation;
  try {
    const parsed = JSON.parse(raw) as { valid?: unknown; reason?: unknown; suggestion?: unknown };
    result = {
      valid: parsed.valid === true,
      reason: typeof parsed.reason === 'string' ? parsed.reason : '校验结果格式异常',
      suggestion: typeof parsed.suggestion === 'string' ? parsed.suggestion : undefined,
    };
  } catch {
    result = { valid: false, reason: 'SQL 校验结果解析失败' };
  }

  emit({ kind: 'tool_result', tool: 'validate_sql', message: result.valid ? 'SQL 校验通过' : `SQL 校验未通过：${result.reason}` });
  return result;
}

/** 执行 SQL；大结果集走分页 */
export async function runSql(
  emit: PipelineEmitFn,
  sql: string,
): Promise<SqlQueryResult> {
  emit({ kind: 'tool_progress', tool: 'run_sql', message: '正在执行 SQL...' });

  const totalCount = await countQueryRows(sql);
  const rows =
    totalCount > PAGE_SIZE_THRESHOLD
      ? await fetchPagedRows(sql, totalCount)
      : await fetchDirectRows(sql);

  emit({
    kind: 'tool_result',
    tool: 'run_sql',
    message: `SQL 执行完成，共 ${totalCount} 条，返回 ${rows.length} 条`,
  });
  return { totalCount, returnedRows: rows.length, rows };
}

/** 判断查询结果是否足以回答用户需求 */
export async function evaluateResult(
  requirement: string,
  queryResult: SqlQueryResult | undefined,
): Promise<{ satisfied: boolean; feedback?: string }> {
  if (!queryResult) {
    return { satisfied: false, feedback: '未获得查询结果' };
  }

  const parseJson = (raw: string) => {
    const trimmed = raw.trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
    return JSON.parse(trimmed) as { satisfied?: boolean; feedback?: string };
  };

  if (queryResult.totalCount === 0) {
    const model = createModel({ temperature: 0.1, maxTokens: 512 });
    const response = await model.invoke([
      new SystemMessage(
        '你是数据分析助手。只输出 JSON：{"satisfied":boolean,"feedback":"..."}。' +
          '若空结果仍可能合理（如确实无匹配记录）则 satisfied=true。',
      ),
      new HumanMessage(`用户需求：${requirement}\n查询返回 0 条记录。是否可据此作答？`),
    ]);
    try {
      const parsed = parseJson(String(response.content ?? ''));
      return {
        satisfied: parsed.satisfied === true,
        feedback: typeof parsed.feedback === 'string' ? parsed.feedback : undefined,
      };
    } catch {
      return { satisfied: false, feedback: '查询结果为空，建议调整筛选条件或时间范围后重试' };
    }
  }

  const model = createModel({ temperature: 0.1, maxTokens: 512 });
  const preview = JSON.stringify(queryResult.rows.slice(0, 5));
  const response = await model.invoke([
    new SystemMessage(
      '你是数据分析助手。只输出 JSON：{"satisfied":boolean,"feedback":"..."}。' +
        'satisfied=false 时 feedback 说明缺口（口径、维度、时间范围等）。',
    ),
    new HumanMessage(
      [
        `用户需求：${requirement}`,
        `共 ${queryResult.totalCount} 条，样本：${preview}`,
        '当前结果是否足以回答用户？',
      ].join('\n'),
    ),
  ]);

  try {
    const parsed = parseJson(String(response.content ?? ''));
    return {
      satisfied: parsed.satisfied === true,
      feedback: typeof parsed.feedback === 'string' ? parsed.feedback : undefined,
    };
  } catch {
    return { satisfied: true };
  }
}
