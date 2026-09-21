/* eslint-disable regexp/no-super-linear-backtracking, regexp/no-unused-capturing-group, regexp/no-useless-lazy, regexp/prefer-w, regexp/use-ignore-case -- SKILL.md uses a deliberately small, line-oriented YAML subset. */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process, { cwd as processCwd } from 'node:process'
import { fileURLToPath } from 'node:url'

function normalizeModuleUrl(value: string) {
  if (value.startsWith('file:'))
    return value
  if (/^[a-z]:[\\/]/i.test(value))
    return `file:///${value.replace(/\\/g, '/')}`
  if (value.startsWith('/'))
    return `file://${value}`
  return value
}

function moduleDirectory(value: string) {
  try {
    return dirname(fileURLToPath(normalizeModuleUrl(value)))
  }
  catch {
    // Nitro's Windows prerenderer can expose import.meta.url as `/D:/...`.
    // Keep the local source-tree fallback available for dev and test runs.
    return resolve(process.cwd(), 'server/agent')
  }
}

const skillsDir = resolve(moduleDirectory(import.meta.url), 'skills')

export type SkillSource = 'builtin' | 'user' | 'imported'
export type SkillVisibility = 'catalog' | 'hidden'

export interface SkillFrontmatter {
  id: string
  name: string
  description: string
  version: string
  source: SkillSource
  visibility: SkillVisibility
  triggers: string[]
  requires: string[]
  inputs: string[]
  safety: {
    maxGenerationsPerRun: number
    allowSpend: boolean
  }
}

export interface SkillDocument {
  id: string
  path: string
  source: SkillSource
  frontmatter: SkillFrontmatter
  body: string
  raw: string
  contentHash: string
}

const SKILL_ID_RE = /^[a-z][a-z0-9-]{1,63}$/
export const CORE_SKILL_IDS = [
  'model-planning',
  'reference-analysis',
  'prompt-rewrite',
  'single-generator',
  'result-evaluation',
  'long-form-video',
] as const
const BUILTIN_SKILL_IDS = new Set([
  ...CORE_SKILL_IDS,
  'product-hunt-gallery',
  'sketch-to-image',
  'image-text-editor',
  'image-layer-splitter',
  'image-object-removal',
  'long-form-video',
  'skill-creator',
])

export function userSkillsDir(workingDirectory = processCwd()) {
  return resolve(workingDirectory, '.data/user-skills')
}

function hashContent(raw: string) {
  return createHash('sha256').update(raw).digest('hex')
}

function stripQuotes(value: string) {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith('\'') && trimmed.endsWith('\'')))
    return trimmed.slice(1, -1)
  return trimmed
}

function parseScalar(value: string): string | number | boolean {
  const trimmed = stripQuotes(value)
  if (trimmed === 'true')
    return true
  if (trimmed === 'false')
    return false
  if (/^\d+(\.\d+)?$/.test(trimmed))
    return Number(trimmed)
  return trimmed
}

/** Parse the small YAML subset used by SKILL.md frontmatter without adding a dependency. */
export function parseSkillMarkdown(raw: string, fallbackId: string, source: SkillSource = 'builtin'): SkillDocument {
  const trimmed = raw.replace(/^\uFEFF/, '')
  let frontmatterText = ''
  let body = trimmed
  if (trimmed.startsWith('---')) {
    const end = trimmed.indexOf('\n---', 3)
    if (end >= 0) {
      frontmatterText = trimmed.slice(3, end).trim()
      body = trimmed.slice(end + 4).replace(/^\r?\n/, '')
    }
  }

  const data: Record<string, unknown> = {}
  let listKey: string | null = null
  let objectKey: string | null = null
  for (const line of frontmatterText.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#'))
      continue
    const listItem = /^(\s*)-\s+(.+)$/.exec(line)
    if (listItem && listKey) {
      const list = Array.isArray(data[listKey]) ? data[listKey] as unknown[] : []
      list.push(parseScalar(listItem[2]!))
      data[listKey] = list
      continue
    }
    const nested = /^(\s+)([A-Za-z0-9_]+):\s*(.*)$/.exec(line)
    if (nested && objectKey && nested[1]!.length >= 2) {
      const object = (data[objectKey] && typeof data[objectKey] === 'object' && !Array.isArray(data[objectKey])
        ? data[objectKey]
        : {}) as Record<string, unknown>
      object[nested[2]!] = nested[3]!.trim() === '' ? {} : parseScalar(nested[3]!)
      data[objectKey] = object
      listKey = null
      continue
    }
    const match = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line)
    if (!match)
      continue
    const key = match[1]!
    const value = match[2]!.trim()
    if (value === '' || value === '[]' || value === '{}') {
      data[key] = value === '[]' ? [] : {}
      listKey = value === '[]' || value === '' ? key : null
      objectKey = value === '{}' || value === '' ? key : null
      continue
    }
    data[key] = parseScalar(value)
    listKey = null
    objectKey = null
  }

  const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim() || fallbackId
  const paragraph = body.replace(/^#\s+.+?\r?\n/, '').trim().split(/\r?\n\r?\n/).find(block => block.trim() && !block.trim().startsWith('#')) || ''
  const description = String(data.description || paragraph.replace(/\s+/g, ' ').slice(0, 200) || heading)
  const safetyRaw = (data.safety && typeof data.safety === 'object' ? data.safety : {}) as Record<string, unknown>
  const triggers = Array.isArray(data.triggers) ? data.triggers.map(String) : [`/${fallbackId}`]
  const requires = Array.isArray(data.requires) ? data.requires.map(String) : []
  const inputs = Array.isArray(data.inputs) ? data.inputs.map(String) : []
  const frontmatter: SkillFrontmatter = {
    id: String(data.id || fallbackId),
    name: String(data.name || heading),
    description,
    version: String(data.version || '1.0.0'),
    source: (data.source as SkillSource) || source,
    visibility: (data.visibility as SkillVisibility) || (CORE_SKILL_IDS.includes(fallbackId as typeof CORE_SKILL_IDS[number]) ? 'hidden' : 'catalog'),
    triggers,
    requires,
    inputs,
    safety: {
      maxGenerationsPerRun: Number(safetyRaw.maxGenerationsPerRun ?? data.maxGenerationsPerRun ?? 3) || 3,
      allowSpend: safetyRaw.allowSpend === undefined && data.allowSpend === undefined
        ? source === 'builtin'
        : Boolean(safetyRaw.allowSpend ?? data.allowSpend),
    },
  }
  return {
    id: frontmatter.id,
    path: '',
    source: frontmatter.source,
    frontmatter,
    body: body.trim(),
    raw: trimmed.trim(),
    contentHash: hashContent(trimmed.trim()),
  }
}

function skillSourceDirectory() {
  if (existsSync(resolve(process.cwd(), 'server/agent/skills', 'single-generator.md')))
    return resolve(process.cwd(), 'server/agent/skills')
  return skillsDir
}

function readSkillFile(filePath: string, id: string, source: SkillSource): SkillDocument | null {
  try {
    const raw = readFileSync(filePath, 'utf8')
    const document = parseSkillMarkdown(raw, id, source)
    document.path = filePath
    if (source === 'builtin')
      document.id = id
    return document
  }
  catch {
    return null
  }
}

export function listBuiltinSkillDocuments(): SkillDocument[] {
  const documents: SkillDocument[] = []
  try {
    for (const file of readdirSync(skillSourceDirectory()).filter(item => item.endsWith('.md')).sort()) {
      const id = file.replace(/\.md$/, '')
      const document = readSkillFile(resolve(skillSourceDirectory(), file), id, 'builtin')
      if (document)
        documents.push(document)
    }
  }
  catch {
    // The skill directory is optional in packaged builds.
  }
  return documents
}

export function isValidSkillId(id: string) {
  return SKILL_ID_RE.test(id)
}

export function isBuiltinSkillId(id: string) {
  return BUILTIN_SKILL_IDS.has(id) || listBuiltinSkillDocuments().some(document => document.id === id)
}

export function loadBuiltinSkill(id: string) {
  return readSkillFile(resolve(skillSourceDirectory(), `${id}.md`), id, 'builtin')
}

export function loadUserSkillFile(id: string, workingDirectory = processCwd()) {
  return readSkillFile(resolve(userSkillsDir(workingDirectory), id, 'SKILL.md'), id, 'user')
}

export function loadSkillDocument(id: string, preferUser = false) {
  if (preferUser) {
    const user = loadUserSkillFile(id)
    if (user)
      return user
  }
  const builtin = loadBuiltinSkill(id)
  if (builtin)
    return builtin
  return preferUser ? null : loadUserSkillFile(id)
}

const FIRST_SKILLS = ['reference-analysis', 'prompt-rewrite', 'result-evaluation', 'long-form-video']

export function loadAgentSkills() {
  const blocks: string[] = []
  for (const name of FIRST_SKILLS) {
    try {
      const text = readFileSync(resolve(skillsDir, `${name}.md`), 'utf8').trim()
      if (text)
        blocks.push(text)
    }
    catch {
      // Skill files are optional at runtime.
    }
  }
  try {
    const extra = readdirSync(skillsDir).filter(file => file.endsWith('.md') && !FIRST_SKILLS.includes(file.replace(/\.md$/, '')))
    for (const file of extra.sort()) {
      const text = readFileSync(resolve(skillsDir, file), 'utf8').trim()
      if (text)
        blocks.push(text)
    }
  }
  catch {
    // No skills directory.
  }
  return blocks
}

export function skillsPromptBlock() {
  const skills = loadAgentSkills()
  if (!skills.length)
    return ''
  return `\n\n## Skills\nThese operating notes shape how you think. They do not spend money. Only tools spend money.\n\n${skills.join('\n\n')}`
}
