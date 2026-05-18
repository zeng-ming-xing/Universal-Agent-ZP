/** 联网搜索请求超时（ms） */
export const WEB_SEARCH_REQUEST_TIMEOUT_MS = Number(
  process.env.AGENT_WEB_SEARCH_TIMEOUT_MS ?? '20000'
);

/** 搜索返回的最大条目数 */
export const SEARCH_MAX_RESULTS = Number(
  process.env.AGENT_WEB_SEARCH_MAX_RESULTS ?? '5'
);

export const TAVILY_API_KEY =
  process.env.TAVILY_API_KEY ??
  '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';

export const TAVILY_MCP_ENDPOINT = 'https://mcp.tavily.com/mcp/';

/** mysql-service HTTP 服务基础地址 */
export const MYSQL_SERVICE_BASE = `http://127.0.0.1:${
  process.env.AGENT_MYSQL_SERVICE_PORT ?? '37123'
}`;

/** 数据库分页阈值 */
export const PAGE_SIZE_THRESHOLD = 200;

/** 分页每批最多获取的行数 */
export const QUERY_PAGE_SIZE = 200;
