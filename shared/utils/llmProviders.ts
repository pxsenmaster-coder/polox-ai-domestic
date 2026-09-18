export type LlmProvider = 'openrouter' | 'deepseek' | 'mimo' | 'glm'

export interface LlmProviderPreset {
  label: string
  baseUrl: string
  model: string
  keyUrl: string
  keyHeader: 'authorization' | 'api-key'
}

export const LLM_PROVIDER_PRESETS: Record<LlmProvider, LlmProviderPreset> = {
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'deepseek/deepseek-v4-flash-vision-exp',
    keyUrl: 'https://openrouter.ai/workspaces/default/keys',
    keyHeader: 'authorization',
  },
  deepseek: {
    label: 'DeepSeek 直连',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash-vision-exp',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    keyHeader: 'authorization',
  },
  mimo: {
    label: '小米 MiMo 直连',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    model: 'mimo-v2.5-pro',
    keyUrl: 'https://platform.xiaomimimo.com/console/api-keys',
    keyHeader: 'api-key',
  },
  glm: {
    label: '智谱 GLM 直连',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-5.3-flash',
    keyUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
    keyHeader: 'authorization',
  },
}

export function normalizeLlmProvider(value: unknown): LlmProvider {
  return value === 'deepseek' || value === 'mimo' || value === 'glm' || value === 'openrouter' ? value : 'openrouter'
}
