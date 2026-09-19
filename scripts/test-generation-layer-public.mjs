import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
function load(relative) {
  const cache = new Map()
  function moduleAt(file) {
    if (cache.has(file))
      return cache.get(file)
    const module = { exports: {} }
    cache.set(file, module.exports)
    const code = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
    }).outputText
    vm.runInNewContext(code, {
      module,
      exports: module.exports,
      require: (id) => {
        if (id.startsWith('~~/'))
          return moduleAt(`${resolve(root, id.slice(3))}.ts`)
        if (id.startsWith('.') || id.startsWith('/'))
          return moduleAt(`${resolve(dirname(file), id)}.ts`)
        return require(id)
      },
    }, { filename: file })
    return module.exports
  }
  return moduleAt(resolve(root, relative))
}

const { toPublicJob } = load('server/utils/generationResults.ts')

function job() {
  const now = new Date('2026-09-18T00:00:00Z')
  return {
    projectId: 'project',
    provider: 'ark',
    model: 'image-layer-splitter',
    category: 'Tools',
    task: 'Split Image Layers',
    input: { image_url: 'https://example.com/source.png' },
    requestBody: {},
    originalRequest: {},
    taskId: 'agent_layer_test',
    providerTaskId: 'ark-layer-test',
    state: 'success',
    sourceUrls: ['https://example.com/base.png', 'https://example.com/title.png'],
    resultUrls: ['https://example.com/base.png', 'https://example.com/title.png'],
    resultAssets: [],
    resultJson: JSON.stringify({
      baseWidth: 1200,
      baseHeight: 1600,
      layers: [
        { image: { url: 'https://example.com/base.png', width: 1200, height: 1600 }, z_index: 0 },
        { image: { url: 'https://example.com/title.png', width: 700, height: 180 }, z_index: 1, name: 'Title', bounding_box: { normalized: [100, 200, 900, 300] } },
      ],
    }),
    failCode: '',
    failMsg: '',
    archiveAttempts: 0,
    hiddenFromUser: false,
    deleted: false,
    createdAt: now,
    updatedAt: now,
    completeTime: now.getTime(),
  }
}

test('public generation jobs expose canonical layer placement metadata', () => {
  const result = toPublicJob(job())
  assert.equal(JSON.stringify(result.layerCanvas), JSON.stringify({ width: 1200, height: 1600 }))
  assert.equal(result.layers?.[0]?.role, 'base')
  assert.equal(result.layers?.[0]?.renderMode, 'full-canvas')
  assert.equal(result.layers?.[1]?.renderMode, 'cropped')
  assert.equal(JSON.stringify(result.layers?.[1]?.boundingBox), JSON.stringify([100, 200, 900, 300]))
  assert.equal(result.layers?.[1]?.id, 'agent_layer_test:layer:1')
})
