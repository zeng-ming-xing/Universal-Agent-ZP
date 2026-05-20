/**
 * SQL 查询流水线编排：用 while 循环替代原 SqlSubgraph，由 queryDatabaseTool 调用。
 *
 * 流程：
 *   1. loadCatalog  → 2. loadSchema
 *   3. generateSql ↔ validateSql（校验失败重试，最多 2 次）
 *   4. runSql → evaluate（结果不满意时回到 generateSql，最多 2 轮）
 */
import { failToolMessage, okToolMessage } from '../../../agent/tools/utils/tool-result';
import type { AgentManager } from '../../index';
import {
  evaluateResult,
  generateSql,
  loadCatalog,
  loadSchema,
  runSql,
  validateSql,
  type PipelineEmitFn,
} from './steps';

const MAX_VALIDATE_RETRY = 2;
const MAX_PIPELINE_ITERATION = 2;

export type QueryDatabaseArgs = {
  requirement: string;
  tables?: string[];
  database?: string;
};

export type PipelineResult = {
  ok: boolean;
  summary: string;
  data: unknown;
  toolCallId: string;
  toolName: string;
};

/**
 * 执行完整数据库查询流水线。
 * @param args       - 查询参数（来自 tool_call）
 * @param toolCallId - 工具调用 ID
 * @param manager    - AgentManager 实例
 * @param emit       - 事件发射回调
 */
export async function executeQueryDatabasePipeline(
  args: QueryDatabaseArgs,
  toolCallId: string,
  manager: AgentManager,
  emit: PipelineEmitFn,
): Promise<PipelineResult> {
  const toolName = 'query_database';

  try {
    if (!args.requirement?.trim()) {
      return {
        ok: false,
        summary: '查询需求不能为空',
        data: { error: '查询需求不能为空' },
        toolCallId,
        toolName,
      };
    }

    // 1. 加载表目录
    emit({ kind: 'tool_progress', tool: toolName, message: '正在执行数据库查询流水线…' });
    await loadCatalog(manager, emit);

    // 2. 加载 schema
    const schemaJson = await loadSchema(emit, args.tables, args.database);

    // 3. 生成 → 校验循环
    let sql = await generateSql(emit, { requirement: args.requirement, schemaJson });
    let previousSql: string | undefined;
    let validateRetryCount = 0;

    while (true) {
      const validation = await validateSql(emit, sql, schemaJson);
      if (validation.valid) break;

      validateRetryCount++;
      if (validateRetryCount >= MAX_VALIDATE_RETRY) {
        return {
          ok: false,
          summary: `数据库查询失败：${validation.reason}`,
          data: { error: validation.reason, sql },
          toolCallId,
          toolName,
        };
      }

      previousSql = sql;
      const feedback = [validation.reason, validation.suggestion]
        .filter(Boolean)
        .join('；');
      sql = await generateSql(emit, {
        requirement: args.requirement,
        schemaJson,
        previousSql,
        feedback,
      });
    }

    // 4. 执行 → 评估循环
    let pipelineIteration = 0;
    let feedback: string | undefined;

    while (true) {
      const queryResult = await runSql(emit, sql);
      const evaluation = await evaluateResult(args.requirement, queryResult);

      if (evaluation.satisfied) {
        const summary = `查询流水线完成：共 ${queryResult.totalCount} 条记录，返回 ${queryResult.returnedRows} 条样本。`;
        return {
          ok: true,
          summary,
          data: { sql, queryResult, validation: { valid: true } },
          toolCallId,
          toolName,
        };
      }

      pipelineIteration++;
      if (pipelineIteration >= MAX_PIPELINE_ITERATION) {
        return {
          ok: true,
          summary: evaluation.feedback ?? '查询流水线结束',
          data: { sql, queryResult },
          toolCallId,
          toolName,
        };
      }

      feedback = evaluation.feedback;
      previousSql = sql;
      sql = await generateSql(emit, {
        requirement: args.requirement,
        schemaJson,
        previousSql,
        feedback,
      });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      summary: `查询失败：${message}`,
      data: { error: message },
      toolCallId,
      toolName,
    };
  }
}

/** 将流水线结果转换为 ToolNode 标准的 ToolMessage 返回值 */
export function pipelineResultToToolMessage(result: PipelineResult) {
  if (result.ok) {
    return okToolMessage(result.toolCallId, result.toolName, result.summary, result.data);
  }
  return failToolMessage(result.toolCallId, result.toolName, result.summary, result.data);
}
