export const MYSQL_SCHEMA_CATALOG_MAX_CHARS = Number(
  process.env.AGENT_MYSQL_SCHEMA_CATALOG_MAX_CHARS ?? '16000'
)

/** 与 {@link fetchMysqlTableCatalog} 返回结构一致（避免从 tools 桶导入产生循环） */
export type MysqlTableCatalog = Awaited<
  ReturnType<
    typeof import('../tools/mysql/client').fetchMysqlTableCatalog
  >
>

export function formatMysqlCatalogForPrompt(catalog: MysqlTableCatalog): string {
  const lines: string[] = []
  for (const db of catalog.databases) {
    lines.push(`库 ${db.database}:`)
    for (const t of db.tables) {
      const desc = t.comment?.trim() ? ` — ${t.comment.trim()}` : ''
      lines.push(`  - ${t.name}${desc}`)
    }
  }
  let text = lines.join('\n')
  if (text.length > MYSQL_SCHEMA_CATALOG_MAX_CHARS) {
    text =
      text.slice(0, MYSQL_SCHEMA_CATALOG_MAX_CHARS) +
      `\n…(已截断，完整目录可用工具 get_table_catalog 获取)`
  }
  return text
}
