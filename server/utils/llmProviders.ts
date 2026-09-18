import type { LlmProvider } from '../../shared/utils/llmProviders'
import { LLM_PROVIDER_PRESETS } from '../../shared/utils/llmProviders'

export function llmProviderPreset(provider: LlmProvider) {
  return LLM_PROVIDER_PRESETS[provider]
}

/**
 * Keep the configurable endpoint limited to the provider's official HTTPS
 * hosts. This prevents the local settings dialog from becoming an SSRF proxy.
 */
export function normalizeLlmBaseUrl(provider: LlmProvider, raw: string) {
  const value = raw.trim() || llmProviderPreset(provider).baseUrl
  let url: URL
  try {
    url = new URL(value)
  }
  catch {
    throw new Error(`${llmProviderPreset(provider).label} base URL is invalid.`)
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error(`${llmProviderPreset(provider).label} base URL must be an HTTPS endpoint.`)
  const host = url.hostname.toLowerCase()
  const allowed = provider === 'openrouter'
    ? host === 'openrouter.ai'
    : provider === 'deepseek'
      ? host === 'api.deepseek.com'
      : provider === 'mimo'
        ? host === 'api.xiaomimimo.com' || host === 'token-plan-cn.xiaomimimo.com' || host.endsWith('.xiaomimimo.com')
        : host === 'open.bigmodel.cn'
  if (!allowed)
    throw new Error(`${llmProviderPreset(provider).label} base URL must use its official API host.`)
  return url.href.replace(/\/$/, '')
}

export function llmChatCompletionsUrl(provider: LlmProvider, baseUrl: string) {
  return `${normalizeLlmBaseUrl(provider, baseUrl)}/chat/completions`
}

export function llmAuthHeaders(provider: LlmProvider, apiKey: string): Record<string, string> {
  return provider === 'mimo'
    ? { 'api-key': apiKey }
    : { Authorization: `Bearer ${apiKey}` }
}
