import { tool, type ToolRuntime } from 'langchain';
import { z } from 'zod';
import { emitToolEvent } from '../../agent/tools/event';
import { searchUploadedDocumentsSchema } from '../../agent/tools/rag/schemas';
import {
  failToolMessage,
  okToolMessage,
} from '../../agent/tools/utils/tool-result';
import { createWebSearchTool } from '../../agent/tools/web-search/web-search.tool';
import { createWorkspaceTools } from '../../agent/tools/workspace';
import { ragOperator } from '../../rag';
import type { AgentManager } from '../index';
import {
  executeQueryDatabasePipeline,
  type QueryDatabaseArgs,
} from './sql/index';

export const queryDatabaseSchema = z.object({
  requirement: z.string().min(1, '需求不能为空'),
  tables: z.array(z.string().min(1)).min(1).optional(),
  database: z.string().min(1).optional(),
});

/** 工厂：创建真正执行 SQL 流水线的 query_database 工具 */
function createQueryDatabaseTool(getManager: () => AgentManager) {
  return tool(
    async (input: unknown, runtime: ToolRuntime) => {
      const args = queryDatabaseSchema.parse(input) as QueryDatabaseArgs;
      const manager = getManager();
      // #region agent log
      fetch('http://127.0.0.1:7308/ingest/9df0043a-1e2b-4de5-81a0-594b047d82f3',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8ff925'},body:JSON.stringify({sessionId:'8ff925',runId:'pre-fix',hypothesisId:'H3',location:'tools/index.ts:queryDatabaseTool:entry',message:'query_database tool invoked',data:{toolCallId:runtime.toolCallId,args:{requirement:args.requirement,tables:args.tables,database:args.database}},timestamp:Date.now()})}).catch(()=>{});
      // #endregion

      // 将 ToolRuntime.writer 适配为 PipelineEmitFn
      const emit = (event: {
        kind: 'tool_progress' | 'tool_result' | 'thinking_chunk';
        tool: string;
        message: string;
      }) => {
        runtime.writer?.(JSON.stringify(event));
      };

      const result = await executeQueryDatabasePipeline(
        args,
        runtime.toolCallId,
        manager,
        emit,
      );

      if (result.ok) {
        return okToolMessage(
          result.toolCallId,
          result.toolName,
          result.summary,
          result.data,
        );
      }
      return failToolMessage(
        result.toolCallId,
        result.toolName,
        result.summary,
        result.data,
      );
    },
    {
      name: 'query_database',
      description:
        '执行完整数据库查询流水线（表目录、结构、生成/校验/执行 SQL）。数据库统计、明细、报表类问题必须优先使用本工具。',
      schema: queryDatabaseSchema,
    },
  );
}

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
        { error: r.error }
      );
    }
    const hits = r.hits.map((h) => {
      const meta =
        h.record.metadata && typeof h.record.metadata === 'object'
          ? (h.record.metadata as {
              document_id?: string;
              chunk_index?: number;
            })
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
      { hits }
    );
  },
  {
    name: 'search_uploaded_documents',
    description:
      '在用户已上传的知识文档（向量库）中按语义检索相关段落；query 用当前用户问题的自然语言表述。正文细节须用本工具，勿凭摘要臆造。',
    schema: searchUploadedDocumentsSchema,
  }
);

/** 创建 Agent 工具集（含真正执行的 query_database）。model bindTools 与 ToolNode 共用同一套。 */
export function createAgentGraphTools(getManager: () => AgentManager) {
  return [
    createQueryDatabaseTool(getManager),
    createWebSearchTool(),
    searchUploadedDocumentsTool,
    ...createWorkspaceTools(),
  ];
}
