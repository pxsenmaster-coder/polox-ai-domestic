// Explicit public catalog: internal operating skills stay out of the picker.
export const PUBLIC_AGENT_SKILLS = [
  {
    id: 'product-hunt-gallery',
    icon: 'lucide:gallery-horizontal-end',
    name: 'Product Hunt gallery',
    description: 'Create consistent Product Hunt launch images from your website or product details.',
    keywords: 'product hunt gallery launch exhibition brand marketing',
  },
  {
    id: 'sketch-to-image',
    icon: 'lucide:pencil-ruler',
    name: 'Sketch to Image',
    description: 'Draw a sketch, add text, and turn your idea into a finished image.',
    keywords: 'sketch drawing image 草图 绘画',
  },
  {
    id: 'image-text-editor',
    icon: 'lucide:text-cursor-input',
    name: 'Image Text Editor',
    description: 'Edit text in images while preserving the original fonts and image details.',
    keywords: 'image text editor typography 图片 文字 编辑',
  },
  {
    id: 'image-layer-splitter',
    icon: 'lucide:layers',
    name: 'Image Layer Splitter',
    description: 'Draw boxes around objects to extract them as separate transparent PNG layers.',
    keywords: 'image layer splitter transparent png 图层 拆分',
  },
  {
    id: 'image-object-removal',
    icon: 'lucide:eraser',
    name: 'Image Object Removal',
    description: 'Remove unwanted objects from an image with precise boxes or paint masks.',
    keywords: 'image object removal erase remove object watermark 修复 擦除 移除',
  },
  {
    id: 'long-form-video',
    icon: 'lucide:clapperboard',
    name: 'Long-form video',
    description: 'Plan a storyboard and produce a multi-shot film from stills, clips, and concat.',
    keywords: 'long-form video film storyboard short film 长视频 短片 分镜',
  },
] as const

export const BUILTIN_PUBLIC_AGENT_SKILLS = PUBLIC_AGENT_SKILLS

export interface CatalogAgentSkill {
  id: string
  name: string
  description: string
  keywords?: string
  icon?: string
  cover?: string
  coverAlt?: string
  placeholder?: string
  source?: 'builtin' | 'user' | 'imported'
  enabled?: boolean
}

/** Merge user-created skills without allowing them to shadow built-in IDs. */
export function mergeAgentSkillCatalog(userSkills: CatalogAgentSkill[] = []): CatalogAgentSkill[] {
  const builtin = PUBLIC_AGENT_SKILLS.map(skill => ({ ...skill, source: 'builtin' as const, enabled: true }))
  const builtinIds = new Set<string>(builtin.map(skill => skill.id))
  return [...builtin, ...userSkills.filter(skill => skill.enabled !== false && !builtinIds.has(skill.id))]
}

export function searchAgentSkills(query: string, skills: readonly CatalogAgentSkill[] = PUBLIC_AGENT_SKILLS) {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  return skills.filter(skill => terms.every(term => `${skill.id} ${skill.name} ${skill.description} ${skill.keywords || ''}`.toLowerCase().includes(term)))
}

export function findComposerCommand(text: string, caret: number, skills: readonly CatalogAgentSkill[] = PUBLIC_AGENT_SKILLS) {
  const before = text.slice(0, caret)
  const match = /(?:^|\s)([@/])([^@/\n]*)$/.exec(before)
  if (match?.[1] === '/' && skills.some(skill => match[2]?.startsWith(`${skill.id} `)))
    return null
  return match ? { start: caret - match[2]!.length - 1, end: caret, query: match[2]!, trigger: match[1] as '@' | '/' } : null
}

export function readSkillCommands(text: string, skills: readonly CatalogAgentSkill[] = PUBLIC_AGENT_SKILLS) {
  const ids = new Set([...text.matchAll(/(?:^|\s)\/([a-z][a-z0-9-]{1,63})(?=\s|$)/g)].map(match => match[1]))
  return skills.filter(skill => ids.has(skill.id))
}

export function stripSkillCommands(text: string, skills: readonly CatalogAgentSkill[] = PUBLIC_AGENT_SKILLS) {
  const ids = new Set(skills.map(skill => skill.id))
  return text.replace(/(?<!\S)\/([a-z0-9-]+)(?=\s|$)[ \t]*/g, (match, id) =>
    ids.has(id) ? '' : match)
}

export function composerPlaceholderForSkills(skills: readonly { id: string, placeholder?: string }[]) {
  for (const skill of skills) {
    if (skill.placeholder)
      return skill.placeholder
  }
  return skills.length ? 'What do you want to create next?' : ''
}
