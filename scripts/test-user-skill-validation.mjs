import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const root = resolve(import.meta.dirname, '..')
const require = createRequire(import.meta.url)
const cache = new Map()
function load(file) {
  if (cache.has(file))
    return cache.get(file)
  const module = { exports: {} }
  const source = readFileSync(file, 'utf8').replaceAll('import.meta.url', JSON.stringify(`file://${file.replaceAll('\\', '/')}`))
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: (id) => {
      if (id.startsWith('.') || id.startsWith('~~/')) {
        const target = id.startsWith('~~/') ? resolve(root, id.slice(3)) : resolve(dirname(file), id)
        return load(`${target}.ts`)
      }
      return require(id)
    },
  }, { filename: file })
  cache.set(file, module.exports)
  return module.exports
}

const { parseSkillMarkdown } = load(resolve(root, 'server/agent/skills.ts'))
const { validateUserSkillMarkdown } = load(resolve(root, 'server/utils/skillValidation.ts'))

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
assert.equal(JSON.stringify(parsed.frontmatter.requires), JSON.stringify(['ask_user', 'generate_image']))
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
