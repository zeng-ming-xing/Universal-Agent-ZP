import { readdir } from 'fs/promises'
import { join } from 'path'
import { Skill } from './core'

export type { SkillDescription } from './core'
export { Skill } from './core'

/**
 * Skills 管理类：扫描目录、加载并索引多个 {@link Skill} 实例。
 */
export class SkillsManager {
  private readonly skillsRoot: string
  private readonly skills = new Map<string, Skill>()

  constructor(skillsRoot = join(process.cwd(), '.agents/skills')) {
    this.skillsRoot = skillsRoot
  }

  async initialize(): Promise<void> {
    await this.loadSkills()
  }

  getSkills(): ReadonlyMap<string, Skill> {
    return this.skills
  }

  getSkill(name: string): Skill | undefined {
    return this.skills.get(name)
  }

  private async loadSkills(): Promise<void> {
    const skillFiles = await this.findSkillFiles(this.skillsRoot)
    const nextSkills = new Map<string, Skill>()
    

    for (const skillFile of skillFiles) {
      const skill = await Skill.fromSkillFile(skillFile)
      if (!skill) {
        continue
      }
      nextSkills.set(skill.name, skill)
    }

    this.skills.clear()
    for (const [name, skill] of nextSkills) {
      this.skills.set(name, skill)
    }
  }

  private async findSkillFiles(dir: string): Promise<string[]> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true, encoding: 'utf8' })
    } catch (error) {
      if (isMissingDirectoryError(error)) {
        return []
      }
      throw error
    }

    const files: string[] = []
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        files.push(...(await this.findSkillFiles(fullPath)))
        continue
      }
      if (entry.isFile() && entry.name.toLowerCase() === 'skill.md') {
        files.push(fullPath)
      }
    }
    return files
  }
}

function isMissingDirectoryError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}

export const skillsManager = new SkillsManager()
