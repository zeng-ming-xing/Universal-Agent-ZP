import { Agent } from './core'
import { fetchMysqlDocumentList, fetchMysqlTableCatalog } from './tools'
import {
  conversationRowsToBaseMessages,
  type MysqlConversationMessageRow,
} from './utils/conversation-rows-to-messages'
import { formatMysqlCatalogForPrompt } from './utils/format-mysql-catalog'
import { formatRagDocumentsForPrompt } from './utils/format-rag-documents'
import { skillsManager } from '../skills'

export class AgentManager {
  private readonly agents = new Map<string, Agent>()

  /** 应用启动时预取；在 {@link preloadAgentContext} 中 await */
  private readonly preloadPromise: Promise<void>

  /** 内存缓存：各库表名 + 表注释（不含字段），供系统提示与模型参考；可由启动预取或 get_table_catalog 写入 */
  mysqlSchemaCatalogText: string | null = null

  /** 已上传知识文档的摘要列表（格式化文本），供系统提示；上传成功后可再次 {@link loadRagDocumentSummaries} */
  ragDocumentsPromptText: string | null = null

  /**skill技能目录 */
  skillsPromptText: string | null = null

  async loadSkillsPromptText(): Promise<void> {
    await skillsManager?.initialize()
    const skills = skillsManager.getSkills()
    this.skillsPromptText = Array.from(skills.values()).map((skill) => `${skill.name}: ${skill.description}（文档路径：${skill.path}/SKILL.md）`).join('\n')
  }

  constructor() {
    this.preloadPromise = Promise.all([
      this.loadMysqlSchemaCatalog(),
      this.loadRagDocumentSummaries(),
      this.loadSkillsPromptText(),
    ]).then(() => {})
  }

  /** 等待表目录与知识文档摘要预取完成（建议在注册 IPC 前 await） */
  preloadAgentContext(): Promise<void> {
    return this.preloadPromise
  }

  /** 从本地 mysql-service POST /schema 拉取目录并写入 {@link mysqlSchemaCatalogText} */
  async loadMysqlSchemaCatalog(): Promise<void> {
    try {
      const catalog = await fetchMysqlTableCatalog()
      this.mysqlSchemaCatalogText = formatMysqlCatalogForPrompt(catalog)
    } catch (e) {
      console.warn('[AgentManager] 拉取 MySQL 表目录失败:', e)
      this.mysqlSchemaCatalogText = null
    }
  }

  /** 从本地 mysql-service GET /documents 拉取摘要列表并写入 {@link ragDocumentsPromptText} */
  async loadRagDocumentSummaries(): Promise<void> {
    try {
      const { documents } = await fetchMysqlDocumentList()
      this.ragDocumentsPromptText =
        documents.length > 0 ? formatRagDocumentsForPrompt(documents) : null
    } catch (e) {
      console.warn('[AgentManager] 拉取知识文档摘要列表失败:', e)
      this.ragDocumentsPromptText = null
    }
  }

  /** 已用 {@link createAgent} 预热过的会话，供流式对话 / 中止使用（不查库、不创建） */
  getAgent(sessionId: string): Agent | undefined {
    return this.agents.get(sessionId.trim())
  }

  /**
   * 按渲染进程传入的消息重建该会话的 Agent 并写入 Map（不查库）。
   * 若该 id 已有实例则先移除再建新实例；`messages` 为空表示新对话，仅注入空线程。
   */
  async createAgent(
    sessionId: string,
    messages: MysqlConversationMessageRow[]
  ): Promise<Agent> {
    const id = sessionId.trim()
    if (!id) {
      throw new Error('sessionId is required')
    }
    const prev = this.agents.get(id)
    if (prev) {
      return prev
    }
    const agent = new Agent(this)
    const rows = messages ?? []
    if (rows.length > 0) {
      const base = conversationRowsToBaseMessages(rows)
      if (base.length > 0) {
        try {
          await agent.addPriorThreadMessages(id, base)
        } catch (e) {
          console.warn('[AgentManager] 注入历史记忆失败:', e)
        }
      }
    }
    this.agents.set(id, agent)
    return agent
  }

  removeAgent(sessionId: string): boolean {
    const id = sessionId.trim()
    if (!id) {
      return false
    }
    const agent = this.agents.get(id)
    if (!agent) {
      return false
    }
    agent.abortSession(id)
    return this.agents.delete(id)
  }
}

export type { AgentFrontendEvent } from './core'
export { Agent } from './core'
export { extractLastAiText } from './core/utils'
