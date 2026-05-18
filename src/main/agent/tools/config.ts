/** 联网搜索请求超时（ms） */
export const WEB_SEARCH_REQUEST_TIMEOUT_MS = Number(
  process.env.AGENT_WEB_SEARCH_TIMEOUT_MS
);

/** 搜索返回的最大条目数 */
export const SEARCH_MAX_RESULTS = Number(
  process.env.AGENT_WEB_SEARCH_MAX_RESULTS
);

export const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

export const TAVILY_MCP_ENDPOINT = process.env.TAVILY_MCP_ENDPOINT;

/** mysql-service HTTP 服务基础地址 */
export const MYSQL_SERVICE_BASE = `http://127.0.0.1:${
  process.env.AGENT_MYSQL_SERVICE_PORT
}`;

/** 数据库分页阈值 */
export const PAGE_SIZE_THRESHOLD = Number(
  process.env.AGENT_SQL_PAGE_SIZE_THRESHOLD
);

/** 分页每批最多获取的行数 */
export const QUERY_PAGE_SIZE = Number(
  process.env.AGENT_SQL_QUERY_PAGE_SIZE
);