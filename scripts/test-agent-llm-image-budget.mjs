import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const sharp = require('sharp')

function loadLlm({ settings, fetch }) {
  const file = resolve(root, 'server/agent/llm.ts')
  const module = { exports: {} }
  const mocks = {
    '../utils/falFiles': { falReadableUrl: async url => `https://fal.example/${encodeURIComponent(url)}` },
    '../utils/llmProviders': {
      llmAuthHeaders: () => ({ Authorization: 'Bearer domestic-key' }),
      llmChatCompletionsUrl: (provider, baseUrl) => `${baseUrl}/chat/completions?provider=${provider}`,
      llmProviderPreset: provider => ({ label: provider }),
    },
    '../utils/localMedia': { readStoredMedia: async (url) => url.startsWith('local://') ? { bytes: settings.imageBytes, mime: 'image/png' } : null },
    '../utils/serviceSettings': { readServiceSettings: () => settings },
    './env': { agentEnv: { llmApiKey: 'domestic-key' } },
  }
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
  }).outputText
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    Buffer,
    Error,
    URL,
    fetch,
    console,
    require: id => id in mocks ? mocks[id] : require(id),
  }, { filename: file })
  return module.exports
}

async function sourceImage() {
  const svg = Buffer.from(`<svg width="2200" height="1800" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"><stop stop-color="#132b56"/><stop offset="1" stop-color="#ef9860"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="1100" cy="900" r="640" fill="#eed58b"/></svg>`)
  return sharp(svg).png().toBuffer()
}

function userImageMessage() {
  return [{ role: 'user', content: [{ type: 'text', text: 'Describe this image' }, { type: 'image_url', image_url: { url: 'local://source-image' } }] }]
}

test('local image inputs are resized to WebP while preserving message content', async () => {
  const imageBytes = await sourceImage()
  const llm = loadLlm({ settings: { llmProvider: 'deepseek', llmBaseUrl: 'https://api.deepseek.com/v1', llmModel: 'deepseek-v4-flash-vision-exp', imageBytes }, fetch: globalThis.fetch })
  const messages = await llm.providerMessages(userImageMessage())
  const url = messages[0].content[1].image_url.url
  assert.match(url, /^data:image\/webp;base64,/)
  assert.equal(messages[0].content[0].text, 'Describe this image')
  const decoded = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')
  const metadata = await sharp(decoded).metadata()
  assert.ok(metadata.width <= 1536)
  assert.ok(metadata.height <= 1536)
  assert.equal(metadata.format, 'webp')
})

test('a 413 retries once with smaller images without changing the domestic provider route', async () => {
  const imageBytes = await sourceImage()
  const requests = []
  const fetch = async (url, init) => {
    requests.push({ url, init, body: JSON.parse(init.body) })
    if (requests.length === 1)
      return { ok: false, status: 413, text: async () => 'payload too large' }
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '已收到图片' } }] }) }
  }
  const llm = loadLlm({ settings: { llmProvider: 'deepseek', llmBaseUrl: 'https://api.deepseek.com/v1', llmModel: 'deepseek-v4-flash-vision-exp', imageBytes }, fetch })
  const answer = await llm.completeText({ messages: userImageMessage(), maxTokens: 16 })
  assert.equal(answer, '已收到图片')
  assert.equal(requests.length, 2)
  assert.match(requests[0].url, /^https:\/\/api\.deepseek\.com\/v1\/chat\/completions\?provider=deepseek$/)
  assert.equal(requests[0].init.headers.Authorization, 'Bearer domestic-key')
  assert.equal(requests[0].body.model, 'deepseek-v4-flash-vision-exp')
  const first = requests[0].body.messages[0].content[1].image_url.url
  const second = requests[1].body.messages[0].content[1].image_url.url
  assert.ok(Buffer.byteLength(first) > Buffer.byteLength(second))
})

test('configured fal image handoff is preserved and does not inline local media', async () => {
  const imageBytes = await sourceImage()
  const llm = loadLlm({ settings: { llmProvider: 'glm', llmBaseUrl: 'https://open.bigmodel.cn/api/paas/v4', llmModel: 'glm-5.3-flash', falKey: 'fal-key', imageBytes }, fetch: globalThis.fetch })
  const messages = await llm.providerMessages(userImageMessage())
  assert.match(messages[0].content[1].image_url.url, /^https:\/\/fal\.example\//)
})
