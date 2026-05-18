/**
 * Agent 工具集：
 * - web_search：联网检索实时信息
 * - search_uploaded_documents：按问题检索用户上传文档的向量分段
 * - get_table_schema：获取数据库表结构
 * - generate_sql：根据需求和上下文生成 SQL（支持失败后重试）
 * - validate_sql：校验 SQL 安全性与合法性
 * - run_sql：执行 SQL 获取数据（内置 count + 分页/直接查询）
 * - read_file / write_file / execute_command：工作区内读写文件与执行命令
 */

export { createAgentTools } from './createTool';
export { createWorkspaceTools, WORKSPACE_ROOT } from './workspace';
export {
  fetchMysqlTableCatalog,
  fetchMysqlDocumentList,
  fetchMysqlConversationById,
} from './mysql/client';
