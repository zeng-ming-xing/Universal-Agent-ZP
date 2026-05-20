import { EventEmitter } from 'node:events';
import { HumanMessage, type BaseMessage } from '@langchain/core/messages';
import type { AgentManager } from '../index';
import { buildMainGraph, type CompiledMainGraph } from './graph';
import { processAgentStreamChunk } from './helpers';
import type { RunAgentParams, StreamHandlers } from './types';
import { extractLastAiText } from './utils';

export type { AgentFrontendEvent } from './types';

export class Agent extends EventEmitter {
  private readonly graph: CompiledMainGraph;
  private readonly sessionAbortMap = new Map<string, AbortController>();
  private readonly recursionLimit =
    Number(process.env.AGENT_RECURSION_LIMIT) || 50;

  readonly manager: AgentManager;

  constructor(manager: AgentManager) {
    super();
    this.manager = manager;
    this.graph = buildMainGraph({ getManager: () => manager });
  }

  async addPriorThreadMessages(
    threadId: string,
    messages: BaseMessage[]
  ): Promise<void> {
    const id = threadId.trim();
    if (!id || messages.length === 0) return;
    await this.graph.updateState(
      { configurable: { thread_id: id } },
      { messages },
      'agent'
    );
  }

  async agentRequest(
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
    try {
      content = await this.runAgent({
        message,
        threadId: sessionId,
        streamCtx: {
          handlers,
          controller,
          eventDedupKeys: new Set<string>(),
          lastThinkingText: '',
          lastContentText: '',
          messageNodesAllowlist: new Set(['agent']),
        },
        signal: controller.signal,
      });
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

  async invokeAgentRequest(
    input: string,
    sessionId = 'default',
    signal?: AbortSignal
  ): Promise<string> {
    const message = input.trim();
    if (!message) {
      return '';
    }

    this.emit('agent:request', message);
    const response = await this.graph.invoke(
      { messages: [new HumanMessage(message)] },
      {
        configurable: { thread_id: sessionId },
        signal,
        recursionLimit: this.recursionLimit,
      }
    );
    const content = extractLastAiText(response.messages ?? []);
    this.emit('agent:response', content);
    return content;
  }

  private async runAgent(params: RunAgentParams): Promise<string> {
    const { message, threadId, streamCtx, signal } = params;

    let content = ''; 

    const stream = await this.graph.stream(
      { messages: [new HumanMessage(message)] },
      {
        configurable: { thread_id: threadId },
        signal,
        recursionLimit: this.recursionLimit,
        streamMode: ['messages', 'updates',  'custom'],
      }
    );

    for await (const chunk of stream) {
      if (streamCtx.controller?.signal.aborted) break;
      await processAgentStreamChunk(chunk, streamCtx, (delta) => {
        content += delta;
        streamCtx.handlers?.onChunk?.(delta);
      });
    }

    return content;
  }
}
