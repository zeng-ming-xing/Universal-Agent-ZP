import { EventEmitter } from 'node:events';
import { AIMessage, BaseMessage, HumanMessage } from '@langchain/core/messages';
import { createMainAgent } from './main-agent';
import { createAgentModel } from './model';
import { EntryAgentLoop } from './entry-agent.loop';
import type { StreamHandlers } from './entry-agent.types';
import type { AgentLike, PlannerModelLike } from './entry-agent.loop';
export type { AgentFrontendEvent } from './entry-agent.types';

/**
 * Electron 侧入口 Agent：
 * - 使用 LangChain createAgent 作为主调度器
 * - 维护会话消息记忆
 * - 对外暴露 chat / chatStream / abortSession / runChat
 */
export class EntryAgent extends EventEmitter {
  private readonly agent = createMainAgent();
  private readonly plannerModel = createAgentModel();
  private readonly sessionAbortMap = new Map<string, AbortController>();
  private readonly sessionMessages = new Map<string, BaseMessage[]>();
  private readonly eventDedupLimit = Number(
    process.env.AGENT_EVENT_DEDUP_LIMIT ?? '300'
  );
  private readonly loop = new EntryAgentLoop(
    this.agent as unknown as AgentLike,
    this.plannerModel as unknown as PlannerModelLike,
    this.eventDedupLimit
  );

  private getOrCreateSessionHistory(sessionId: string): BaseMessage[] {
    let history = this.sessionMessages.get(sessionId);
    if (!history) {
      history = [];
      this.sessionMessages.set(sessionId, history);
    }
    return history;
  }

  async runChat(
    input: string,
    sessionId = 'default',
    signal?: AbortSignal
  ): Promise<string> {
    const message = input.trim();
    if (!message) {
      return '';
    }

    const history = this.getOrCreateSessionHistory(sessionId);
    const finalText = await this.loop.runLoopWithPlan({
      message,
      history,
      signal,
    });
    history.push(new HumanMessage(message), new AIMessage(finalText));
    return finalText;
  }

  async chat(input: string, sessionId = 'default') {
    this.emit('agent:request', input);
    const content = await this.runChat(input, sessionId);
    this.emit('agent:response', content);
    return content;
  }

  /**
   * 流式输出：
   * - 官方推荐：agent.stream + streamMode（支持 messages/updates/custom）
   * - messages：用于前端“增量文本”
   * - updates：用于捕获 tool_calls / ToolMessage（告诉前端当前在调用什么工具）
   * - custom：来自 tool 内 runtime.writer 的自定义进度（更细粒度、更稳定）
   */
  async chatStream(
    input: string,
    sessionId = 'default',
    handlers?: StreamHandlers
  ) {
    const message = input.trim();
    if (!message) {
      handlers?.onDone?.('');
      return '';
    }

    this.emit('agent:request', message);
    const controller = new AbortController();
    this.sessionAbortMap.set(sessionId, controller);

    let content = '';
    const rawToolJsonState = {
      active: false,
      braceDepth: 0,
    };
    try {
      const history = this.getOrCreateSessionHistory(sessionId);
      content = await this.loop.runLoopWithPlan({
        message,
        history,
        streamCtx: {
          handlers,
          rawToolJsonState,
          controller,
          eventDedupKeys: new Set<string>(),
        },
        signal: controller.signal,
      });

      if (!controller.signal.aborted) {
        history.push(new HumanMessage(message), new AIMessage(content));
      }
    } catch (error) {
      if (!this.isAbortError(error)) {
        throw error;
      }
    } finally {
      if (this.sessionAbortMap.get(sessionId) === controller) {
        this.sessionAbortMap.delete(sessionId);
      }
    }

    handlers?.onDone?.(content);
    this.emit('agent:response', content);
    return content;
  }

  abortSession(sessionId = 'default') {
    const controller = this.sessionAbortMap.get(sessionId);
    if (controller && !controller.signal.aborted) {
      controller.abort();
    }
  }

  private isAbortError(error: unknown) {
    if (!error || typeof error !== 'object') {
      return false;
    }
    const name = String((error as { name?: string }).name ?? '');
    return name === 'AbortError';
  }
}
