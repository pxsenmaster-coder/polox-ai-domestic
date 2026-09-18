import type { ChatMessage, ToolCall } from './types'
import { Buffer } from 'node:buffer'
import { falReadableUrl } from '../utils/falFiles'
import { llmAuthHeaders, llmChatCompletionsUrl, llmProviderPreset } from '../utils/llmProviders'
import { readStoredMedia } from '../utils/localMedia'
import { readServiceSettings } from '../utils/serviceSettings'
import { agentEnv } from './env'

const MAX_INLINE_IMAGE_BYTES = 24 * 1024 * 1024

export interface StreamDelta {
  content?: string
  reasoning?: string
  toolCalls?: Array<{
    index: number
    id?: string
    name?: string
    arguments?: string
  }>
  finishReason?: string | null
}

interface OpenRouterChunk {
  choices?: Array<{
    delta?: {
      content?: string | null
      reasoning?: string | null
      reasoning_content?: string | null
      tool_calls?: Array<{
        index?: number
        id?: string
        function?: {
          name?: string
          arguments?: string
        }
      }>
    }
    finish_reason?: string | null
  }>
  error?: { message?: string }
}

async function providerImageUrl(url: string) {
  const local = await readStoredMedia(url, MAX_INLINE_IMAGE_BYTES)
  // fal remains the preferred CDN hand-off when configured. When it is not
  // configured, send local uploads as data URLs so DeepSeek/MiMo/GLM can still
  // inspect user images without requiring a second paid provider.
  if (!local) {
    return url
  }
  if (readServiceSettings().falKey) {
    return falReadableUrl(url)
  }
  return `data:${local.mime};base64,${Buffer.from(local.bytes).toString('base64')}`
}

async function providerMessages(messages: ChatMessage[]) {
  return Promise.all(messages.map(async ({ historyId: _historyId, internal: _internal, ...message }) => {
    if (!Array.isArray(message.content))
      return message
    const content = await Promise.all(message.content.map(async (part) => {
      if (part.type !== 'image_url')
        return part
      return { ...part, image_url: { ...part.image_url, url: await providerImageUrl(part.image_url.url) } }
    }))
    return { ...message, content }
  }))
}

function providerHeaders() {
  const settings = readServiceSettings()
  const headers: Record<string, string> = {
    ...llmAuthHeaders(settings.llmProvider, agentEnv.llmApiKey),
    'Content-Type': 'application/json',
  }
  if (settings.llmProvider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://polox.ai'
    headers['X-Title'] = 'PoloX Agent Lab'
  }
  return { settings, headers }
}

function providerErrorLabel() {
  return llmProviderPreset(readServiceSettings().llmProvider).label
}

export async function completeText(options: {
  signal?: AbortSignal
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
}) {
  const { settings, headers } = providerHeaders()
  const response = await fetch(llmChatCompletionsUrl(settings.llmProvider, settings.llmBaseUrl), {
    method: 'POST',
    signal: options.signal,
    headers,
    body: JSON.stringify({
      model: settings.llmModel,
      temperature: options.temperature ?? 0.2,
      stream: false,
      ...(settings.llmProvider === 'openrouter' ? { reasoning: { enabled: false } } : {}),
      ...(settings.llmProvider === 'mimo' ? { max_completion_tokens: options.maxTokens ?? 32 } : { max_tokens: options.maxTokens ?? 32 }),
      messages: await providerMessages(options.messages),
    }),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `${providerErrorLabel()} request failed (${response.status})`)
  }

  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string | null } }>
    error?: { message?: string }
  }
  if (payload.error?.message)
    throw new Error(payload.error.message)
  return String(payload.choices?.[0]?.message?.content || '').trim()
}

export async function streamChat(options: {
  messages: ChatMessage[]
  tools: unknown[]
  requiredTool?: string
  disableTools?: boolean
  signal?: AbortSignal
  onDelta: (delta: StreamDelta) => void
}) {
  const { settings, headers } = providerHeaders()
  const response = await fetch(llmChatCompletionsUrl(settings.llmProvider, settings.llmBaseUrl), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: settings.llmModel,
      temperature: 0.4,
      stream: true,
      ...(settings.llmProvider === 'openrouter' ? { reasoning: { enabled: false } } : {}),
      messages: await providerMessages(options.messages),
      tools: options.tools,
      tool_choice: options.disableTools ? 'none' : options.requiredTool ? { type: 'function', function: { name: options.requiredTool } } : 'auto',
      parallel_tool_calls: !options.requiredTool,
      ...(settings.llmProvider === 'mimo' ? { max_completion_tokens: 4096 } : {}),
    }),
    signal: options.signal,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `${providerErrorLabel()} request failed (${response.status})`)
  }

  if (!response.body)
    throw new Error(`${providerErrorLabel()} returned an empty stream`)

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done)
      break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n')
    buffer = parts.pop() || ''
    for (const line of parts) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:'))
        continue
      const data = trimmed.slice(5).trim()
      if (!data || data === '[DONE]')
        continue
      let chunk: OpenRouterChunk
      try {
        chunk = JSON.parse(data) as OpenRouterChunk
      }
      catch {
        continue
      }
      if (chunk.error?.message)
        throw new Error(chunk.error.message)
      const choice = chunk.choices?.[0]
      if (!choice)
        continue
      const delta = choice.delta || {}
      options.onDelta({
        content: delta.content || undefined,
        reasoning: delta.reasoning || delta.reasoning_content || undefined,
        toolCalls: (delta.tool_calls || []).map(item => ({
          index: item.index ?? 0,
          id: item.id,
          name: item.function?.name,
          arguments: item.function?.arguments,
        })),
        finishReason: choice.finish_reason,
      })
    }
  }
}

export function assembleToolCalls(parts: Array<{ index: number, id?: string, name?: string, arguments?: string }>): ToolCall[] {
  const byIndex = new Map<number, { id: string, name: string, arguments: string }>()
  for (const part of parts) {
    const current = byIndex.get(part.index) || { id: '', name: '', arguments: '' }
    if (part.id)
      current.id = part.id
    if (part.name)
      current.name = part.name
    if (part.arguments)
      current.arguments += part.arguments
    byIndex.set(part.index, current)
  }
  return [...byIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, value]) => ({
      id: value.id || crypto.randomUUID(),
      type: 'function' as const,
      function: {
        name: value.name,
        arguments: value.arguments || '{}',
      },
    }))
}
