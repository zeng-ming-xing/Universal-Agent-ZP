import { readFile } from 'fs/promises'
import { join } from 'path'

export interface SkillDescription {
  name: string
  description: string
  path: string
}

/**
 * 单个 skill：从 skill.md 解析元数据并持有目录路径。
 */
export class Skill {
  readonly name: string
  readonly description: string
  readonly path: string

  private constructor(description: SkillDescription) {
    this.name = description.name
    this.description = description.description
    this.path = description.path
  }

  static async fromSkillFile(skillFilePath: string): Promise<Skill | null> {
    const content = await readFile(skillFilePath, 'utf8')
    const parsed = parseSkillFrontmatter(content)
    if (!parsed) {
      return null
    }

    const skillDir = join(skillFilePath, '..')
    const fallbackName = skillDir.split(/[\\/]/).pop() ?? skillFilePath
    const name = parsed.name?.trim() || fallbackName
    const description = parsed.description?.trim()
    if (!description) {
      return null
    }

    return new Skill({ name, description, path: skillDir })
  }

  toDescription(): SkillDescription {
    return {
      name: this.name,
      description: this.description,
      path: this.path
    }
  }
}

type SkillFrontmatterField = 'name' | 'description'

function normalizeSkillFrontmatterKey(rawKey: string): SkillFrontmatterField | null {
  const key = rawKey.trim()
  if (!key) {
    return null
  }

  const lower = key.toLowerCase()
  if (lower === 'name' || key === '名称' || key === '名字') {
    return 'name'
  }
  if (lower === 'description' || key === '描述' || key === '简介' || key === '说明') {
    return 'description'
  }
  return null
}

/** 支持 ---、**---** / **--**、**___** 等首尾分隔符 */
function extractSkillFrontmatterBody(content: string): string | null {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/)
  if (lines.length < 3) {
    return null
  }

  const openLine = lines[0].trim()
  if (!isFrontmatterOpenDelimiter(openLine)) {
    return null
  }

  for (let i = 1; i < lines.length; i++) {
    if (isFrontmatterCloseDelimiter(openLine, lines[i].trim())) {
      return lines.slice(1, i).join('\n')
    }
  }

  return null
}

function isFrontmatterOpenDelimiter(line: string): boolean {
  if (line === '---') {
    return true
  }
  if (line === '**___**') {
    return true
  }
  // **---**、**--** 等 Markdown 加粗包裹的横线
  return /^\*\*-{2,}\*\*$/.test(line)
}

function isFrontmatterCloseDelimiter(openLine: string, line: string): boolean {
  if (line === openLine) {
    return true
  }
  if (openLine === '---' && line === '---') {
    return true
  }
  if (openLine === '**___**' && line === '**___**') {
    return true
  }
  // 开头 **---** 时，结尾 **--** / **---** 均视为闭合
  if (/^\*\*-{2,}\*\*$/.test(openLine) && /^\*\*-{2,}\*\*$/.test(line)) {
    return true
  }
  return false
}

function parseSkillFrontmatter(content: string): { name?: string; description?: string } | null {
  const body = extractSkillFrontmatterBody(content)
  if (!body) {
    return null
  }

  const fields: Partial<Record<SkillFrontmatterField, string>> = {}
  let currentKey: SkillFrontmatterField | null = null

  for (const line of body.split(/\r?\n/)) {
    const keyValue = line.match(/^([^\s:：]+)[:：]\s*(.*)$/)
    if (keyValue) {
      const canonicalKey = normalizeSkillFrontmatterKey(keyValue[1])
      if (!canonicalKey) {
        currentKey = null
        continue
      }

      currentKey = canonicalKey
      const value = keyValue[2].trim()
      if (!value || value === '>' || value === '>-' || value === '|') {
        fields[canonicalKey] = ''
        continue
      }
      fields[canonicalKey] = stripYamlQuotes(value)
      continue
    }

    if (currentKey && /^\s+/.test(line)) {
      const chunk = line.trim()
      fields[currentKey] = fields[currentKey] ? `${fields[currentKey]} ${chunk}` : chunk
      continue
    }

    if (line.trim() !== '') {
      currentKey = null
    }
  }

  return {
    name: fields.name,
    description: fields.description
  }
}

function stripYamlQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  return value
}
