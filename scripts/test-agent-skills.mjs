import assert from 'node:assert/strict'
import { findComposerCommand, mergeAgentSkillCatalog, readSkillCommands, searchAgentSkills, stripSkillCommands } from '../shared/utils/agentSkills.ts'

assert.deepEqual(searchAgentSkills('').map(s => s.id), ['product-hunt-gallery', 'sketch-to-image', 'image-text-editor', 'image-layer-splitter', 'image-object-removal', 'long-form-video'])
assert.equal(searchAgentSkills('long video')[0].id, 'long-form-video')
assert.equal(searchAgentSkills('分镜')[0].id, 'long-form-video')
assert.equal(searchAgentSkills('擦除')[0].id, 'image-object-removal')
assert.equal(searchAgentSkills('HUNT product')[0].id, 'product-hunt-gallery')
assert.equal(searchAgentSkills('not-a-skill').length, 0)
for (const text of ['https://polox.ai', 'Visit https://polox.ai/gallery', '/product-hunt-gallery https://polox.ai', '/product-hunt-gallery '])
  assert.equal(findComposerCommand(text, text.length), null, text)
assert.deepEqual(findComposerCommand('/hunt', 5), { start: 0, end: 5, query: 'hunt', trigger: '/' })
assert.equal(findComposerCommand('Use @image', 10).trigger, '@')
assert.deepEqual(findComposerCommand('Try /hunt please', 9), { start: 4, end: 9, query: 'hunt', trigger: '/' })
console.log('Public skill search, slash parsing, URL exclusion and @ compatibility passed.')

const selected = '/product-hunt-gallery https://example.com'
assert.equal(readSkillCommands(selected)[0].id, 'product-hunt-gallery')
assert.equal(stripSkillCommands(selected), 'https://example.com')
assert.equal(stripSkillCommands('/product-hunt-gallery '), '')
assert.equal(readSkillCommands('https://example.com/product-hunt-gallery').length, 0)
assert.equal(stripSkillCommands('/unknown https://example.com'), '/unknown https://example.com')
console.log('Skill selection round-trip and URL preservation passed.')

assert.equal(stripSkillCommands('/product-hunt-gallery /image-text-editor /image-layer-splitter Keep this brief'), 'Keep this brief')
assert.equal(stripSkillCommands('/image-object-removal remove the watermark'), 'remove the watermark')

const userCatalog = mergeAgentSkillCatalog([{
  id: 'album-layout',
  name: 'Album layout',
  description: 'Build an editable album page.',
  source: 'user',
  enabled: true,
}, {
  id: 'image-layer-splitter',
  name: 'Shadow builtin',
  description: 'Must not replace the builtin.',
  source: 'user',
  enabled: true,
}])
assert.equal(userCatalog.filter(skill => skill.id === 'album-layout').length, 1)
assert.equal(userCatalog.filter(skill => skill.id === 'image-layer-splitter').length, 1)
assert.equal(readSkillCommands('/album-layout compose a page', userCatalog)[0].id, 'album-layout')
assert.equal(stripSkillCommands('/album-layout compose a page', userCatalog), 'compose a page')
console.log('User skill catalog merge and builtin shadow protection passed.')
