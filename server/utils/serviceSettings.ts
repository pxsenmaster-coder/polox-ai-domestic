import type { LlmProvider } from '../../shared/utils/llmProviders'
import { randomUUID } from 'node:crypto'
import { DEFAULT_ARK_BASE_URL, DEFAULT_ARK_SEEDREAM_MODEL } from '../../shared/utils/arkSeedream'
import { normalizeLlmProvider } from '../../shared/utils/llmProviders'
import { llmProviderPreset } from './llmProviders'
import { connectDatabase } from './sqlite'

export interface ServiceSettings {
  llmProvider: LlmProvider
  llmApiKey: string
  llmBaseUrl: string
  llmModel: string
  /** Legacy aliases kept so existing local databases and callers migrate safely. */
  openRouterKey: string
  openRouterModel: string
  falKey: string
  arkApiKey: string
  arkBaseUrl: string
  arkModel: string
  revision: string
  openRouterOk: boolean
  llmOk: boolean
  falOk: boolean
  arkOk: boolean
  checkedAt: string
}
export const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash-vision-exp'
export function readServiceSettings(): ServiceSettings {
  const db = connectDatabase()
  db.exec('CREATE TABLE IF NOT EXISTS local_service_settings (id INTEGER PRIMARY KEY CHECK (id = 1), body TEXT NOT NULL)')
  const row = db.prepare('SELECT body FROM local_service_settings WHERE id = 1').get()
  const parsed = row ? JSON.parse(String(row.body)) as Partial<ServiceSettings> : {}
  const hasProvider = typeof parsed.llmProvider === 'string'
  const llmProvider = normalizeLlmProvider(parsed.llmProvider)
  const preset = llmProviderPreset(llmProvider)
  const llmApiKey = String(parsed.llmApiKey || parsed.openRouterKey || '')
  const llmModel = String(parsed.llmModel || (!hasProvider ? parsed.openRouterModel : '') || preset.model)
  const llmBaseUrl = String(parsed.llmBaseUrl || preset.baseUrl)
  // Keep settings forward-compatible when an existing local database predates
  // the generic LLM provider fields and the Ark integration.
  return {
    llmProvider,
    llmApiKey,
    llmBaseUrl,
    llmModel,
    openRouterKey: llmApiKey,
    openRouterModel: llmModel,
    falKey: String(parsed.falKey || ''),
    arkApiKey: String(parsed.arkApiKey || ''),
    arkBaseUrl: String(parsed.arkBaseUrl || DEFAULT_ARK_BASE_URL),
    arkModel: String(parsed.arkModel || DEFAULT_ARK_SEEDREAM_MODEL),
    revision: String(parsed.revision || ''),
    openRouterOk: Boolean(parsed.openRouterOk),
    llmOk: Boolean(parsed.llmOk),
    falOk: Boolean(parsed.falOk),
    arkOk: Boolean(parsed.arkOk),
    checkedAt: String(parsed.checkedAt || ''),
  }
}
export function writeServiceSettings(settings: ServiceSettings) {
  readServiceSettings()
  connectDatabase().prepare('INSERT INTO local_service_settings(id, body) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body').run(JSON.stringify(settings))
}
export function updateServiceSettings(input: {
  llmProvider?: string
  llmApiKey?: string
  llmBaseUrl?: string
  llmModel?: string
  openRouterKey?: string
  openRouterModel?: string
  falKey?: string
  arkApiKey?: string
  arkBaseUrl?: string
  arkModel?: string
}) {
  const current = readServiceSettings()
  const llmProvider = normalizeLlmProvider(input.llmProvider ?? current.llmProvider)
  const providerChanged = llmProvider !== current.llmProvider
  const preset = llmProviderPreset(llmProvider)
  const providedKey = input.llmApiKey === undefined ? input.openRouterKey : input.llmApiKey
  const llmApiKey = providedKey === undefined ? current.llmApiKey : providedKey.trim()
  const providedModel = input.llmModel === undefined ? input.openRouterModel : input.llmModel
  const llmModel = providedModel?.trim() || (providerChanged ? preset.model : current.llmModel || preset.model)
  const llmBaseUrl = input.llmBaseUrl?.trim() || (providerChanged ? preset.baseUrl : current.llmBaseUrl || preset.baseUrl)
  const settings: ServiceSettings = {
    llmProvider,
    llmApiKey,
    llmBaseUrl,
    llmModel,
    openRouterKey: llmApiKey,
    openRouterModel: llmModel,
    falKey: input.falKey === undefined ? current.falKey : input.falKey.trim(),
    arkApiKey: input.arkApiKey === undefined ? current.arkApiKey : input.arkApiKey.trim(),
    arkBaseUrl: input.arkBaseUrl?.trim() || current.arkBaseUrl || DEFAULT_ARK_BASE_URL,
    arkModel: input.arkModel?.trim() || current.arkModel || DEFAULT_ARK_SEEDREAM_MODEL,
    revision: randomUUID(),
    openRouterOk: false,
    llmOk: false,
    falOk: false,
    arkOk: false,
    checkedAt: '',
  }
  writeServiceSettings(settings)
  return settings
}
export function publicServiceStatus(settings = readServiceSettings()) {
  const fresh = Boolean(settings.checkedAt)
  const llmOk = fresh && (settings.llmOk || (settings.llmProvider === 'openrouter' && settings.openRouterOk))
  return {
    llmProvider: settings.llmProvider,
    llmConfigured: Boolean(settings.llmApiKey),
    llmBaseUrl: settings.llmBaseUrl,
    llmModel: settings.llmModel,
    llmOk,
    // Legacy aliases retained for older clients.
    openRouterConfigured: settings.llmProvider === 'openrouter' && Boolean(settings.llmApiKey),
    falConfigured: Boolean(settings.falKey),
    arkConfigured: Boolean(settings.arkApiKey),
    openRouterModel: settings.llmModel,
    arkBaseUrl: settings.arkBaseUrl,
    arkModel: settings.arkModel,
    openRouterOk: settings.llmProvider === 'openrouter' && llmOk,
    falOk: fresh && settings.falOk,
    arkOk: fresh && settings.arkOk,
    // The agent needs one tested language model plus at least one image provider.
    // Existing OpenRouter/fal workspaces remain valid, while direct DeepSeek/MiMo/GLM
    // workspaces can now run with Ark without a second LLM gateway.
    connected: fresh && llmOk && (settings.falOk || settings.arkOk),
    checkedAt: settings.checkedAt,
  }
}
