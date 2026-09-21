import type { IUserSkill } from '../models/userSkill'

export interface UserSkillRuntimePolicy {
  allowSpend: boolean
  maxGenerationsPerRun: number
}

export function mergeUserSkillRuntimePolicies(rows: readonly Pick<IUserSkill, 'allowSpend' | 'maxGenerationsPerRun'>[]): UserSkillRuntimePolicy | null {
  if (!rows.length)
    return null
  return {
    allowSpend: rows.every(row => row.allowSpend),
    maxGenerationsPerRun: Math.max(1, Math.min(...rows.map(row => Math.floor(Number(row.maxGenerationsPerRun) || 1)))),
  }
}

export function countGenerationCallsSinceLastUser(
  messages: readonly { role: string, tool_calls?: readonly { function?: { name?: string } }[] }[],
  isGenerationTool: (name: string) => boolean,
) {
  let count = 0
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.role === 'user')
      break
    if (message?.role !== 'assistant' || !Array.isArray(message.tool_calls))
      continue
    for (const call of message.tool_calls) {
      const name = String(call?.function?.name || '')
      if (isGenerationTool(name))
        count++
    }
  }
  return count
}

export function filterLoadedSkillIds(ids: readonly string[], builtinIds: ReadonlySet<string>, loadableUserIds: ReadonlySet<string>) {
  return ids.filter(id => builtinIds.has(id) || loadableUserIds.has(id))
}
