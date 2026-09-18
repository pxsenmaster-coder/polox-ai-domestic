import type { ServiceSettings } from './serviceSettings'
import { createFalClient } from '@fal-ai/client'
import { llmAuthHeaders, llmChatCompletionsUrl, llmProviderPreset } from './llmProviders'
import { publicServiceStatus, readServiceSettings, writeServiceSettings } from './serviceSettings'

const DEFAULT_ARK_ENDPOINT = 'https://ark.cn-beijing.volces.com/api/v3'

async function checkLlm(settings: ServiceSettings) {
  const provider = settings.llmProvider
  const preset = llmProviderPreset(provider)
  if (!settings.llmApiKey)
    return { ok: false, message: `${preset.label} API key is not configured.` }
  try {
    const headers = {
      ...llmAuthHeaders(provider, settings.llmApiKey),
      'Content-Type': 'application/json',
    }
    if (provider === 'openrouter') {
      Object.assign(headers, {
        'HTTP-Referer': 'https://polox.ai',
        'X-Title': 'PoloX Agent Lab',
      })
    }
    const response = await fetch(llmChatCompletionsUrl(provider, settings.llmBaseUrl), {
      method: 'POST',
      signal: AbortSignal.timeout(20000),
      headers,
      body: JSON.stringify({
        model: settings.llmModel,
        messages: [{ role: 'user', content: 'Reply OK.' }],
        ...(provider === 'mimo' ? { max_completion_tokens: 8 } : { max_tokens: 8 }),
        stream: false,
      }),
    })
    const payload = await response.json()
    if (!response.ok || payload.error || !Array.isArray(payload.choices) || !payload.choices.length)
      return { ok: false, message: `${preset.label} test failed (${response.status}). Check your key, model name and available balance.` }
    return { ok: true, message: `${preset.label} model responded successfully.` }
  }
  catch (error) {
    return {
      ok: false,
      message: error instanceof Error && /base URL/i.test(error.message)
        ? error.message
        : `${preset.label} could not be reached. Check your connection and try again.`,
    }
  }
}
async function checkFal(settings: ServiceSettings) {
  if (settings.arkApiKey)
    return { ok: false, skipped: true, message: 'fal check skipped; Ark is configured as the primary image provider.' }
  if (!settings.falKey)
    return { ok: false, message: 'fal API key is not configured.' }
  try {
    const client = createFalClient({ credentials: settings.falKey })
    // Authenticate against the model queue without creating a paid generation.
    const response = await fetch('https://queue.fal.run/openai/gpt-image-2/requests/00000000-0000-0000-0000-000000000000/status', {
      headers: { Authorization: `Key ${settings.falKey}` },
      signal: AbortSignal.timeout(15000),
    })
    if (response.status !== 404)
      return { ok: false, message: `fal authentication failed (${response.status}). Check your API key and account.` }
    // A successful authenticated CDN upload confirms the key, rather than trusting a 404 alone.
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF9kAAAAASUVORK5CYII='), c => c.charCodeAt(0))
    const url = await client.storage.upload(new File([bytes], 'connection-test.png', { type: 'image/png' }))
    const file = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!file.ok)
      return { ok: false, message: 'fal upload succeeded but its CDN could not be reached.' }
    await file.arrayBuffer()
    return { ok: true, message: 'fal authentication and file upload succeeded.' }
  }
  catch { return { ok: false, message: 'fal test failed. Check your API key, account and connection.' } }
}
async function boundedFal(settings: ServiceSettings) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([checkFal(settings), new Promise<{ ok: boolean, message: string }>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, message: 'fal connection test timed out. Please try again.' }), 45000)
    })])
  }
  finally { clearTimeout(timer) }
}
function arkBaseUrl(settings: ServiceSettings) {
  const value = settings.arkBaseUrl.trim() || DEFAULT_ARK_ENDPOINT
  let url: URL
  try {
    url = new URL(value)
  }
  catch {
    throw new Error('Ark base URL is invalid.')
  }
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.volces.com'))
    throw new Error('Ark base URL must be an HTTPS volcengine endpoint.')
  return url.href.replace(/\/$/, '')
}
async function checkArk(settings: ServiceSettings) {
  if (!settings.arkApiKey)
    return { ok: false, message: 'Ark API key is not configured.' }
  try {
    const response = await fetch(`${arkBaseUrl(settings)}/models`, {
      headers: { Authorization: `Bearer ${settings.arkApiKey}` },
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok)
      return { ok: false, message: `Ark authentication failed (${response.status}). Check the API key and region.` }
    return { ok: true, message: 'Ark API key authenticated successfully.' }
  }
  catch (error) {
    return { ok: false, message: error instanceof Error && error.message.includes('base URL') ? error.message : 'Ark could not be reached. Check the base URL and try again.' }
  }
}
export async function testServiceConnections(settings: ServiceSettings) {
  const [llm, fal, ark] = await Promise.all([checkLlm(settings), boundedFal(settings), checkArk(settings)])
  if (readServiceSettings().revision !== settings.revision)
    return { ...publicServiceStatus(), llm, openRouter: llm, fal, ark, superseded: true }
  const checked = {
    ...settings,
    llmOk: llm.ok,
    openRouterOk: settings.llmProvider === 'openrouter' && llm.ok,
    falOk: fal.ok,
    arkOk: ark.ok,
    checkedAt: new Date().toISOString(),
  }
  writeServiceSettings(checked)
  return { ...publicServiceStatus(checked), llm, openRouter: llm, fal, ark, superseded: false }
}
