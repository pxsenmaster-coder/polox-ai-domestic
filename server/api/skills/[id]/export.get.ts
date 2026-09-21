import { createError } from 'h3'
import { BUILTIN_PUBLIC_AGENT_SKILLS } from '../../../../shared/utils/agentSkills'
import { isBuiltinSkillId, loadBuiltinSkill } from '../../../agent/skills'
import { ensureUserSkillsReady, serializeSkillExport } from '../../../utils/userSkills'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'Missing skill id' })
  if (isBuiltinSkillId(id)) {
    const document = loadBuiltinSkill(id)
    if (!document)
      throw createError({ statusCode: 404, statusMessage: 'Builtin skill not found' })
    return {
      format: 'polox-skill/v1',
      skill: {
        id: document.id,
        name: document.frontmatter.name,
        description: document.frontmatter.description,
        version: document.frontmatter.version,
        markdown: document.raw,
        catalog: BUILTIN_PUBLIC_AGENT_SKILLS.find(skill => skill.id === id),
      },
    }
  }
  ensureUserSkillsReady()
  const payload = serializeSkillExport(id)
  if (!payload)
    throw createError({ statusCode: 404, statusMessage: 'User skill not found' })
  return payload
})
