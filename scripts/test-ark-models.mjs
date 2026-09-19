import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
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
  assert.equal(body.stream, false)
  assert.equal(body.image[0], 'data:image/png;base64,AQID')
  assert.equal(result.requestId, 'ark-request-1')
  assert.deepEqual(Array.from(result.urls), ['https://cdn.example.com/result.png'])
})

test('Ark task preserves a provider status URL and can refresh an asynchronous response', async () => {
  let calls = 0
  const api = load('server/utils/arkGenerate.ts', {
    './serviceSettings': {
      readServiceSettings: () => ({ arkApiKey: 'ark-secret', arkBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3', arkModel: 'custom-seedream-5-pro' }),
    },
    './localMedia': { readStoredMedia: async () => null },
    './httpError': { toUpstreamApiError: error => error },
  }, {
    fetch: async (url) => {
      calls++
      if (String(url).endsWith('/images/generations')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'ark-pending-1', status: 'generating', status_url: 'https://ark.cn-beijing.volces.com/api/v3/tasks/ark-pending-1' }) }
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'ark-pending-1', status: 'done', data: [{ url: 'https://cdn.example.com/async.png' }] }) }
    },
  })
  const created = await api.createArkTask('ark/seedream/5-pro-text-to-image', { prompt: 'A paper-cut album cover' })
  assert.equal(created.state, 'pending')
  assert.equal(created.statusUrl, 'https://ark.cn-beijing.volces.com/api/v3/tasks/ark-pending-1')
  const completed = await api.pollArkTask(created.requestId, { statusUrl: created.statusUrl, waitForResult: false })
  assert.equal(completed.state, 'complete')
  assert.deepEqual(Array.from(completed.urls), ['https://cdn.example.com/async.png'])
  assert.equal(calls, 2)
})

test('Ark empty success responses expose a safe diagnostic instead of raw provider content', async () => {
  const api = load('server/utils/arkGenerate.ts', {
    './serviceSettings': {
      readServiceSettings: () => ({ arkApiKey: 'ark-secret', arkBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3', arkModel: 'custom-seedream-5-pro' }),
    },
    './localMedia': { readStoredMedia: async () => null },
    './httpError': { toUpstreamApiError: error => error },
  }, {
    fetch: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ id: 'ark-empty-1', data: [] }) }),
  })
  await assert.rejects(
    () => api.createArkTask('ark/seedream/5-pro-text-to-image', { prompt: 'A paper-cut album cover' }),
    error => error.code === 'ARK_EMPTY_RESULT' && error.data?.diagnostics?.requestId === 'ark-empty-1' && error.data?.diagnostics?.resultUrlCount === 0,
  )
})

test('Ark normalizes image URL arrays from compatible response envelopes', async () => {
  const api = load('server/utils/arkGenerate.ts', {
    './serviceSettings': {
      readServiceSettings: () => ({ arkApiKey: 'ark-secret', arkBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3', arkModel: 'custom-seedream-5-pro' }),
    },
    './localMedia': { readStoredMedia: async () => null },
    './httpError': { toUpstreamApiError: error => error },
  }, {
    fetch: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ data: { image_urls: ['https://cdn.example.com/array.png'] } }) }),
  })
  const result = await api.createArkTask('ark/seedream/5-pro-text-to-image', { prompt: 'A paper-cut album cover' })
  assert.deepEqual(Array.from(result.urls), ['https://cdn.example.com/array.png'])
})

test('Ark Seedream 5.0 Pro layer decomposition normalizes data into editable layers', async () => {
  let request
  const api = load('server/utils/arkGenerate.ts', {
    './serviceSettings': {
      readServiceSettings: () => ({ arkApiKey: 'ark-secret', arkBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3', arkModel: 'doubao-seedream-5-0-pro-260628' }),
    },
    './localMedia': { readStoredMedia: async url => url.startsWith('http://localhost:3001/media/') ? { bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' } : null },
    './httpError': { toUpstreamApiError: error => error },
  }, {
    fetch: async (url, init) => {
      request = { url, init }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          id: 'ark-layer-request-1',
          data: [
            { url: 'https://cdn.example.com/base.png', size: '1200x1600', z_index: 0 },
            { url: 'https://cdn.example.com/title.png', size: '700x180', z_index: 1, name: 'Title', description: 'Editable title', bounding_box: { normalized: [100, 200, 900, 300] } },
          ],
        }),
      }
    },
  })
  const result = await api.createArkLayerTask({
    image_url: 'http://localhost:3001/media/source.png',
    prompt: 'Separate the title from the background',
    image_size: 'auto_2K',
  })
  assert.equal(request.url, 'https://ark.cn-beijing.volces.com/api/v3/images/generations')
  const body = JSON.parse(request.init.body)
  assert.equal(body.model, 'doubao-seedream-5-0-pro-260628')
  assert.equal(body.layer_decomposition, true)
  assert.equal(body.size, '2K')
  assert.equal(body.image, 'data:image/png;base64,AQID')
  assert.deepEqual(Array.from(result.urls), ['https://cdn.example.com/base.png', 'https://cdn.example.com/title.png'])
  assert.equal(result.payload.layers[1].name, 'Title')
  assert.equal(result.payload.layers[1].z_index, 1)
})

test('Ark layer decomposition accepts the alternate top-level layers response shape', async () => {
  const api = load('server/utils/arkGenerate.ts', {
    './serviceSettings': {
      readServiceSettings: () => ({ arkApiKey: 'ark-secret', arkBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3', arkModel: 'doubao-seedream-5-0-pro-260628' }),
    },
    './localMedia': { readStoredMedia: async () => null },
    './httpError': { toUpstreamApiError: error => error },
  }, {
    fetch: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        id: 'ark-layer-request-2',
        layers: [
          { image: { url: 'https://cdn.example.com/base.png', width: 1200, height: 1600 }, z_index: 0 },
          { image: { url: 'https://cdn.example.com/object.png', width: 400, height: 500 }, zIndex: 1, name: 'Object' },
        ],
      }),
    }),
  })
  const result = await api.createArkLayerTask({ image_url: 'https://cdn.example.com/source.png' })
  assert.deepEqual(Array.from(result.urls), ['https://cdn.example.com/base.png', 'https://cdn.example.com/object.png'])
  assert.equal(result.payload.layers[1].name, 'Object')
  assert.equal(result.payload.layers[1].image.width, 400)
})

test('Ark layer decomposition rejects a non-editable response contract', async () => {
  const api = load('server/utils/arkGenerate.ts', {
    './serviceSettings': {
      readServiceSettings: () => ({ arkApiKey: 'ark-secret', arkBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3', arkModel: 'doubao-seedream-5-0-pro-260628' }),
    },
    './localMedia': { readStoredMedia: async () => null },
    './httpError': { toUpstreamApiError: error => error },
  }, {
    fetch: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: 'ark-layer-invalid', data: [{ url: 'https://cdn.example.com/flat.png' }] }),
    }),
  })
  await assert.rejects(() => api.createArkLayerTask({ image_url: 'https://cdn.example.com/source.png' }), /Invalid image layer result/)
})

test('generic image generation prefers tested Ark over fal', async () => {
  let request
  const created = []
  const api = load('server/agent/modelGeneration.ts', {
    '../models/generationJob': { GenerationJob: { findOne: async () => null } },
    '../utils/arkGenerate': { createArkTask: async (model, input) => {
      request = { model, input }
      return { requestId: 'ark-request-2', urls: ['https://cdn.example.com/ark.png'] }
    } },
    '../utils/falGenerate': { createFalTask: async () => { throw new Error('fal should not be called') } },
    '../utils/falInput': { falEndpoint: model => model },
    '../utils/generateInput': { sanitizeGenerateInput: (_model, input) => input },
    '../utils/serviceSettings': { readServiceSettings: () => ({ arkApiKey: 'ark-secret', arkOk: true }) },
    './env': { agentEnv: { falApiKey: 'fal-secret' } },
  })
  const result = await api.generatePreferredImage({ prompt: 'A paper-cut album cover', aspect_ratio: '1:1', resolution: '2K', input_urls: [] }, undefined, id => created.push(id))
  assert.equal(request.model, 'ark/seedream/5-pro-text-to-image')
  assert.equal(JSON.stringify(request.input), JSON.stringify({ prompt: 'A paper-cut album cover', size: '2K', watermark: false }))
  assert.equal(result.taskId, 'ark-request-2')
  assert.deepEqual(created, ['ark-request-2'])
})
