import { EntryAgent } from '../agent'

export class AgentManager {
  private readonly agents = new Map<string, EntryAgent>()

  createAgent(sessionId: string): EntryAgent {
    const id = sessionId.trim()
    if (!id) {
      throw new Error('sessionId is required')
    }
    const existed = this.agents.get(id)
    if (existed) {
      return existed
    }
    const agent = new EntryAgent()
    this.agents.set(id, agent)
    return agent
  }

  getAgent(sessionId: string): EntryAgent {
    return this.createAgent(sessionId)
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
