import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')

function load(relative, mocks = {}, globals = {}) {
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
      URL,
      Buffer,
      AbortSignal,
      Error,
      crypto: { randomUUID: () => 'generated-id' },
      createError: details => Object.assign(new Error(details.statusMessage), details),
      ...globals,
      require: (id) => {
        if (id in mocks)
          return mocks[id]
        if (id.startsWith('.') || id.startsWith('~~/')) {
          const target = id.startsWith('~~/') ? resolve(root, id.slice(3)) : resolve(dirname(file), id)
          return moduleAt(`${target}.ts`)
        }
        return require(id)
      },
    }, { filename: file })
    return module.exports
  }
  return moduleAt(resolve(root, relative))
}

test('Ark schemas validate text-to-image and image-to-image inputs', () => {
  const api = load('server/utils/arkInput.ts')
  const t2i = api.sanitizeArkInput('ark/seedream/5-pro-text-to-image', { prompt: 'A paper-cut album cover' })
  assert.equal(t2i.size, '2K')
  assert.equal(t2i.watermark, false)
  assert.throws(() => api.sanitizeArkInput('ark/seedream/5-pro-text-to-image', { prompt: 'A', unknown: true }), /Unknown Ark parameter/)
  assert.throws(() => api.sanitizeArkInput('ark/seedream/5-pro-image-to-image', { prompt: 'Edit this' }), /image_urls/)
  const i2i = api.sanitizeArkInput('ark/seedream/5-pro-image-to-image', { prompt: 'Keep the subject, change the style', image_urls: ['https://example.com/input.png'] })
  assert.deepEqual(i2i.image_urls, ['https://example.com/input.png'])
})

test('Ark task uses the configured model and returns image URLs without a paid polling loop', async () => {
  let request
  const api = load('server/utils/arkGenerate.ts', {
    './serviceSettings': {
      readServiceSettings: () => ({ arkApiKey: 'ark-secret', arkBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3', arkModel: 'custom-seedream-5-pro' }),
    },
    './localMedia': { readStoredMedia: async url => url.startsWith('http://localhost:3001/media/') ? { bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' } : null },
    './httpError': { toUpstreamApiError: error => error },
  }, {
    fetch: async (url, init) => {
      request = { url, init }
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'ark-request-1', data: [{ url: 'https://cdn.example.com/result.png' }] }) }
    },
  })
  const result = await api.createArkTask('ark/seedream/5-pro-text-to-image', { prompt: 'A paper-cut album cover', image_urls: ['http://localhost:3001/media/ref.png'], size: '4K', watermark: false })
  assert.equal(request.url, 'https://ark.cn-beijing.volces.com/api/v3/images/generations')
  const body = JSON.parse(request.init.body)
  assert.equal(body.model, 'custom-seedream-5-pro')
  assert.equal(body.image[0], 'data:image/png;base64,AQID')
  assert.equal(result.requestId, 'ark-request-1')
  assert.deepEqual(Array.from(result.urls), ['https://cdn.example.com/result.png'])
})
