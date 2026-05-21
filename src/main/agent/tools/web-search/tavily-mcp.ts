import {
  SEARCH_MAX_RESULTS,
  TAVILY_API_KEY,
  TAVILY_MCP_ENDPOINT,
  WEB_SEARCH_REQUEST_TIMEOUT_MS,
} from '../config';

type TavilyResultItem = { title?: string; content?: string; url?: string };
export type TavilySearchData = { answer?: string; results?: TavilyResultItem[] };

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

/**
 * 解析 Tavily MCP tools/call 的 JSON-RPC 响应为结构化数据。
 *
 * result.content 是 MCP ContentBlock 数组，Tavily 固定返回一个 type:"text" 块，
 * 其 text 字段是 JSON 字符串：{ answer?: string; results: [...] }
 */
function parseTavilyResult(rpcMsg: unknown): TavilySearchData {
  if (!rpcMsg || typeof rpcMsg !== 'object') return {};

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
  if (!textBlock?.text) return {};

  // text 字段可能是 JSON 也可能是纯文本
  try {
    return JSON.parse(textBlock.text) as TavilySearchData;
  } catch {
    return { answer: textBlock.text };
  }
}

/**
 * 基于 URL 对多个查询的搜索结果去重并格式化为可读文本。
 * - 有 URL 的按 URL 去重；无 URL 的回退按 title+content 前 50 字去重
 * - answer 按查询拼接展示，便于大模型识别每条摘要的出处
 */
export function formatMergedSearchResults(
  queries: string[],
  dataList: TavilySearchData[]
): string {
  const seen = new Set<string>();
  const mergedResults: TavilyResultItem[] = [];
  const answers: string[] = [];

  dataList.forEach((data, idx) => {
    const q = queries[idx] ?? '';
    if (data.answer && data.answer.trim()) {
      answers.push(`[查询${idx + 1}] ${q}\n${data.answer.trim()}`);
    }
    for (const item of data.results ?? []) {
      const url = (item.url ?? '').trim();
      const key = url
        ? url
        : `${item.title ?? ''}::${(item.content ?? '').slice(0, 50)}`;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      mergedResults.push(item);
    }
  });

  const parts: string[] = [];
  if (answers.length > 0) parts.push(`AI摘要：\n${answers.join('\n\n')}`);
  if (mergedResults.length > 0) {
    const maxItems = Math.max(
      SEARCH_MAX_RESULTS,
      queries.length * SEARCH_MAX_RESULTS
    );
    parts.push(
      ...mergedResults
        .slice(0, maxItems)
        .map(
          (item, i) =>
            `[${i + 1}] ${item.title ?? ''}\n${item.content ?? ''}\n来源：${
              item.url ?? ''
            }`
        )
    );
  }
  return parts.join('\n\n') || '未找到相关搜索结果';
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
export async function callTavilyMcpSearch(query: string): Promise<TavilySearchData> {
  if (!TAVILY_MCP_ENDPOINT?.trim() || !TAVILY_API_KEY?.trim()) {
    throw new Error('TAVILY_MCP_ENDPOINT 与 TAVILY_API_KEY 未配置');
  }
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
      return { answer: responseText };
    }
  }

  return parseTavilyResult(rpcMsg);
}
