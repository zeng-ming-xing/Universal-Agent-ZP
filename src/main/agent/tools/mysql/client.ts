import { MYSQL_SERVICE_BASE, QUERY_PAGE_SIZE } from '../config';

async function getFromMysqlService<T extends { ok: boolean; error?: string }>(
  path: string
): Promise<T> {
  const response = await fetch(`${MYSQL_SERVICE_BASE}${path}`);
  const body = (await response.json()) as T;
  if (!body.ok) {
    throw new Error(body.error ?? `GET ${path} 失败`);
  }
  return body;
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

export async function fetchDbSchema(options?: {
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

export type MysqlAgentDocumentRow = {
  id: string;
  title: string;
  file_path: string;
  summary: string;
  chunk_count: number;
  created_at: string | Date;
  updated_at: string | Date;
};

/** GET /documents — 已入库知识文档的摘要列表（正文分段在向量库） */
export async function fetchMysqlDocumentList(): Promise<{
  documents: MysqlAgentDocumentRow[];
}> {
  const body = await getFromMysqlService<{
    ok: boolean;
    documents?: MysqlAgentDocumentRow[];
    error?: string;
  }>('/documents');
  return { documents: body.documents ?? [] };
}

/** 仅表名+表注释，供启动时缓存与 get_table_catalog 工具复用 */
export async function fetchMysqlTableCatalog() {
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

export async function countQueryRows(sql: string): Promise<number> {
  const body = await postToMysqlService<{
    ok: boolean;
    count?: number;
    error?: string;
  }>('/count', { sql });
  return Number(body.count ?? 0);
}

export async function fetchPagedRows(
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

export async function fetchDirectRows(sql: string): Promise<unknown[]> {
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

export type MysqlStoredConversationMessage = {
  id?: string | number | bigint;
  role?: string;
  content?: string;
  events_json?: unknown;
};

export type MysqlStoredConversation = {
  id: string;
  title?: string;
  summary?: string;
  message_count?: number;
  messages?: MysqlStoredConversationMessage[];
};

/**
 * GET /conversations/:id — 有记录则返回详情（含 messages），不存在或服务错误时返回 null（不抛错，便于启动时离线）。
 */
export async function fetchMysqlConversationById(
  conversationId: string
): Promise<MysqlStoredConversation | null> {
  const id = conversationId.trim();
  if (!id) return null;
  const path = `/conversations/${encodeURIComponent(id)}`;
  try {
    const response = await fetch(`${MYSQL_SERVICE_BASE}${path}`);
    const body = (await response.json()) as {
      ok?: boolean;
      conversation?: MysqlStoredConversation;
      error?: string;
    };
    if (!response.ok || body.ok === false || !body.conversation) {
      return null;
    }
    return body.conversation;
  } catch (e) {
    console.warn('[mysql client] 拉取对话失败:', e);
    return null;
  }
}
