<script setup lang="ts">
import type { LlmProvider } from '~~/shared/utils/llmProviders'
import { AlertTriangle, CheckCircle2, LoaderCircle } from 'lucide-vue-next'
import { LLM_PROVIDER_PRESETS, normalizeLlmProvider } from '~~/shared/utils/llmProviders'
import { useServiceConnection } from '~/composables/useServiceConnection'

interface ConnectionStatus {
  connected: boolean
  llmProvider: LlmProvider
  llmConfigured: boolean
  llmBaseUrl: string
  llmModel: string
  llmOk: boolean
  openRouterConfigured: boolean
  falConfigured: boolean
  arkConfigured: boolean
  openRouterModel: string
  arkBaseUrl: string
  arkModel: string
  openRouterOk: boolean
  falOk: boolean
  arkOk: boolean
  checkedAt: string
}
interface ConnectionResult {
  llm: { ok: boolean, message: string }
  openRouter: { ok: boolean, message: string }
  fal: { ok: boolean, message: string }
  ark: { ok: boolean, message: string }
}
const status = ref<ConnectionStatus | null>(null)
const { dialogOpen: open } = useServiceConnection()
const testing = ref(false)
const MASKED_KEY = '********'
const llmProvider = ref<LlmProvider>('openrouter')
const llmApiKey = ref('')
const llmBaseUrl = ref('')
const llmModel = ref('')
const falKey = ref('')
const arkApiKey = ref('')
const arkBaseUrl = ref('')
const arkModel = ref('')
function showSavedKeys() {
  llmApiKey.value = status.value?.llmConfigured ? MASKED_KEY : ''
  falKey.value = status.value?.falConfigured ? MASKED_KEY : ''
  arkApiKey.value = status.value?.arkConfigured ? MASKED_KEY : ''
}
function selectKey(event: FocusEvent) {
  (event.target as HTMLInputElement).select()
}
const error = ref('')
const results = ref<ConnectionResult | null>(null)
const connected = computed(() => Boolean(status.value?.connected))
const providerPreset = computed(() => LLM_PROVIDER_PRESETS[llmProvider.value])
const providerOptions = Object.entries(LLM_PROVIDER_PRESETS) as [LlmProvider, (typeof LLM_PROVIDER_PRESETS)[LlmProvider]][]
watch(llmProvider, (provider, previous) => {
  // Opening the dialog hydrates the saved provider; do not treat that as a
  // user switch or clear the masked key before the form is displayed.
  if (provider === previous)
    return
  if (provider === status.value?.llmProvider) {
    llmApiKey.value = status.value?.llmConfigured ? MASKED_KEY : ''
    return
  }
  const preset = LLM_PROVIDER_PRESETS[provider]
  llmApiKey.value = ''
  llmBaseUrl.value = preset.baseUrl
  llmModel.value = preset.model
  results.value = null
})
async function refresh() {
  try { status.value = await $fetch<ConnectionStatus>('/api/settings/services') }
  catch { status.value = null }
}
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  refresh()
  timer = setInterval(refresh, 30000)
})
onUnmounted(() => clearInterval(timer))
watch(open, async (value) => {
  llmApiKey.value = ''
  falKey.value = ''
  arkApiKey.value = ''
  arkBaseUrl.value = ''
  arkModel.value = ''
  if (!value)
    return
  await refresh()
  llmProvider.value = normalizeLlmProvider(status.value?.llmProvider)
  const preset = LLM_PROVIDER_PRESETS[llmProvider.value]
  llmBaseUrl.value = status.value?.llmBaseUrl || preset.baseUrl
  llmModel.value = status.value?.llmModel || preset.model
  arkBaseUrl.value = status.value?.arkBaseUrl || 'https://ark.cn-beijing.volces.com/api/v3'
  arkModel.value = status.value?.arkModel || 'doubao-seedream-5-0-pro-260628'
  // Apply the provider first so its change watcher cannot erase a saved key.
  showSavedKeys()
  results.value = null
  error.value = ''
})
async function testConnection() {
  testing.value = true
  results.value = null
  error.value = ''
  // A new test invalidates the previous green indicator immediately.
  if (status.value)
    status.value.connected = false
  try {
    const result = await $fetch<ConnectionStatus & ConnectionResult & { superseded: boolean }>('/api/settings/services', {
      method: 'POST',
      body: {
        llmProvider: llmProvider.value,
        llmApiKey: llmApiKey.value === MASKED_KEY ? undefined : llmApiKey.value,
        llmBaseUrl: llmBaseUrl.value,
        llmModel: llmModel.value,
        falKey: falKey.value === MASKED_KEY ? undefined : falKey.value,
        arkApiKey: arkApiKey.value === MASKED_KEY ? undefined : arkApiKey.value,
        arkBaseUrl: arkBaseUrl.value,
        arkModel: arkModel.value,
      },
      timeout: 65000,
    })
    status.value = result
    results.value = result
    if (result.superseded)
      error.value = 'Settings changed in another window. Test the current settings again.'
    showSavedKeys()
  }
  catch { error.value = 'Connection test could not finish. Please try again.'; await refresh() }
  finally { testing.value = false }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogTrigger as-child>
      <button type="button" class="inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" :class="connected ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'" aria-label="Service connection" :title="connected ? 'Language model and an image provider tested successfully' : 'Configure and test a language model and an image provider'">
        <CheckCircle2 v-if="connected" class="size-4" />
        <AlertTriangle v-else class="size-4" />
        <span>{{ connected ? 'Services connected' : 'API keys not configured' }}</span>
      </button>
    </DialogTrigger>
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Service connection</DialogTitle>
        <DialogDescription>Connect a language model (OpenRouter、DeepSeek、MiMo 或 GLM) and at least one image provider (fal or Ark) to start creating. Your keys are stored locally on this computer. Keep your API keys private. Never share them with anyone.</DialogDescription>
      </DialogHeader>
      <form class="space-y-4" @submit.prevent="testConnection">
        <div class="space-y-2">
          <div class="flex items-center gap-3">
            <Label for="llm-provider">大模型服务</Label>
          </div>
          <Select v-model="llmProvider" :disabled="testing">
            <SelectTrigger id="llm-provider" class="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="([id, preset]) in providerOptions" :key="id" :value="id">
                {{ preset.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div class="space-y-2">
          <div class="flex items-center gap-3">
            <Label for="llm-key">{{ providerPreset.label }} API Key</Label>
            <a :href="providerPreset.keyUrl" target="_blank" rel="noopener noreferrer" class="text-xs text-primary underline underline-offset-4 hover:opacity-80">获取 API Key ↗</a>
          </div>
          <Input id="llm-key" v-model="llmApiKey" type="password" autocomplete="off" :disabled="testing" :placeholder="`输入 ${providerPreset.label} API Key`" @focus="selectKey" />
        </div>
        <div class="grid gap-2">
          <Label for="llm-base-url">Base URL</Label>
          <Input id="llm-base-url" v-model="llmBaseUrl" required autocomplete="off" :disabled="testing" />
        </div>
        <div class="space-y-2">
          <Label for="llm-model">{{ providerPreset.label }} 模型 ID</Label>
          <Input id="llm-model" v-model="llmModel" required autocomplete="off" :disabled="testing" :placeholder="providerPreset.model" />
          <p class="text-xs text-muted-foreground">
            DeepSeek 推荐使用支持图片理解的 <code>deepseek-v4-flash-vision-exp</code>；MiMo 默认使用 <code>mimo-v2.5-pro</code>；GLM 默认使用多模态 <code>glm-5.3-flash</code>。
          </p>
        </div>
        <div class="space-y-2">
          <div class="flex items-center gap-3">
            <Label for="fal-key">fal API key</Label>
            <a href="https://fal.ai/login?returnTo=%2Fdashboard%2Fkeys" target="_blank" rel="noopener noreferrer" class="text-xs text-primary underline underline-offset-4 hover:opacity-80" aria-label="Get fal API key (opens in a new tab)">Get API key ↗</a>
          </div>
          <Input id="fal-key" v-model="falKey" type="password" autocomplete="off" :disabled="testing" placeholder="Enter your fal API key" @focus="selectKey" />
        </div>
        <div class="space-y-3 rounded-md border p-3">
          <div class="flex items-center justify-between gap-3">
            <Label for="ark-key">火山方舟 API key</Label>
            <a href="https://console.volcengine.com/ark/region:cn-beijing/apikey" target="_blank" rel="noopener noreferrer" class="text-xs text-primary underline underline-offset-4 hover:opacity-80" aria-label="Get Ark API key (opens in a new tab)">获取 API Key ↗</a>
          </div>
          <Input id="ark-key" v-model="arkApiKey" type="password" autocomplete="off" :disabled="testing" placeholder="可选：输入方舟 API Key" @focus="selectKey" />
          <div class="grid gap-2">
            <Label for="ark-base-url">Ark Base URL</Label>
            <Input id="ark-base-url" v-model="arkBaseUrl" autocomplete="off" :disabled="testing" placeholder="https://ark.cn-beijing.volces.com/api/v3" />
          </div>
          <div class="grid gap-2">
            <Label for="ark-model">Seedream 5.0 Pro 模型 ID</Label>
            <Input id="ark-model" v-model="arkModel" required autocomplete="off" :disabled="testing" placeholder="控制台中的模型 ID" />
          </div>
          <p class="text-xs text-muted-foreground">
            Ark 配置为可选项；填写后会通过 GET /models 验证密钥，不会发起付费生图。
          </p>
        </div>
        <p class="text-xs text-muted-foreground">
          Clear a key to remove it when you test and save. Testing saves your settings, sends a short request to the selected language model, checks fal authentication/file upload, and verifies Ark authentication when configured. The model request may incur a small charge.
        </p>
        <div v-if="results" class="space-y-2 rounded-md border p-3 text-sm" role="status" aria-live="polite">
          <p :class="results.llm.ok ? 'text-emerald-600' : 'text-red-600'">
            {{ results.llm.ok ? '✓' : '⚠' }} {{ results.llm.message }}
          </p>
          <p :class="results.fal.ok ? 'text-emerald-600' : 'text-red-600'">
            {{ results.fal.ok ? '✓' : '⚠' }} {{ results.fal.message }}
          </p>
          <p :class="results.ark.ok ? 'text-emerald-600' : 'text-red-600'">
            {{ results.ark.ok ? '✓' : '⚠' }} {{ results.ark.message }}
          </p>
        </div>
        <p v-if="error" role="alert" class="text-sm text-red-600">
          {{ error }}
        </p>
        <DialogFooter>
          <Button type="submit" :disabled="testing || !llmModel.trim()">
            <LoaderCircle v-if="testing" class="mr-2 size-4 animate-spin" />
            {{ testing ? 'Testing connections…' : 'Test connection' }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
