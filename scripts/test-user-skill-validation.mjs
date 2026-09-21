import assert from 'node:assert/strict'
import { parseSkillMarkdown } from '../server/agent/skills.ts'
import { validateUserSkillMarkdown } from '../server/utils/skillValidation.ts'

const valid = `---
id: album-layout
name: Album layout
description: Create an editable album page.
version: 1.0.0
triggers:
  - /album-layout
requires:
  - ask_user
  - generate_image
safety:
  maxGenerationsPerRun: 4
  allowSpend: false
---
# Album layout

Plan the page, then generate the requested image layers.
`

const parsed = parseSkillMarkdown(valid, 'draft-skill', 'user')
assert.equal(parsed.frontmatter.id, 'album-layout')
assert.deepEqual(parsed.frontmatter.requires, ['ask_user', 'generate_image'])
assert.equal(parsed.frontmatter.safety.maxGenerationsPerRun, 4)
const result = validateUserSkillMarkdown(valid)
assert.equal(result.ok, true)

const builtin = validateUserSkillMarkdown(valid
  .replace('id: album-layout', 'id: image-layer-splitter')
  .replace('/album-layout', '/image-layer-splitter'))
assert.equal(builtin.ok, false)
assert.match(builtin.issues.map(issue => issue.message).join('\n'), /reserved by a builtin/)

const unknownTool = validateUserSkillMarkdown(valid.replace('  - generate_image', '  - arbitrary_tool'))
assert.equal(unknownTool.ok, false)
assert.match(unknownTool.issues.map(issue => issue.message).join('\n'), /Unregistered tool/)

console.log('User skill markdown parsing and L1 validation passed.')
