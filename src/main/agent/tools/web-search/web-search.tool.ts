import { tool, type ToolRuntime } from 'langchain';
import { z } from 'zod';
import { emitToolEvent } from '../event';
import {
  callTavilyMcpSearch,
  formatMergedSearchResults,
  type TavilySearchData,
} from './tavily-mcp';

import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { unwrapJsonText } from '../../core/helpers';
import { createModel } from '../../model';

 function createSummaryModel() {
  return createModel({
    temperature: 0.2,
    maxTokens: 512,
    modelKwargs: {
      thinking: { type: 'disabled' },
    },
  });
}

/**
 * 调用轻量模型，基于原始 query + 当前日期，扩展出 2-3 个差异化搜索查询。
 * - 严格要求模型输出 JSON：{ "queries": ["...", "..."] }
 * - 任一异常/解析失败均回退为原始 query，保证工具可用
 * - 模型在调用时创建，不挂在 tools 包上
 */
export async function expandSearchQueries(originalQuery: string): Promise<string[]> {
  const original = originalQuery.trim();
  if (!original) return [];

  const today = new Date().toISOString().slice(0, 10);

  try {
    const model = createSummaryModel();
    const response = await model.invoke([
      new SystemMessage(
        [
          '你是联网搜索的查询扩展器。',
          `当前日期：${today}`,
          '根据用户的原始查询，生成 2-3 个有差异化的搜索查询（中文或英文均可），用于并行联网检索。',
          '要求：',
          '1. 包含宽泛概览型、精准细节型、权威官网限定型三种角度',
          '2. 自带时间年份、官方、最新等限定词',
          '3. 每个Query表述句式不一样，不要同义重复',
          '4) 严格只输出 JSON，格式：{"queries":["...","..."]}，不要任何解释、不要 markdown 代码块。',
        ].join('\n')
      ),
      new HumanMessage(`原始查询：${original}`),
    ]);

    const raw = unwrapJsonText(String(response.content ?? ''));
    const parsed = JSON.parse(raw) as { queries?: unknown };
    if (Array.isArray(parsed.queries)) {
      const queries = parsed.queries
        .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
        .map((q) => q.trim())
        .slice(0, 3);
      if (queries.length > 0) return queries;
    }
  } catch (err) {
    console.warn('[expandSearchQueries] 扩展查询失败，回退原始 query：', err);
  }

  return [original];
}


const webSearchSchema = z.object({
  query: z.string().min(1, '搜索词不能为空'),
});

/** 工具：通过 Tavily 远程 MCP 联网搜索实时信息 */
export function createWebSearchTool() {
  return tool(
    async (input: unknown, runtime: ToolRuntime) => {
      const parsed = webSearchSchema.parse(input);

      emitToolEvent(runtime, {
        kind: 'tool_progress',
        tool: 'web_search',
        message: `正在扩展查询：${parsed.query}`,
      });

      const queries = await expandSearchQueries(parsed.query);

      emitToolEvent(runtime, {
        kind: 'tool_progress',
        tool: 'web_search',
        message: `已生成 ${queries.length} 个差异化查询，开始并行检索：\n${queries
          .map((q, i) => `${i + 1}. ${q}`)
          .join('\n')}`,
      });

      const settled = await Promise.allSettled(
        queries.map((q) => callTavilyMcpSearch(q))
      );
      const okQueries: string[] = [];
      const okDataList: TavilySearchData[] = [];
      settled.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          okQueries.push(queries[i]);
          okDataList.push(r.value);
        } else {
          console.warn(
            `[web_search] 查询失败：${queries[i]}`,
            r.reason instanceof Error ? r.reason.message : r.reason
          );
        }
      });

      if (okDataList.length === 0) {
        throw new Error('所有联网检索均失败，请稍后重试');
      }

      const result = formatMergedSearchResults(okQueries, okDataList);

      emitToolEvent(runtime, {
        kind: 'tool_result',
        tool: 'web_search',
        message: `联网检索完成，共合并 ${okQueries.length}/${queries.length} 个查询的结果`,
      });

      return result;
    },
    {
      name: 'web_search',
      description: '通过 Tavily MCP 联网搜索实时信息，返回 AI 摘要与相关网页内容',
      schema: webSearchSchema,
    }
  );
}
