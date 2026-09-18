import { readServiceSettings } from '../utils/serviceSettings'

export const agentEnv = {
  get llmProvider() { return readServiceSettings().llmProvider },
  get llmApiKey() {
    const settings = readServiceSettings()
    return settings.llmApiKey || settings.openRouterKey
  },
  get llmBaseUrl() { return readServiceSettings().llmBaseUrl },
  get llmModel() {
    const settings = readServiceSettings()
    return settings.llmModel || settings.openRouterModel
  },
  // Compatibility aliases for code and integrations that still use the old name.
  get openRouterApiKey() { return readServiceSettings().llmApiKey },
  get falApiKey() { return readServiceSettings().falKey },
  get arkApiKey() { return readServiceSettings().arkApiKey },
  get model() { return readServiceSettings().llmModel },
}
export function assertAgentSecrets() {
  if (!agentEnv.llmApiKey || (!agentEnv.falApiKey && !agentEnv.arkApiKey))
    throw new Error('Configure a language model (OpenRouter, DeepSeek, MiMo or GLM) and at least one image provider (fal or Ark) using Service connection in the top-right corner.')
}
