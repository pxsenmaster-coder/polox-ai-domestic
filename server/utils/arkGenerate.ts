import type { IGenerationJob } from '../models/generationJob'
import type { StoredDocument } from './sqlite'
import { Buffer } from 'node:buffer'
import { readErrorMessage } from '~~/shared/utils/apiError'
import { arkRequestModel, DEFAULT_ARK_BASE_URL, isArkGenerateModel } from '~~/shared/utils/arkSeedream'
import { toUpstreamApiError } from './httpError'
import { readStoredMedia } from './localMedia'
import { readServiceSettings } from './serviceSettings'

const MAX_INPUT_IMAGE_BYTES = 15 * 1024 * 1024

export function isArkModel(model: string) {
  return isArkGenerateModel(model)
}

function baseUrl(value: string) {
  const raw = value.trim() || DEFAULT_ARK_BASE_URL
  let url: URL
  try {
    url = new URL(raw)
  }
  catch {
    throw createError({ statusCode: 400, statusMessage: 'Ark base URL is invalid' })
  }
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.volces.com'))
    throw createError({ statusCode: 400, statusMessage: 'Ark base URL must be an HTTPS volcengine endpoint' })
  return url.href.replace(/\/$/, '')
}

function arkCredentials() {
  const settings = readServiceSettings()
  if (!settings.arkApiKey) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Ark API key is not configured',
    })
  }
  return {
    apiKey: settings.arkApiKey,
    baseUrl: baseUrl(settings.arkBaseUrl),
    model: settings.arkModel,
  }
}

async function arkReadableUrl(url: string) {
  const local = await readStoredMedia(url, MAX_INPUT_IMAGE_BYTES)
  if (!local)
    return url
  return `data:${local.mime};base64,${Buffer.from(local.bytes).toString('base64')}`
}

async function prepareArkInput(input: Record<string, unknown>) {
  const output = { ...input }
  const value = input.image_urls
  if (Array.isArray(value))
    output.image_urls = await Promise.all(value.map(item => typeof item === 'string' ? arkReadableUrl(item) : item))
  return output
}

function readPayload(text: string) {
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  }
  catch {
    return {}
  }
}

function arkErrorMessage(payload: Record<string, unknown>, fallback: string) {
  const error = payload.error
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim())
      return message.trim()
  }
  return readErrorMessage(payload, fallback)
}

function resultUrls(payload: Record<string, unknown>) {
  const data = Array.isArray(payload.data) ? payload.data : []
  const urls = data
    .map((item) => {
      if (!item || typeof item !== 'object')
        return ''
      const url = (item as { url?: unknown }).url
      return typeof url === 'string' && /^https?:\/\//i.test(url) ? url : ''
    })
    .filter(Boolean)
  if (urls.length)
    return urls
  const images = Array.isArray(payload.images) ? payload.images : []
  return images
    .map(item => item && typeof item === 'object' ? (item as { url?: unknown }).url : '')
    .filter((url): url is string => typeof url === 'string' && /^https?:\/\//i.test(url))
}

export async function createArkTask(model: string, input: Record<string, unknown>) {
  if (!isArkGenerateModel(model))
    throw createError({ statusCode: 400, statusMessage: 'Unknown Ark model' })
  const credentials = arkCredentials()
  const prepared = await prepareArkInput(input)
  const images = Array.isArray(prepared.image_urls)
    ? prepared.image_urls.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : []
  const body: Record<string, unknown> = {
    model: arkRequestModel(model, credentials.model),
    prompt: String(prepared.prompt || '').trim(),
    response_format: 'url',
    size: String(prepared.size || '2K'),
    watermark: prepared.watermark === true,
  }
  if (images.length)
    body.image = images
  try {
    const response = await fetch(`${credentials.baseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${credentials.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    })
    const payload = readPayload(await response.text())
    if (!response.ok)
      throw Object.assign(new Error(arkErrorMessage(payload, `Ark generation failed (${response.status})`)), { statusCode: response.status, data: payload })
    const urls = resultUrls(payload)
    if (!urls.length)
      throw Object.assign(new Error('Ark returned no result URLs'), { statusCode: 502, data: payload })
    return {
      requestId: String(payload.id || `ark_${crypto.randomUUID()}`).trim(),
      urls,
      payload,
      requestBody: body,
    }
  }
  catch (error) {
    throw toUpstreamApiError(error, 'Failed to create Ark Seedream task')
  }
}

/** Ark image generation is synchronous; the queue stores its result and archives it locally. */
export async function syncJobFromArk(job: StoredDocument<IGenerationJob>) {
  if (job.provider !== 'ark')
    return job
  if (!job.resultUrls.length && job.state !== 'fail') {
    job.state = 'fail'
    job.failMsg = 'Ark returned no result URLs'
    await job.save()
  }
  return job
}
