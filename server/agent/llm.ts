import type { ChatMessage, ToolCall } from './types'
import { Buffer } from 'node:buffer'
import sharp from 'sharp'
import { falReadableUrl } from '../utils/falFiles'
import { llmAuthHeaders, llmChatCompletionsUrl, llmProviderPreset } from '../utils/llmProviders'
import { readStoredMedia } from '../utils/localMedia'
import { readServiceSettings } from '../utils/serviceSettings'
import { agentEnv } from './env'

const MAX_INLINE_IMAGE_BYTES = 30 * 1024 * 1024
const MAX_LLM_INLINE_IMAGE_BYTES = 18 * 1024 * 1024

class LlmImagePayloadTooLargeError extends Error {}

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

export async function providerImageUrl(url: string, compact = false) {
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
  const image = await sharp(local.bytes, { limitInputPixels: 64_000_000 })
    .rotate()
    .resize({ width: compact ? 1024 : 1536, height: compact ? 1024 : 1536, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: compact ? 68 : 82, effort: 4 })
    .toBuffer()
  return `data:image/webp;base64,${Buffer.from(image).toString('base64')}`
}

/** Keep raw bbox coordinates out of LLM text; the model receives the visual overlay instead. */
function messagesForLlm(messages: ChatMessage[]): ChatMessage[] {
  return messages.map(({ historyId: _historyId, internal: _internal, ...message }) => {
    if (message.role !== 'tool' || typeof message.content !== 'string')
      return message
    try {
      const parsed = JSON.parse(message.content) as {
        answers?: Array<Record<string, unknown>>
        [key: string]: unknown
      }
      if (!Array.isArray(parsed.answers))
        return message
      let changed = false
      const answers = parsed.answers.map((answer) => {
        if (answer.questionId !== 'layer_selection_method' || answer.optionId !== 'draw_boxes')
          return answer
        const next: Record<string, unknown> = { ...answer }
        if ('regions' in next) {
          next.boxCount = Array.isArray(next.regions) ? next.regions.length : 0
          delete next.regions
          changed = true
        }
        if (Array.isArray(next.imageSelections)) {
          next.imageSelections = (next.imageSelections as Array<Record<string, unknown>>).map((selection) => {
            const row: Record<string, unknown> = {
              imageUrl: selection.imageUrl,
              boxCount: Array.isArray(selection.regions) ? selection.regions.length : (selection.boxCount || 0),
            }
            if (typeof selection.boxedImageUrl === 'string' && selection.boxedImageUrl)
              row.boxedImageUrl = selection.boxedImageUrl
            changed = true
            return row
          })
        }
        return next
      })
      if (!changed)
        return message
      return { ...message, content: JSON.stringify({ ...parsed, answers }) }
    }
    catch {
      return message
    }
  })
}

export async function providerMessages(messages: ChatMessage[], compact = false) {
  const result: ChatMessage[] = []
  let inlineImageBytes = 0
  for (const { historyId: _historyId, internal: _internal, ...message } of messages) {
    if (!Array.isArray(message.content)) {
      result.push(message)
      continue
    }
    const content = []
    for (const part of message.content) {
      if (part.type !== 'image_url') {
        content.push(part)
        continue
      }
      const url = await providerImageUrl(part.image_url.url, compact)
      if (url.startsWith('data:image/')) {
        const encoded = url.slice(url.indexOf(',') + 1)
        inlineImageBytes += Math.max(0, Math.floor(encoded.length * 3 / 4) - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0))
        if (inlineImageBytes > MAX_LLM_INLINE_IMAGE_BYTES)
          throw new LlmImagePayloadTooLargeError('The image request is too large after optimization. Remove a few images or use smaller files, then try again.')
      }
      content.push({ ...part, image_url: { ...part.image_url, url } })
    }
    result.push({ ...message, content })
  }
  return result
}

async function postWithImageFallback(url: string, init: RequestInit, buildBody: (compact: boolean) => Promise<Record<string, unknown>>) {
  let compact = false
  let body: Record<string, unknown>
  try {
    body = await buildBody(false)
  }
  catch (error) {
    if (!(error instanceof LlmImagePayloadTooLargeError))
      throw error
    compact = true
    body = await buildBody(true)
  }
  let response = await fetch(url, { ...init, body: JSON.stringify(body) })
  if (response.status !== 413)
    return response
  await response.text().catch(() => '')
  if (compact)
    throw new Error('The image request is too large for the selected language model. Remove a few images or use smaller files, then try again.')
  body = await buildBody(true)
  response = await fetch(url, { ...init, body: JSON.stringify(body) })
  if (response.status === 413) {
    await response.text().catch(() => '')
    throw new Error('The image request is too large for the selected language model. Remove a few images or use smaller files, then try again.')
  }
  return response
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
  const response = await postWithImageFallback(llmChatCompletionsUrl(settings.llmProvider, settings.llmBaseUrl), {
    method: 'POST',
    signal: options.signal,
    headers,
  }, async (compact) => {
    return {
      model: settings.llmModel,
      temperature: options.temperature ?? 0.2,
      stream: false,
      ...(settings.llmProvider === 'openrouter' ? { reasoning: { enabled: false } } : {}),
      ...(settings.llmProvider === 'mimo' ? { max_completion_tokens: options.maxTokens ?? 32 } : { max_tokens: options.maxTokens ?? 32 }),
      messages: await providerMessages(messagesForLlm(options.messages), compact),
    }
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
  const response = await postWithImageFallback(llmChatCompletionsUrl(settings.llmProvider, settings.llmBaseUrl), {
    method: 'POST',
    headers,
    signal: options.signal,
  }, async (compact) => {
    return {
      model: settings.llmModel,
      temperature: 0.4,
      stream: true,
      ...(settings.llmProvider === 'openrouter' ? { reasoning: { enabled: false } } : {}),
      messages: await providerMessages(messagesForLlm(options.messages), compact),
      tools: options.tools,
      tool_choice: options.disableTools ? 'none' : options.requiredTool ? { type: 'function', function: { name: options.requiredTool } } : 'auto',
      parallel_tool_calls: !options.requiredTool,
      ...(settings.llmProvider === 'mimo' ? { max_completion_tokens: 4096 } : {}),
    }
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
