import assert from 'node:assert/strict'
import { countGenerationCallsSinceLastUser, filterLoadedSkillIds, mergeUserSkillRuntimePolicies } from '../server/utils/userSkillRuntime.ts'

const policy = mergeUserSkillRuntimePolicies([
  { allowSpend: true, maxGenerationsPerRun: 4 },
  { allowSpend: true, maxGenerationsPerRun: 2 },
])
assert.deepEqual(policy, { allowSpend: true, maxGenerationsPerRun: 2 })
assert.equal(mergeUserSkillRuntimePolicies([{ allowSpend: false, maxGenerationsPerRun: 4 }])?.allowSpend, false)

const messages = [
  { role: 'user' },
  { role: 'assistant', tool_calls: [{ function: { name: 'generate_image' } }, { function: { name: 'ask_user' } }] },
  { role: 'tool' },
  { role: 'assistant', tool_calls: [{ function: { name: 'model_seedream_5_pro' } }] },
]
assert.equal(countGenerationCallsSinceLastUser(messages, name => name === 'generate_image' || name.startsWith('model_')), 2)
assert.equal(countGenerationCallsSinceLastUser([...messages, { role: 'user' }, { role: 'assistant' }], () => true), 0)

assert.deepEqual(
  filterLoadedSkillIds(['builtin', 'disabled', 'published'], new Set(['builtin']), new Set(['published'])),
  ['builtin', 'published'],
)

console.log('User skill runtime policy, generation budget, and stale-session filtering passed.')
