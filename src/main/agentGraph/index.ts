import { Agent } from './core';
import { fetchMysqlDocumentList, fetchMysqlTableCatalog } from '../agent/tools';
import {
  conversationRowsToBaseMessages,
  type MysqlConversationMessageRow,
} from '../agent/utils/conversation-rows-to-messages';
import { formatMysqlCatalogForPrompt } from '../agent/utils/format-mysql-catalog';
import { formatRagDocumentsForPrompt } from '../agent/utils/format-rag-documents';
import { skillsManager } from '../skills';

export class AgentManager {
  private readonly agents = new Map<string, Agent>();

  private readonly preloadPromise: Promise<void>;

  mysqlSchemaCatalogText: string | null = null;
  ragDocumentsPromptText: string | null = null;
  skillsPromptText: string | null = null;

  async loadSkillsPromptText(): Promise<void> {
    await skillsManager?.initialize();
    const skills = skillsManager.getSkills();
    this.skillsPromptText = Array.from(skills.values())
      .map(
        (skill) =>
          `${skill.name}: ${skill.description}（文档路径：${skill.path}/SKILL.md）`
      )
      .join('\n');
  }

  constructor() {
    this.preloadPromise = Promise.all([
      this.loadMysqlSchemaCatalog(),
      this.loadRagDocumentSummaries(),
      this.loadSkillsPromptText(),
    ]).then(() => {});
  }

  preloadAgentContext(): Promise<void> {
    return this.preloadPromise;
  }

  async loadMysqlSchemaCatalog(): Promise<void> {
    try {
      const catalog = await fetchMysqlTableCatalog();
      this.mysqlSchemaCatalogText = formatMysqlCatalogForPrompt(catalog);
    } catch (e) {
      console.warn('[AgentGraphManager] 拉取 MySQL 表目录失败:', e);
      this.mysqlSchemaCatalogText = null;
    }
  }

  async loadRagDocumentSummaries(): Promise<void> {
    try {
      const { documents } = await fetchMysqlDocumentList();
      this.ragDocumentsPromptText =
        documents.length > 0 ? formatRagDocumentsForPrompt(documents) : null;
    } catch (e) {
      console.warn('[AgentGraphManager] 拉取知识文档摘要列表失败:', e);
      this.ragDocumentsPromptText = null;
    }
  }

  getAgent(sessionId: string): Agent | undefined {
    return this.agents.get(sessionId.trim());
  }

  async createAgent(
    sessionId: string,
    messages: MysqlConversationMessageRow[]
  ): Promise<Agent> {
    const id = sessionId.trim();
    if (!id) {
      throw new Error('sessionId is required');
    }
    const prev = this.agents.get(id);
    if (prev) {
      return prev;
    }
    const agent = new Agent(this);
    const rows = messages ?? [];
    if (rows.length > 0) {
      const base = conversationRowsToBaseMessages(rows);
      if (base.length > 0) {
        try {
          await agent.addPriorThreadMessages(id, base);
        } catch (e) {
          console.warn('[AgentGraphManager] 注入历史记忆失败:', e);
        }
      }
    }
    this.agents.set(id, agent);
    return agent;
  }

  removeAgent(sessionId: string): boolean {
    const id = sessionId.trim();
    if (!id) {
      return false;
    }
    const agent = this.agents.get(id);
    if (!agent) {
      return false;
    }
    agent.abortSession(id);
    return this.agents.delete(id);
  }
}

export type { AgentFrontendEvent, StreamHandlers } from './core/types';
export { Agent } from './core';
export { extractLastAiText } from './core/utils';

export interface AgentSessionLike {
  agentRequest(
    input: string,
    sessionId: string,
    handlers?: import('./core/types').StreamHandlers
  ): Promise<string>;
  abortSession(sessionId: string): void;
}

export interface AgentManagerLike {
  mysqlSchemaCatalogText: string | null;
  ragDocumentsPromptText: string | null;
  skillsPromptText: string | null;
  preloadAgentContext(): Promise<void>;
  loadMysqlSchemaCatalog(): Promise<void>;
  loadRagDocumentSummaries(): Promise<void>;
  loadSkillsPromptText(): Promise<void>;
  getAgent(sessionId: string): AgentSessionLike | undefined;
  createAgent(
    sessionId: string,
    messages: MysqlConversationMessageRow[]
  ): Promise<AgentSessionLike>;
  removeAgent(sessionId: string): boolean;
}
