import { BUILTIN_PUBLIC_AGENT_SKILLS } from '../../../shared/utils/agentSkills'
import { listBuiltinSkillDocuments } from '../../agent/skills'
import { ensureUserSkillsReady, listUserSkillRecords, toPublicUserSkill } from '../../utils/userSkills'

export default defineEventHandler(async () => {
  ensureUserSkillsReady()
  const userSkills = (await listUserSkillRecords()).map(row => toPublicUserSkill(row))
  const builtinMeta = listBuiltinSkillDocuments().map(document => ({
    id: document.id,
    name: document.frontmatter.name,
    description: document.frontmatter.description,
    visibility: document.frontmatter.visibility,
    triggers: document.frontmatter.triggers,
    source: 'builtin' as const,
  }))
  return {
    builtinCatalog: BUILTIN_PUBLIC_AGENT_SKILLS,
    builtinMeta,
    userSkills,
    catalog: [
      ...BUILTIN_PUBLIC_AGENT_SKILLS.map(skill => ({ ...skill, source: 'builtin' as const, enabled: true })),
      ...userSkills.filter(skill => skill.enabled && skill.status !== 'draft').map(skill => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        keywords: skill.keywords || '',
        icon: 'lucide:sparkles',
        source: skill.source,
        enabled: true,
      })),
    ],
    registeredAt: new Date().toISOString(),
  }
})
